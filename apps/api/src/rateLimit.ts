/**
 * Abuse protection for high-cost public endpoints.
 *
 * Two layers back the same rules:
 *
 * 1. An optional Cloudflare Rate Limiting binding per bucket, configured when
 *    `MATTRAX_RATE_LIMIT_NAMESPACE` is present at build time. This is shared by
 *    every isolate and every colo, so it is the real limiter in production.
 * 2. A per-isolate in-memory fallback so local development and deployments
 *    without a namespace still get some protection.
 *
 * The in-memory layer is intentionally not presented as a global limit: a
 * Worker runs many isolates and each one keeps its own counters. The exact gap
 * is documented in `docs/production-readiness.md`.
 */

export type RateLimitBucket = "auth" | "enrollment" | "mdm" | "scep" | "scim" | "billing";

export type RateLimitRule = {
  readonly bucket: RateLimitBucket;
  readonly limit: number;
  /** Cloudflare's simple limiter only supports 10s or 60s periods. */
  readonly windowSeconds: 10 | 60;
};

/** POST endpoints that issue proofs, sessions or password changes. */
export const SENSITIVE_AUTH_PATHS = new Set([
  "/api/v1/signIn",
  "/api/v1/register",
  "/api/v1/requestReset",
  "/api/v1/requestEmailCode",
  "/api/v1/beginEmailSignIn",
  "/api/v1/completeEmailCode",
  "/api/v1/ssoSignIn",
  "/api/v1/verify-email",
  "/api/v1/account/email-change/verify",
  "/api/v1/verifyTotpPending",
  "/api/v1/recoverTotpPending",
  "/api/v1/beginTotpEnrollment",
  "/api/v1/confirmTotpEnrollment",
  "/api/v1/disableTotp",
  "/api/v1/regenerateTotpRecoveryCodes",
  "/api/v1/changePassword",
  "/api/v1/completeReset",
]);

/**
 * Route classes we protect. Values are deliberately generous for fleet-scale
 * NAT: enrollment and MDM traffic from thousands of devices can share one
 * egress IP, so the limiter is a blunt backstop for credential stuffing and
 * accidental hot loops, not a per-user quota.
 */
export const rateLimitRuleFor = (request: Request): RateLimitRule | undefined => {
  const { pathname } = new URL(request.url);

  if (request.method === "POST" && SENSITIVE_AUTH_PATHS.has(pathname))
    return { bucket: "auth", limit: 120, windowSeconds: 60 };

  if (pathname.startsWith("/api/v1/enrollment/"))
    return { bucket: "enrollment", limit: 600, windowSeconds: 60 };

  // Stripe already signs every delivery; this is only a coarse flood guard.
  if (pathname === "/api/v1/billing/webhook")
    return { bucket: "billing", limit: 600, windowSeconds: 60 };

  // Google Pub/Sub is signature-verified, but an unauthenticated caller can
  // still force JWKS fetches and JSON parsing.
  if (pathname === "/api/v1/android/pubsub")
    return { bucket: "mdm", limit: 600, windowSeconds: 60 };

  if (pathname.startsWith("/scim/")) return { bucket: "scim", limit: 600, windowSeconds: 60 };

  if (pathname.startsWith("/mdm/")) {
    if (pathname === "/mdm/apple/scep") return { bucket: "scep", limit: 300, windowSeconds: 60 };
    return { bucket: "mdm", limit: 600, windowSeconds: 60 };
  }

  return undefined;
};

export const clientKey = (request: Request): string =>
  request.headers.get("cf-connecting-ip") ??
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
  request.headers.get("x-real-ip") ??
  "local";

export type RateLimitBindingLike = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

export type RateLimitBindings = Partial<Record<RateLimitBucket, RateLimitBindingLike>>;

/**
 * Read the optional Cloudflare Rate Limiting bindings from the Worker env.
 * Every bucket has its own binding name; any missing binding (or a
 * deployment that did not configure a namespace) simply falls back to the
 * per-isolate limiter for that bucket.
 */
