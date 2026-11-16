import "reflect-metadata";
import { Context, Effect, Exit, Layer, Option, Redacted, Schema } from "effect";
import { HttpApi, HttpApiBuilder, OpenApi } from "effect/http-api";
import { HttpRouter, HttpServer, HttpServerResponse } from "effect/http";
import { version } from "../package.json" with { type: "json" };
import { AuthContract, Http } from "@yielded/auth";
import type { AuthLiveOptions } from "@mattrax/enterprise-backend";
import {
  AuthApi,
  enterpriseAccountApi,
  enterpriseApi,
  enterpriseAdeApi,
  enterpriseAttributeApi,
  scriptAgentApi,
  scriptApi,
} from "@mattrax/enterprise-domain";
import { appleMdmApi } from "@mattrax/dm-apple";
import {
  DEFAULT_EMAIL_FROM,
  DEFAULT_ONBOARDING_REPLY_TO,
  ONBOARDING_SUPPORT_EMAIL,
  EnterpriseService,
  enterpriseAccountHandlers,
  enterpriseAdeHandlers,
  enterpriseHandlers,
  enterpriseAttributeHandlers,
  scriptAgentHandlers,
  scriptHandlers,
  billingWebhookRoutes,
  runMaintenance,
  runOnboardingEmails,
  runScheduledBackups,
  runScheduledEntraSync,
  runWelcomeEmailSweep,
  linkedDeviceIdsForUsers,
  syncAndroidPoliciesForTenant,
  ScimMembershipNotifier,
  makeApplePush,
  scimRoutes,
  mcpOAuthRoutes,
  androidRoutes,
  makeAppAuth,
  makeAuthLive,
  makeRecoveryStrategy,
  makeSsoStrategy,
  makeEnterpriseAuthLive,
  EnterpriseAnalyticsService,
  sessionCookie,
  drainEmailOutbox,
  sendTransactionalEmail,
  loadTrustedScepCaCertificates,
  runServerCertificateCheck,
  type CredentialExpiryNotification,
} from "@mattrax/enterprise-backend";
import { appleMdmHandlers, appleMdmRoutes } from "@mattrax/dm-apple";
import { windowsMdmRoutes, WindowsMdmServiceLive } from "@mattrax/dm-windows";
import { scepRoutes } from "@mattrax/scep";
import { AppleMdmConfig, AppleMdmService, AppleMdmTopic } from "@mattrax/dm-apple";
import { ScepService } from "@mattrax/scep";
import {
  ManagementBackendEnterpriseLive,
  ScepRepositoryLive,
} from "@mattrax/management-backend-enterprise";
import { managementWebhookOpenApi } from "@mattrax/management-backend-http";
import { Db, Env as CoreEnv, R2, parsePlanLimits, schema } from "@mattrax/enterprise-core";
import type { EnterpriseDb } from "@mattrax/enterprise-core";
import { ApnsService, NoopPushTransport, RelayPushTransport, makeApnsService } from "@mattrax/apns";
import { MysqlClient } from "@effect/sql-mysql2";
import { StripeService } from "@mattrax/effect-stripe";
import { env as apiEnv } from "./env.js";
import { DAILY_CRON, HOURLY_CRON } from "./crons.js";
import { androidDeliveryConfig, androidManagementLayer } from "./android.js";
import { ssoRoutes } from "./sso.js";
import { AzureOidcLive } from "@mattrax/azure-oidc";
import { AzureGraphFetchLive } from "@mattrax/azure-graph";
import { AzureGraph } from "@mattrax/azure-graph";
import { AppleMdmTrust, MdmError, parseSubjectDn } from "@mattrax/dm-apple";
import { FetchHttpClient } from "effect/http";
import { isDevMailboxEnabled, listDevEmails, timingSafeStringEqual } from "./devMailbox.js";
import {
  errorResponse,
  logRequest,
  readErrorTag,
  resolveRequestId,
  shouldLogRequest,
  tenantIdFromPath,
  withDefaultNoStore,
  withRequestId,
} from "./observability.js";
import { createRateLimiter, rateLimitBindingsFromEnv, rateLimitResponse } from "./rateLimit.js";
import {
  authEventForRequest,
  authOutcomeFromResponse,
  createRequestAnalytics,
  shouldReportError,
  shouldTrackApiRequest,
  type AnalyticsProperties,
} from "./analytics.js";
import { checkReadiness } from "./readiness.js";
import { mailerReadiness, selectMailer } from "./mailer.js";
import { createProbeCache } from "./probeCache.js";
import { clearsSsrShell, withClearedSsrShell } from "./sessionShell.js";
import { withSessionPresence } from "./sessionPresence.js";
import { credentialExpiryEmail } from "./credentialEmail.js";

const rateLimiter = createRateLimiter({
  // Node deployments behind a reverse proxy must opt in before their
  // forwarded headers are trusted; Cloudflare is detected from `request.cf`.
  trustForwarded: apiEnv.TRUST_PROXY_HEADERS === "1",
});

/**
 * Plan limits are deployment configuration, not product pricing. A malformed
 * secret is logged and treated as "unlimited" so a bad deploy cannot crash the
 * Worker or lock customers out.
 */
const planLimits = parsePlanLimits(apiEnv.MATTRAX_PLAN_LIMITS);

for (const warning of planLimits.warnings) console.warn(warning);

/**
 * Apple enrollment profiles carry a one-time bearer challenge. The default
 * lifetime is one hour; a deployment can choose any whole number of seconds
 * between one minute and one day.
 */
const enrollmentProfileTtlSeconds = (() => {
  const raw = apiEnv.MATTRAX_ENROLLMENT_PROFILE_TTL_SECONDS;

  if (raw === undefined) return undefined;
  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed < 60 || parsed > 86_400)
    throw new Error(
      "MATTRAX_ENROLLMENT_PROFILE_TTL_SECONDS must be a whole number of seconds between 60 and 86400",
    );

  return parsed;
})();

/**
 * Edge limiter bindings are optional (see `cloudflare.config.ts`). Buckets
 * without one use the per-isolate fallback.
 */
const rateLimitBindings = (env: Env) => rateLimitBindingsFromEnv(env);

