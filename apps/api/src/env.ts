import { Schema } from "effect";
import { env as cfEnv } from "cloudflare:workers";

const nonEmptyString = Schema.String.check(Schema.isMinLength(1));
const urlString = Schema.String.check(
  Schema.makeFilter<string>((value) => {
    try {
      new URL(value);
      return true;
    } catch {
      return "a valid URL";
    }
  }),
);

const ApiEnvSchema = Schema.Struct({
  ORIGIN: urlString,
  AUTH_SECRET: nonEmptyString,
  STRIPE_SECRET_KEY: Schema.optional(nonEmptyString),
  STRIPE_WEBHOOK_SECRET: Schema.optional(nonEmptyString),
  STRIPE_DEVICE_MONTHLY_PRICE_ID: Schema.optional(nonEmptyString),
  /**
   * Optional JSON plan catalogue mapping plan names to device/tenant limits.
   * Missing or `null` limits are unlimited. Parsed defensively at startup.
   */
  MATTRAX_PLAN_LIMITS: Schema.optional(Schema.String),
  CLOUD_APPLE_VENDOR_CERT: Schema.optional(Schema.String),
  CLOUD_APPLE_VENDOR_KEY: Schema.optional(Schema.String),
  /** Hosted Cloud push relay. When set, APNs pushes go through the relay. */
  APNS_RELAY_URL: Schema.optional(urlString),
  APNS_RELAY_SECRET: Schema.optional(nonEmptyString),
  /** Microsoft Entra ID app used for tenant SSO. */
  AZURE_CLIENT_ID: Schema.optional(nonEmptyString),
  AZURE_CLIENT_SECRET: Schema.optional(nonEmptyString),
  /**
   * Google service-account JSON (the full key file, as a single string) used
   * for Android Management API delivery. The private key is never persisted.
   */
  ANDROID_MANAGEMENT_SERVICE_ACCOUNT_JSON: Schema.optional(Schema.String),
  /** Google Cloud project; defaults to the service account's `project_id`. */
  ANDROID_MANAGEMENT_PROJECT_ID: Schema.optional(nonEmptyString),
  /** `projects/{project}/topics/{topic}` configured on the enterprise. */
  ANDROID_MANAGEMENT_PUBSUB_TOPIC: Schema.optional(nonEmptyString),
  /** `projects/{project}/subscriptions/{subscription}` receiving pushes. */
  ANDROID_MANAGEMENT_PUBSUB_SUBSCRIPTION: Schema.optional(nonEmptyString),
  /** OIDC audience on the Pub/Sub push subscription; defaults to the callback URL. */
  ANDROID_MANAGEMENT_PUBSUB_AUDIENCE: Schema.optional(nonEmptyString),
  /** Optional JWKS override for non-Google test deployments. */
  ANDROID_MANAGEMENT_PUBSUB_JWKS_URI: Schema.optional(nonEmptyString),
  /**
   * Extra browser origins allowed to call the auth API, comma separated. The
   * canonical `ORIGIN` is always trusted; this is for local development and
   * split-origin whitelabel deployments.
   */
  TRUSTED_ORIGINS: Schema.optional(Schema.String),
  /** HTTPS landing URL for password-reset emails; defaults to `ORIGIN`. */
  AUTH_RESET_URL: Schema.optional(Schema.String),
  /**
   * Local-only debug mailbox. The mailbox is only exposed when the canonical
   * `ORIGIN` is loopback, or when `DEV_MAILBOX_ALLOW_REMOTE=true` is also set.
   */
  DEV_MAILBOX: Schema.optional(nonEmptyString),
  /**
   * Explicit opt-in for exposing the debug mailbox on a non-loopback origin.
   * Only honoured together with a non-empty `DEV_MAILBOX_SECRET`.
   */
  DEV_MAILBOX_ALLOW_REMOTE: Schema.optional(nonEmptyString),
  /** Optional shared secret required in `x-dev-mailbox-secret`. */
  DEV_MAILBOX_SECRET: Schema.optional(nonEmptyString),
  /**
   * Legacy fallback tenant for Windows devices. Tenant-scoped enrollment URLs
   * carry a signed token, so this is no longer required. Set it only for a
   * single-tenant deployment that must keep accepting the old un-scoped
   * `/mdm/windows/*` discovery URL.
   */
  WINDOWS_ORGANIZATION_ID: Schema.optional(nonEmptyString),
  /** Scheduled maintenance: days without a check-in before a device is marked unenrolled. */
  MAINTENANCE_STALE_DEVICE_DAYS: Schema.optional(nonEmptyString),
  /** Scheduled maintenance: audit-log retention in days; `0` disables purging. */
  MAINTENANCE_AUDIT_RETENTION_DAYS: Schema.optional(nonEmptyString),
  /** Scheduled tenant backups: days to keep non-pinned runs; `0` keeps forever. */
  MAINTENANCE_BACKUP_RETENTION_DAYS: Schema.optional(nonEmptyString),
  /** Scheduled tenant backups: tenants backed up concurrently (default 4). */
  MAINTENANCE_BACKUP_CONCURRENCY: Schema.optional(nonEmptyString),
  /** Scheduled Entra directory sync: tenants synced concurrently (default 2). */
  MAINTENANCE_ENTRA_SYNC_CONCURRENCY: Schema.optional(nonEmptyString),
  /**
   * Optional Sentry-compatible DSN for uncaught/5xx error events. Without it
   * error tracking is disabled and only the structured request log is written.
   */
  SENTRY_DSN: Schema.optional(nonEmptyString),
  /** Sentry environment tag, e.g. `production` or `staging`. */
  SENTRY_ENVIRONMENT: Schema.optional(nonEmptyString),
  /** Fraction of eligible errors to report, 0..1. Defaults to 1. */
  SENTRY_SAMPLE_RATE: Schema.optional(nonEmptyString),
  /** Maximum Sentry events per isolate per minute. Defaults to 20. */
  SENTRY_MAX_EVENTS_PER_MINUTE: Schema.optional(nonEmptyString),
});

