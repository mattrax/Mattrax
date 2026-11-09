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
  /**
   * Extra browser origins allowed to call the auth API, comma separated. The
   * canonical `ORIGIN` is always trusted; this is for local development and
   * split-origin whitelabel deployments.
   */
  TRUSTED_ORIGINS: Schema.optional(Schema.String),
  /** HTTPS landing URL for password-reset emails; defaults to `ORIGIN`. */
  AUTH_RESET_URL: Schema.optional(Schema.String),
  /**
   * Organization that owns Windows devices. Windows discovery/enrollment has no
   * tenant identity, so when unset the backend uses the earliest organization.
   */
  WINDOWS_ORGANIZATION_ID: Schema.optional(nonEmptyString),
});

const emptyStringAsUndefined = (value: unknown) => (value === "" ? undefined : value);

// For now this is only used for runtime validation, so transformations aren't safe.
export const env = Schema.decodeUnknownSync(ApiEnvSchema)({
  ORIGIN: emptyStringAsUndefined(cfEnv.ORIGIN),
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
  TRUSTED_ORIGINS: emptyStringAsUndefined((cfEnv as any).TRUSTED_ORIGINS),
  AUTH_RESET_URL: emptyStringAsUndefined((cfEnv as any).AUTH_RESET_URL),
  WINDOWS_ORGANIZATION_ID: emptyStringAsUndefined((cfEnv as any).WINDOWS_ORGANIZATION_ID),
});