const appAuth = makeAppAuth(apiEnv.ORIGIN, {
  sso: makeSsoStrategy(),
  // Break-glass recovery completes through the same session machinery as SSO,
  // so the issued session is subject to the normal revision and policy checks.
  recovery: makeRecoveryStrategy(),
});

const authHttp = AuthContract.httpGroup(AuthApi);

const authHttps = Http.make(appAuth, {
  origin: apiEnv.ORIGIN,
  cookie: { name: sessionCookie },
  trustedOrigins: apiEnv.TRUSTED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
});

// Proof delivery is not part of authentication: passkeys never leave the
// browser and verification codes are delivered by EnterpriseAuth.

const apiRoot = HttpApi.make("Mattrax")
  .add(enterpriseAccountApi)
  .add(enterpriseApi)
  .add(enterpriseAdeApi)
  .add(enterpriseAttributeApi)
  .add(scriptApi)
  .add(scriptAgentApi)
  .add(authHttp)
  .add(appleMdmApi)
  .annotateMerge(
    OpenApi.annotations({
      title: "Mattrax Cloud API",
      version,
      description: "The Mattrax Cloud API",
      servers: [{ url: "/" }],
    }),
  );

/**
 * The OpenAPI document is static for a build. Building it lazily once per
 * isolate keeps it out of the global scope and stops every API request from
 * paying for it (the previous Scalar layer generated it eagerly each request).
 */
let cachedOpenApi: ReturnType<typeof OpenApi.fromApi> | undefined;

const openApiResponse = () => {
  cachedOpenApi ??= OpenApi.fromApi(apiRoot);

  return HttpServerResponse.jsonUnsafe(cachedOpenApi);
};

/**
 * The management webhook contract is a separate document: these routes are
 * implemented by a customer's management backend, not by this API.
 */
const managementWebhookOpenApiResponse = () =>
  HttpServerResponse.jsonUnsafe(managementWebhookOpenApi());

const apiDocsHtml = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Mattrax Cloud API</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <div id="api-reference"></div>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@latest/dist/browser/standalone.min.js" crossorigin></script>
    <script>
      window.Scalar.createApiReference("#api-reference", { url: "/api/openapi.json" });
    </script>
  </body>
