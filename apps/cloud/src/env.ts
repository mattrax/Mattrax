import { env as cfEnv } from "cloudflare:workers";
import type { RateLimitBindingLike } from "@mattrax/cloud-services";
import { resolveApiEnv } from "./envSchema.js";

declare global {
  interface Env {
    readonly RATE_LIMITER_AUTH?: RateLimitBindingLike;
    readonly RATE_LIMITER_ENROLLMENT?: RateLimitBindingLike;
    readonly RATE_LIMITER_MDM?: RateLimitBindingLike;
    readonly RATE_LIMITER_SCIM?: RateLimitBindingLike;
    readonly RATE_LIMITER_BILLING?: RateLimitBindingLike;
    readonly RATE_LIMITER_SCEP?: RateLimitBindingLike;
    readonly RATE_LIMITER_POLICY?: RateLimitBindingLike;
  }
}

export const env = resolveApiEnv(cfEnv);
