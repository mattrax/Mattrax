import { Effect, Layer, Option, Result, Schema } from "effect";
import { checkWith, RateLimiter } from "./rateLimit.js";
import type {
  ConsumeRateLimit,
  RateLimitBindings,
  RateLimitOutcome,
  RateLimitRule,
} from "./rateLimit.js";
import { localConsumer } from "./rateLimiterLocal.js";
import type { LocalRateLimiterOptions } from "./rateLimiterLocal.js";

/** The only shape a Cloudflare Rate Limiting binding may resolve to. */
const RateLimitBindingResult = Schema.Struct({ success: Schema.Boolean });

export type CloudflareRateLimiterOptions = LocalRateLimiterOptions & {
  /** Shared edge limiters, one per bucket, from the Worker's environment. */
  readonly bindings: RateLimitBindings;
  /** Sink for degradation warnings; defaults to `console.warn`. */
  readonly warn?: (message: string, cause?: unknown) => void;
};

const allowed = (rule: RateLimitRule): RateLimitOutcome => ({
  limited: false,
  bucket: rule.bucket,
  limit: rule.limit,
  retryAfterSeconds: 0,
});

const limited = (rule: RateLimitRule): RateLimitOutcome => ({
  limited: true,
  bucket: rule.bucket,
  limit: rule.limit,
  retryAfterSeconds: rule.windowSeconds,
});

/**
 * The shared limiter: Cloudflare's Rate Limiting binding, one namespace per
 * bucket.
 *
 * Counters are approximate and live **per Cloudflare location**, so this is an
 * abuse backstop rather than a global quota. A bucket without a configured
 * namespace falls back to the process-local counter so local development and
 * partially configured deployments still have a limiter.
 */
export const cloudflareConsumer = ({
  bindings,
  warn = (message, cause) => console.warn(message, cause),
  ...localOptions
}: CloudflareRateLimiterOptions): ConsumeRateLimit => {
  const fallback = localConsumer(localOptions);

  return (rule, key) =>
    Effect.gen(function* () {
      const binding = bindings[rule.bucket];

      // No namespace for this bucket: the deployment has no shared counter to
      // charge, so keep the bounded local one.
      if (binding === undefined) return yield* fallback(rule, key);

      const attempt = yield* Effect.tryPromise({
        try: () => binding.limit({ key }),
        catch: (cause) => cause,
      }).pipe(Effect.result);

      const decoded = Result.isSuccess(attempt)
        ? Option.getOrUndefined(Schema.decodeUnknownOption(RateLimitBindingResult)(attempt.success))
        : undefined;

      if (decoded !== undefined) return decoded.success ? allowed(rule) : limited(rule);

      const cause = Result.isFailure(attempt)
        ? attempt.failure
        : new Error("Rate limiter binding returned an invalid result");

      // A binding that resolves to an unexpected shape is treated exactly like
      // an unavailable binding rather than allowing the request.
      if (rule.failClosedWhenUnavailable) {
        warn(`Cloudflare rate limiter failed for bucket ${rule.bucket}; failing closed`, cause);

        return limited(rule);
      }

      // A limiter outage must not take down enrollment, MDM or billing. Keep
      // serving with the local counter and make the degradation visible.
      warn(`Cloudflare rate limiter failed for bucket ${rule.bucket}; using local fallback`, cause);

      return yield* fallback(rule, key);
    });
};

/**
 * The Cloud limiter: Cloudflare's official edge limiter with a local fallback
 * for buckets that have no namespace.
 */
export const RateLimiterCloudflare = (options: CloudflareRateLimiterOptions) =>
  Layer.succeed(RateLimiter, {
    check: checkWith(
      { trustForwarded: options.trustForwarded ?? false },
      cloudflareConsumer(options),
    ),
  });
