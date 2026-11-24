import "reflect-metadata";
import { Context, DateTime, Effect, Exit, Layer, Option, Predicate, Schema, Tracer } from "effect";
import { HttpApi, HttpApiBuilder, OpenApi } from "effect/http-api";
import { HttpRouter, HttpServer, HttpServerResponse } from "effect/http";
import { version } from "../package.json" with { type: "json" };
import { deviceViewSyncRoutes } from "./deviceViewRoutes.js";
import { AuthContract, Http } from "@yielded/auth";
import type { AuthLiveOptions } from "@mattrax/enterprise-backend";
import {
  AuthApi,
  enterpriseAccountApi,
  enterpriseAdminApi,
  enterpriseApi,
  enterpriseApplicationApi,
  enterpriseCutoverApi,
  enterpriseGroupApi,
  enterpriseAdeApi,
  enterpriseAttributeApi,
  enterpriseDashboardApi,
  enterpriseDeviceHandoverApi,
  enterpriseIdentityApi,
  enterpriseOnboardingApi,
  enterpriseUserApi,
  enterpriseSoftwareUpdateApi,
  enterpriseOsPolicyApi,
  enterpriseListApi,
  enterpriseSoftwareCatalogueApi,
  enterpriseWindowsApi,
  enterpriseApprovalApi,
  EnterpriseErrorDiagnostics,
  enterpriseScopeTagApi,
  fleetMigrationApi,
  parseSuperadminEmails,
  scriptAgentApi,
  scriptApi,
  EnterpriseService as EnterpriseServiceTag,
  restrictedSoftwareApi,
  restrictedSoftwareAgentApi,
} from "@mattrax/enterprise-domain";
import {
  EnterpriseAnalyticsService,
  EnterpriseService,
  applicationStoreServiceLayer,
  androidRoutes,
  enterpriseAccountHandlers,
  enterpriseAdminHandlers,
  enterpriseApprovalHandlers,
  enterpriseAdeHandlers,
  enterpriseAttributeHandlers,
  enterpriseDashboardHandlers,
  enterpriseDeviceHandoverHandlers,
  enterpriseGroupHandlers,
  enterpriseHandlers,
  appleByodRoutes,
  enterpriseScopeTagHandlers,
  enterpriseApplicationHandlers,
  enterpriseCutoverHandlers,
  enterpriseSoftwareUpdateHandlers,
  enterpriseOsPolicyHandlers,
  enterpriseIdentityHandlers,
  enterpriseOnboardingHandlers,
  enterpriseUserHandlers,
  enterpriseListHandlers,
  enterpriseSoftwareCatalogueHandlers,
  enterpriseWindowsHandlers,
  fleetMigrationHandlers,
  mcpOAuthRoutes,
  realtimeRoutes,
  scriptAgentHandlers,
  scriptHandlers,
  restrictedSoftwareHandlers,
  restrictedSoftwareAgentHandlers,
  scimRoutes,
  ScimMembershipNotifier,
  appleBusinessManager,
} from "@mattrax/enterprise-api";
import { appleMdmApi } from "@mattrax/dm-apple";
import {
  DEFAULT_EMAIL_FROM,
  DEFAULT_ONBOARDING_REPLY_TO,
  ONBOARDING_SUPPORT_EMAIL,
  runMaintenance,
  runOnboardingEmails,
  runScheduledBackups,
  runScheduledEntraSync,
  runScheduledReports,
  runScheduledGoogleSync,
  loadGoogleDirectoryConfig,
  runWelcomeEmailSweep,
  OnboardingEmailWarnings,
  linkedDeviceIdsForUsers,
  syncAndroidPoliciesForTenant,
  syncDirectoryGroupsForTenant,
  makeApplePush,
  makeAppAuth,
  makeAuthLive,
  makeRecoveryStrategy,
  makeSsoStrategy,
  makeEnterpriseAuthLive,
  sessionCookie,
  billingEntitlementRoutes,
  drainEmailOutbox,
  notifyRestrictedSoftwareViolations,
  sendTransactionalEmail,
  loadTrustedScepCaCertificates,
  runServerCertificateCheck,
  SoftwareUpdateCache,
} from "@mattrax/enterprise-backend";
import {
  BillingServiceLive,
  makeRemoteBillingService,
  makeServicesBillingService,
} from "@mattrax/enterprise-billing";
import type { CredentialExpiryNotification } from "@mattrax/enterprise-backend";
import { appleMdmHandlers, appleMdmRoutes } from "@mattrax/dm-apple";
import { windowsMdmRoutes, WindowsMdmServiceLive } from "@mattrax/dm-windows";
import { scepRoutes } from "@mattrax/scep";
import { AppleMdmConfig, AppleMdmService, AppleMdmTopic } from "@mattrax/dm-apple";
import { ScepService } from "@mattrax/scep";
import { ManagementBackendEnterpriseLive } from "@mattrax/mdm-apple";
import { ScepRepositoryLive } from "@mattrax/mdm-core";
import { managementWebhookOpenApi } from "@mattrax/management-backend-http";
import {
  Db,
  Env as CoreEnv,
  R2,
  deploymentUsage,
  parsePlanLimits,
  schema,
} from "@mattrax/enterprise-core";
import type { EnterpriseDb } from "@mattrax/enterprise-core";
import { ApnsService, NoopPushTransport, RelayPushTransport, makeApnsService } from "@mattrax/apns";
import { MysqlClient } from "@effect/sql-mysql2";
import { decodeDeploymentCredentials } from "@mattrax/google-workspace";
import type { GoogleWorkspaceCredentials } from "@mattrax/google-workspace";
import { env as apiEnv } from "./env.js";
import { resolveDeploymentBranding } from "./onboardingBranding.js";
import { metricsResponse, telemetry } from "./telemetry.js";
import { logBestEffortFailure } from "./bestEffort.js";
import { runScheduledJobs, scheduledRuntimeLayer } from "./scheduledRuntime.js";
import {
  DAILY_CRON,
  HOURLY_CRON,
  androidDeliveryConfig,
  androidManagementLayer,
  ssoRoutes,
  isDevMailboxEnabled,
  listDevEmails,
  timingSafeStringEqual,
  errorResponse,
  logRequest,
  readErrorTag,
  resolveRequestId,
  REQUEST_ID_HEADER,
  tenantIdFromPath,
  withDefaultNoStore,
  withRequestId,
  RateLimiterCloudflare,
  RateLimiterLocal,
  check as checkRateLimit,
  rateLimitBindingsFromEnv,
  rateLimitResponse,
  authEventForRequest,
  authOutcomeFromResponse,
  createRequestAnalytics,
  routeClassForPath,
  shouldLogRequest,
  shouldReportError,
  shouldTrackApiRequest,
  checkReadiness,
  mailerReadiness,
  selectMailer,
  createProbeCache,
  clearsSsrShell,
  withApiSecurityHeaders,
  withClearedSsrShell,
  withSessionPresence,
  loginAttemptObserver,
  credentialExpiryEmail,
  boundedClientAddress,
  databaseConfigFromFields,
  mysqlClientOptions,
  servicesUrls,
} from "@mattrax/cloud-services";
import type { AnalyticsProperties, RateLimitStore, SendEmail } from "@mattrax/cloud-services";
import { AzureOidcLive } from "@mattrax/azure-oidc";
import { AzureGraphLive } from "@mattrax/azure-graph";
import { AzureGraph } from "@mattrax/azure-graph";
import { AppleMdmTrust, MdmError, parseSubjectDn } from "@mattrax/dm-apple";
import { FetchHttpClient, HttpClient } from "effect/http";

