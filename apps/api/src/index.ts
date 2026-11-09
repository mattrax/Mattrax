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
  scimRoutes,
  makeAppAuth,
  makeAuthLive,
  makeSsoStrategy,
  makeEnterpriseAuthLive,
  sessionCookie,
} from "@mattrax/enterprise-backend";
import { platformApi } from "@mattrax/platform-api";
import { PlatformServiceLive, platformHandlers } from "@mattrax/platform-backend";
import { appleMdmHandlers, appleMdmRoutes } from "@mattrax/dm-apple";
import { windowsMdmRoutes, WindowsMdmServiceLive } from "@mattrax/dm-windows";
import { scepRoutes } from "@mattrax/scep";
import { AppleMdmConfig, AppleMdmService, AppleMdmTopic } from "@mattrax/dm-apple";
import { ScepService } from "@mattrax/scep";
import {
  ManagementBackendEnterpriseLive,
  ScepRepositoryLive,
} from "@mattrax/management-backend-enterprise";
import { Db, Env as CoreEnv, R2 } from "@mattrax/enterprise-core";
import { ApnsService, NoopPushTransport, RelayPushTransport, makeApnsService } from "@mattrax/apns";
import { MysqlClient } from "@effect/sql-mysql2";
import { StripeService } from "@mattrax/effect-stripe";
import { env as apiEnv } from "./env.js";
import { ssoRoutes } from "./sso.js";
import { AzureOidcLive } from "@mattrax/azure-oidc";
import { FetchHttpClient } from "effect/http";
import { listDevEmails, recordDevEmail } from "./devMailbox.js";

const rateLimitWindow = new Map<string, { count: number; resetAt: number }>();
const sensitiveAuthPaths = new Set([
  "/api/v1/signIn",
  "/api/v1/register",
  "/api/v1/requestReset",
  "/api/v1/requestEmailCode",
  "/api/v1/beginEmailSignIn",
  "/api/v1/completeEmailCode",
  "/api/v1/ssoSignIn",
  "/api/v1/verifyEmail",
]);

