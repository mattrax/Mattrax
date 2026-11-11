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

/**
 * Shared with the web Worker's Vite config so that both Workers are built
 * together and can talk to each other over the service binding during dev.
 */
export const apiWorker = {
  name: "mattrax-api",
  compatibilityDate: "2026-10-06",
  compatibilityFlags: ["nodejs_compat"],
  entrypoint: new URL("./src/index.ts", import.meta.url).pathname,
  workersDev: false,
  previewUrls: false,
  observability: { enabled: true },
  placement: { mode: "smart" as const },
  // Daily maintenance: expired invitations, stale devices, expired auth
  // proofs/sessions and audit retention. Keep the off-peak UTC schedule.
  triggers: [
    triggers.scheduled({ schedule: "17 3 * * *" }),
    // Hourly sweep for due Entra directory syncs. Runs after the daily job's
    // maintenance/backups window and is a no-op when no tenant is due.
    triggers.scheduled({ schedule: "47 * * * *" }),
  ],
  env: {
    // `ORIGIN` is a secret so local dev and whitelabel deployments can set
    // their own canonical origin. Production sets the hosted Mattrax domain.
    ORIGIN: bindings.secret(),
    TRUSTED_ORIGINS: bindings.secret(),
    AUTH_RESET_URL: bindings.secret(),
    AUTH_SECRET: bindings.secret(),
    STRIPE_SECRET_KEY: bindings.secret(),
    STRIPE_WEBHOOK_SECRET: bindings.secret(),
    STRIPE_DEVICE_MONTHLY_PRICE_ID: bindings.secret(),
    /** Optional JSON plan catalogue; absent means unlimited plans. */
    MATTRAX_PLAN_LIMITS: bindings.secret(),
    CLOUD_APPLE_VENDOR_CERT: bindings.secret(),
    CLOUD_APPLE_VENDOR_KEY: bindings.secret(),
    APNS_RELAY_URL: bindings.secret(),
    APNS_RELAY_SECRET: bindings.secret(),
    AZURE_CLIENT_ID: bindings.secret(),
    AZURE_CLIENT_SECRET: bindings.secret(),
    /** Google Android Management API service account and Pub/Sub delivery. */
    ANDROID_MANAGEMENT_SERVICE_ACCOUNT_JSON: bindings.secret(),
    ANDROID_MANAGEMENT_PROJECT_ID: bindings.secret(),
    ANDROID_MANAGEMENT_PUBSUB_TOPIC: bindings.secret(),
    ANDROID_MANAGEMENT_PUBSUB_SUBSCRIPTION: bindings.secret(),
    ANDROID_MANAGEMENT_PUBSUB_AUDIENCE: bindings.secret(),
    ANDROID_MANAGEMENT_PUBSUB_JWKS_URI: bindings.secret(),
    /** Local-only mailbox flag. Never set in production. */
    DEV_MAILBOX: bindings.secret(),
    DEV_MAILBOX_ALLOW_REMOTE: bindings.secret(),
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
    /** Optional Sentry-compatible error tracking. */
    SENTRY_DSN: bindings.secret(),
    SENTRY_ENVIRONMENT: bindings.secret(),
    SENTRY_SAMPLE_RATE: bindings.secret(),
    SENTRY_MAX_EVENTS_PER_MINUTE: bindings.secret(),
    /** Deployed version id used by `/api/ready`. */
    CF_VERSION_METADATA: bindings.versionMetadata(),
    // Shared edge limiters, only present when the deployment supplies a
    // namespace id. Without them the API keeps its per-isolate fallback.
    ...(rateLimitNamespace("AUTH")
      ? {
          RATE_LIMITER_AUTH: bindings.rateLimit({
            namespace: rateLimitNamespace("AUTH")!,
            simple: { limit: 120, period: 60 },
          }),
        }
      : {}),
    ...(rateLimitNamespace("ENROLLMENT")
      ? {
          RATE_LIMITER_ENROLLMENT: bindings.rateLimit({
            namespace: rateLimitNamespace("ENROLLMENT")!,
            simple: { limit: 600, period: 60 },
          }),
        }
      : {}),
    ...(rateLimitNamespace("MDM")
      ? {
          RATE_LIMITER_MDM: bindings.rateLimit({
            namespace: rateLimitNamespace("MDM")!,
            simple: { limit: 600, period: 60 },
          }),
        }
      : {}),
    ...(rateLimitNamespace("SCIM")
      ? {
          RATE_LIMITER_SCIM: bindings.rateLimit({
            namespace: rateLimitNamespace("SCIM")!,
            simple: { limit: 600, period: 60 },
          }),
        }
      : {}),
    ...(rateLimitNamespace("BILLING")
      ? {
          RATE_LIMITER_BILLING: bindings.rateLimit({
            namespace: rateLimitNamespace("BILLING")!,
            simple: { limit: 600, period: 60 },
          }),
        }
      : {}),
    ...(rateLimitNamespace("SCEP")
      ? {
          RATE_LIMITER_SCEP: bindings.rateLimit({
            namespace: rateLimitNamespace("SCEP")!,
            simple: { limit: 300, period: 60 },
          }),
        }
      : {}),
    HYPERDRIVE: bindings.hyperdrive({
      id: "239e6b5c776b47a2bcdd180e8798ce7a",
      // Local dev only. The Worker reads the individual host/port/user/password/
      // database fields; Hyperdrive's production binding supplies them.
      dev: { connectionString: "mysql://mattrax:mattrax@127.0.0.1:3306/mattraxe" },
    }),
    STORAGE: bindings.r2({ name: "mattrax" }),
    EMAIL: bindings.sendEmail({
      allowedSenderAddresses: ["hello@mattrax.cloud"],
      // Keep local test mail in the local explorer instead of the remote service.
      dev: { remote: false },
    }),
  },
};

export type ApiConfig = UnwrapConfig<typeof apiWorker>;
export type ApiEnv = InferEnv<ApiConfig>;

export default defineConfig({ worker: apiWorker });
