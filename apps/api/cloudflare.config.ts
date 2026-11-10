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
 */
const rateLimitAuthNamespace = process.env.MATTRAX_RATE_LIMIT_AUTH_NAMESPACE;
const rateLimitEnrollmentNamespace = process.env.MATTRAX_RATE_LIMIT_ENROLLMENT_NAMESPACE;

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
  triggers: [triggers.scheduled({ schedule: "17 3 * * *" })],
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
    CLOUD_APPLE_VENDOR_CERT: bindings.secret(),
    CLOUD_APPLE_VENDOR_KEY: bindings.secret(),
    APNS_RELAY_URL: bindings.secret(),
    APNS_RELAY_SECRET: bindings.secret(),
    AZURE_CLIENT_ID: bindings.secret(),
    AZURE_CLIENT_SECRET: bindings.secret(),
    /** Local-only mailbox flag. Never set in production. */
    DEV_MAILBOX: bindings.secret(),
    DEV_MAILBOX_ALLOW_REMOTE: bindings.secret(),
    DEV_MAILBOX_SECRET: bindings.secret(),
    /** Days without a check-in before the maintenance job marks a device unenrolled. */
    MAINTENANCE_STALE_DEVICE_DAYS: bindings.text("30"),
    /** Audit-log retention in days; `0` keeps audit entries indefinitely. */
    MAINTENANCE_AUDIT_RETENTION_DAYS: bindings.text("365"),
    /** Deployed version id used by `/api/ready`. */
    CF_VERSION_METADATA: bindings.versionMetadata(),
    // Shared edge limiters, only present when the deployment supplies a
    // namespace id. Without them the API keeps its per-isolate fallback.
    ...(rateLimitAuthNamespace
      ? {
          RATE_LIMITER_AUTH: bindings.rateLimit({
            namespace: rateLimitAuthNamespace,
            simple: { limit: 120, period: 60 },
          }),
        }
      : {}),
    ...(rateLimitEnrollmentNamespace
      ? {
          RATE_LIMITER_ENROLLMENT: bindings.rateLimit({
            namespace: rateLimitEnrollmentNamespace,
            simple: { limit: 600, period: 60 },
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