const tooManyRequests = (request: Request) => {
  const url = new URL(request.url);
  if (request.method !== "POST" || !sensitiveAuthPaths.has(url.pathname)) return false;
  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "local";
  const now = Date.now();
  const entry = rateLimitWindow.get(ip);
  if (!entry || entry.resetAt <= now) {
    rateLimitWindow.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  entry.count += 1;
  return entry.count > 120;
};

const appAuth = makeAppAuth(apiEnv.ORIGIN, apiEnv.AUTH_RESET_URL, {
  sso: makeSsoStrategy(),
});
const authHttp = AuthContract.httpGroup(AuthApi);
const authHttps = Http.make(appAuth, {
  origin: apiEnv.ORIGIN,
  cookie: { name: sessionCookie },
  trustedOrigins: apiEnv.TRUSTED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
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
  HttpRouter.add(
    "GET",
    "/api/version",
    HttpServerResponse.json({ version } satisfies { version: string }),
  ),
);

const apiLayer = Layer.mergeAll(
  HttpApiBuilder.layer(apiRoot, { openapiPath: "/api/openapi.json" }).pipe(
    Layer.provide(handlersLayer),
  ),
  HttpApiScalar.layerCdn(apiRoot, { path: "/api/docs" }),
  appleMdmRoutes,
  windowsMdmRoutes,
  scepRoutes,
  scimRoutes,
);

const appLayer = apiLayer.pipe(Layer.provide(HttpServer.layerServices));

const makeAppLayer = (env: Env, request: Request) => {
  const staticEnvLayer = CoreEnv.layer({
    origin: env.ORIGIN,
    cloudAppleVendorCert: env.CLOUD_APPLE_VENDOR_CERT,
    cloudAppleVendorKey: env.CLOUD_APPLE_VENDOR_KEY,
    authSecret: env.AUTH_SECRET,
  });

  const appleMdmConfigLayer = AppleMdmConfig.layer({
    origin: env.ORIGIN,
    cloudAppleVendorCert: env.CLOUD_APPLE_VENDOR_CERT,
    cloudAppleVendorKey: env.CLOUD_APPLE_VENDOR_KEY,
    authSecret: env.AUTH_SECRET,
  });

  // Hosted Cloud cannot attach a per-tenant client certificate to `fetch`, so
  // pushes go through the HMAC-signed relay. Without a relay the service is a
  // no-op: devices still poll for DDM changes, so policy still converges.
  const apns = makeApnsService(
    env.APNS_RELAY_URL && env.APNS_RELAY_SECRET
      ? RelayPushTransport({ url: env.APNS_RELAY_URL, secret: env.APNS_RELAY_SECRET })
      : NoopPushTransport(
          "APNs push relay is not configured; devices will poll for changes instead",
        ),
  );
  const apnsLayer = Layer.succeed(ApnsService, apns);

  const devMailbox = (env as unknown as { DEV_MAILBOX?: string }).DEV_MAILBOX === "true";
  const devEmail = devMailbox
    ? {
        send: async (message: { to: string; subject: string; text?: string; html?: string }) => {
          recordDevEmail({
            to: message.to,
            subject: message.subject,
            text: message.text ?? "",
            html: message.html,
          });
          console.log("DEV EMAIL", message.to, message.subject, message.text);
        },
      }
    : undefined;
  const email = devEmail ?? (env as any).EMAIL;

  const authLive = makeAuthLive({
    appAuth,
    cryptoLayer: Workerd.layer,
    proofSchedulerLayer,
    email,
    authSecret: env.AUTH_SECRET,
    origin: env.ORIGIN,
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

  const managementBackendLayer = ManagementBackendEnterpriseLive.layer(env.ORIGIN, {
    apns,
    authSecret: env.AUTH_SECRET,
    // Windows discovery/enrollment has no tenant identity. Cloud falls back to
    // the earliest organization; set this to pin Windows devices to one tenant.
    windowsOrganizationId: apiEnv.WINDOWS_ORGANIZATION_ID,
    requireWindowsDeviceIdentity: true,
    requireAppleDeviceIdentity: true,
  }).pipe(Layer.provide(Db.layer));

  const servicesLayer = Layer.mergeAll(
    EnterpriseService({ email }).pipe(
      Layer.provide(enterpriseAuthLive),
      Layer.provide(staticEnvLayer),
      Layer.provide(StripeService.layer(env.STRIPE_SECRET_KEY)),
      Layer.provide(R2.layer(storageBucket)),
      Layer.provide(apnsLayer),
      Layer.provide(Db.layer),
    ),
    AppleMdmService.layer.pipe(
      Layer.provide(AppleMdmTopic.layer),
      Layer.provide(managementBackendLayer),
      Layer.provide(appleMdmConfigLayer),
    ),
    WindowsMdmServiceLive({ origin: env.ORIGIN }).pipe(Layer.provide(managementBackendLayer)),
    ScepService.pipe(
      Layer.provide(
        ScepRepositoryLive.layerWithOptions({ authSecret: env.AUTH_SECRET }).pipe(
          Layer.provide(Db.layer),
        ),
      ),
    ),
    PlatformServiceLive({
      cloudAppleVendorCert: env.CLOUD_APPLE_VENDOR_CERT,
      cloudAppleVendorKey: env.CLOUD_APPLE_VENDOR_KEY,
    }).pipe(Layer.provide(enterpriseAuthLive), Layer.provide(Db.layer)),
    AzureOidcLive().pipe(Layer.provide(FetchHttpClient.layer)),
  );

  const appWithDevRoutes = Layer.mergeAll(
    appLayer,
    ssoRoutes({
      origin: env.ORIGIN,
      clientId: env.AZURE_CLIENT_ID,
      clientSecret: env.AZURE_CLIENT_SECRET,
      authSecret: env.AUTH_SECRET,
    }).pipe(Layer.provide(HttpServer.layerServices)),
    ...(devMailbox
      ? [
          HttpRouter.add("GET", "/api/debug/emails", HttpServerResponse.json(listDevEmails())).pipe(
            Layer.provide(HttpServer.layerServices),
          ),
        ]
      : []),
  );

  return appWithDevRoutes.pipe(
    Layer.provide(servicesLayer),
    Layer.provide(authLive),
    Layer.provide(proofContextLayer),
    Layer.provideMerge(Db.layer),
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
    if (tooManyRequests(request))
      return new Response("Too Many Requests", {
        status: 429,
        headers: { "retry-after": "60", "content-type": "text/plain" },
      });

    // Device identity must come from the verified mTLS handshake, never from a
    // caller-supplied header. Cloudflare exposes the certificate subject here.
    const headers = new Headers(request.headers);
    headers.delete("x-device-identity-certificate");
    const tls = (
      request as unknown as {
        cf?: { tlsClientAuth?: { certVerified?: string; certSubjectDN?: string } };
      }
    ).cf?.tlsClientAuth;
    if (tls?.certVerified === "SUCCESS" && tls.certSubjectDN)
      headers.set("x-device-identity-certificate", tls.certSubjectDN);
    const deviceRequest = new Request(request, { headers });

    const { handler, dispose } = HttpRouter.toWebHandler(makeAppLayer(env, deviceRequest) as any);
    const context = Context.makeUnsafe<any>(new Map());
    const response = await handler(deviceRequest, context);
    waitUntil(dispose().catch((cause) => console.error("Layer dispose failed", cause)));
    return response;
  },
} satisfies ExportedHandler<Env>;
