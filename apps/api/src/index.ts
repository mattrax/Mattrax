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
  billingWebhookRoutes,
  runMaintenance,
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
import { AzureGraphFetchLive } from "@mattrax/azure-graph";
import { AppleMdmTrust, MdmError } from "@mattrax/dm-apple";
import { FetchHttpClient } from "effect/http";
import {
  isDevMailboxEnabled,
  listDevEmails,
  recordDevEmail,
  timingSafeStringEqual,
} from "./devMailbox.js";
import {
  errorResponse,
  logRequest,
  readErrorTag,
  resolveRequestId,
  shouldLogRequest,
  tenantIdFromPath,
  withRequestId,
} from "./observability.js";
import { makeRateLimiter, rateLimitResponse, type RateLimitBindingLike } from "./rateLimit.js";
import { checkReadiness } from "./readiness.js";

const rateLimiter = makeRateLimiter();

/**
 * Edge limiter bindings are optional (see `cloudflare.config.ts`). Buckets
 * without one use the per-isolate fallback.
 */
const rateLimitBindings = (env: Env) => {
  const candidate = env as unknown as Record<string, unknown>;
  const binding = (name: string) => candidate[name] as RateLimitBindingLike | undefined;
  return {
    auth: binding("RATE_LIMITER_AUTH"),
    enrollment: binding("RATE_LIMITER_ENROLLMENT"),
  };
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

// Proof delivery (password-reset links and passwordless email codes) is
// scheduled by Auth after the proof commit resolves. Await it inside the
// request: a `waitUntil`-only hand-off can be dropped when the request-scoped
// Worker context is torn down before the provider accepts the message, which
// silently loses reset/code emails. Unexpected scheduler failures are logged
// and surfaced as `ProofUnavailable`; provider rejections are reported by the
// auth delivery layer.
const proofSchedulerLayer = Layer.succeed(Proofs.ProofDispatchScheduler, {
  schedule: (work: Effect.Effect<void>) =>
    Effect.tryPromise({
      try: () => Effect.runPromise(work),
      catch: (cause) => {
        console.error("Proof delivery failed", cause);
        return Proofs.ProofUnavailable.make({});
      },
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
  // Raw Stripe webhook: unauthenticated but signature-verified. Mounted before
  // the Effect HttpApi routes so it can read the raw request body.
  billingWebhookRoutes({
    webhookSecret: apiEnv.STRIPE_WEBHOOK_SECRET,
    deviceMonthlyPriceId: apiEnv.STRIPE_DEVICE_MONTHLY_PRICE_ID,
  }),
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
  scepRoutes,
  scimRoutes,
);

const appLayer = apiLayer.pipe(Layer.provide(HttpServer.layerServices));

const databaseLayer = (env: Env) =>
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
  });

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

  const devMailbox = isDevMailboxEnabled(
    env as unknown as {
      DEV_MAILBOX?: string;
      DEV_MAILBOX_ALLOW_REMOTE?: string;
      DEV_MAILBOX_SECRET?: string;
    },
    env.ORIGIN,
    request.url,
  );
  const devMailboxSecret = (env as unknown as { DEV_MAILBOX_SECRET?: string }).DEV_MAILBOX_SECRET;
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

  const appleTrustLayer = Layer.effect(
    AppleMdmTrust,
    Effect.gen(function* () {
      const db = yield* Db;
      return AppleMdmTrust.of({
        requireSignature: true,
        caCertPems: Effect.gen(function* () {
          const ca = yield* db.query.scepCa.findFirst();
          return ca ? [ca.certPem] : [];
        }).pipe(
          Effect.mapError(
            (cause) => new MdmError({ message: `Could not load SCEP CA: ${String(cause)}` }),
          ),
        ),
      });
    }),
  ).pipe(Layer.provide(Db.layer));

  const managementBackendLayer = ManagementBackendEnterpriseLive.layer(env.ORIGIN, {
    apns,
    authSecret: env.AUTH_SECRET,
    // Tenant-scoped enrollment URLs carry a signed tenant token, so Cloud no
    // longer needs a deployment-wide pin. An explicitly configured pin is kept
    // as a fallback for single-tenant deployments that still use the old
    // un-scoped discovery URL.
    windowsOrganizationId: apiEnv.WINDOWS_ORGANIZATION_ID,
    requireWindowsDeviceIdentity: true,
    requireAppleDeviceIdentity: true,
  }).pipe(Layer.provide(Db.layer));

  const azureGraphLayer =
    env.AZURE_CLIENT_ID && env.AZURE_CLIENT_SECRET
      ? AzureGraphFetchLive({
          clientId: env.AZURE_CLIENT_ID,
          clientSecret: env.AZURE_CLIENT_SECRET,
          origin: env.ORIGIN,
        })
      : Layer.empty;

  const stripeLayer = env.STRIPE_SECRET_KEY
    ? StripeService.layer(env.STRIPE_SECRET_KEY)
    : Layer.empty;

  const servicesLayer = Layer.mergeAll(
    EnterpriseService({ email, azureClientId: env.AZURE_CLIENT_ID }).pipe(
      Layer.provide(enterpriseAuthLive),
      Layer.provide(staticEnvLayer),
      Layer.provide(stripeLayer),
      Layer.provide(R2.layer(storageBucket)),
      Layer.provide(apnsLayer),
      Layer.provide(Db.layer),
      Layer.provide(azureGraphLayer),
    ),
    AppleMdmService.layer.pipe(
      Layer.provide(AppleMdmTopic.layer),
      Layer.provide(managementBackendLayer),
      Layer.provide(appleMdmConfigLayer),
      Layer.provide(appleTrustLayer),
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
    windowsMdmRoutes,
    ssoRoutes({
      origin: env.ORIGIN,
      clientId: env.AZURE_CLIENT_ID,
      clientSecret: env.AZURE_CLIENT_SECRET,
      authSecret: env.AUTH_SECRET,
    }).pipe(Layer.provide(HttpServer.layerServices)),
    ...(devMailbox
      ? [
          HttpRouter.add("GET", "/api/debug/emails", (debugRequest) => {
            // A shared secret is optional locally and mandatory whenever the
            // remote opt-in is used, so an exposed dev deployment cannot leak
            // verification links to arbitrary callers.
            const supplied = debugRequest.headers["x-dev-mailbox-secret"];
            if (
              devMailboxSecret &&
              !timingSafeStringEqual(typeof supplied === "string" ? supplied : "", devMailboxSecret)
            )
              return Effect.succeed(HttpServerResponse.text("Not Found", { status: 404 }));
            return HttpServerResponse.json(listDevEmails());
          }).pipe(Layer.provide(HttpServer.layerServices)),
        ]
      : []),
  );

  return appWithDevRoutes.pipe(
    // `provideMerge` keeps the MDM/SCEP service instances in the layer's
    // output. With plain `provide` the routes were built, but their handlers
    // failed at request time with `Service not found: ScepService`.
    Layer.provideMerge(servicesLayer),
    Layer.provide(authLive),
    Layer.provide(proofContextLayer),
    Layer.provideMerge(Db.layer),
    Layer.provide(databaseLayer(env)),
  );
};

const checkDatabaseReady = (env: Env) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* Db;
      // The cheapest possible round-trip; no tenant data is read.
      yield* db.execute("select 1");
    }).pipe(Effect.provide(Db.layer), Effect.provide(databaseLayer(env))),
  );

