import { bindings, defineConfig, triggers } from "cf/config";
import type { InferEnv, UnwrapConfig } from "cf/config";

/**
 * Shared Cloudflare Rate Limiting namespaces, supplied at build time. They are
 * optional so local development and self-hosted deployments (which do not have
 * an account-level rate-limit namespace) keep building and fall back to the
 * per-isolate limiter. Create them in the Cloudflare dashboard and pass:
 *
 *   MATTRAX_RATE_LIMIT_AUTH_NAMESPACE=<namespace id>
 *   MATTRAX_RATE_LIMIT_ENROLLMENT_NAMESPACE=<namespace id>
 *   MATTRAX_RATE_LIMIT_MDM_NAMESPACE=<namespace id>
 *   MATTRAX_RATE_LIMIT_SCIM_NAMESPACE=<namespace id>
 *   MATTRAX_RATE_LIMIT_BILLING_NAMESPACE=<namespace id>
 *   MATTRAX_RATE_LIMIT_SCEP_NAMESPACE=<namespace id>
 *
 * Each bucket can use its own namespace; reusing one namespace across buckets
 * is fine because the limiter key is prefixed with the bucket name.
 */
const rateLimitNamespace = (name: string) => process.env[`MATTRAX_RATE_LIMIT_${name}_NAMESPACE`];

const rateLimitBinding = (name: string, limit: number) => {
  const namespace = rateLimitNamespace(name);

  return namespace ? bindings.rateLimit({ namespace, simple: { limit, period: 60 } }) : undefined;
};

const configuredRateLimitBindings = () => {
  const candidates = {
    RATE_LIMITER_AUTH: rateLimitBinding("AUTH", 600),
    RATE_LIMITER_ENROLLMENT: rateLimitBinding("ENROLLMENT", 600),
    RATE_LIMITER_MDM: rateLimitBinding("MDM", 600),
    RATE_LIMITER_SCIM: rateLimitBinding("SCIM", 600),
    RATE_LIMITER_BILLING: rateLimitBinding("BILLING", 600),
    RATE_LIMITER_SCEP: rateLimitBinding("SCEP", 300),
  };

  return Object.fromEntries(Object.entries(candidates).filter((entry) => entry[1] !== undefined));
};

/**
 * Where the public website lives. The website Worker owns this hostname as a
 * Custom Domain; the API Worker takes the paths it owns as Workers routes.
 */
const publicOrigin = (() => {
  try {
    return new URL(process.env.ORIGIN ?? "https://e.mattrax.app");
  } catch {
    return new URL("https://e.mattrax.app");
  }
})();

/**
 * Browser, device and IdP traffic that should skip the website Worker.
 *
 * A Custom Domain and a Route can share a hostname: Workers picks the most
 * specific matching pattern, so these paths invoke the API Worker directly
 * while every other path still renders on the website Worker. The website
 * Worker keeps its `/api`, `/mdm` and `/scim` file routes for local
 * development, previews and self-hosting, and SSR keeps using the `API`
 * service binding.
 */
/**
 * The zone that owns the public host. A Custom Domain is a SaaS wildcard host,
 * so the routes API requires the zone explicitly; derive it from the hostname
 * (dropping the leftmost label) unless the deployment names it.
 */
const publicZone =
  process.env.MATTRAX_ZONE?.trim() ||
  (() => {
    const labels = publicOrigin.host.split(".");

    return labels.length > 2 ? labels.slice(1).join(".") : publicOrigin.host;
  })();

const publicApiRoutes =
  publicOrigin.protocol === "https:"
    ? ["/api/*", "/mdm/*", "/scim/*"].map((path) =>
        triggers.fetch({ pattern: `${publicOrigin.host}${path}`, zone: publicZone }),
      )
    : [];

/**
 * Shared with the web Worker's Vite config so that both Workers are built
 * together and can talk to each other over the service binding during dev.
 *
 * The API Worker owns only the request paths listed in `publicApiRoutes`; it
 * has no Custom Domain of its own and previews stay private (`previewUrls`).
 * Everything else reaches it over the website Worker's `API` service binding.
 */
