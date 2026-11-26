import { Effect, Layer } from "effect";
import { checkWith, RateLimiter } from "./rateLimit.js";
import type { ConsumeRateLimit, RateLimitOutcome } from "./rateLimit.js";

/** Counters for one window; the reset instant is an epoch millisecond. */
type Counter = { count: number; resetAt: number };

export type RateLimitStore = Map<string, Counter>;

export type LocalRateLimiterOptions = {
  /** Reuse a map across layers, so a test can inspect the counters. */
  readonly store?: RateLimitStore;
  readonly now?: () => number;
  /** Bundles above this size drop expired keys, then the oldest ones. */
  readonly maxEntries?: number;
  /** Trust a reverse proxy that appends the client address it saw. */
  readonly trustForwarded?: boolean;
};

const DEFAULT_MAX_ENTRIES = 10_000;

/**
 * A fixed-window counter held in this process.
 *
 * Correct for the self-hosted container, where one process serves every
 * request for the lifetime of the deployment. In a Worker, module state is
 * per isolate and isolates are short-lived, so this is only ever a fallback
 * there: the ceiling becomes `limit × live isolates`.
 */
export const localConsumer = ({
  store = new Map<string, Counter>(),
  now = Date.now,
  maxEntries = DEFAULT_MAX_ENTRIES,
}: LocalRateLimiterOptions = {}): ConsumeRateLimit => {
  const prune = () => {
    if (store.size < maxEntries) return;
    const nowMs = now();

    for (const [key, entry] of store) {
      if (entry.resetAt <= nowMs) store.delete(key);
    }

    // Still full: drop the oldest keys. Map preserves insertion order.
    while (store.size >= maxEntries) {
      const oldest = store.keys().next().value;

      if (oldest === undefined) break;
      store.delete(oldest);
    }
  };

  return (rule, key) =>
    Effect.sync(() => {
      const nowMs = now();
      const entry = store.get(key);

      if (!entry || entry.resetAt <= nowMs) {
        if (!entry) prune();
        store.set(key, { count: 1, resetAt: nowMs + rule.windowSeconds * 1_000 });

        return {
          limited: false,
          bucket: rule.bucket,
          limit: rule.limit,
          retryAfterSeconds: 0,
        } satisfies RateLimitOutcome;
      }

      entry.count += 1;

      if (entry.count <= rule.limit)
        return {
          limited: false,
          bucket: rule.bucket,
          limit: rule.limit,
          retryAfterSeconds: 0,
        } satisfies RateLimitOutcome;

      return {
        limited: true,
        bucket: rule.bucket,
        limit: rule.limit,
        retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - nowMs) / 1_000)),
      } satisfies RateLimitOutcome;
    });
};

/**
 * The self-hosted limiter: one counter set per process, with no external
 * dependency. A single container is the deployment this is built for, so the
 * limits are exact there.
 */
export const RateLimiterLocal = (options: LocalRateLimiterOptions = {}) =>
  Layer.succeed(RateLimiter, {
    check: checkWith({ trustForwarded: options.trustForwarded ?? false }, localConsumer(options)),
  });
