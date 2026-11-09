import { Context, Layer, Redacted } from "effect";
import { HttpApi, HttpApiBuilder, HttpApiScalar, OpenApi } from "effect/http-api";
import { HttpRouter, HttpServer, HttpServerResponse } from "effect/http";
import { waitUntil } from "cloudflare:workers";
import { version } from "../package.json" with { type: "json" };
import { enterpriseApi } from "@mattrax/enterprise-domain";
import { appleMdmApi } from "@mattrax/dm-apple";
import {
  EnterpriseAuthLive,
  EnterpriseService,
  enterpriseHandlers,
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
import { PgClient } from "@effect/sql-pg";
import { StripeService } from "@mattrax/effect-stripe";
import "./env.js";

const apiRoot = HttpApi.make("Mattrax")
  .add(enterpriseApi)
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

const handlersLayer = Layer.mergeAll(
  HttpApiBuilder.group(apiRoot, "EnterpriseApi", enterpriseHandlers),
  HttpApiBuilder.group(apiRoot, "AppleDM", appleMdmHandlers),
  HttpApiBuilder.group(apiRoot, "PlatformApi", platformHandlers),
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

const makeAppLayer = (env: Env) => {
  const staticEnvLayer = CoreEnv.layer({
    origin: env.ORIGIN,
    cloudAppleVendorCert: env.CLOUD_APPLE_VENDOR_CERT,
  });

  const storageBucket: Parameters<typeof R2.layer>[0] = {
    head: (key) => env.STORAGE.head(key),
    get: (key) => env.STORAGE.get(key),
    put: (key, value, options) => env.STORAGE.put(key, value, options),
    delete: (keys) => env.STORAGE.delete(typeof keys === "string" ? keys : [...keys]),
    list: () => env.STORAGE.list(),
  };

  const servicesLayer = Layer.mergeAll(
    EnterpriseService.pipe(
      Layer.provide(EnterpriseAuthLive),
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
    Layer.provide(
      PgClient.layer({
        url: Redacted.make(env.HYPERDRIVE.connectionString),
      }),
    ),
  );
};

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const { handler, dispose } = HttpRouter.toWebHandler(makeAppLayer(env));
    const context = Context.makeUnsafe<any>(new Map());
    const response = await handler(request, context);
    waitUntil(dispose().catch((cause) => console.error("Layer dispose failed", cause)));
    return response;
  },
} satisfies ExportedHandler<Env>;