export const apiWorker = {
  name: "mattrax-api",
  compatibilityDate: "2026-10-06",
  compatibilityFlags: ["nodejs_compat"],
  entrypoint: new URL("./src/index.ts", import.meta.url).pathname,
  workersDev: false,
  previewUrls: false,
  // Workers Logs + real-time Issues: uncaught exceptions, failed invocations,
  // 5xx responses and error-level logs are grouped into issues in the
  // dashboard without any SDK.
  observability: { enabled: true, issues: { enabled: true } },
  // The database is a DigitalOcean MySQL instance in New York. Smart Placement
  // does not see Hyperdrive's socket traffic, and a TCP `host` hint is not
  // picked up while the origin's firewall blocks placement probes, so the
  // isolate stayed in the request colo (Perth in the worst case) and every
  // query crossed the Pacific (~550ms for SELECT 1). Pin it to the nearest
  // Cloudflare region instead: Ashburn is ~5-10ms from the origin.
  placement: {
    mode: "targeted" as const,
    region: "aws:us-east-1",
  },
  // Daily maintenance: expired invitations, stale devices, expired auth
  // proofs/sessions and audit retention. Keep the off-peak UTC schedule.
  // The values are mirrored in `src/crons.ts`, which dispatches them.
  triggers: [
    triggers.scheduled({ schedule: "17 3 * * *" }),
    // Hourly sweep for due Entra directory syncs. Runs after the daily job's
    // maintenance/backups window and is a no-op when no tenant is due.
    triggers.scheduled({ schedule: "47 * * * *" }),
  ],
  env: {
    // The canonical origin is deployment configuration, not a secret: a
    // Preview supplies its generated host at build time, and a production
    // deploy supplies its public origin. A plain `pnpm web dev` (and the e2e
    // suite) gets the local server because the dev runtime ignores `.dev.vars`
    // for declared text bindings.
    ORIGIN: bindings.text(
      process.env.ORIGIN ??
        (process.env.DEV_HTTPS === "1" ? "https://localhost:9050" : "http://localhost:9050"),
    ),
    TRUSTED_ORIGINS: bindings.secret(),
    AUTH_SECRET: bindings.secret(),
    STRIPE_SECRET_KEY: bindings.secret(),
    STRIPE_WEBHOOK_SECRET: bindings.secret(),
    STRIPE_DEVICE_MONTHLY_PRICE_ID: bindings.secret(),
    /** Optional: enables self-hosted deployment licences on this deployment. */
    STRIPE_LICENSE_PRICE_ID: bindings.text(process.env.STRIPE_LICENSE_PRICE_ID ?? ""),
    /** Optional JSON plan catalogue; absent means unlimited plans. */
    MATTRAX_PLAN_LIMITS: bindings.secret(),
    /**
     * Comma-separated verified emails that always hold platform superadmin.
     * Not a secret: this is an operator allowlist, and an unset value simply
     * means no environment-granted superadmin exists yet.
     */
    MATTRAX_SUPERADMINS: bindings.text(process.env.MATTRAX_SUPERADMINS ?? ""),
    /**
     * Lifetime of the bearer SCEP challenge in an Apple enrollment profile.
     * One hour by default; deployments can raise it up to one day.
     */
    MATTRAX_ENROLLMENT_PROFILE_TTL_SECONDS: bindings.text("3600"),
    CLOUD_APPLE_VENDOR_CERT: bindings.secret(),
    CLOUD_APPLE_VENDOR_KEY: bindings.secret(),
    // Apple profile signing is optional (see `useAppleProfileSigning` below).
    APNS_RELAY_URL: bindings.secret(),
    APNS_RELAY_SECRET: bindings.secret(),
    AZURE_CLIENT_ID: bindings.secret(),
    AZURE_CLIENT_SECRET: bindings.secret(),
    /** Deployment-wide Google Workspace directory sync (optional). */
    GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON: bindings.secret(),
    GOOGLE_WORKSPACE_ADMIN_EMAIL: bindings.secret(),
    GOOGLE_WORKSPACE_CUSTOMER: bindings.secret(),
    /** Google Android Management API service account and Pub/Sub delivery. */
    ANDROID_MANAGEMENT_SERVICE_ACCOUNT_JSON: bindings.secret(),
    ANDROID_MANAGEMENT_PROJECT_ID: bindings.secret(),
    ANDROID_MANAGEMENT_PUBSUB_TOPIC: bindings.secret(),
    ANDROID_MANAGEMENT_PUBSUB_SUBSCRIPTION: bindings.secret(),
    ANDROID_MANAGEMENT_PUBSUB_AUDIENCE: bindings.secret(),
    ANDROID_MANAGEMENT_PUBSUB_JWKS_URI: bindings.secret(),
    /**
     * Local-only mailbox flag. Only declare the text bindings when a build
     * explicitly opts in: a deployed Worker may already carry secrets with
     * these names, and `cf` refuses to silently replace secrets with text.
     * `isDevMailboxEnabled` still requires a loopback origin, or an explicit
     * ALLOW_REMOTE opt-in with the shared secret.
     */
    ...(process.env.MATTRAX_PRODUCTION === "true"
      ? {}
      : {
          DEV_MAILBOX: bindings.text(process.env.DEV_MAILBOX ?? "true"),
        }),
    ...(process.env.DEV_MAILBOX_ALLOW_REMOTE
      ? { DEV_MAILBOX_ALLOW_REMOTE: bindings.text(process.env.DEV_MAILBOX_ALLOW_REMOTE) }
      : {}),
    DEV_MAILBOX_SECRET: bindings.secret(),
    /** Days without a check-in before the maintenance job marks a device unenrolled. */
    MAINTENANCE_STALE_DEVICE_DAYS: bindings.text("30"),
    /** Audit-log retention in days; `0` keeps audit entries indefinitely. */
    MAINTENANCE_AUDIT_RETENTION_DAYS: bindings.text("365"),
    /** Tenant backup retention in days; `0` keeps runs indefinitely. */
    MAINTENANCE_BACKUP_RETENTION_DAYS: bindings.text("30"),
    /** Tenants backed up concurrently by the daily job. */
    MAINTENANCE_BACKUP_CONCURRENCY: bindings.text("4"),
    /** Tenants synced concurrently by the scheduled Entra directory sync. */
    MAINTENANCE_ENTRA_SYNC_CONCURRENCY: bindings.text("2"),
    MAINTENANCE_GOOGLE_SYNC_CONCURRENCY: bindings.text("2"),
    /** Disable the scheduled one-week onboarding follow-up with `false`. */
    MAINTENANCE_ONBOARDING_EMAILS: bindings.text("true"),
    /** Days after tenant creation before the onboarding follow-up is eligible. */
    MAINTENANCE_ONBOARDING_FOLLOW_UP_DAYS: bindings.text("7"),
    /** Extra days after the threshold that remain eligible. */
    MAINTENANCE_ONBOARDING_WINDOW_DAYS: bindings.text("7"),
    /** Per-recipient cooldown across tenants; `0` disables it. */
    MAINTENANCE_ONBOARDING_COOLDOWN_DAYS: bindings.text("7"),
    /** ISO date floor so enabling the follow-up does not mail old tenants. */
    MATTRAX_ONBOARDING_SINCE: bindings.secret(),
    /** Reply-To for onboarding mail; defaults to `oscar@otbeaumont.me`. */
    MATTRAX_ONBOARDING_REPLY_TO: bindings.secret(),
    /** Support address in the onboarding footer; defaults to the sender. */
    MATTRAX_ONBOARDING_SUPPORT_EMAIL: bindings.secret(),
    /**
     * Set to `true` only on a deployment that intentionally has no outbound
     * email. Readiness then reports `mailer: skipped` (degraded) instead of
     * failing while the `EMAIL` binding is absent.
     */
    MATTRAX_EMAIL_DISABLED: bindings.text(process.env.MATTRAX_EMAIL_DISABLED ?? ""),
    /**
     * Outbound email without the Cloudflare `EMAIL` binding: `smtp` or
     * `disabled`. Empty leaves the hosted default (the `EMAIL` binding) in
     * place.
     */
    MAIL_TRANSPORT: bindings.text(process.env.MAIL_TRANSPORT ?? ""),
    /** Verified sender for every transactional email, e.g. `a@example.com`. */
    MAIL_FROM: bindings.text(""),
    /** Invitation-specific sender override; empty uses `MAIL_FROM`. */
    MATTRAX_INVITATION_FROM: bindings.text(""),
    /** Legacy Windows tenant pin and federated WSTEP app registration. */
    WINDOWS_ORGANIZATION_ID: bindings.text(""),
    WINDOWS_FEDERATED_AUDIENCE: bindings.text(""),
    /** Set to `1` only behind a proxy that terminates device mTLS. */
    TRUST_DEVICE_IDENTITY_HEADERS: bindings.text(process.env.TRUST_DEVICE_IDENTITY_HEADERS ?? ""),
    /** SMTP server used by self-hosted deployments. */
    MAIL_SMTP_HOST: bindings.text(""),
    MAIL_SMTP_PORT: bindings.text(""),
    MAIL_SMTP_SECURE: bindings.text(""),
    MAIL_SMTP_USER: bindings.text(""),
    MAIL_SMTP_HELO: bindings.text(""),
    /** Outbox deliveries in flight per maintenance run. */
    MAINTENANCE_EMAIL_OUTBOX_CONCURRENCY: bindings.text("4"),
    /** Attempts before queued mail is permanently failed. */
    MAINTENANCE_EMAIL_OUTBOX_MAX_ATTEMPTS: bindings.text("5"),
    /** PostHog project API key, ingestion host and error sampling. */
    POSTHOG_KEY: bindings.secret(),
    POSTHOG_HOST: bindings.text("https://us.i.posthog.com"),
    POSTHOG_ENVIRONMENT: bindings.secret(),
    POSTHOG_ERROR_SAMPLE_RATE: bindings.secret(),
    POSTHOG_ERROR_MAX_EVENTS_PER_MINUTE: bindings.secret(),
    /** Deployed version id used by `/api/ready`. */
    CF_VERSION_METADATA: bindings.versionMetadata(),
    // Shared edge limiters, only present when the deployment supplies a
    // namespace id. Without them the API keeps its per-isolate fallback.
    ...configuredRateLimitBindings(),
    HYPERDRIVE: bindings.hyperdrive({
      // Preview deployments bind the shared preview database through their own
      // Hyperdrive config; production keeps the hosted database by default.
      id: process.env.MATTRAX_HYPERDRIVE_ID ?? "239e6b5c776b47a2bcdd180e8798ce7a",
      // Local dev only. The Worker reads the individual host/port/user/password/
      // database fields; Hyperdrive's production binding supplies them.
      // `MATTRAX_DEV_DATABASE_URL` lets the API benchmark point local dev at the
      // latency proxy (see `scripts/db-latency-proxy.ts`) without editing code.
      dev: {
        connectionString:
          process.env.MATTRAX_DEV_DATABASE_URL ?? "mysql://mattrax:mattrax@127.0.0.1:3306/mattraxe",
      },
    }),
    STORAGE: bindings.r2({ name: process.env.MATTRAX_STORAGE_BUCKET ?? "mattrax" }),
    EMAIL: bindings.sendEmail({
      allowedSenderAddresses: ["hello@mattrax.cloud"],
      // Keep local test mail in the local explorer instead of the remote service.
      dev: { remote: false },
    }),
  },
};

