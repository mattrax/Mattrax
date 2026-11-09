import { Context, Effect, Layer, Redacted } from "effect";
import { HttpApi, HttpApiBuilder, HttpApiScalar, OpenApi } from "effect/http-api";
import { HttpRouter, HttpServer, HttpServerResponse } from "effect/http";
import { waitUntil } from "cloudflare:workers";
import { version } from "../package.json" with { type: "json" };
import { AuthContract, Http, Proofs } from "@yielded/auth";
import * as Workerd from "@yielded/auth-platform-workerd";
import { AuthApi, enterpriseApi } from "@mattrax/enterprise-domain";
import { appleMdmApi } from "@mattrax/dm-apple";
import {
  EnterpriseService,
  enterpriseHandlers,
  makeAppAuth,
  makeAuthLive,
  makeEnterpriseAuthLive,
  sessionCookie,
} from "@mattrax/enterprise-backend";
import { platformApi } from "@mattrax/platform-api";
import { platformHandlers } from "@mattrax/platform-backend";
import { appleMdmHandlers, appleMdmRoutes } from "@mattrax/dm-apple";
import { scepRoutes } from "@mattrax/scep";
import { AppleMdmService, AppleMdmTopic } from "@mattrax/dm-apple";
import { ScepService } from "@mattrax/scep";
import {
  ManagementBackendEnterpriseLive,
  ScepRepositoryLive,
} from "@mattrax/management-backend-enterprise";
import { Db, Env as CoreEnv, R2 } from "@mattrax/enterprise-core";
import { MysqlClient } from "@effect/sql-mysql2";
import { StripeService } from "@mattrax/effect-stripe";
import { env as apiEnv } from "./env.js";

const appAuth = makeAppAuth(apiEnv.ORIGIN);
const authHttp = AuthContract.httpGroup(AuthApi);
const authHttps = Http.make(appAuth, {
  origin: apiEnv.ORIGIN,
  cookie: { name: sessionCookie },
});

// Proof delivery (password reset email) is queued by Auth with no remaining
// services. Hand it to `waitUntil` so the Worker stays alive after the response
// instead of interrupting the request-scoped auth layer.
const proofSchedulerLayer = Layer.succeed(Proofs.ProofDispatchScheduler, {
  schedule: (work: Effect.Effect<void>) =>
    Effect.sync(() => {
      waitUntil(Effect.runPromise(work));
    }),
});

const apiRoot = HttpApi.make("Mattrax")
  .add(enterpriseApi)
  .add(authHttp)
  .add(appleMdmApi)
  .add(platformApi)
  .annotateMerge(
    OpenApi.annotations({
      title: "Mattrax Cloud API",
      version,
      description: "The Mattrax Cloud API",
      servers: [{ url: "/" }],
    }),
  );

const applicationHandlers = Layer.mergeAll(
  HttpApiBuilder.group(apiRoot, "EnterpriseApi", enterpriseHandlers),
  HttpApiBuilder.group(apiRoot, "AppleDM", appleMdmHandlers),
  HttpApiBuilder.group(apiRoot, "PlatformApi", platformHandlers),
).pipe(authHttps.middleware);

const handlersLayer = Layer.mergeAll(
  applicationHandlers,
  authHttps.handlers(apiRoot),
  HttpRouter.add("GET", "/api/health", HttpServerResponse.text("ok")),
  HttpRouter.add("GET", "/health", HttpServerResponse.text("ok")),
);

const apiLayer = Layer.mergeAll(
  HttpApiBuilder.layer(apiRoot, { openapiPath: "/api/openapi.json" }).pipe(
    Layer.provide(handlersLayer),
  ),
  HttpApiScalar.layerCdn(apiRoot, { path: "/api/docs" }),
  appleMdmRoutes,
  scepRoutes,
);

const appLayer = apiLayer.pipe(Layer.provide(HttpServer.layerServices));

const makeAppLayer = (env: Env, request: Request) => {
  const staticEnvLayer = CoreEnv.layer({
    origin: env.ORIGIN,
    cloudAppleVendorCert: env.CLOUD_APPLE_VENDOR_CERT,
  });

  const authLive = makeAuthLive({
    appAuth,
    cryptoLayer: Workerd.layer,
    proofSchedulerLayer,
    email: (env as any).EMAIL,
  }).pipe(Layer.provide(Db.layer));

  const enterpriseAuthLive = makeEnterpriseAuthLive({
    appAuth,
    origin: env.ORIGIN,
    authSecret: env.AUTH_SECRET,
    email: (env as any).EMAIL,
  });

  const proofContextLayer: Layer.Layer<Proofs.ProofRequestContext> = Layer.succeed(
    Proofs.ProofRequestContext,
    Effect.succeed({
      networkKey: Redacted.make(request.headers.get("cf-connecting-ip") ?? "local"),
    }),
  );

  const storageBucket: Parameters<typeof R2.layer>[0] = {
    head: (key) => env.STORAGE.head(key),
    get: (key) => env.STORAGE.get(key),
    put: (key, value, options) => env.STORAGE.put(key, value, options),
    delete: (keys) => env.STORAGE.delete(typeof keys === "string" ? keys : [...keys]),
    list: () => env.STORAGE.list(),
  };

  const servicesLayer = Layer.mergeAll(
    EnterpriseService.pipe(
      Layer.provide(enterpriseAuthLive),
      Layer.provide(staticEnvLayer),
      Layer.provide(StripeService.layer(env.STRIPE_SECRET_KEY)),
      Layer.provide(R2.layer(storageBucket)),
      Layer.provide(Db.layer),
    ),
    AppleMdmService.layer.pipe(
      Layer.provide(AppleMdmTopic.layer),
      Layer.provide(
        ManagementBackendEnterpriseLive.layer(env.ORIGIN).pipe(Layer.provide(Db.layer)),
      ),
      Layer.provide(staticEnvLayer),
    ),
    ScepService.pipe(Layer.provide(ScepRepositoryLive.layer.pipe(Layer.provide(Db.layer)))),
  );

  return appLayer.pipe(
    Layer.provide(servicesLayer),
    Layer.provide(authLive),
    Layer.provide(proofContextLayer),
    Layer.provide(Db.layer),
    Layer.provide(
      MysqlClient.layer({
        // Hyperdrive exposes individual connection fields for MySQL. Do not
        // pass `url`: `@effect/sql-mysql2` ignores `poolConfig` when it is set,
        // which would silently drop `disableEval` and break Workers builds.
        host: env.HYPERDRIVE.host,
        port: env.HYPERDRIVE.port,
        username: env.HYPERDRIVE.user,
        password: Redacted.make(env.HYPERDRIVE.password),
        database: env.HYPERDRIVE.database,
        // `mysql2` uses `eval` for some protocol decoding; Workers forbids it.
        // `timezone: "Z"` keeps `DATETIME(3)` reads/writes UTC, matching the
        // `toISOString()` encoding Drizzle uses for `datetime` columns.
        poolConfig: { disableEval: true, timezone: "Z" },
        // Hyperdrive rejects MySQL `COM_STMT_PREPARE`; use the text protocol.
        disablePreparedStatements: true,
      }),
    ),
  );
};

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const { handler, dispose } = HttpRouter.toWebHandler(makeAppLayer(env, request) as any);
    const context = Context.makeUnsafe<any>(new Map());
    const response = await handler(request, context);
    waitUntil(dispose().catch((cause) => console.error("Layer dispose failed", cause)));
    return response;
  },
} satisfies ExportedHandler<Env>;
