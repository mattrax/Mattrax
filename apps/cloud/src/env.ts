import { Schema } from "effect";
import { env as cfEnv } from "cloudflare:workers";
import type { RateLimitBindingLike } from "@mattrax/cloud-services";

declare global {
  interface Env {
    readonly RATE_LIMITER_AUTH?: RateLimitBindingLike;
    readonly RATE_LIMITER_ENROLLMENT?: RateLimitBindingLike;
    readonly RATE_LIMITER_MDM?: RateLimitBindingLike;
    readonly RATE_LIMITER_SCIM?: RateLimitBindingLike;
    readonly RATE_LIMITER_BILLING?: RateLimitBindingLike;
    readonly RATE_LIMITER_SCEP?: RateLimitBindingLike;
  }
}

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
  // Signs sessions, SSR tokens, step-up grants, SSO assertions and email
  // tokens; a short operator-chosen value makes every artifact forgeable.
  AUTH_SECRET: Schema.String.check(Schema.isMinLength(32)),
  STRIPE_SECRET_KEY: Schema.optional(nonEmptyString),
  STRIPE_WEBHOOK_SECRET: Schema.optional(nonEmptyString),
  STRIPE_DEVICE_MONTHLY_PRICE_ID: Schema.optional(nonEmptyString),
  /** Per-device price for a self-hosted deployment's platform licence. */
  STRIPE_LICENSE_PRICE_ID: Schema.optional(nonEmptyString),
  /**
   * Optional JSON plan catalogue mapping plan names to device/tenant limits.
   * Missing or `null` limits are unlimited. Parsed defensively at startup.
   */
  MATTRAX_PLAN_LIMITS: Schema.optional(Schema.String),
  CLOUD_APPLE_VENDOR_CERT: Schema.optional(Schema.String),
  CLOUD_APPLE_VENDOR_KEY: Schema.optional(Schema.String),
  /**
   * Deployment identity used to CMS-sign Apple enrollment profiles. The key is
   * an unencrypted PKCS#8 PEM; the optional chain is a PEM bundle.
   */
  APPLE_PROFILE_SIGNING_CERT: Schema.optional(Schema.String),
  APPLE_PROFILE_SIGNING_KEY: Schema.optional(Schema.String),
  APPLE_PROFILE_SIGNING_CHAIN: Schema.optional(Schema.String),
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
  /** Verified sender for invitation email; defaults to `hello@mattrax.cloud`. */
  MATTRAX_INVITATION_FROM: Schema.optional(nonEmptyString),
  /**
   * Lifetime in seconds of the bearer SCEP challenge embedded in an Apple
   * enrollment profile. Defaults to one hour; bounded to 60..86400.
   */
  MATTRAX_ENROLLMENT_PROFILE_TTL_SECONDS: Schema.optional(Schema.String),
  /**
   * Reply-To for the one-time onboarding emails. Defaults to
   * `oscar@otbeaumont.me`; set it to a monitored mailbox, never `no-reply@`.
   */
  MATTRAX_ONBOARDING_REPLY_TO: Schema.optional(nonEmptyString),
  /** Support address in the onboarding email footer. Defaults to the sender. */
  MATTRAX_ONBOARDING_SUPPORT_EMAIL: Schema.optional(nonEmptyString),
  /**
   * ISO date (for example `2026-11-14`). Tenants created before this date are
   * never sent the follow-up, so enabling it does not mail existing customers.
   */
  MATTRAX_ONBOARDING_SINCE: Schema.optional(nonEmptyString),
  /**
   * Outbound-email transport for deployments without the Cloudflare
   * `send_email` binding: `smtp`, `cloudflare` or `disabled`.
   */
  MAIL_TRANSPORT: Schema.optional(nonEmptyString),
  /** Verified sender, e.g. `Mattrax <notifications@example.com>`. */
  MAIL_FROM: Schema.optional(nonEmptyString),
  /** SMTP server reached directly by the Worker or Node process. */
  MAIL_SMTP_HOST: Schema.optional(nonEmptyString),
  /** SMTP port; defaults to 587, or 465 with `MAIL_SMTP_SECURE`. */
  MAIL_SMTP_PORT: Schema.optional(nonEmptyString),
  /** `true` connects with implicit TLS instead of STARTTLS. */
  MAIL_SMTP_SECURE: Schema.optional(nonEmptyString),
  MAIL_SMTP_USER: Schema.optional(nonEmptyString),
  MAIL_SMTP_PASSWORD: Schema.optional(nonEmptyString),
  /** EHLO name; defaults to the hostname reported by the runtime. */
  MAIL_SMTP_HELO: Schema.optional(nonEmptyString),
  /** Outbox deliveries in flight per maintenance run. Defaults to 4. */
  MAINTENANCE_EMAIL_OUTBOX_CONCURRENCY: Schema.optional(Schema.String),
  /** Attempts before queued mail is permanently failed. Defaults to 5. */
  MAINTENANCE_EMAIL_OUTBOX_MAX_ATTEMPTS: Schema.optional(Schema.String),
  /** Disable the scheduled one-week follow-up with `false`, `0` or `off`. */
  MAINTENANCE_ONBOARDING_EMAILS: Schema.optional(nonEmptyString),
  /**
   * Explicitly declare that this deployment has no outbound email. Readiness
   * reports `mailer: skipped` (degraded) instead of failing, and the
   * self-hosted runner sets this when it removes the email binding.
   */
  MATTRAX_EMAIL_DISABLED: Schema.optional(nonEmptyString),
  /** Days after tenant creation before the follow-up is eligible. Defaults to 7. */
  MAINTENANCE_ONBOARDING_FOLLOW_UP_DAYS: Schema.optional(nonEmptyString),
  /** Extra eligible days after the follow-up threshold. Defaults to 7. */
  MAINTENANCE_ONBOARDING_WINDOW_DAYS: Schema.optional(nonEmptyString),
  /**
   * Suppress a recipient who already received a follow-up for another tenant
   * this many days ago. `0` disables the cooldown. Defaults to 7.
   */
  MAINTENANCE_ONBOARDING_COOLDOWN_DAYS: Schema.optional(nonEmptyString),
  /**
   * Legacy fallback tenant for Windows devices. Tenant-scoped enrollment URLs
   * carry a signed token, so this is no longer required. Set it only for a
   * single-tenant deployment that must keep accepting the old un-scoped
   * `/mdm/windows/*` discovery URL.
   */
  WINDOWS_ORGANIZATION_ID: Schema.optional(nonEmptyString),
  /**
   * Audience accepted on federated Entra WSTEP tokens. Defaults to
   * `AZURE_CLIENT_ID`; set it explicitly when the Windows enrollment app is a
   * different registration. Federated discovery stays disabled when neither is
   * set.
   */
  WINDOWS_FEDERATED_AUDIENCE: Schema.optional(nonEmptyString),
  /**
   * Trust `x-device-identity-certificate*` headers set by a TLS-terminating
   * reverse proxy. Only enable behind a proxy that verifies device client
   * certificates and strips caller-supplied values. Off on Cloudflare, where
   * the certificate comes from the mTLS handshake.
   */
  TRUST_DEVICE_IDENTITY_HEADERS: Schema.optional(nonEmptyString),
  /** Trust `x-forwarded-for`/`x-real-ip`; set only behind a stripping proxy. */
  TRUST_PROXY_HEADERS: Schema.optional(nonEmptyString),
  /**
   * How long repeated device check-ins fold into one `mdm.checkin` audit row,
   * in seconds. Defaults to 900 (15 minutes); `0` records every check-in.
   * State changes (enrollment, policy delivery, command results, failures) are
   * never coalesced.
   */
  MDM_AUDIT_CHECKIN_COALESCE_SECONDS: Schema.optional(nonEmptyString),
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
   * PostHog project API key. Without it product analytics and error tracking
   * are disabled and only the structured request log is written.
   */
  POSTHOG_KEY: Schema.optional(nonEmptyString),
  /** PostHog ingestion host. Defaults to `https://us.i.posthog.com`. */
  POSTHOG_HOST: Schema.optional(nonEmptyString),
  /** PostHog environment tag, e.g. `production` or `staging`. */
  POSTHOG_ENVIRONMENT: Schema.optional(nonEmptyString),
  /** Fraction of eligible errors to report, 0..1. Defaults to 1. */
  POSTHOG_ERROR_SAMPLE_RATE: Schema.optional(nonEmptyString),
  /** Maximum error events per isolate per minute. Defaults to 20. */
  POSTHOG_ERROR_MAX_EVENTS_PER_MINUTE: Schema.optional(nonEmptyString),
  /**
   * `off` disables span recording and metrics collection (the tracer becomes
   * Effect's no-op). Any other value, or leaving it unset, keeps telemetry on.
   */
  MATTRAX_TELEMETRY: Schema.optional(nonEmptyString),
  /**
   * `GET /api/metrics` exposure: `off` (default), `public` or `token`.
   * Metrics are aggregate-only, but the endpoint stays closed unless a
   * deployment opts in.
   */
  MATTRAX_METRICS: Schema.optional(nonEmptyString),
  /** Bearer token required when `MATTRAX_METRICS=token`. */
  MATTRAX_METRICS_TOKEN: Schema.optional(nonEmptyString),
});