/** One trusted-proxy decision for the limiter, the audit log and MDM scopes. */
const TRUST_PROXY_HEADERS = apiEnv.TRUST_PROXY_HEADERS === "1";

/**
 * Plan limits are deployment configuration, not product pricing. A malformed
 * secret is logged and treated as "unlimited" so a bad deploy cannot crash the
 * Worker or lock customers out.
 */
const planLimits = parsePlanLimits(apiEnv.MATTRAX_PLAN_LIMITS);

for (const warning of planLimits.warnings) console.warn(warning);

/**
 * Platform operators named by the deployment. The allowlist is authoritative
 * over the stored flag, so it is the bootstrap path for a fresh deployment and
 * a hard ceiling against a mistaken demotion.
 */
const superadmins = parseSuperadminEmails(apiEnv.MATTRAX_SUPERADMINS);

/**
 * Apple enrollment profiles carry a one-time bearer challenge. The default
 * lifetime is one hour; a deployment can choose any whole number of seconds
 * between one minute and one day.
 */
const enrollmentProfileTtlSeconds = apiEnv.MATTRAX_ENROLLMENT_PROFILE_TTL_SECONDS;

/**
 * Device check-ins are the highest-volume MDM event. Repeated check-ins from
 * the same device fold into one audit row inside this window. `0` records
 * every request, which is only sensible for a small fleet or debugging.
 */
const auditCheckinCoalesceWindowMs =
  apiEnv.MDM_AUDIT_CHECKIN_COALESCE_SECONDS === undefined
    ? undefined
    : apiEnv.MDM_AUDIT_CHECKIN_COALESCE_SECONDS * 1_000;

/**
 * Fallback counters for this process.
 *
 * Module scope, so they outlive a request: the limiter layer is rebuilt per
 * request because Worker bindings are request-scoped, but the counts must not
 * be. One process serves the whole self-hosted deployment, so these are exact
 * there; in a Worker they are per isolate, which is why they are only a
 * fallback.
 */
const localRateLimitStore: RateLimitStore = new Map();

/**
 * Charge the request to whichever limiter this deployment has.
 *
 * Shared Rate Limiting namespaces mean Cloudflare's edge limiter; without them
 * (local development, the self-hosted container) the process-local counters
 * are the limiter. Building the layer per request costs single-digit
 * microseconds and avoids retaining binding handles across request contexts.
 */
const rateLimiterLayer = (env: Env) => {
  const bindings = rateLimitBindingsFromEnv(env);
  const shared = Object.values(bindings).some((binding) => binding !== undefined);

  return shared
    ? RateLimiterCloudflare({
        bindings,
        store: localRateLimitStore,
        trustForwarded: TRUST_PROXY_HEADERS,
      })
    : RateLimiterLocal({ store: localRateLimitStore, trustForwarded: TRUST_PROXY_HEADERS });
};

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
  .add(enterpriseAdminApi)
  .add(enterpriseApi)
  .add(enterpriseApplicationApi)
  .add(enterpriseCutoverApi)
  .add(enterpriseGroupApi)
  .add(enterpriseAdeApi)
  .add(enterpriseAttributeApi)
  .add(enterpriseDashboardApi)
  .add(enterpriseDeviceHandoverApi)
  .add(enterpriseIdentityApi)
  .add(enterpriseOnboardingApi)
  .add(enterpriseUserApi)
  .add(enterpriseSoftwareUpdateApi)
  .add(enterpriseOsPolicyApi)
  .add(enterpriseListApi)
  .add(enterpriseSoftwareCatalogueApi)
  .add(enterpriseWindowsApi)
  .add(enterpriseApprovalApi)
  .add(enterpriseScopeTagApi)
  .add(fleetMigrationApi)
  .add(scriptApi)
  .add(scriptAgentApi)
  .add(restrictedSoftwareApi)
  .add(restrictedSoftwareAgentApi)
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
  HttpApiBuilder.group(apiRoot, "EnterpriseAdmin", enterpriseAdminHandlers),
  HttpApiBuilder.group(apiRoot, "EnterpriseApi", enterpriseHandlers),
  HttpApiBuilder.group(apiRoot, "EnterpriseApplication", enterpriseApplicationHandlers),
  HttpApiBuilder.group(apiRoot, "EnterpriseCutover", enterpriseCutoverHandlers),
  HttpApiBuilder.group(apiRoot, "EnterpriseGroup", enterpriseGroupHandlers),
  HttpApiBuilder.group(apiRoot, "EnterpriseAde", enterpriseAdeHandlers),
  HttpApiBuilder.group(apiRoot, "EnterpriseAttribute", enterpriseAttributeHandlers),
  HttpApiBuilder.group(apiRoot, "EnterpriseDashboard", enterpriseDashboardHandlers),
  HttpApiBuilder.group(apiRoot, "EnterpriseDeviceHandover", enterpriseDeviceHandoverHandlers),
  HttpApiBuilder.group(apiRoot, "EnterpriseIdentity", enterpriseIdentityHandlers),
  HttpApiBuilder.group(apiRoot, "EnterpriseOnboarding", enterpriseOnboardingHandlers),
  HttpApiBuilder.group(apiRoot, "EnterpriseUser", enterpriseUserHandlers),
  HttpApiBuilder.group(apiRoot, "EnterpriseSoftwareUpdate", enterpriseSoftwareUpdateHandlers),
  HttpApiBuilder.group(apiRoot, "EnterpriseOsPolicy", enterpriseOsPolicyHandlers),
  HttpApiBuilder.group(apiRoot, "EnterpriseList", enterpriseListHandlers),
  HttpApiBuilder.group(apiRoot, "EnterpriseSoftwareCatalogue", enterpriseSoftwareCatalogueHandlers),
  HttpApiBuilder.group(apiRoot, "EnterpriseWindows", enterpriseWindowsHandlers),
  HttpApiBuilder.group(apiRoot, "EnterpriseApproval", enterpriseApprovalHandlers),
  HttpApiBuilder.group(apiRoot, "EnterpriseScopeTag", enterpriseScopeTagHandlers),
  HttpApiBuilder.group(apiRoot, "FleetMigration", fleetMigrationHandlers),
  HttpApiBuilder.group(apiRoot, "ScriptApi", scriptHandlers),
  HttpApiBuilder.group(apiRoot, "ScriptAgentApi", scriptAgentHandlers),
  HttpApiBuilder.group(apiRoot, "RestrictedSoftwareApi", restrictedSoftwareHandlers),
  HttpApiBuilder.group(apiRoot, "RestrictedSoftwareAgentApi", restrictedSoftwareAgentHandlers),
  HttpApiBuilder.group(apiRoot, "AppleDM", appleMdmHandlers),
).pipe(authHttps.middleware);

