import { createEnv } from "@t3-oss/env-core";
import * as v from "valibot";
import { env as cfEnv } from "cloudflare:workers"

// For now this is only used for runtime validation, so transformations aren't safe.
export const env = createEnv({
  server: {
    ORIGIN: v.pipe(v.string(), v.url()),
    AUTH_SECRET: v.pipe(v.string(), v.minLength(1)),
    STRIPE_SECRET_KEY: v.pipe(v.string(), v.minLength(1)),
    STRIPE_WEBHOOK_SECRET: v.pipe(v.string(), v.minLength(1)),
    STRIPE_DEVICE_MONTHLY_PRICE_ID: v.pipe(v.string(), v.minLength(1)),
    CLOUD_APPLE_VENDOR_CERT: v.optional(v.string()),
    CLOUD_APPLE_VENDOR_KEY: v.optional(v.string()),
  },
  runtimeEnvStrict: {
    ORIGIN: cfEnv.ORIGIN,
    AUTH_SECRET: cfEnv.AUTH_SECRET,
    STRIPE_SECRET_KEY: (cfEnv as any).STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: (cfEnv as any).STRIPE_WEBHOOK_SECRET,
    STRIPE_DEVICE_MONTHLY_PRICE_ID: (cfEnv as any).STRIPE_DEVICE_MONTHLY_PRICE_ID,
    CLOUD_APPLE_VENDOR_CERT: cfEnv.CLOUD_APPLE_VENDOR_CERT,
    CLOUD_APPLE_VENDOR_KEY: cfEnv.CLOUD_APPLE_VENDOR_KEY,
  },
  emptyStringAsUndefined: true,
});