const optionalString = Schema.optional(Schema.String);

const RawApiEnvSchema = Schema.Struct({
  ORIGIN: optionalString,
  AUTH_SECRET: optionalString,
  STRIPE_SECRET_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,
  STRIPE_DEVICE_MONTHLY_PRICE_ID: optionalString,
  STRIPE_LICENSE_PRICE_ID: optionalString,
  MATTRAX_PLAN_LIMITS: optionalString,
  CLOUD_APPLE_VENDOR_CERT: optionalString,
  CLOUD_APPLE_VENDOR_KEY: optionalString,
  APPLE_PROFILE_SIGNING_CERT: optionalString,
  APPLE_PROFILE_SIGNING_KEY: optionalString,
  APPLE_PROFILE_SIGNING_CHAIN: optionalString,
  APNS_RELAY_URL: optionalString,
  APNS_RELAY_SECRET: optionalString,
  AZURE_CLIENT_ID: optionalString,
  AZURE_CLIENT_SECRET: optionalString,
  ANDROID_MANAGEMENT_SERVICE_ACCOUNT_JSON: optionalString,
  ANDROID_MANAGEMENT_PROJECT_ID: optionalString,
  ANDROID_MANAGEMENT_PUBSUB_TOPIC: optionalString,
  ANDROID_MANAGEMENT_PUBSUB_SUBSCRIPTION: optionalString,
  ANDROID_MANAGEMENT_PUBSUB_AUDIENCE: optionalString,
  ANDROID_MANAGEMENT_PUBSUB_JWKS_URI: optionalString,
  TRUSTED_ORIGINS: optionalString,
  DEV_MAILBOX: optionalString,
  DEV_MAILBOX_ALLOW_REMOTE: optionalString,
  DEV_MAILBOX_SECRET: optionalString,
  MATTRAX_INVITATION_FROM: optionalString,
  MATTRAX_ENROLLMENT_PROFILE_TTL_SECONDS: optionalString,
  MATTRAX_ONBOARDING_REPLY_TO: optionalString,
  MATTRAX_ONBOARDING_SUPPORT_EMAIL: optionalString,
  MATTRAX_ONBOARDING_SINCE: optionalString,
  MAIL_TRANSPORT: optionalString,
  MAIL_FROM: optionalString,
  MAIL_SMTP_HOST: optionalString,
  MAIL_SMTP_PORT: optionalString,
  MAIL_SMTP_SECURE: optionalString,
  MAIL_SMTP_USER: optionalString,
  MAIL_SMTP_PASSWORD: optionalString,
  MAIL_SMTP_HELO: optionalString,
  MAINTENANCE_EMAIL_OUTBOX_CONCURRENCY: optionalString,
  MAINTENANCE_EMAIL_OUTBOX_MAX_ATTEMPTS: optionalString,
  MAINTENANCE_ONBOARDING_EMAILS: optionalString,
  MATTRAX_EMAIL_DISABLED: optionalString,
  MAINTENANCE_ONBOARDING_FOLLOW_UP_DAYS: optionalString,
  MAINTENANCE_ONBOARDING_WINDOW_DAYS: optionalString,
  MAINTENANCE_ONBOARDING_COOLDOWN_DAYS: optionalString,
  WINDOWS_ORGANIZATION_ID: optionalString,
  WINDOWS_FEDERATED_AUDIENCE: optionalString,
  TRUST_DEVICE_IDENTITY_HEADERS: optionalString,
  TRUST_PROXY_HEADERS: optionalString,
  MDM_AUDIT_CHECKIN_COALESCE_SECONDS: optionalString,
  MAINTENANCE_STALE_DEVICE_DAYS: optionalString,
  MAINTENANCE_AUDIT_RETENTION_DAYS: optionalString,
  MAINTENANCE_BACKUP_RETENTION_DAYS: optionalString,
  MAINTENANCE_BACKUP_CONCURRENCY: optionalString,
  MAINTENANCE_ENTRA_SYNC_CONCURRENCY: optionalString,
  POSTHOG_KEY: optionalString,
  POSTHOG_HOST: optionalString,
  POSTHOG_ENVIRONMENT: optionalString,
  POSTHOG_ERROR_SAMPLE_RATE: optionalString,
  POSTHOG_ERROR_MAX_EVENTS_PER_MINUTE: optionalString,
  MATTRAX_TELEMETRY: optionalString,
  MATTRAX_METRICS: optionalString,
  MATTRAX_METRICS_TOKEN: optionalString,
});

