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
  STRIPE_SECRET_KEY: nonEmptyString,
  STRIPE_WEBHOOK_SECRET: nonEmptyString,
  STRIPE_DEVICE_MONTHLY_PRICE_ID: nonEmptyString,
  CLOUD_APPLE_VENDOR_CERT: Schema.optional(Schema.String),
  CLOUD_APPLE_VENDOR_KEY: Schema.optional(Schema.String),
  /** Hosted Cloud push relay. When set, APNs pushes go through the relay. */
  APNS_RELAY_URL: Schema.optional(urlString),
  APNS_RELAY_SECRET: Schema.optional(nonEmptyString),
  /** Microsoft Entra ID app used for tenant SSO. */
  AZURE_CLIENT_ID: Schema.optional(nonEmptyString),
  AZURE_CLIENT_SECRET: Schema.optional(nonEmptyString),
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
  /** Explicit opt-in for exposing the debug mailbox on a non-loopback origin. */
  DEV_MAILBOX_ALLOW_REMOTE: Schema.optional(nonEmptyString),
  /** Optional shared secret required in `x-dev-mailbox-secret`. */
  DEV_MAILBOX_SECRET: Schema.optional(nonEmptyString),
  /**
   * Organization that owns Windows devices. Windows discovery/enrollment has no
   * tenant identity, so Cloud requires this pin; when unset `/mdm/windows/*`
   * returns a configuration error rather than guessing a tenant.
   */
  WINDOWS_ORGANIZATION_ID: Schema.optional(nonEmptyString),
  /** Scheduled maintenance: days without a check-in before a device is marked unenrolled. */
  MAINTENANCE_STALE_DEVICE_DAYS: Schema.optional(nonEmptyString),
  /** Scheduled maintenance: audit-log retention in days; `0` disables purging. */
  MAINTENANCE_AUDIT_RETENTION_DAYS: Schema.optional(nonEmptyString),
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
  CLOUD_APPLE_VENDOR_CERT: emptyStringAsUndefined(cfEnv.CLOUD_APPLE_VENDOR_CERT),
  CLOUD_APPLE_VENDOR_KEY: emptyStringAsUndefined(cfEnv.CLOUD_APPLE_VENDOR_KEY),
  APNS_RELAY_URL: emptyStringAsUndefined((cfEnv as any).APNS_RELAY_URL),
  APNS_RELAY_SECRET: emptyStringAsUndefined((cfEnv as any).APNS_RELAY_SECRET),
  AZURE_CLIENT_ID: emptyStringAsUndefined((cfEnv as any).AZURE_CLIENT_ID),
  AZURE_CLIENT_SECRET: emptyStringAsUndefined((cfEnv as any).AZURE_CLIENT_SECRET),
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
});