export type ApiConfig = UnwrapConfig<typeof apiWorker>;

export type ApiEnv = InferEnv<ApiConfig>;

/**
 * Apple profile signing is optional: without an identity the tenant SCEP CA
 * signs profile downloads (or the plist is served unsigned). `cf deploy`
 * refuses to ship a declared secret that has no value, so the three bindings
 * are only part of the deployed Worker when the deploy supplies the identity.
 */
const useAppleProfileSigning = Boolean(process.env.APPLE_PROFILE_SIGNING_CERT);

/**
 * Provider credentials are only declared when the deploy supplies them, for the
 * same reason as the Apple identity above: `cf deploy` refuses a declared
 * secret with no value. A self-hosted container passes them as plain bindings
 * from its own environment instead (see `apps/docker`).
 */
const EMAIL_PROVIDER_SECRETS = ["MAIL_SMTP_PASSWORD"] as const;

const emailProviderSecrets: Record<string, ReturnType<typeof bindings.secret>> = {};

for (const name of EMAIL_PROVIDER_SECRETS)
  if (process.env[name]) emailProviderSecrets[name] = bindings.secret();

/** Values that only exist when the API Worker is built with a mail provider. */
const emailProviderEnv =
  Object.keys(emailProviderSecrets).length > 0
    ? { ...apiWorker.env, ...emailProviderSecrets }
    : apiWorker.env;

export default defineConfig(({ isPreview }) => {
  const worker = {
    ...apiWorker,
    // Previews are reachable on their generated host so the web Preview can
    // proxy to them over HTTP (service bindings always resolve to the bound
    // Worker's production deployment). Cron triggers are production-only.
    previewUrls: isPreview,
    // Previews are reached over the website Preview's proxy, so public routes
    // would point at a production hostname that is not part of the preview.
    triggers: isPreview ? [] : [...apiWorker.triggers, ...publicApiRoutes],
  };

  if (!useAppleProfileSigning) return { worker: { ...worker, env: emailProviderEnv } };

  return {
    worker: {
      ...worker,
      env: {
        ...emailProviderEnv,
        APPLE_PROFILE_SIGNING_CERT: bindings.secret(),
        APPLE_PROFILE_SIGNING_KEY: bindings.secret(),
        APPLE_PROFILE_SIGNING_CHAIN: bindings.secret(),
      },
    },
  };
});