const rawEnv = Schema.decodeUnknownSync(RawApiEnvSchema)(cfEnv);

const emptyStringAsUndefined = (value: string | undefined) => (value === "" ? undefined : value);

// For now this is only used for runtime validation, so transformations aren't safe.
export const env = Schema.decodeUnknownSync(ApiEnvSchema)({
  // Keep the hosted default so existing deployments that have not set the
  // newly-configurable secret keep working. Local dev overrides it via
  // `.dev.vars`; whitelabel deployments set their own origin.
  ORIGIN: emptyStringAsUndefined(rawEnv.ORIGIN) ?? "https://e.mattrax.app",
  AUTH_SECRET: emptyStringAsUndefined(rawEnv.AUTH_SECRET),
  STRIPE_SECRET_KEY: emptyStringAsUndefined(rawEnv.STRIPE_SECRET_KEY),
  STRIPE_WEBHOOK_SECRET: emptyStringAsUndefined(rawEnv.STRIPE_WEBHOOK_SECRET),
  STRIPE_DEVICE_MONTHLY_PRICE_ID: emptyStringAsUndefined(rawEnv.STRIPE_DEVICE_MONTHLY_PRICE_ID),
  STRIPE_LICENSE_PRICE_ID: emptyStringAsUndefined(rawEnv.STRIPE_LICENSE_PRICE_ID),
  MATTRAX_PLAN_LIMITS: emptyStringAsUndefined(rawEnv.MATTRAX_PLAN_LIMITS),
  CLOUD_APPLE_VENDOR_CERT: emptyStringAsUndefined(rawEnv.CLOUD_APPLE_VENDOR_CERT),
  CLOUD_APPLE_VENDOR_KEY: emptyStringAsUndefined(rawEnv.CLOUD_APPLE_VENDOR_KEY),
  APPLE_PROFILE_SIGNING_CERT: emptyStringAsUndefined(rawEnv.APPLE_PROFILE_SIGNING_CERT),
  APPLE_PROFILE_SIGNING_KEY: emptyStringAsUndefined(rawEnv.APPLE_PROFILE_SIGNING_KEY),
  APPLE_PROFILE_SIGNING_CHAIN: emptyStringAsUndefined(rawEnv.APPLE_PROFILE_SIGNING_CHAIN),
  APNS_RELAY_URL: emptyStringAsUndefined(rawEnv.APNS_RELAY_URL),
  APNS_RELAY_SECRET: emptyStringAsUndefined(rawEnv.APNS_RELAY_SECRET),
  AZURE_CLIENT_ID: emptyStringAsUndefined(rawEnv.AZURE_CLIENT_ID),
  AZURE_CLIENT_SECRET: emptyStringAsUndefined(rawEnv.AZURE_CLIENT_SECRET),
  ANDROID_MANAGEMENT_SERVICE_ACCOUNT_JSON: emptyStringAsUndefined(
    rawEnv.ANDROID_MANAGEMENT_SERVICE_ACCOUNT_JSON,
  ),
  ANDROID_MANAGEMENT_PROJECT_ID: emptyStringAsUndefined(rawEnv.ANDROID_MANAGEMENT_PROJECT_ID),
  ANDROID_MANAGEMENT_PUBSUB_TOPIC: emptyStringAsUndefined(rawEnv.ANDROID_MANAGEMENT_PUBSUB_TOPIC),
  ANDROID_MANAGEMENT_PUBSUB_SUBSCRIPTION: emptyStringAsUndefined(
    rawEnv.ANDROID_MANAGEMENT_PUBSUB_SUBSCRIPTION,
  ),
  ANDROID_MANAGEMENT_PUBSUB_AUDIENCE: emptyStringAsUndefined(
    rawEnv.ANDROID_MANAGEMENT_PUBSUB_AUDIENCE,
  ),
  ANDROID_MANAGEMENT_PUBSUB_JWKS_URI: emptyStringAsUndefined(
    rawEnv.ANDROID_MANAGEMENT_PUBSUB_JWKS_URI,
  ),
  TRUSTED_ORIGINS: emptyStringAsUndefined(rawEnv.TRUSTED_ORIGINS),
  DEV_MAILBOX: emptyStringAsUndefined(rawEnv.DEV_MAILBOX),
  DEV_MAILBOX_ALLOW_REMOTE: emptyStringAsUndefined(rawEnv.DEV_MAILBOX_ALLOW_REMOTE),
  DEV_MAILBOX_SECRET: emptyStringAsUndefined(rawEnv.DEV_MAILBOX_SECRET),
  MATTRAX_INVITATION_FROM: emptyStringAsUndefined(rawEnv.MATTRAX_INVITATION_FROM),
  MATTRAX_ENROLLMENT_PROFILE_TTL_SECONDS: emptyStringAsUndefined(
    rawEnv.MATTRAX_ENROLLMENT_PROFILE_TTL_SECONDS,
  ),
  MATTRAX_ONBOARDING_REPLY_TO: emptyStringAsUndefined(rawEnv.MATTRAX_ONBOARDING_REPLY_TO),
  MATTRAX_ONBOARDING_SUPPORT_EMAIL: emptyStringAsUndefined(rawEnv.MATTRAX_ONBOARDING_SUPPORT_EMAIL),
  MATTRAX_ONBOARDING_SINCE: emptyStringAsUndefined(rawEnv.MATTRAX_ONBOARDING_SINCE),
  MAIL_TRANSPORT: emptyStringAsUndefined(rawEnv.MAIL_TRANSPORT),
  MAIL_FROM: emptyStringAsUndefined(rawEnv.MAIL_FROM),
  MAIL_SMTP_HOST: emptyStringAsUndefined(rawEnv.MAIL_SMTP_HOST),
  MAIL_SMTP_PORT: emptyStringAsUndefined(rawEnv.MAIL_SMTP_PORT),
  MAIL_SMTP_SECURE: emptyStringAsUndefined(rawEnv.MAIL_SMTP_SECURE),
  MAIL_SMTP_USER: emptyStringAsUndefined(rawEnv.MAIL_SMTP_USER),
  MAIL_SMTP_PASSWORD: emptyStringAsUndefined(rawEnv.MAIL_SMTP_PASSWORD),
  MAIL_SMTP_HELO: emptyStringAsUndefined(rawEnv.MAIL_SMTP_HELO),
  MAINTENANCE_EMAIL_OUTBOX_CONCURRENCY: emptyStringAsUndefined(
    rawEnv.MAINTENANCE_EMAIL_OUTBOX_CONCURRENCY,
  ),
  MAINTENANCE_EMAIL_OUTBOX_MAX_ATTEMPTS: emptyStringAsUndefined(
    rawEnv.MAINTENANCE_EMAIL_OUTBOX_MAX_ATTEMPTS,
  ),
  MAINTENANCE_ONBOARDING_EMAILS: emptyStringAsUndefined(rawEnv.MAINTENANCE_ONBOARDING_EMAILS),
  MATTRAX_EMAIL_DISABLED: emptyStringAsUndefined(rawEnv.MATTRAX_EMAIL_DISABLED),
  MAINTENANCE_ONBOARDING_FOLLOW_UP_DAYS: emptyStringAsUndefined(
    rawEnv.MAINTENANCE_ONBOARDING_FOLLOW_UP_DAYS,
  ),
  MAINTENANCE_ONBOARDING_WINDOW_DAYS: emptyStringAsUndefined(
    rawEnv.MAINTENANCE_ONBOARDING_WINDOW_DAYS,
  ),
  MAINTENANCE_ONBOARDING_COOLDOWN_DAYS: emptyStringAsUndefined(
    rawEnv.MAINTENANCE_ONBOARDING_COOLDOWN_DAYS,
  ),
  WINDOWS_ORGANIZATION_ID: emptyStringAsUndefined(rawEnv.WINDOWS_ORGANIZATION_ID),
  WINDOWS_FEDERATED_AUDIENCE: emptyStringAsUndefined(rawEnv.WINDOWS_FEDERATED_AUDIENCE),
  TRUST_DEVICE_IDENTITY_HEADERS: emptyStringAsUndefined(rawEnv.TRUST_DEVICE_IDENTITY_HEADERS),
  TRUST_PROXY_HEADERS: emptyStringAsUndefined(rawEnv.TRUST_PROXY_HEADERS),
  MDM_AUDIT_CHECKIN_COALESCE_SECONDS: emptyStringAsUndefined(
    rawEnv.MDM_AUDIT_CHECKIN_COALESCE_SECONDS,
  ),
  MAINTENANCE_STALE_DEVICE_DAYS: emptyStringAsUndefined(rawEnv.MAINTENANCE_STALE_DEVICE_DAYS),
  MAINTENANCE_AUDIT_RETENTION_DAYS: emptyStringAsUndefined(rawEnv.MAINTENANCE_AUDIT_RETENTION_DAYS),
  MAINTENANCE_BACKUP_RETENTION_DAYS: emptyStringAsUndefined(
    rawEnv.MAINTENANCE_BACKUP_RETENTION_DAYS,
  ),
  MAINTENANCE_BACKUP_CONCURRENCY: emptyStringAsUndefined(rawEnv.MAINTENANCE_BACKUP_CONCURRENCY),
  MAINTENANCE_ENTRA_SYNC_CONCURRENCY: emptyStringAsUndefined(
    rawEnv.MAINTENANCE_ENTRA_SYNC_CONCURRENCY,
  ),
  POSTHOG_KEY: emptyStringAsUndefined(rawEnv.POSTHOG_KEY),
  POSTHOG_HOST: emptyStringAsUndefined(rawEnv.POSTHOG_HOST),
  POSTHOG_ENVIRONMENT: emptyStringAsUndefined(rawEnv.POSTHOG_ENVIRONMENT),
  POSTHOG_ERROR_SAMPLE_RATE: emptyStringAsUndefined(rawEnv.POSTHOG_ERROR_SAMPLE_RATE),
  POSTHOG_ERROR_MAX_EVENTS_PER_MINUTE: emptyStringAsUndefined(
    rawEnv.POSTHOG_ERROR_MAX_EVENTS_PER_MINUTE,
  ),
  MATTRAX_TELEMETRY: emptyStringAsUndefined(rawEnv.MATTRAX_TELEMETRY),
  MATTRAX_METRICS: emptyStringAsUndefined(rawEnv.MATTRAX_METRICS),
  MATTRAX_METRICS_TOKEN: emptyStringAsUndefined(rawEnv.MATTRAX_METRICS_TOKEN),
});