const handlersLayer = Layer.mergeAll(
  applicationHandlers,
  authHttps.handlers(apiRoot),
  // The services deployment owns Stripe and pushes entitlements here.
  billingEntitlementRoutes({ token: apiEnv.SERVICES_TOKEN }),
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
  // The DiagnosticLog CSP uploads its ZIP to this scoped URL. It is a raw
  // route because the body is binary and the device presents a signed token,
  // not a tenant session.
  ...["PUT" as const, "POST" as const].map((method) =>
    HttpRouter.add(method, "/api/v1/windows-diagnostics/upload", (request) =>
      Effect.flatMap(EnterpriseServiceTag, (service) =>
        Effect.map(
          service.uploadWindowsDiagnostics(request),
          (result: { status: number; body: unknown }) =>
            HttpServerResponse.jsonUnsafe(result.body, { status: result.status }),
        ),
      ),
    ),
  ),
);

const apiLayer = Layer.mergeAll(
  HttpApiBuilder.layer(apiRoot).pipe(Layer.provide(handlersLayer)),
  appleMdmRoutes,
  appleByodRoutes,
  scepRoutes,
  scimRoutes,
);

const appLayer = apiLayer.pipe(Layer.provide(HttpServer.layerServices));

const databaseLayer = (env: Env) => {
  // The Node host extends the binding with TLS options parsed from
  // `DATABASE_URL`; the Workers binding never has them.
  // SAFETY: the extra field is optional and only the Node entry sets it.
  const hyperdrive = env.HYPERDRIVE as Env["HYPERDRIVE"] & {
    ssl?: false | { rejectUnauthorized: boolean };
  };
  const config = databaseConfigFromFields({
    host: hyperdrive.host,
    port: hyperdrive.port,
    user: hyperdrive.user,
    password: hyperdrive.password,
    database: hyperdrive.database,
    ssl: hyperdrive.ssl,
  });

  return MysqlClient.layer(mysqlClientOptions(config));
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
 * Deployment-wide Google Workspace directory credentials.
 *
 * Parsed once at boot. A malformed document is reported without echoing it:
 * the value is a private key. Tenants that save their own key do not depend on
 * this; it is only the self-hosted "configure once" fallback.
 */
const googleWorkspaceCredentials = (): GoogleWorkspaceCredentials | undefined => {
  if (!apiEnv.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON || !apiEnv.GOOGLE_WORKSPACE_ADMIN_EMAIL)
    return undefined;

  try {
    return Effect.runSync(
      decodeDeploymentCredentials({
        serviceAccountJson: apiEnv.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON,
        adminEmail: apiEnv.GOOGLE_WORKSPACE_ADMIN_EMAIL,
        customer: apiEnv.GOOGLE_WORKSPACE_CUSTOMER,
      }),
    );
  } catch {
    console.error(
      "Google Workspace directory sync is disabled: the deployment service-account configuration is invalid.",
    );

    return undefined;
  }
};

const googleCredentials = googleWorkspaceCredentials();

/** Resolve one tenant's Workspace credentials, preferring its sealed key. */
const resolveGoogleCredentials = (db: EnterpriseDb, env: Env) => (organizationId: string) =>
  loadGoogleDirectoryConfig({
    db,
    organizationId,
    authSecret: env.AUTH_SECRET,
    deployment: googleCredentials,
  }).pipe(
    Effect.map((loaded) => loaded?.credentials ?? null),
    Effect.catch((error) =>
      Effect.sync(() => {
        console.error(
          "Google Workspace credentials unavailable",
          organizationId,
          Predicate.isError(error) ? error.message : "unknown error",
        );

        return null;
      }),
    ),
  );

/** Scheduled Google Workspace sweep; tenants without credentials are skipped. */
const googleSyncEffect = (
  db: EnterpriseDb,
  env: Env,
  concurrency: number | undefined,
  onMembershipsChanged?: (
    organizationId: string,
    userIds: ReadonlyArray<string>,
  ) => Effect.Effect<void, unknown, never>,
) =>
  runScheduledGoogleSync({
    db,
    concurrency,
    resolveCredentials: resolveGoogleCredentials(db, env),
    onMembershipsChanged,
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
        AzureGraphLive({
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

/**
 * Windows enrollment/management failure diagnostics are kept for the same
 * window by the delivery panel and the daily prune, so the count an operator
 * sees is what maintenance actually retains.
 */
const windowsFailureRetentionDays = 30;

const onboardingReplyTo = () => apiEnv.MATTRAX_ONBOARDING_REPLY_TO ?? DEFAULT_ONBOARDING_REPLY_TO;

const onboardingSupportEmail = () =>
  apiEnv.MATTRAX_ONBOARDING_SUPPORT_EMAIL ?? ONBOARDING_SUPPORT_EMAIL;

/**
 * Resolve once: the verification hook and the delayed welcome sweep must render
 * the same brand even when the first attempt was lost.
 */
const onboardingBranding = resolveDeploymentBranding(apiEnv);

const onboardingSince = apiEnv.MATTRAX_ONBOARDING_SINCE
  ? DateTime.toDateUtc(apiEnv.MATTRAX_ONBOARDING_SINCE)
  : null;

/**
 * The mailer settings live in two places: the Cloudflare binding on `Env` and
 * the parsed deployment variables on `apiEnv` (some are only declared when a
 * deploy supplies them). This keeps the selection call sites to one expression.
 */
const resolveMailer = (env: Env) =>
  selectMailer({
    ORIGIN: env.ORIGIN,
    // SAFETY: the Worker binding implements the structured `send` overload used by the adapter.
    EMAIL: env.EMAIL as SendEmail | undefined,
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
      concurrency: apiEnv.MAINTENANCE_EMAIL_OUTBOX_CONCURRENCY,
      maxAttempts: apiEnv.MAINTENANCE_EMAIL_OUTBOX_MAX_ATTEMPTS,
    });
  });

/**
 * Deliver pending restricted-software violation events. Inventory writes mark
 * new violations with `notifiedAt = null`; this sweep signs the webhook and
 * queues the optional email, then records that the event went out.
 */
const restrictedSoftwareNotificationsJob = (env: Env) =>
  Effect.gen(function* () {
    const db = yield* Db;

    return yield* notifyRestrictedSoftwareViolations({
      db,
      authSecret: env.AUTH_SECRET,
      email: resolveMailer(env).transport,
    });
  }).pipe(
    Effect.orDie,
    Effect.provide(Db.layer),
    Effect.provide(databaseLayer(env)),
  );

/**
 * Review the deployment origin's TLS certificate. Runs from the hourly trigger
 * so the code path is exercised often; the check itself is throttled to once an
 * hour, and the daily maintenance run reuses a fresh observation.
 */
const serverCertificateJob = () =>
  Effect.gen(function* () {
    const db = yield* Db;

    return yield* runServerCertificateCheck(db, { origin: apiEnv.ORIGIN });
  });

/**
 * Generate due dashboard reports. The daily run does this too, but a report
 * scheduled for a specific UTC hour would otherwise wait for 03:17; the hourly
 * trigger lets the hour setting mean what it says. Claiming a run per
 * `(report, period)` makes a second tick in the same hour a no-op.
 */
const dashboardReportsJob = (env: Env) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const mailer = resolveMailer(env);

    if (!mailer.transport) return { due: 0, queued: 0, skipped: 0, failed: 0 };

    return yield* runScheduledReports({
      db,
      email: mailer.transport,
      from: mailer.sender,
    });
  });

/** Hosted endpoints derived from the single services origin. */
const services = servicesUrls(apiEnv.MATTRAX_SERVICES_URL);

const makeHostedApns = () => {
  const url = services.apnsRelay;
  // Hosted Cloud signs relay requests with the shared services token. A
  // self-hosted deployment already holds a licence key; reusing it for the
  // relay keeps push working without a second shared secret.
  const licenseKey = apiEnv.MATTRAX_LICENSE_KEY;

  return makeApnsService(
    apiEnv.SERVICES_TOKEN
      ? RelayPushTransport({ url, secret: apiEnv.SERVICES_TOKEN })
      : licenseKey
        ? RelayPushTransport({ url, token: licenseKey })
        : NoopPushTransport(
            "APNs push relay is not configured; devices will poll for changes instead",
          ),
  );
};

/**
 * Wake the devices affected by a directory membership change.
 *
 * Shared by the hourly sweep and the daily job: both write directory
 * memberships and must re-derive linked device groups before pushing, or a
 * change written during that tick is never seen by a later run (there are no
 * changed users to report).
 */
const makeMembershipRefresher = (db: EnterpriseDb, env: Env) => {
  const apns = makeHostedApns();

  const androidConfig = androidDeliveryConfig(apiEnv);

  const applePush = makeApplePush({
    db,
    schema,
    apns,
    authSecret: env.AUTH_SECRET,
  });

  return (organizationId: string, userIds: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      // Device groups linked to directory groups must be recomputed before the
      // linked devices are woken, or a newly derived group policy would not be
      // part of their next check-in.
      yield* syncDirectoryGroupsForTenant(db, organizationId);

      const deviceIds = yield* linkedDeviceIdsForUsers(db, organizationId, userIds);

      if (deviceIds.length === 0) return;

      yield* applePush
        .pushAppleDevices(deviceIds)
        .pipe(logBestEffortFailure("apple_push", organizationId));
      yield* syncAndroidPoliciesForTenant({
        db,
        config: androidConfig,
        organizationId,
        deviceIds,
      }).pipe(
        logBestEffortFailure("android_policy_sync", organizationId),
        Effect.provide(androidManagementLayer(androidConfig)),
      );
    });
};