</html>`;

const apiDocsResponse = () => HttpServerResponse.html(apiDocsHtml);

const applicationHandlers = Layer.mergeAll(
  HttpApiBuilder.group(apiRoot, "EnterpriseAccount", enterpriseAccountHandlers),
  HttpApiBuilder.group(apiRoot, "EnterpriseApi", enterpriseHandlers),
  HttpApiBuilder.group(apiRoot, "EnterpriseAde", enterpriseAdeHandlers),
  HttpApiBuilder.group(apiRoot, "EnterpriseAttribute", enterpriseAttributeHandlers),
  HttpApiBuilder.group(apiRoot, "ScriptApi", scriptHandlers),
  HttpApiBuilder.group(apiRoot, "ScriptAgentApi", scriptAgentHandlers),
  HttpApiBuilder.group(apiRoot, "AppleDM", appleMdmHandlers),
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
  HttpRouter.add("GET", "/api/openapi.json", Effect.sync(openApiResponse)),
  HttpRouter.add(
    "GET",
    "/api/webhooks/openapi.json",
    Effect.sync(managementWebhookOpenApiResponse),
  ),
  HttpRouter.add("GET", "/api/docs", Effect.sync(apiDocsResponse)),
);

const apiLayer = Layer.mergeAll(
  HttpApiBuilder.layer(apiRoot).pipe(Layer.provide(handlersLayer)),
  appleMdmRoutes,
  scepRoutes,
  scimRoutes,
);

const appLayer = apiLayer.pipe(Layer.provide(HttpServer.layerServices));

type DatabasePoolConfig = {
  disableEval: boolean;
  timezone: string;
  ssl?: { rejectUnauthorized?: boolean; ca?: string };
};

const databaseLayer = (env: Env) => {
  // The Node host extends the binding with TLS options parsed from
  // `DATABASE_URL`; the Workers binding never has them.
  // SAFETY: the extra field is optional and only the Node entry sets it.
  const hyperdrive = env.HYPERDRIVE as Env["HYPERDRIVE"] & {
    ssl?: { rejectUnauthorized?: boolean; ca?: string };
  };

  const poolConfig: DatabasePoolConfig = {
    disableEval: true,
    timezone: "Z",
  };

  if (hyperdrive.ssl) poolConfig.ssl = hyperdrive.ssl;

  return MysqlClient.layer({
    // Hyperdrive exposes individual connection fields for MySQL. Do not
    // pass `url`: `@effect/sql-mysql2` ignores `poolConfig` when it is set,
    // which would silently drop `disableEval` and break Workers builds.
    host: hyperdrive.host,
    port: hyperdrive.port,
    username: hyperdrive.user,
    password: Redacted.make(hyperdrive.password),
    database: hyperdrive.database,
    // `mysql2` uses `eval` for some protocol decoding; Workers forbids it.
    // `timezone: "Z"` keeps `DATETIME(3)` reads/writes UTC, matching the
    // `toISOString()` encoding Drizzle uses for `datetime` columns. The Node
    // entry supplies TLS options through the same object; Hyperdrive never does.
    poolConfig,
    // Hyperdrive rejects MySQL `COM_STMT_PREPARE`; use the text protocol.
    disablePreparedStatements: true,
  });
};

const storageBucketFor = (env: Env): Parameters<typeof R2.layer>[0] => ({
  head: (key) => env.STORAGE.head(key),
  get: (key) => env.STORAGE.get(key),
  put: (key, value, options) => env.STORAGE.put(key, value, options),
  delete: (keys) => env.STORAGE.delete(Schema.is(Schema.String)(keys) ? keys : [...keys]),
  list: (options) =>
    env.STORAGE.list(
      options
        ? {
            ...options,
            include: options.include ? [...options.include] : undefined,
          }
        : undefined,
    ),
});

/**
 * Run the scheduled Entra directory sweep. The Graph client is built only when
 * the deployment has Entra app credentials; otherwise the sweep returns
 * immediately so the rest of the cron job is unaffected.
 */
const entraSyncEffect = (
  db: EnterpriseDb,
  env: Env,
  concurrency: number | undefined,
  onMembershipsChanged?: (
    organizationId: string,
    userIds: ReadonlyArray<string>,
  ) => Effect.Effect<void, unknown, never>,
) => {
  if (!env.AZURE_CLIENT_ID || !env.AZURE_CLIENT_SECRET)
    return runScheduledEntraSync({ db, concurrency, onMembershipsChanged });

  return Effect.scoped(
    Effect.gen(function* () {
      const context = yield* Layer.build(
        AzureGraphFetchLive({
          clientId: env.AZURE_CLIENT_ID,
          clientSecret: env.AZURE_CLIENT_SECRET,
          origin: env.ORIGIN,
        }),
      );

      return yield* runScheduledEntraSync({
        db,
        graph: Context.get(context, AzureGraph),
        concurrency,
        onMembershipsChanged,
      });
    }),
  );
};

const parsePositive = (value: string | undefined) => {
  if (value === undefined) return undefined;
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
};

/** A non-negative day count; malformed input falls back to the default. */
const parseDayCount = (value: string | undefined, fallback: number) => {
  if (value === undefined) return fallback;
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
};

const optionalIsoDate = (value: string | undefined) => {
  if (!value) return null;
  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const onboardingReplyTo = () => apiEnv.MATTRAX_ONBOARDING_REPLY_TO ?? DEFAULT_ONBOARDING_REPLY_TO;

const onboardingSupportEmail = () =>
  apiEnv.MATTRAX_ONBOARDING_SUPPORT_EMAIL ?? ONBOARDING_SUPPORT_EMAIL;

const onboardingSince = optionalIsoDate(apiEnv.MATTRAX_ONBOARDING_SINCE);

if (apiEnv.MATTRAX_ONBOARDING_SINCE && !onboardingSince)
  console.warn(
    "MATTRAX_ONBOARDING_SINCE is not a valid ISO date; the follow-up window floor still applies",
  );

/**
 * The mailer settings live in two places: the Cloudflare binding on `Env` and
 * the parsed deployment variables on `apiEnv` (some are only declared when a
 * deploy supplies them). This keeps the selection call sites to one expression.
 */
const resolveMailer = (env: Env) =>
  selectMailer({
    ORIGIN: env.ORIGIN,
    EMAIL: env.EMAIL,
    MATTRAX_EMAIL_DISABLED: apiEnv.MATTRAX_EMAIL_DISABLED,
    MAIL_TRANSPORT: apiEnv.MAIL_TRANSPORT,
    MAIL_FROM: apiEnv.MAIL_FROM,
    MAIL_SMTP_HOST: apiEnv.MAIL_SMTP_HOST,
    MAIL_SMTP_PORT: apiEnv.MAIL_SMTP_PORT,
    MAIL_SMTP_SECURE: apiEnv.MAIL_SMTP_SECURE,
    MAIL_SMTP_USER: apiEnv.MAIL_SMTP_USER,
    MAIL_SMTP_PASSWORD: apiEnv.MAIL_SMTP_PASSWORD,
    MAIL_SMTP_HELO: apiEnv.MAIL_SMTP_HELO,
    DEV_MAILBOX: apiEnv.DEV_MAILBOX,
    DEV_MAILBOX_ALLOW_REMOTE: apiEnv.DEV_MAILBOX_ALLOW_REMOTE,
    DEV_MAILBOX_SECRET: apiEnv.DEV_MAILBOX_SECRET,
  });

const onboardingEmailsEnabled = () => {
  const value = apiEnv.MAINTENANCE_ONBOARDING_EMAILS?.trim().toLowerCase();

  return !(value === "0" || value === "false" || value === "off");
};

/**
 * Drain queued transactional mail outside the daily maintenance window. The
 * hourly trigger owns retries, so a provider outage costs minutes rather than a
 * day; `runMaintenance` also drains so a deployment with only the daily cron
 * still delivers.
 */
const emailOutboxJob = (env: Env) =>
  Effect.gen(function* () {
    const db = yield* Db;

    return yield* drainEmailOutbox({
      db,
      email: resolveMailer(env).transport,
      concurrency: parsePositive(apiEnv.MAINTENANCE_EMAIL_OUTBOX_CONCURRENCY),
      maxAttempts: parsePositive(apiEnv.MAINTENANCE_EMAIL_OUTBOX_MAX_ATTEMPTS),
    });
  }).pipe(Effect.provide(Db.layer), Effect.provide(databaseLayer(env)));

/**
 * Review the deployment origin's TLS certificate. Runs from the hourly trigger
 * so the code path is exercised often; the check itself is throttled to once an
 * hour, and the daily maintenance run reuses a fresh observation.
 */
const serverCertificateJob = (env: Env) =>
  Effect.gen(function* () {
    const db = yield* Db;

    return yield* runServerCertificateCheck(db, { origin: apiEnv.ORIGIN });
  }).pipe(Effect.provide(Db.layer), Effect.provide(databaseLayer(env)));

/** Standalone scheduled Entra sweep used by the hourly trigger. */
const entraSyncJob = (env: Env) =>
  Effect.gen(function* () {
    const db = yield* Db;

    const apns = makeApnsService(
      env.APNS_RELAY_URL && env.APNS_RELAY_SECRET
        ? RelayPushTransport({ url: env.APNS_RELAY_URL, secret: env.APNS_RELAY_SECRET })
        : NoopPushTransport(
            "APNs push relay is not configured; devices will poll for changes instead",
          ),
    );

    const androidConfig = androidDeliveryConfig();

    const applePush = makeApplePush({
      db,
      schema,
      apns,
      authSecret: env.AUTH_SECRET,
      webhookFetch: fetch,
    });

    // Directory membership changes can add or remove user-assigned policies.
    // Wake the linked devices so they converge without waiting for a poll.
    const refreshMemberships = (organizationId: string, userIds: ReadonlyArray<string>) =>
      Effect.gen(function* () {
        const deviceIds = yield* linkedDeviceIdsForUsers(db, organizationId, userIds);

        if (deviceIds.length === 0) return;

        yield* applePush.pushAppleDevices(deviceIds).pipe(Effect.catch(() => Effect.void));
        yield* syncAndroidPoliciesForTenant({
          db,
          config: androidConfig,
          organizationId,
          deviceIds,
        }).pipe(
          Effect.catch(() => Effect.void),
          Effect.provide(androidManagementLayer(androidConfig)),
        );
      });

    return yield* entraSyncEffect(
      db,
      env,
      parsePositive(apiEnv.MAINTENANCE_ENTRA_SYNC_CONCURRENCY),
      refreshMemberships,
    );
  }).pipe(Effect.provide(Db.layer), Effect.provide(databaseLayer(env)));

type CryptoLayer = AuthLiveOptions["cryptoLayer"];

const makeAppLayer = (env: Env, cryptoLayer: CryptoLayer) => {
  const androidConfig = androidDeliveryConfig();

  const staticEnvLayer = CoreEnv.layer({
    origin: env.ORIGIN,
    cloudAppleVendorCert: env.CLOUD_APPLE_VENDOR_CERT,
    cloudAppleVendorKey: env.CLOUD_APPLE_VENDOR_KEY,
    authSecret: env.AUTH_SECRET,
    appleProfileSigningCert: env.APPLE_PROFILE_SIGNING_CERT,
    appleProfileSigningKey: env.APPLE_PROFILE_SIGNING_KEY,
    appleProfileSigningChain: env.APPLE_PROFILE_SIGNING_CHAIN,
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

  // The routes exist whenever the feature is switched on; each request is
  // checked against its own URL, so a loopback ORIGIN does not expose the
  // mailbox when the deployment is reachable from a public host.
  const devMailbox = env.DEV_MAILBOX === "true";

  // Effect's request URL is usually a path; the mailbox check needs the
  // request host, so resolve it against the deployment origin.
  const mailboxAllowed = (request: { readonly url: string }) =>
    isDevMailboxEnabled(env, env.ORIGIN, new URL(request.url, env.ORIGIN).toString());

  const devMailboxSecret = env.DEV_MAILBOX_SECRET;

  // One selection serves the request path and cron: the Cloudflare binding,
  // an HTTP provider, the self-hosted SMTP relay, the local mailbox or an
  // explicit "disabled" state. A misconfiguration stays `undefined` here and
  // fails readiness instead of silently logging messages.
  const mailer = resolveMailer(env);
  const email = mailer.transport;

  const authLive = makeAuthLive({
    appAuth,
    cryptoLayer,
    authSecret: env.AUTH_SECRET,
    origin: env.ORIGIN,
    // Only same-site origins can share the deployment's WebAuthn relying party;
    // `passkeyProfile` drops anything that would widen the RP id.
    trustedOrigins: (apiEnv.TRUSTED_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  }).pipe(Layer.provide(Db.layer));

  const enterpriseAuthLive = makeEnterpriseAuthLive({
    appAuth,
    origin: env.ORIGIN,
    authSecret: env.AUTH_SECRET,
    // Use the same development mailbox as sign-in proofs so verification
    // codes are visible at /api/debug/emails locally.
    email,
    emailFrom: mailer.sender,
    onboardingReplyTo: onboardingReplyTo(),
    onboardingSupportEmail: onboardingSupportEmail(),
  });

  const storageBucket: Parameters<typeof R2.layer>[0] = storageBucketFor(env);

  const appleTrustLayer = Layer.effect(
    AppleMdmTrust,
    Effect.gen(function* () {
      const db = yield* Db;

      return AppleMdmTrust.of({
        requireSignature: true,
        // Each tenant has its own SCEP CA. The check-in identity certificate
        // names the tenant in its OU, so only that tenant's CAs are valid trust
        // anchors for the message signature. Retired CAs stay in the list until
        // their overlap window closes, so a rotation never rejects an identity
        // issued before it.
        caCertPems: (identityCertificateSubject) =>
          Effect.gen(function* () {
            if (!identityCertificateSubject) return [];

            let subject = identityCertificateSubject;

            try {
              subject = decodeURIComponent(subject);
            } catch {
              // The forwarder may already have decoded the header.
            }

            const organizationId = parseSubjectDn(subject).find(
              (attribute) => attribute.type === "OU",
            )?.value;

            if (!organizationId) return [];

            return yield* loadTrustedScepCaCertificates(db, organizationId);
          }).pipe(
            Effect.mapError(
              (cause) => new MdmError({ message: `Could not load SCEP CA: ${String(cause)}` }),
            ),
          ),
      });
    }),
  ).pipe(Layer.provide(Db.layer));

  // Federated WSTEP is opt-in: discovery only advertises it when an audience
  // is configured, and policy/enroll then require a verifiable Entra JWT.
  const windowsFederatedAudience = apiEnv.WINDOWS_FEDERATED_AUDIENCE ?? env.AZURE_CLIENT_ID;

  const windowsFederated = windowsFederatedAudience
    ? { enabled: true, audience: windowsFederatedAudience, clientId: env.AZURE_CLIENT_ID }
    : undefined;

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
    planLimits,
    windowsFederated,
    // Uploaded `.pkg` artefacts are served to devices through a signed,
    // expiring URL on the MDM origin; the protocol layer never exposes R2 keys.
    readApplicationObject: async (key) => {
      const object = await env.STORAGE.get(key);

      if (!object) return null;

      return new Uint8Array(await object.arrayBuffer());
    },
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
    EnterpriseService({
      email,
      // `MAIL_FROM` decides the envelope sender for every provider; the
      // invitation-specific override still wins when an operator wants the
      // branded address only for invites.
      invitationFromEmail: apiEnv.MATTRAX_INVITATION_FROM ?? mailer.sender.email,
      enrollmentProfileTtlSeconds,
      azureClientId: env.AZURE_CLIENT_ID,
      windowsFederated: windowsFederatedAudience
        ? { audience: windowsFederatedAudience }
        : undefined,
      android: androidConfig,
      planLimits,
      // Checkout and seat reconciliation need the per-device price; both
      // report a configuration error when it is absent.
      deviceMonthlyPriceId: apiEnv.STRIPE_DEVICE_MONTHLY_PRICE_ID,
    }).pipe(
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
    AzureOidcLive().pipe(Layer.provide(FetchHttpClient.layer)),
    androidManagementLayer(androidConfig),
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
    mcpOAuthRoutes({ origin: env.ORIGIN }).pipe(Layer.provide(HttpServer.layerServices)),
    ...(devMailbox
      ? [
          HttpRouter.add("GET", "/api/debug/emails", (debugRequest) => {
            // A shared secret is optional locally and mandatory whenever the
            // remote opt-in is used, so an exposed dev deployment cannot leak
            // verification links to arbitrary callers.
            const supplied = debugRequest.headers["x-dev-mailbox-secret"];

            if (
              !mailboxAllowed(debugRequest) ||
              (devMailboxSecret && !timingSafeStringEqual(supplied ?? "", devMailboxSecret))
            )
              return Effect.succeed(HttpServerResponse.text("Not Found", { status: 404 }));

            return HttpServerResponse.json(listDevEmails());
          }).pipe(Layer.provide(HttpServer.layerServices)),
          // Runs the same bounded sweeps the daily cron uses, in this isolate,
          // so browser tests can prove once-only welcome mail without waiting
          // for a scheduler. The `/api/debug/` prefix is excluded from analytics
          // and access is gated exactly like the mailbox.
          HttpRouter.add("POST", "/api/debug/onboarding-emails", (debugRequest) =>
            Effect.gen(function* () {
              const supplied = debugRequest.headers["x-dev-mailbox-secret"];

              if (
                !mailboxAllowed(debugRequest) ||
                (devMailboxSecret && !timingSafeStringEqual(supplied ?? "", devMailboxSecret))
              )
                return HttpServerResponse.text("Not Found", { status: 404 });

              const db = yield* Db;

              const welcome = yield* runWelcomeEmailSweep({
                db,
                email,
                origin: env.ORIGIN,
                replyTo: onboardingReplyTo(),
                supportEmail: onboardingSupportEmail(),
              });

              const followUp = onboardingEmailsEnabled()
                ? yield* runOnboardingEmails({
                    db,
                    email,
                    origin: env.ORIGIN,
                    replyTo: onboardingReplyTo(),
                    supportEmail: onboardingSupportEmail(),
                    followUpDays: parseDayCount(apiEnv.MAINTENANCE_ONBOARDING_FOLLOW_UP_DAYS, 7),
                    windowDays: parseDayCount(apiEnv.MAINTENANCE_ONBOARDING_WINDOW_DAYS, 7),
                    cooldownDays: parseDayCount(apiEnv.MAINTENANCE_ONBOARDING_COOLDOWN_DAYS, 7),
                    since: onboardingSince,
                  })
                : null;

              return yield* HttpServerResponse.json({ welcome, followUp });
            }),
          ).pipe(Layer.provide(HttpServer.layerServices)),
        ]
      : []),
    androidRoutes({
      origin: env.ORIGIN,
      authSecret: env.AUTH_SECRET,
      config: androidConfig,
      planLimits,
    }).pipe(Layer.provide(HttpServer.layerServices)),
  );

  const scimNotifierLayer = Layer.succeed(
    ScimMembershipNotifier,
    (db: EnterpriseDb, organizationId: string, userIds: ReadonlyArray<string>) =>
      Effect.gen(function* () {
        const deviceIds = yield* linkedDeviceIdsForUsers(db, organizationId, userIds);

        if (deviceIds.length === 0) return;

        const applePush = makeApplePush({
          db,
          schema,
          apns,
          authSecret: env.AUTH_SECRET,
          webhookFetch: fetch,
        });

        yield* applePush.pushAppleDevices(deviceIds).pipe(Effect.catch(() => Effect.void));
        yield* syncAndroidPoliciesForTenant({
          db,
          config: androidConfig,
          organizationId,
          deviceIds,
        }).pipe(
          Effect.catch(() => Effect.void),
          Effect.provide(androidManagementLayer(androidConfig)),
        );
      }),
  );

  return appWithDevRoutes.pipe(
    Layer.provide(scimNotifierLayer),
    // `provideMerge` keeps the MDM/SCEP service instances in the layer's
    // output. With plain `provide` the routes were built, but their handlers
    // failed at request time with `Service not found: ScepService`.
    Layer.provideMerge(servicesLayer),
    Layer.provide(authLive),
    Layer.provideMerge(Db.layer),
    Layer.provide(databaseLayer(env)),
  );
};

/**
 * Build a Web handler for an environment. `toWebHandler` owns the layer's scope
 * and serves every request through it; the Cloudflare entry rebuilds per
 * request (one isolate, short-lived), while the Node entry caches it so the
 * MySQL pool and password admission survive across requests.
 */
const getAppHandler = (env: Env, cryptoLayer: CryptoLayer) => {
  // SAFETY: makeAppLayer returns the combined router/service layer; the web
  // handler only reads the router and server services from its output. The
  // layer's inferred requirement channel includes framework request services
  // that `toWebHandler` cannot name, so the assertion stays at this boundary.
  // oxlint-disable-next-line typescript/no-explicit-any
  return HttpRouter.toWebHandler(makeAppLayer(env, cryptoLayer) as any);
};

const checkDatabaseReady = (env: Env) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* Db;
      // The cheapest possible round-trip; no tenant data is read.
      yield* db.execute("select 1");
    }).pipe(Effect.provide(Db.layer), Effect.provide(databaseLayer(env))),
  );

const deploymentId = (env: Env): string | null => env.CF_VERSION_METADATA?.id ?? null;

/**
 * Prove object storage is writable, readable and deletable with one real probe
 * object. A read-only volume or an unbound bucket fails here instead of on the
 * first upload, backup or download.
 */
const checkStorageReady = async (env: Env): Promise<"ok"> => {
  const key = `__readiness/${crypto.randomUUID()}`;
  let failure: unknown;

  try {
    const object = await env.STORAGE.put(key, "ok", {
      httpMetadata: {
        contentType: "text/plain; charset=utf-8",
        cacheControl: "no-store",
      },
    });

    if (!object) throw new Error("storage probe put returned no object");

    const head = await env.STORAGE.head(key);

    if (!head) throw new Error("storage probe object is not readable");
  } catch (cause) {
    failure = cause;
  }

  try {
    await env.STORAGE.delete(key);
  } catch (cause) {
    failure ??= cause;
  }

  if (failure) throw failure;

  return "ok";
};

/**
 * Outbound email is either configured, captured by the local dev mailbox, or
 * explicitly declared disabled. Silence is not accepted: a deployment that
 * forgot the transport must not report ready while every sign-in email fails.
 * The reason is deliberately generic, and secrets never reach the probe.
 */
const checkMailerReady = (env: Env): "ok" | "skipped" => mailerReadiness(resolveMailer(env));

/**
 * Readiness probes are memoised per isolate for 30 seconds. The storage probe
 * writes, reads and deletes an object, so running it on every load-balancer
 * poll is billable work with no extra signal. A new isolate always probes
 * fresh; the cache is not shared between Workers. Failures are cached for the
 * same window so a wedged dependency is not retried on every poll, and the
 * existing per-check timeout still turns a slow probe into a 503.
 */
const READINESS_PROBE_TTL_MS = 30_000;
const storageProbeCache = createProbeCache<"ok">(READINESS_PROBE_TTL_MS);
const mailerProbeCache = createProbeCache<"ok" | "skipped">(READINESS_PROBE_TTL_MS);

const readinessResponse = async (env: Env, requestId: string): Promise<Response> => {
  const result = await checkReadiness({
    checkDatabase: () => checkDatabaseReady(env),
    checkStorage: () => storageProbeCache.get(() => checkStorageReady(env)),
    checkMailer: () => mailerProbeCache.get(async () => checkMailerReady(env)),
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

const TlsClientAuth = Schema.Struct({
  certVerified: Schema.optional(Schema.String),
  certRevoked: Schema.optional(Schema.Union([Schema.String, Schema.Boolean])),
  certSubjectDN: Schema.optional(Schema.String),
  certSerial: Schema.optional(Schema.String),
  certFingerprintSHA256: Schema.optional(Schema.String),
});

const RequestCfProperties = Schema.Struct({
  tlsClientAuth: Schema.optional(TlsClientAuth),
});

/** Redact emails and long opaque tokens before an error message reaches logs. */
const describeError = (cause: unknown): string => {
  const error = cause instanceof Error ? cause : undefined;
  const text = error ? `${error.name}: ${error.message}` : String(cause);

  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\b[A-Za-z0-9+/=_-]{32,}\b/g, "[redacted]")
    .slice(0, 500);
};

/**
 * Device identity must come from the verified mTLS handshake, never from a
 * caller-supplied header. Cloudflare exposes the certificate subject on
 * `request.cf`; a self-hosted reverse proxy terminates mTLS itself and
 * forwards the verified fields instead, which requires an explicit opt-in.
 */
const TRUST_DEVICE_IDENTITY_HEADERS = apiEnv.TRUST_DEVICE_IDENTITY_HEADERS === "1";

const deviceIdentityHeaders = (request: Request) => {
  const headers = new Headers(request.headers);

  if (TRUST_DEVICE_IDENTITY_HEADERS) return headers;

  headers.delete("x-device-identity-certificate");
  headers.delete("x-device-identity-certificate-serial");
  headers.delete("x-device-identity-certificate-sha256");

  const cf = Option.getOrUndefined(Schema.decodeUnknownOption(RequestCfProperties)(request.cf));

  const tls = cf?.tlsClientAuth;

  if (tls?.certVerified === "SUCCESS" && tls.certRevoked !== "1" && tls.certRevoked !== true) {
    if (tls.certSubjectDN) headers.set("x-device-identity-certificate", tls.certSubjectDN);

    if (tls.certSerial) headers.set("x-device-identity-certificate-serial", tls.certSerial);

    if (tls.certFingerprintSHA256)
      headers.set("x-device-identity-certificate-sha256", tls.certFingerprintSHA256);
  }

  return headers;
};

/**
 * Build the API runtime for a host. The Cloudflare entry supplies the Workers
 * crypto/password layer; the Node entry supplies the scrypt layer. Everything
 * else (routing, auth, MDM, scheduled work) is shared.
 */
export const createApiRuntime = (
  cryptoLayer: CryptoLayer,
  options: { readonly cacheHandler?: boolean } = {},
) => {
  // A Node process serves many requests from one runtime, so rebuilding the
  // service graph per request would create a new MySQL pool every time. The
  // Cloudflare entry keeps the per-request build (one isolate, short-lived).
  const handlers = new WeakMap<Env, ReturnType<typeof getAppHandler>>();

  const appHandler = (env: Env) => {
    if (!options.cacheHandler) return getAppHandler(env, cryptoLayer);

    let handler = handlers.get(env);

    if (!handler) {
      handler = getAppHandler(env, cryptoLayer);
      handlers.set(env, handler);
    }

    return handler;
  };

  return {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      const requestId = resolveRequestId(request);
      const startedAt = Date.now();
      const pathname = new URL(request.url).pathname;

      const analytics = createRequestAnalytics({
        key: apiEnv.POSTHOG_KEY,
        host: apiEnv.POSTHOG_HOST,
        environment: apiEnv.POSTHOG_ENVIRONMENT,
        release: version,
        deploymentId: deploymentId(env),
        requestId,
        method: request.method,
        path: pathname,
        headers: request.headers,
        errorSampleRate: Number(apiEnv.POSTHOG_ERROR_SAMPLE_RATE ?? "1"),
        maxErrorsPerMinute: Number(apiEnv.POSTHOG_ERROR_MAX_EVENTS_PER_MINUTE ?? "20"),
      });

      let response: Response;
      let uncaught: unknown;

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
          const deviceRequest = new Request(request, { headers: deviceIdentityHeaders(request) });

          const context = Context.makeUnsafe(
            new Map([[EnterpriseAnalyticsService.key, analytics]]),
          );

          response = await appHandler(env).handler(deviceRequest, context);
        }
      } catch (cause) {
        uncaught = cause;
        response = errorResponse(500, requestId, {
          error: "internal_error",
          message: "Internal Server Error",
        });
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
          errorTag,
          error: uncaught ? describeError(uncaught) : undefined,
        });
      }

      // PostHog product analytics. Paths are recorded without query strings and
      // no bodies, cookies, headers or email addresses leave the Worker.
      if (shouldTrackApiRequest(pathname, request.method)) {
        const durationMs = Math.max(0, Date.now() - startedAt);
        const tenantId = tenantIdFromPath(pathname);

        const properties: AnalyticsProperties = {
          status: response.status,
          duration_ms: durationMs,
          outcome:
            response.status >= 500
              ? "server_error"
              : response.status >= 400
                ? "client_error"
                : "ok",
        };

        if (tenantId) properties.tenant_id = tenantId;

        if (errorTag) properties.error_tag = errorTag;

        analytics.capture("api_request", properties);
        const conversion = authEventForRequest(pathname, request.method, response.status);

        if (conversion === "auth_signed_in" || conversion === "auth_sso_signed_in") {
          const outcome = await authOutcomeFromResponse(response);

          if (outcome === "pending")
            analytics.capture("auth_mfa_pending", { status: response.status });
          else if (outcome !== undefined)
            analytics.capture(conversion, { status: response.status });
        } else if (conversion) {
          analytics.capture(conversion, { status: response.status });
        }
      }

      // PostHog error tracking is opt-in via POSTHOG_KEY. Only uncaught failures
      // and 5xx responses are eligible; sampling and a per-isolate cap prevent
      // an outage from flooding the provider.
      if (shouldReportError(response.status, uncaught !== undefined)) {
        const properties: AnalyticsProperties = { status: response.status };

        if (errorTag) properties.error_tag = errorTag;

        analytics.captureError(
          uncaught ?? new Error(`${request.method} ${pathname} responded ${response.status}`),
          properties,
        );
      }

      if (analytics.enabled) ctx.waitUntil(analytics.flush());

      response = withSessionPresence(response, {
        sessionCookieName: sessionCookie,
        secure: new URL(request.url).protocol === "https:",
      });

      // A successful revoke/credential/email change must not leave a warm shell
      // that can paint for another five minutes. Clearing the pair forces the
      // next navigation through bootstrap, which is authoritative.
      if (clearsSsrShell(request)) response = withClearedSsrShell(response);

      if (pathname.startsWith("/api/")) response = withDefaultNoStore(response);

      return withRequestId(response, requestId);
    },

    /**
     * Cron entrypoint. The daily trigger runs maintenance (which also drains the
     * transactional-email outbox and prunes it), tenant backups and a directory
     * sweep. The hourly trigger drains the outbox and sweeps due Entra directory
     * syncs, so mail retries do not wait for the daily window. The same functions
     * are exported from `@mattrax/enterprise-backend` so a self-hosted Enterprise
     * deployment can run them from its own scheduler.
     */
    async scheduled(
      controller: ScheduledController,
      env: Env,
      ctx: ExecutionContext,
    ): Promise<void> {
      const parseDays = (value: string | undefined) => {
        if (value === undefined) return undefined;
        const parsed = Number(value);

        return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
      };

      const graphConfigured = Boolean(env.AZURE_CLIENT_ID && env.AZURE_CLIENT_SECRET);

      const logEntraResult = (exit: Exit.Exit<unknown, unknown>) => {
        if (Exit.isFailure(exit))
          console.error("Scheduled Entra directory sync failed", exit.cause);
        else console.log("Scheduled Entra directory sync complete", exit.value);
      };

      const logOutboxResult = (exit: Exit.Exit<unknown, unknown>) => {
        if (Exit.isFailure(exit)) console.error("Scheduled email outbox drain failed", exit.cause);
        else console.log("Scheduled email outbox drain complete", exit.value);
      };

      // The hourly trigger drains queued transactional mail and, when Graph is
      // configured, sweeps due directory syncs. The outbox runs even without
      // Graph so a retry does not wait for the daily job.
      if (controller.cron === HOURLY_CRON) {
        if (!graphConfigured)
          console.log("Scheduled Entra directory sync skipped: Microsoft Graph is not configured");

        // The origin certificate probe runs on every hourly tick; it records at
        // most one observation per hour, so this exercises the TLS path often
        // without creating audit or database churn.
        ctx.waitUntil(
          Effect.runPromise(Effect.exit(serverCertificateJob(env))).then(
            (exit) => {
              if (Exit.isFailure(exit))
                console.error("Scheduled origin certificate check failed", exit.cause);
              else if (exit.value.checked)
                console.log("Scheduled origin certificate check complete", exit.value.state.level);
            },
            (cause) => console.error("Scheduled origin certificate check job failed", cause),
          ),
        );

        ctx.waitUntil(
          Effect.runPromise(Effect.exit(emailOutboxJob(env))).then(logOutboxResult, (cause) =>
            console.error("Scheduled email outbox job failed", cause),
          ),
        );

        if (graphConfigured)
          ctx.waitUntil(
            Effect.runPromise(Effect.exit(entraSyncJob(env))).then(logEntraResult, (cause) =>
              console.error("Scheduled Entra directory sync job failed", cause),
            ),
          );

        return;
      }

      // A new trigger must not accidentally run the daily maintenance, backup
      // and retention work. Only the declared daily expression does that.
      if (controller.cron !== DAILY_CRON) {
        console.warn(`Scheduled trigger ${controller.cron} is not handled; ignoring`);

        return;
      }

      const mailer = resolveMailer(env);

      // The onboarding emails keep their founder persona on the hosted default;
      // a deployment that verified its own sender must use it instead.
      const onboardingFrom =
        mailer.sender.email === DEFAULT_EMAIL_FROM.email ? undefined : mailer.sender;

      // Queued delivery failures are retried by the outbox. The notifier only
      // has to enqueue one message per recipient; a maintenance retry of the
      // same threshold/day dedupes through the outbox key.
      const notifyCredentialExpiry = (notification: CredentialExpiryNotification) =>
        Effect.gen(function* () {
          if (notification.recipients.length === 0) {
            yield* Effect.logWarning("Credential expiry email skipped: no owner/admin recipients", {
              organizationId: notification.organizationId,
              threshold: notification.threshold,
            });

            return;
          }

          const db = yield* Db;
          const message = credentialExpiryEmail(notification, { origin: apiEnv.ORIGIN });

          yield* Effect.forEach(
            notification.recipients,
            (recipient) =>
              sendTransactionalEmail({
                db,
                email: mailer.transport,
                template: "credential_expiry",
                recipient: recipient.email,
                organizationId: notification.organizationId,
                dedupeKey: `credential_expiry:${notification.organizationId}:${
                  notification.threshold
                }:${notification.day}:${recipient.email.toLowerCase()}`,
                message: {
                  // One message per recipient so admins never see each other.
                  to: recipient.email,
                  from: mailer.sender,
                  subject: message.subject,
                  text: message.text,
                  html: message.html,
                },
              }),
            { concurrency: 2, discard: true },
          );
        });

      const storage = storageBucketFor(env);

      const daily = Effect.gen(function* () {
        const db = yield* Db;

        // Maintenance is allowed to fail without skipping backups: a broken
        // retention query must not leave the fleet without a recent bundle.
        const maintenance = yield* Effect.exit(
          runMaintenance({
            staleDeviceDays: parseDays(apiEnv.MAINTENANCE_STALE_DEVICE_DAYS),
            auditRetentionDays: parseDays(apiEnv.MAINTENANCE_AUDIT_RETENTION_DAYS),
            // Outbound webhook retries need the same secret used to seal endpoint
            // secrets; retention/pruning runs regardless.
            webhookAuthSecret: apiEnv.AUTH_SECRET,
            authSecret: apiEnv.AUTH_SECRET,
            notifyCredentialExpiry,
            // Review the public origin certificate as part of the daily run too;
            // the hourly trigger normally owns the frequent probe.
            serverCertificateOrigin: apiEnv.ORIGIN,
            // Queued transactional mail is drained here as well as by the
            // hourly trigger; without a transport the rows stay pending.
            email: mailer.transport,
            emailOutboxConcurrency: parsePositive(apiEnv.MAINTENANCE_EMAIL_OUTBOX_CONCURRENCY),
            emailOutboxMaxAttempts: parsePositive(apiEnv.MAINTENANCE_EMAIL_OUTBOX_MAX_ATTEMPTS),
            // Nightly seat reconciliation and customer-name repair. The plan
            // catalogue is passed so the paid quantity can be capped by the plan.
            billing: env.STRIPE_SECRET_KEY
              ? {
                  stripe: StripeService.make(env.STRIPE_SECRET_KEY),
                  deviceMonthlyPriceId: apiEnv.STRIPE_DEVICE_MONTHLY_PRICE_ID,
                  planLimits,
                }
              : undefined,
          }),
        );

        if (Exit.isFailure(maintenance))
          console.error("Scheduled maintenance failed", maintenance.cause);
        else console.log("Scheduled maintenance complete", maintenance.value);

        // Onboarding email runs after maintenance. The welcome sweep is a
        // bounded backstop for a lost verification hook; the one-week follow-up
        // is disabled by `MAINTENANCE_ONBOARDING_EMAILS=false`. Neither can
        // abort the rest of the daily job.
        const onboarding = yield* Effect.exit(
          Effect.gen(function* () {
            const welcome = yield* runWelcomeEmailSweep({
              db,
              email: mailer.transport,
              origin: apiEnv.ORIGIN,
              replyTo: onboardingReplyTo(),
              supportEmail: onboardingSupportEmail(),
              from: onboardingFrom,
            });

            const followUp = onboardingEmailsEnabled()
              ? yield* runOnboardingEmails({
                  db,
                  email: mailer.transport,
                  origin: apiEnv.ORIGIN,
                  replyTo: onboardingReplyTo(),
                  supportEmail: onboardingSupportEmail(),
                  from: onboardingFrom,
                  followUpDays: parseDayCount(apiEnv.MAINTENANCE_ONBOARDING_FOLLOW_UP_DAYS, 7),
                  windowDays: parseDayCount(apiEnv.MAINTENANCE_ONBOARDING_WINDOW_DAYS, 7),
                  cooldownDays: parseDayCount(apiEnv.MAINTENANCE_ONBOARDING_COOLDOWN_DAYS, 7),
                  since: onboardingSince,
                })
              : null;

            return { welcome, followUp };
          }),
        );

        if (Exit.isFailure(onboarding))
          console.error("Scheduled onboarding email failed", onboarding.cause);
        else console.log("Scheduled onboarding email complete", onboarding.value);

        // Tenant backups run after maintenance, bounded and failure-isolated per
        // tenant. `MAINTENANCE_BACKUP_RETENTION_DAYS=0` keeps runs indefinitely.
        const backups = yield* Effect.exit(
          runScheduledBackups(db, storage, {
            retentionDays: parseDays(apiEnv.MAINTENANCE_BACKUP_RETENTION_DAYS),
            concurrency: parsePositive(apiEnv.MAINTENANCE_BACKUP_CONCURRENCY),
          }),
        );

        // Entra directory sync runs last, also bounded and failure-isolated per
        // tenant. Without Graph credentials the sweep is a no-op.
        const entra = yield* Effect.exit(
          entraSyncEffect(db, env, parsePositive(apiEnv.MAINTENANCE_ENTRA_SYNC_CONCURRENCY)),
        );

        return { maintenance, onboarding, backups, entra };
      }).pipe(Effect.provide(Db.layer), Effect.provide(databaseLayer(env)));

      if (!graphConfigured)
        console.log("Scheduled Entra directory sync skipped: Microsoft Graph is not configured");

      ctx.waitUntil(
        Effect.runPromise(daily).then(
          ({ backups, entra }) => {
            if (Exit.isFailure(backups))
              console.error("Scheduled tenant backups failed", backups.cause);
            else console.log("Scheduled tenant backups complete", backups.value);
            logEntraResult(entra);
          },
          (cause) => console.error("Scheduled daily job failed", cause),
        ),
      );
    },
  };
};