export const rateLimitBindingsFromEnv = (env: unknown): RateLimitBindings => {
  const candidate = env as Record<string, unknown>;
  const binding = (name: string) => candidate[name] as RateLimitBindingLike | undefined;
  return {
    auth: binding("RATE_LIMITER_AUTH"),
    enrollment: binding("RATE_LIMITER_ENROLLMENT"),
    mdm: binding("RATE_LIMITER_MDM"),
    scim: binding("RATE_LIMITER_SCIM"),
    billing: binding("RATE_LIMITER_BILLING"),
    scep: binding("RATE_LIMITER_SCEP"),
  };
};

export type RateLimitOutcome = {
  readonly limited: boolean;
  readonly bucket?: RateLimitBucket;
  readonly limit?: number;
  readonly retryAfterSeconds: number;
};

type Counter = { count: number; resetAt: number };
export type RateLimitStore = Map<string, Counter>;

export type RateLimiterOptions = {
  readonly store?: RateLimitStore;
  readonly now?: () => number;
  readonly maxEntries?: number;
  readonly warn?: (message: string, error?: unknown) => void;
};

const DEFAULT_MAX_ENTRIES = 10_000;

export const makeRateLimiter = ({
  store = new Map<string, Counter>(),
  now = Date.now,
  maxEntries = DEFAULT_MAX_ENTRIES,
  warn = (message, error) => console.warn(message, error),
}: RateLimiterOptions = {}) => {
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

  const consumeFallback = (key: string, rule: RateLimitRule): RateLimitOutcome => {
    const nowMs = now();
    const entry = store.get(key);
    if (!entry || entry.resetAt <= nowMs) {
      if (!entry) prune();
      store.set(key, { count: 1, resetAt: nowMs + rule.windowSeconds * 1_000 });
      return { limited: false, bucket: rule.bucket, limit: rule.limit, retryAfterSeconds: 0 };
    }
    entry.count += 1;
    if (entry.count <= rule.limit)
      return { limited: false, bucket: rule.bucket, limit: rule.limit, retryAfterSeconds: 0 };
    return {
      limited: true,
      bucket: rule.bucket,
      limit: rule.limit,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - nowMs) / 1_000)),
    };
  };

  const check = async (
    request: Request,
    bindings: RateLimitBindings = {},
  ): Promise<RateLimitOutcome> => {
    const rule = rateLimitRuleFor(request);
    if (!rule) return { limited: false, retryAfterSeconds: 0 };

    const key = `${rule.bucket}:${clientKey(request)}`;
    const binding = bindings[rule.bucket];
    if (binding) {
      try {
        const result = await binding.limit({ key });
        return result.success
          ? { limited: false, bucket: rule.bucket, limit: rule.limit, retryAfterSeconds: 0 }
          : {
              limited: true,
              bucket: rule.bucket,
              limit: rule.limit,
              retryAfterSeconds: rule.windowSeconds,
            };
      } catch (error) {
        // A limiter outage must not take down auth or enrollment. Keep serving
        // with the per-isolate fallback and make the degradation visible.
        warn(
          `Cloudflare rate limiter failed for bucket ${rule.bucket}; using local fallback`,
          error,
        );
      }
    }

    return consumeFallback(key, rule);
  };

  return { check, store };
};

export type RateLimiter = ReturnType<typeof makeRateLimiter>;

/** Stable JSON body for 429s so clients and probes can branch on `error`. */
export const rateLimitResponse = (outcome: RateLimitOutcome, requestId: string): Response => {
  const retryAfter = Math.max(1, outcome.retryAfterSeconds);
  return new Response(
    JSON.stringify({
      error: "rate_limited",
      message: "Too Many Requests",
      requestId,
      retryAfter,
    }),
    {
      status: 429,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "retry-after": String(retryAfter),
        "x-request-id": requestId,
      },
    },
  );
};