/** Standalone scheduled Entra sweep used by the hourly trigger. */
const entraSyncJob = (env: Env) =>
  Effect.gen(function* () {
    const db = yield* Db;

    // Directory membership changes can add or remove user-assigned policies.
    // Wake the linked devices so they converge without waiting for a poll.
    const refreshMemberships = makeMembershipRefresher(db, env);

    return yield* entraSyncEffect(
      db,
      env,
      apiEnv.MAINTENANCE_ENTRA_SYNC_CONCURRENCY,
      refreshMemberships,
    );
  });

/** Standalone scheduled Google Workspace sweep used by the hourly trigger. */
const googleSyncJob = (env: Env) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const refreshMemberships = makeMembershipRefresher(db, env);

    return yield* googleSyncEffect(
      db,
      env,
      apiEnv.MAINTENANCE_GOOGLE_SYNC_CONCURRENCY,
      refreshMemberships,
    );
  });

type CryptoLayer = AuthLiveOptions["cryptoLayer"];

/**
 * Self-hosted billing is remote: the deployment pays the vendor for the whole
 * licence and never holds Stripe credentials. These variables are read from the
 * Node process directly because they are not part of the hosted Worker's
 * binding set.
 */
const remoteBillingConfig = () => {
  const licenseKey = apiEnv.MATTRAX_LICENSE_KEY;

  return licenseKey ? { url: services.billing, licenseKey } : undefined;
};