const deploymentId = (env: Env): string | null => {
  const metadata = (env as unknown as { CF_VERSION_METADATA?: { id?: string } })
    .CF_VERSION_METADATA;
  return metadata?.id ?? null;
};

const readinessResponse = async (env: Env, requestId: string): Promise<Response> => {
  const result = await checkReadiness({
    checkDatabase: () => checkDatabaseReady(env),
    version,
    deploymentId: deploymentId(env),
  });
  return withRequestId(
    new Response(JSON.stringify(result.body), {
      status: result.httpStatus,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    }),
    requestId,
  );
};

/** Redact emails and long opaque tokens before an error message reaches logs. */
const describeError = (cause: unknown): string => {
  const error = cause instanceof Error ? cause : undefined;
  const text = error ? `${error.name}: ${error.message}` : String(cause);
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[redacted]")
    .slice(0, 500);
};

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const requestId = resolveRequestId(request);
    const startedAt = Date.now();
    const pathname = new URL(request.url).pathname;

    let response: Response;
    let uncaught: unknown;
    let dispose: (() => Promise<void>) | undefined;

    try {
      const limited = await rateLimiter.check(request, rateLimitBindings(env));
      if (limited.limited) {
        response = rateLimitResponse(limited, requestId);
      } else if (
        (pathname === "/api/health" || pathname === "/health") &&
        request.method === "GET"
      ) {
        // Liveness must not build the service layer or touch MySQL.
        response = new Response("ok", {
          status: 200,
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      } else if (pathname === "/api/ready" && request.method === "GET") {
        response = await readinessResponse(env, requestId);
      } else {
        // Device identity must come from the verified mTLS handshake, never
        // from a caller-supplied header. Cloudflare exposes the certificate
        // subject here.
        const headers = new Headers(request.headers);
        headers.delete("x-device-identity-certificate");
        headers.delete("x-device-identity-certificate-serial");
        headers.delete("x-device-identity-certificate-sha256");
        const tls = (
          request as unknown as {
            cf?: {
              tlsClientAuth?: {
                certVerified?: string;
                certRevoked?: string | boolean;
                certSubjectDN?: string;
                certSerial?: string;
                certFingerprintSHA256?: string;
              };
            };
          }
        ).cf?.tlsClientAuth;
        if (
          tls?.certVerified === "SUCCESS" &&
          tls.certRevoked !== "1" &&
          tls.certRevoked !== true
        ) {
          if (tls.certSubjectDN) headers.set("x-device-identity-certificate", tls.certSubjectDN);
          if (tls.certSerial) headers.set("x-device-identity-certificate-serial", tls.certSerial);
          if (tls.certFingerprintSHA256)
            headers.set("x-device-identity-certificate-sha256", tls.certFingerprintSHA256);
        }
        const deviceRequest = new Request(request, { headers });

        const handlerAndDispose = HttpRouter.toWebHandler(makeAppLayer(env, deviceRequest) as any);
        dispose = handlerAndDispose.dispose;
        const context = Context.makeUnsafe<any>(new Map());
        response = await handlerAndDispose.handler(deviceRequest, context);
      }
    } catch (cause) {
      uncaught = cause;
      response = errorResponse(500, requestId, {
        error: "internal_error",
        message: "Internal Server Error",
      });
    } finally {
      // Dispose even when the handler threw so the per-request Db pool/HTTP
      // sessions are not leaked.
      if (dispose)
        waitUntil(dispose().catch((cause) => console.error("Layer dispose failed", cause)));
    }

    const errorTag = uncaught ? "UncaughtError" : await readErrorTag(response);
    if (shouldLogRequest(pathname, response.status)) {
      logRequest({
        requestId,
        method: request.method,
        path: pathname,
        status: response.status,
        durationMs: Math.max(0, Date.now() - startedAt),
        tenantId: tenantIdFromPath(pathname),
        ...(errorTag ? { errorTag } : {}),
        ...(uncaught ? { error: describeError(uncaught) } : {}),
      });
    }

    return withRequestId(response, requestId);
  },

  /**
   * Daily maintenance. Cloudflare Cron Triggers call this; the same function is
   * exported from `@mattrax/enterprise-backend` so a future self-hosted
   * Enterprise deployment can run it from its own scheduler.
   */
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const parseDays = (value: string | undefined) => {
      if (value === undefined) return undefined;
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
    };
    const maintenance = runMaintenance({
      staleDeviceDays: parseDays(apiEnv.MAINTENANCE_STALE_DEVICE_DAYS),
      auditRetentionDays: parseDays(apiEnv.MAINTENANCE_AUDIT_RETENTION_DAYS),
    }).pipe(Effect.provide(Db.layer), Effect.provide(databaseLayer(env)));

    ctx.waitUntil(
      Effect.runPromise(maintenance).then(
        (result) => console.log("Scheduled maintenance complete", result),
        (cause) => console.error("Scheduled maintenance failed", cause),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