const emptyStringAsUndefined = (value: unknown) => (value === "" ? undefined : value);

// For now this is only used for runtime validation, so transformations aren't safe.
export const env = Schema.decodeUnknownSync(ApiEnvSchema)({
  // Keep the hosted default so existing deployments that have not set the
  // newly-configurable secret keep working. Local dev overrides it via
  // `.dev.vars`; whitelabel deployments set their own origin.
  ORIGIN: emptyStringAsUndefined(cfEnv.ORIGIN) ?? "https://e.mattrax.app",
  AUTH_SECRET: emptyStringAsUndefined(cfEnv.AUTH_SECRET),
  STRIPE_SECRET_KEY: emptyStringAsUndefined((cfEnv as any).STRIPE_SECRET_KEY),
  STRIPE_WEBHOOK_SECRET: emptyStringAsUndefined((cfEnv as any).STRIPE_WEBHOOK_SECRET),
  STRIPE_DEVICE_MONTHLY_PRICE_ID: emptyStringAsUndefined(
    (cfEnv as any).STRIPE_DEVICE_MONTHLY_PRICE_ID,
  ),
  MATTRAX_PLAN_LIMITS: emptyStringAsUndefined((cfEnv as any).MATTRAX_PLAN_LIMITS),
  CLOUD_APPLE_VENDOR_CERT: emptyStringAsUndefined(cfEnv.CLOUD_APPLE_VENDOR_CERT),
  CLOUD_APPLE_VENDOR_KEY: emptyStringAsUndefined(cfEnv.CLOUD_APPLE_VENDOR_KEY),
  APNS_RELAY_URL: emptyStringAsUndefined((cfEnv as any).APNS_RELAY_URL),
  APNS_RELAY_SECRET: emptyStringAsUndefined((cfEnv as any).APNS_RELAY_SECRET),
  AZURE_CLIENT_ID: emptyStringAsUndefined((cfEnv as any).AZURE_CLIENT_ID),
  AZURE_CLIENT_SECRET: emptyStringAsUndefined((cfEnv as any).AZURE_CLIENT_SECRET),
  ANDROID_MANAGEMENT_SERVICE_ACCOUNT_JSON: emptyStringAsUndefined(
    (cfEnv as any).ANDROID_MANAGEMENT_SERVICE_ACCOUNT_JSON,
  ),
  ANDROID_MANAGEMENT_PROJECT_ID: emptyStringAsUndefined(
    (cfEnv as any).ANDROID_MANAGEMENT_PROJECT_ID,
  ),
  ANDROID_MANAGEMENT_PUBSUB_TOPIC: emptyStringAsUndefined(
    (cfEnv as any).ANDROID_MANAGEMENT_PUBSUB_TOPIC,
  ),
  ANDROID_MANAGEMENT_PUBSUB_SUBSCRIPTION: emptyStringAsUndefined(
    (cfEnv as any).ANDROID_MANAGEMENT_PUBSUB_SUBSCRIPTION,
  ),
  ANDROID_MANAGEMENT_PUBSUB_AUDIENCE: emptyStringAsUndefined(
    (cfEnv as any).ANDROID_MANAGEMENT_PUBSUB_AUDIENCE,
  ),
  ANDROID_MANAGEMENT_PUBSUB_JWKS_URI: emptyStringAsUndefined(
    (cfEnv as any).ANDROID_MANAGEMENT_PUBSUB_JWKS_URI,
  ),
  TRUSTED_ORIGINS: emptyStringAsUndefined((cfEnv as any).TRUSTED_ORIGINS),
  AUTH_RESET_URL: emptyStringAsUndefined((cfEnv as any).AUTH_RESET_URL),
  DEV_MAILBOX: emptyStringAsUndefined((cfEnv as any).DEV_MAILBOX),
  DEV_MAILBOX_ALLOW_REMOTE: emptyStringAsUndefined((cfEnv as any).DEV_MAILBOX_ALLOW_REMOTE),
  DEV_MAILBOX_SECRET: emptyStringAsUndefined((cfEnv as any).DEV_MAILBOX_SECRET),
  WINDOWS_ORGANIZATION_ID: emptyStringAsUndefined((cfEnv as any).WINDOWS_ORGANIZATION_ID),
  MAINTENANCE_STALE_DEVICE_DAYS: emptyStringAsUndefined(
    (cfEnv as any).MAINTENANCE_STALE_DEVICE_DAYS,
  ),
  MAINTENANCE_AUDIT_RETENTION_DAYS: emptyStringAsUndefined(
    (cfEnv as any).MAINTENANCE_AUDIT_RETENTION_DAYS,
  ),
  MAINTENANCE_BACKUP_RETENTION_DAYS: emptyStringAsUndefined(
    (cfEnv as any).MAINTENANCE_BACKUP_RETENTION_DAYS,
  ),
  MAINTENANCE_BACKUP_CONCURRENCY: emptyStringAsUndefined(
    (cfEnv as any).MAINTENANCE_BACKUP_CONCURRENCY,
  ),
  MAINTENANCE_ENTRA_SYNC_CONCURRENCY: emptyStringAsUndefined(
    (cfEnv as any).MAINTENANCE_ENTRA_SYNC_CONCURRENCY,
  ),
  SENTRY_DSN: emptyStringAsUndefined((cfEnv as any).SENTRY_DSN),
  SENTRY_ENVIRONMENT: emptyStringAsUndefined((cfEnv as any).SENTRY_ENVIRONMENT),
  SENTRY_SAMPLE_RATE: emptyStringAsUndefined((cfEnv as any).SENTRY_SAMPLE_RATE),
  SENTRY_MAX_EVENTS_PER_MINUTE: emptyStringAsUndefined((cfEnv as any).SENTRY_MAX_EVENTS_PER_MINUTE),
});