/** Report deployment usage to the cloud licence so seats stay in sync. */
const reportLicenseUsage = (db: EnterpriseDb, env: Env) =>
  Effect.gen(function* () {
    const config = remoteBillingConfig();

    if (!config) return;

    const usage = yield* deploymentUsage(db);

    yield* makeRemoteBillingService({
      ...config,
      origin: env.ORIGIN,
    }).reportUsage(usage);
  });

const decodeSubjectHeader = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const makeAppLayer = (
  env: Env,
  cryptoLayer: CryptoLayer,
  httpClientLayer: Layer.Layer<HttpClient.HttpClient>,
) => {
  const androidConfig = androidDeliveryConfig(apiEnv);

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
  const apns = makeHostedApns();

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
    onboardingBranding,
    trustedOrigins: (apiEnv.TRUSTED_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  }).pipe(
    // The auth service is built before the API service that depends on it, so
    // give it the same state Layers explicitly rather than relying on the
    // later merged request context.
    Layer.provideMerge(EnterpriseErrorDiagnostics.layer),
    Layer.provideMerge(OnboardingEmailWarnings.layer),
  );

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

            // The forwarder may already have decoded the header.
            const subject = decodeSubjectHeader(identityCertificateSubject);

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
    // The MDM check-in owns the moment an uninstall is confirmed by inventory;
    // returning the Apps and Books seat here keeps the licence pool correct
    // without a separate scheduled reconciliation.
    releaseAppleVppLicence: async ({ db, organizationId, deviceId, adamId }) =>
      Effect.runPromise(
        appleBusinessManager
          .releaseVppLicence({
            db,
            organizationId,
            deviceId,
            adamId,
            authSecret: env.AUTH_SECRET,
          })
          .pipe(
            Effect.match({
              onSuccess: () => true,
              onFailure: () => false,
            }),
          ),
      ),
    // Use the same signing identity and challenge lifetime as the enrollment
    // profile download when an ADE device asks for its profile inline.
    appleProfileSigning:
      env.APPLE_PROFILE_SIGNING_CERT ||
      env.APPLE_PROFILE_SIGNING_KEY ||
      env.APPLE_PROFILE_SIGNING_CHAIN
        ? {
            certificatePem: env.APPLE_PROFILE_SIGNING_CERT,
            privateKeyPem: env.APPLE_PROFILE_SIGNING_KEY,
            chainPem: env.APPLE_PROFILE_SIGNING_CHAIN,
          }
        : undefined,
    enrollmentProfileTtlSeconds,
    auditCheckinCoalesceWindowMs,
  }).pipe(Layer.provide(Db.layer));

  const azureGraphLayer =
    env.AZURE_CLIENT_ID && env.AZURE_CLIENT_SECRET
      ? AzureGraphLive({
          clientId: env.AZURE_CLIENT_ID,
          clientSecret: env.AZURE_CLIENT_SECRET,
          origin: env.ORIGIN,
        })
      : Layer.empty;

  // Hosted Cloud forwards tenant billing to the services deployment. A
  // self-hosted deployment uses the licence API on the same service; neither
  // path needs a Stripe secret in the application.
  const servicesBilling = apiEnv.SERVICES_TOKEN
    ? makeServicesBillingService({
        url: services.origin,
        token: apiEnv.SERVICES_TOKEN,
        origin: env.ORIGIN,
      })
    : undefined;
  const remoteBilling = servicesBilling ? undefined : remoteBillingConfig();
  const billing =
    servicesBilling ??
    (remoteBilling
      ? makeRemoteBillingService({ ...remoteBilling, origin: env.ORIGIN })
      : undefined);

  const servicesLayer = Layer.mergeAll(
    OnboardingEmailWarnings.layer,
    EnterpriseService({
      hosted: Boolean(env.CF_VERSION_METADATA),
      superadmins,
      email,
      // `MAIL_FROM` decides the envelope sender for every provider; the
      // invitation-specific override still wins when an operator wants the
      // branded address only for invites.
      invitationFromEmail: apiEnv.MATTRAX_INVITATION_FROM ?? mailer.sender.email,
      branding: onboardingBranding,
      enrollmentProfileTtlSeconds,
      // The SOFA feed is public and refreshable at most a few times a day.
      // Failure cooldowns keep an outage from adding a timeout to every
      // dashboard request; disabling it leaves macOS statuses unknown.
      softwareUpdateFeedUrl: apiEnv.SOFA_FEED_URL,
      softwareUpdateCacheTtlMs: (apiEnv.SOFA_FEED_CACHE_SECONDS ?? 6 * 60 * 60) * 1_000,
      softwareUpdateRetryMs: (apiEnv.SOFA_FEED_RETRY_SECONDS ?? 15 * 60) * 1_000,
      softwareUpdateTimeoutMs: apiEnv.SOFA_FEED_TIMEOUT_MS ?? 5_000,
      softwareUpdateSupportedMajors: apiEnv.SOFA_FEED_SUPPORTED_MAJORS ?? 3,
      softwareUpdateDisabled: /^(1|true|yes|on)$/i.test(apiEnv.SOFA_FEED_DISABLED ?? ""),
      azureClientId: env.AZURE_CLIENT_ID,
      googleWorkspace: googleCredentials,
      windowsFederated: windowsFederatedAudience
        ? { audience: windowsFederatedAudience }
        : undefined,
      android: androidConfig,
      planLimits,
      // Match the delivery panel's "in N days" window to what maintenance keeps.
      windowsFailureRetentionDays,
    }).pipe(
      Layer.provide(billing ? BillingServiceLive(billing) : Layer.empty),
      Layer.provideMerge(applicationStoreServiceLayer()),
      Layer.provideMerge(EnterpriseErrorDiagnostics.layer),
      Layer.provideMerge(SoftwareUpdateCache.layer),
      // Merge auth into the service layer's output so raw routes (the SSE
      // stream) can resolve it from the request context too.
      Layer.provideMerge(enterpriseAuthLive),
      Layer.provide(staticEnvLayer),
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
    AzureOidcLive(),
    androidManagementLayer(androidConfig),
  );

  const appWithDevRoutes = Layer.mergeAll(
    // Registered first so every route added below is wrapped by it.
    loginAttemptObserver,
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
                branding: onboardingBranding,
              });

              const followUp = onboardingEmailsEnabled()
                ? yield* runOnboardingEmails({
                    db,
                    email,
                    origin: env.ORIGIN,
                    replyTo: onboardingReplyTo(),
                    supportEmail: onboardingSupportEmail(),
                    followUpDays: apiEnv.MAINTENANCE_ONBOARDING_FOLLOW_UP_DAYS ?? 7,
                    windowDays: apiEnv.MAINTENANCE_ONBOARDING_WINDOW_DAYS ?? 7,
                    cooldownDays: apiEnv.MAINTENANCE_ONBOARDING_COOLDOWN_DAYS ?? 7,
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
    // Authenticated, tenant-scoped SSE invalidation. Mounted as a raw route so
    // it can return a bounded streaming body instead of an HttpApi JSON value.
    realtimeRoutes().pipe(Layer.provide(HttpServer.layerServices)),
    ...deviceViewSyncRoutes(env).map((route) =>
      route.pipe(Layer.provide(HttpServer.layerServices)),
    ),
  );

  const scimNotifierLayer = Layer.succeed(
    ScimMembershipNotifier,
    (
      db: EnterpriseDb,
      organizationId: string,
      userIds: ReadonlyArray<string>,
      linkedDeviceIds: ReadonlyArray<string> = [],
    ) =>
      Effect.gen(function* () {
        const deviceIds = [
          ...new Set([
            ...(yield* linkedDeviceIdsForUsers(db, organizationId, userIds)),
            ...linkedDeviceIds,
          ]),
        ];

        if (deviceIds.length === 0) return;

        const applePush = makeApplePush({
          db,
          schema,
          apns,
          authSecret: env.AUTH_SECRET,
        });

        yield* applePush
          .pushAppleDevices(deviceIds)
          .pipe(logBestEffortFailure("apple_push", organizationId));
        yield* syncAndroidPoliciesForTenant({
          db,
          config: androidConfig,
          organizationId,
          deviceIds,
        }).pipe(
          logBestEffortFailure("android_policy_sync", organizationId),
          Effect.provide(androidManagementLayer(androidConfig)),
        );
      }),
  );

  // One tracer for the whole request graph. Effect creates a span for
  // `Effect.withSpan` and for every SQL statement, so service code and MySQL
  // are instrumented without threading anything through. The web handler uses
  // the same instance to open the request's root span. `provideMerge` keeps
  // the service in the layer's output, which is the context the request fiber
  // runs in; a plain `provide` would only cover layer construction.
  const telemetryLayer = Layer.succeed(Tracer.Tracer, telemetry.tracer);

  return appWithDevRoutes.pipe(
    Layer.provide(scimNotifierLayer),
    // `provideMerge` keeps the MDM/SCEP service instances in the layer's
    // output. With plain `provide` the routes were built, but their handlers
    // failed at request time with `Service not found: ScepService`.
    Layer.provideMerge(servicesLayer),
    // Merge auth into the output too: the raw realtime route resolves it from
    // the request context, and plain `provide` only satisfies construction.
    Layer.provideMerge(authLive),
    Layer.provideMerge(Db.layer),
    Layer.provide(databaseLayer(env)),
    Layer.provide(httpClientLayer),
    Layer.provideMerge(telemetryLayer),
  );
};

/**
 * Build a Web handler for an environment. `toWebHandler` owns the layer's scope
 * and serves every request through it; the Cloudflare entry rebuilds per
 * request (one isolate, short-lived), while the Node entry caches it so the
 * MySQL pool and password admission survive across requests.
 */
const getAppHandler = (
  env: Env,
  cryptoLayer: CryptoLayer,
  httpClientLayer: Layer.Layer<HttpClient.HttpClient>,
) => {
  // SAFETY: makeAppLayer returns the combined router/service layer; the web
  // handler only reads the router and server services from its output. The
  // layer's inferred requirement channel includes framework request services
  // that `toWebHandler` cannot name, so the assertion stays at this boundary.
  return HttpRouter.toWebHandler(
    makeAppLayer(env, cryptoLayer, httpClientLayer) as Layer.Layer<
      unknown,
      unknown,
      HttpRouter.HttpRouter
    >,
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

const deploymentId = (env: Env): string | null => env.CF_VERSION_METADATA?.id ?? null;

let reportedMissingPostHogKey = false;

const reportMissingPostHogKey = (): void => {
  if (reportedMissingPostHogKey) return;

  reportedMissingPostHogKey = true;
  console.warn(
    "[posthog] POSTHOG_KEY is not configured on the mattrax-api Worker; product analytics and error tracking are disabled.",
  );
};

/**
 * Prove object storage is writable, readable and deletable with one real probe
 * object. A read-only volume or an unbound bucket fails here instead of on the
 * first upload, backup or download.
 */
const checkStorageReady = async (env: Env): Promise<"ok"> => {
  const key = `__readiness/${crypto.randomUUID()}`;
  let failure: Error | undefined;

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
  } catch (error) {
    failure = Predicate.isError(error) ? error : new Error(String(error));
  }

  try {
    await env.STORAGE.delete(key);
  } catch (error) {
    failure ??= Predicate.isError(error) ? error : new Error(String(error));
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
  const error = Predicate.isError(cause) ? cause : undefined;
  const text = error ? `${error.name}: ${error.message}` : String(cause);

  return text
    .replaceAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replaceAll(/\b[A-Za-z0-9+/=_-]{32,}\b/g, "[redacted]")
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

  // The client address is computed once, with the rate limiter's trust policy,
  // and handed to the inner handlers as a header they can trust. A caller can
  // never set it: the value is stripped first and only the verified address is
  // written back. Handlers store null when the deployment cannot prove one.
  headers.delete("x-mattrax-client-address");
  // SAFETY: Workers requests expose the platform's `cf` object; Node requests do not.
  const cloudflare = (request as { cf?: unknown }).cf !== undefined;

  const address = boundedClientAddress(request.headers, {
    trustForwarded: TRUST_PROXY_HEADERS,
    cloudflare,
  });

  if (address) headers.set("x-mattrax-client-address", address);

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
  options: {
    readonly cacheHandler?: boolean;
    /** Replace the single outbound Effect transport in tests or custom hosts. */
    readonly httpClientLayer?: Layer.Layer<HttpClient.HttpClient>;
  } = {},
) => {
  const httpClientLayer = options.httpClientLayer ?? FetchHttpClient.layer;

  // A Node process serves many requests from one runtime, so rebuilding the
  // service graph per request would create a new MySQL pool every time. The
  // Cloudflare entry keeps the per-request build: Workers forbid reusing I/O
  // objects (including a MySQL socket) across request contexts.
  const handlers = new WeakMap<Env, ReturnType<typeof getAppHandler>>();

  const appHandler = (env: Env) => {
    if (!options.cacheHandler) return getAppHandler(env, cryptoLayer, httpClientLayer);

    let handler = handlers.get(env);

    if (!handler) {
      handler = getAppHandler(env, cryptoLayer, httpClientLayer);
      handlers.set(env, handler);
    }

    return handler;
  };

  return {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      const requestId = resolveRequestId(request);
      const startedAt = Date.now();
      const pathname = new URL(request.url).pathname;
      // One bounded label for metrics; the raw path never becomes a label.
      const route = routeClassForPath(pathname);

      const trace = telemetry.beginRequest({
        method: request.method,
        route,
        traceparent: request.headers.get("traceparent"),
      });

      if (!apiEnv.POSTHOG_KEY) reportMissingPostHogKey();

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
        errorSampleRate: apiEnv.POSTHOG_ERROR_SAMPLE_RATE ?? 1,
        maxErrorsPerMinute: apiEnv.POSTHOG_ERROR_MAX_EVENTS_PER_MINUTE ?? 20,
      });

      let response: Response;
      let uncaught: unknown;

      try {
        const limited = await Effect.runPromise(
          checkRateLimit(request).pipe(Effect.provide(rateLimiterLayer(env))),
        );

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
        } else if (pathname === "/api/metrics" && request.method === "GET") {
          // Handled before the Effect router: it needs no database, no auth
          // machinery and no service layer, so a scrape stays cheap.
          response = metricsResponse(request);
        } else {
          const deviceRequest = new Request(request, { headers: deviceIdentityHeaders(request) });

          // The root span becomes the parent of every span the handler creates
          // (including `@effect/sql` query spans), which is what makes the
          // trace ids on the log line join up.
          const requestServices = new Map<string, unknown>([
            [EnterpriseAnalyticsService.key, analytics],
          ]);

          if (trace) requestServices.set(Tracer.ParentSpan.key, trace.span);

          response = await appHandler(env).handler(
            deviceRequest,
            Context.makeUnsafe(requestServices),
          );
        }
      } catch (error) {
        uncaught = error;
        response = errorResponse(500, requestId, {
          error: "internal_error",
          message: "Internal Server Error",
        });
      }

      const errorTag = uncaught ? "UncaughtError" : await readErrorTag(response);
      const durationMs = Math.max(0, Date.now() - startedAt);

      // Closing the root span also records the request and MDM-outcome
      // metrics; the returned children are the trace's timing breakdown.
      const childSpans = trace
        ? telemetry.finishRequest(trace, { status: response.status, durationMs, errorTag })
        : [];

      if (shouldLogRequest(pathname, response.status)) {
        const summary = telemetry.summariseSpans(childSpans);

        logRequest({
          requestId,
          method: request.method,
          path: pathname,
          status: response.status,
          durationMs,
          tenantId: tenantIdFromPath(pathname),
          traceId: trace?.traceId,
          spanId: trace?.spanId,
          // Only include the breakdown when there is something to show; a
          // request with no children keeps the line as small as before.
          spans: summary.spans.length > 0 ? summary.spans : undefined,
          spanCount: summary.spanCount > 0 ? summary.spanCount : undefined,
          errorTag,
          error: uncaught ? describeError(uncaught) : undefined,
        });
      }

      // PostHog product analytics. Paths are recorded without query strings and
      // no bodies, cookies, headers or email addresses leave the Worker.
      if (shouldTrackApiRequest(pathname, request.method)) {
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

      // A WebSocket upgrade carries its accepted socket on the native
      // Response. The header helpers clone Responses, which would discard that
      // socket, so copy the headers and explicitly carry `webSocket` across.
      if (response.status === 101) {
        const headers = new Headers(response.headers);
        headers.set("cache-control", "no-store");
        headers.set("x-content-type-options", "nosniff");
        headers.set("x-frame-options", "DENY");
        headers.set("referrer-policy", "strict-origin-when-cross-origin");
        headers.set(REQUEST_ID_HEADER, requestId);
        if (new URL(request.url).protocol === "https:")
          headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");

        return new Response(null, {
          status: 101,
          statusText: response.statusText,
          headers,
          webSocket: response.webSocket,
        });
      }

      response = withSessionPresence(response, {
        sessionCookieName: sessionCookie,
        secure: new URL(request.url).protocol === "https:",
      });

      // A successful revoke/credential/email change must not leave a warm shell
      // that can paint for another five minutes. Clearing the pair forces the
      // next navigation through bootstrap, which is authoritative.
      if (clearsSsrShell(request)) response = withClearedSsrShell(response);

      if (pathname.startsWith("/api/")) response = withDefaultNoStore(response);

      // /api, /mdm and /scim are published as Workers routes so browser and
      // device traffic reaches this Worker without the website hop. Those
      // responses no longer inherit the website's hardening set; apply the
      // entries that matter for a payload here.
      response = withApiSecurityHeaders(request, response);

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
      const graphConfigured = Boolean(env.AZURE_CLIENT_ID && env.AZURE_CLIENT_SECRET);

      const observeJob = <A>(
        label: string,
        job: Effect.Effect<A, unknown, Db | HttpClient.HttpClient>,
        onSuccess: (value: A) => void = () => {},
      ) =>
        job.pipe(
          Effect.matchCause({
            onFailure: (cause) =>
              Effect.sync(() => {
                console.error(label, cause);
              }),
            onSuccess: (value) =>
              Effect.sync(() => {
                onSuccess(value);
              }),
          }),
        );

      // The hourly trigger drains queued transactional mail and sweeps due
      // directory syncs (Entra needs Graph app credentials; Google works with
      // tenant credentials even when the deployment has no service account).
      // The outbox runs even without Graph so a retry does not wait for the
      // daily job.
      if (controller.cron === HOURLY_CRON) {
        if (!graphConfigured)
          console.log("Scheduled Entra directory sync skipped: Microsoft Graph is not configured");

        const jobs = [
          observeJob(
            "Scheduled origin certificate check failed",
            serverCertificateJob(),
            (result) => {
              if (result.checked)
                console.log("Scheduled origin certificate check complete", result.state.level);
            },
          ),
          observeJob("Scheduled email outbox drain failed", emailOutboxJob(env), (result) => {
            console.log("Scheduled email outbox drain complete", result);
          }),
          observeJob("Scheduled dashboard reports failed", dashboardReportsJob(env), (result) => {
            if (result.queued > 0 || result.failed > 0)
              console.log("Scheduled dashboard reports complete", result);
          }),
          observeJob(
            "Scheduled restricted software notifications failed",
            restrictedSoftwareNotificationsJob(env),
            (result) => {
              if (result.notified > 0)
                console.log("Scheduled restricted software notifications complete", result);
            },
          ),
          ...(graphConfigured
            ? [
                observeJob("Scheduled Entra directory sync failed", entraSyncJob(env), (result) => {
                  console.log("Scheduled Entra directory sync complete", result);
                }),
              ]
            : []),
          observeJob("Scheduled Google directory sync failed", googleSyncJob(env), (result) => {
            console.log("Scheduled Google directory sync complete", result);
          }),
        ];
        const hourly = runScheduledJobs(
          jobs,
          scheduledRuntimeLayer(databaseLayer(env), httpClientLayer),
        );
        const signal = (ctx as ExecutionContext & { readonly signal?: AbortSignal }).signal;

        ctx.waitUntil(
          Effect.runPromiseExit(hourly, { signal }).then((exit) => {
            if (Exit.isFailure(exit)) console.error("Scheduled hourly runtime failed", exit.cause);
          }),
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
        const cronBilling = apiEnv.SERVICES_TOKEN
          ? makeServicesBillingService({
              url: services.origin,
              token: apiEnv.SERVICES_TOKEN,
              origin: env.ORIGIN,
            })
          : remoteBillingConfig()
            ? makeRemoteBillingService({
                ...remoteBillingConfig()!,
                origin: env.ORIGIN,
              })
            : undefined;

        yield* reportLicenseUsage(db, env).pipe(
          Effect.catch((error) =>
            Effect.logWarning("Scheduled licence usage report failed", { error }),
          ),
        );

        // Maintenance is allowed to fail without skipping backups: a broken
        // retention query must not leave the fleet without a recent bundle.
        const maintenance = yield* Effect.exit(
          runMaintenance({
            staleDeviceDays: apiEnv.MAINTENANCE_STALE_DEVICE_DAYS,
            storage,
            auditRetentionDays: apiEnv.MAINTENANCE_AUDIT_RETENTION_DAYS,
            windowsFailureRetentionDays,
            // Outbound webhook retries need the same secret used to seal endpoint
            // secrets; retention/pruning runs regardless.
            webhookAuthSecret: apiEnv.AUTH_SECRET,
            authSecret: apiEnv.AUTH_SECRET,
            notifyCredentialExpiry,
            // Review the public origin certificate as part of the daily run too;
            // the hourly trigger normally owns the frequent probe.
            serverCertificateOrigin: apiEnv.ORIGIN,
            // Report mail uses the same verified sender as the rest of the
            // deployment's transactional mail.
            reportEmailFrom: mailer.sender,
            // Queued transactional mail is drained here as well as by the
            // hourly trigger; without a transport the rows stay pending.
            email: mailer.transport,
            emailOutboxConcurrency: apiEnv.MAINTENANCE_EMAIL_OUTBOX_CONCURRENCY,
            emailOutboxMaxAttempts: apiEnv.MAINTENANCE_EMAIL_OUTBOX_MAX_ATTEMPTS,
            // Nightly usage report. The services deployment reconciles paid
            // seats and retries a lost report in its own sweep.
            billing: cronBilling ? { reportUsage: cronBilling.reportUsage } : undefined,
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
              branding: onboardingBranding,
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
                  followUpDays: apiEnv.MAINTENANCE_ONBOARDING_FOLLOW_UP_DAYS ?? 7,
                  windowDays: apiEnv.MAINTENANCE_ONBOARDING_WINDOW_DAYS ?? 7,
                  cooldownDays: apiEnv.MAINTENANCE_ONBOARDING_COOLDOWN_DAYS ?? 7,
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
            retentionDays: apiEnv.MAINTENANCE_BACKUP_RETENTION_DAYS,
            concurrency: apiEnv.MAINTENANCE_BACKUP_CONCURRENCY,
          }),
        );

        // Entra directory sync runs last, also bounded and failure-isolated per
        // tenant. Without Graph credentials the sweep is a no-op. The same
        // callback as the hourly sweep re-derives linked groups and wakes their
        // devices, so memberships written by this tick converge immediately.
        const refreshMemberships = makeMembershipRefresher(db, env);

        const entra = yield* Effect.exit(
          entraSyncEffect(db, env, apiEnv.MAINTENANCE_ENTRA_SYNC_CONCURRENCY, refreshMemberships),
        );

        // Google runs after Entra, also bounded and failure-isolated. It skips
        // tenants with no tenant or deployment credentials.
        const google = yield* Effect.exit(
          googleSyncEffect(db, env, apiEnv.MAINTENANCE_GOOGLE_SYNC_CONCURRENCY, refreshMemberships),
        );

        return { maintenance, onboarding, backups, entra, google };
      }).pipe(Effect.provide(scheduledRuntimeLayer(databaseLayer(env), httpClientLayer)));

      if (!graphConfigured)
        console.log("Scheduled Entra directory sync skipped: Microsoft Graph is not configured");

      const signal = (ctx as ExecutionContext & { readonly signal?: AbortSignal }).signal;

      ctx.waitUntil(
        Effect.runPromiseExit(daily, { signal }).then((exit) => {
          if (Exit.isFailure(exit)) {
            console.error("Scheduled daily job failed", exit.cause);

            return;
          }

          const { backups, entra, google } = exit.value;

          if (Exit.isFailure(backups))
            console.error("Scheduled tenant backups failed", backups.cause);
          else console.log("Scheduled tenant backups complete", backups.value);

          if (Exit.isFailure(entra))
            console.error("Scheduled Entra directory sync failed", entra.cause);
          else console.log("Scheduled Entra directory sync complete", entra.value);

          if (Exit.isFailure(google))
            console.error("Scheduled Google directory sync failed", google.cause);
          else console.log("Scheduled Google directory sync complete", google.value);
        }),
      );
    },
  };
};
