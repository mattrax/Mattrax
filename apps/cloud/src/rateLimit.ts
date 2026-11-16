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
 * Worker runs many isolates and each one keeps its own counters. Credential
 * endpoints (`auth`) therefore fail closed when their edge binding is
 * configured but throws, instead of silently multiplying the limit by the
 * isolate count. Other buckets keep the bounded fallback so an edge outage
 * cannot take down enrollment, MDM or billing.
 */

import { Option, Schema } from "effect";

export type RateLimitBucket = "auth" | "enrollment" | "mdm" | "scep" | "scim" | "billing";

/** The only shape a Cloudflare Rate Limiting binding may resolve to. */
const RateLimitBindingResult = Schema.Struct({ success: Schema.Boolean });

export type RateLimitRule = {
  readonly bucket: RateLimitBucket;
  readonly limit: number;
  /** Cloudflare's simple limiter only supports 10s or 60s periods. */
  readonly windowSeconds: 10 | 60;
  /**
   * Deny instead of falling back to the per-isolate counter when a configured
   * edge limiter throws. Set for credential endpoints, where a silently weaker
   * limit is a credential-stuffing window. Deployments without the binding
   * still use the local counter, so local development keeps working.
   */
  readonly failClosedWhenUnavailable?: boolean;
};

/**
 * Credential-stuffing and token-brute-force buckets. They share one rule so a
 * new credential route cannot accidentally opt out of the fail-closed policy.
 */
const authRule = (): RateLimitRule => ({
  bucket: "auth",
  // Credential endpoints share one bucket. A busy office behind a single
  // address, or a browser that retries a ceremony, must not be mistaken for
  // credential stuffing; 10 attempts per second is still a blunt backstop.
  limit: 600,
  windowSeconds: 60,
  failClosedWhenUnavailable: true,
});

/** POST endpoints that issue sessions or mutate authentication factors. */
export const SENSITIVE_AUTH_PATHS = new Set([
  "/api/v1/beginpasskeysignin",
  "/api/v1/completepasskeysignin",
  "/api/v1/beginpasskeyregistration",
  "/api/v1/completepasskeyregistration",
  "/api/v1/ssosignin",
  "/api/v1/verify-email",
  "/api/v1/account/email-change",
  "/api/v1/account/email-change/verify",
  "/api/v1/account/email-verification",
  "/api/v1/register/verification",
  "/api/v1/register/verification/verify",
  "/api/v1/verifytotppending",
  "/api/v1/recovertotppending",
  "/api/v1/begintotpenrollment",
  "/api/v1/confirmtotpenrollment",
  "/api/v1/disabletotp",
  "/api/v1/regeneratetotprecoverycodes",
]);

/**
 * Route classes we protect. Values are deliberately generous for fleet-scale
 * NAT: enrollment and MDM traffic from thousands of devices can share one
 * egress IP, so the limiter is a blunt backstop for credential stuffing and
 * accidental hot loops, not a per-user quota.
 */
/**
 * Normalise a path the way the Effect router matches it before applying a
 * rule: decode escapes, drop matrix parameters, collapse duplicate slashes,
 * strip a trailing slash and fold case. Without this, `/API/V1//completePasskeySignIn/`
 * would bypass the credential bucket while still reaching the handler.
 */
const normalisePath = (pathname: string): string => {
  let decoded = pathname;

  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // A malformed escape cannot match a route; leave it as-is.
  }

  return (
    decoded
      .replaceAll(/;.*?(?=\/|$)/g, "")
      .replaceAll(/\/+/g, "/")
      .replace(/\/$/, "")
      .toLowerCase() || "/"
  );
};

export const rateLimitRuleFor = (request: Request): RateLimitRule | undefined => {
  const pathname = normalisePath(new URL(request.url).pathname);

  // Bootstrap is a cheap, authenticated read over the web Worker's service
  // binding. It is account-scoped (no tenant lookup) and deliberately outside
  // the credential-stuffing buckets: the API still requires a valid session.
  if (pathname === "/api/v1/bootstrap") return undefined;

  if (request.method === "POST" && SENSITIVE_AUTH_PATHS.has(pathname)) return authRule();

  // Invitation links are bearer credentials: preview and accept are public, so
  // they share the auth bucket's credential-stuffing ceiling.
  if (
    (request.method === "POST" && pathname === "/api/v1/invitations/accept") ||
    (request.method === "GET" && pathname === "/api/v1/invitations/preview")
  )
    return authRule();

  // Creating and resending invitations sends mail; keep them in the auth bucket
  // so a compromised member cannot fan out unbounded messages.
  if (
    request.method === "POST" &&
    /^\/api\/v1\/tenants\/[^/]+\/invitations(?:\/[^/]+\/resend)?$/.test(pathname)
  )
    return authRule();

  // Passkey ceremonies and step-up factor verification are credential checks.
  if (request.method === "POST" && (pathname.includes("/passkey") || pathname.includes("/step-up")))
    return authRule();

  // The MCP OAuth endpoints exchange public-client authorization codes and
  // refresh tokens without a client secret; they are credential endpoints too.
  // Registration is included because each call writes a client row.
  if (
    request.method === "POST" &&
    (pathname === "/api/oauth/token" ||
      pathname === "/api/oauth/revoke" ||
      pathname === "/api/oauth/register")
  )
    return authRule();

  // Deployment licence calls carry a bearer credential and mutate billing.
  if (pathname.startsWith("/api/platform/billing/")) return authRule();

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

/**
 * Limiter key.
 *
 * Cloudflare requests carry `request.cf`; only then is `cf-connecting-ip`
 * trustworthy (the edge overwrites it). A Node deployment behind a reverse
 * proxy must opt in with `TRUST_PROXY_HEADERS=1`, and the key is the **last**
 * forwarded hop: the nearest proxy appends the address it saw, while earlier
 * hops may be caller-supplied. Without either, every caller shares one key,
 * which is blunt but not spoofable.
 */
export type ClientKeyOptions = { readonly trustForwarded?: boolean };

export const clientKey = (
  request: Request,
  { trustForwarded = false }: ClientKeyOptions = {},
): string => {
  const header = (name: string) => request.headers.get(name)?.trim() || undefined;
  // SAFETY: Workers requests expose the platform's `cf` object; Node requests do not.
  const cloudflare = (request as { cf?: unknown }).cf !== undefined;

  if (cloudflare)
    return (
      header("cf-connecting-ip") ?? header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local"
    );

  if (!trustForwarded) return "local";

  const chain = header("x-forwarded-for")
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return chain?.at(-1) ?? header("x-real-ip") ?? "local";
};

export type RateLimitBindingLike = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

export type RateLimitBindings = Partial<Record<RateLimitBucket, RateLimitBindingLike>>;

export type RateLimitEnv = {
  readonly RATE_LIMITER_AUTH?: RateLimitBindingLike;
  readonly RATE_LIMITER_ENROLLMENT?: RateLimitBindingLike;
  readonly RATE_LIMITER_MDM?: RateLimitBindingLike;
  readonly RATE_LIMITER_SCIM?: RateLimitBindingLike;
  readonly RATE_LIMITER_BILLING?: RateLimitBindingLike;
  readonly RATE_LIMITER_SCEP?: RateLimitBindingLike;
};

/**
 * Read the optional Cloudflare Rate Limiting bindings from the Worker env.
 * Every bucket has its own binding name; any missing binding (or a
 * deployment that did not configure a namespace) simply falls back to the
 * per-isolate limiter for that bucket.
 */
export const rateLimitBindingsFromEnv = (env: RateLimitEnv): RateLimitBindings => ({
  auth: env.RATE_LIMITER_AUTH,
  enrollment: env.RATE_LIMITER_ENROLLMENT,
  mdm: env.RATE_LIMITER_MDM,
  scim: env.RATE_LIMITER_SCIM,
  billing: env.RATE_LIMITER_BILLING,
  scep: env.RATE_LIMITER_SCEP,
});

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
  readonly trustForwarded?: boolean;
  readonly warn?: (message: string, cause?: unknown) => void;
};

const DEFAULT_MAX_ENTRIES = 10_000;

export const createRateLimiter = ({
  store = new Map<string, Counter>(),
  now = Date.now,
  maxEntries = DEFAULT_MAX_ENTRIES,
  trustForwarded = false,
  warn = (message, cause) => console.warn(message, cause),
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

    const key = `${rule.bucket}:${clientKey(request, { trustForwarded })}`;
    const binding = bindings[rule.bucket];

    if (binding) {
      try {
        const result = await binding.limit({ key });

        const decoded = Option.getOrUndefined(
          Schema.decodeUnknownOption(RateLimitBindingResult)(result),
        );

        // A binding that resolves to an unexpected shape is treated exactly
        // like an unavailable binding rather than allowing the request.
        if (decoded === undefined)
          throw new Error("Rate limiter binding returned an invalid result");

        return decoded.success
          ? { limited: false, bucket: rule.bucket, limit: rule.limit, retryAfterSeconds: 0 }
          : {
              limited: true,
              bucket: rule.bucket,
              limit: rule.limit,
              retryAfterSeconds: rule.windowSeconds,
            };
      } catch (cause) {
        // Credential endpoints fail closed: the per-isolate counter is only
        // meaningful for a single isolate, so a shared-limiter outage must not
        // turn a global limit into N independent limits for a credential
        // guessing window. Other buckets keep their bounded local fallback.
        if (rule.failClosedWhenUnavailable) {
          warn(`Cloudflare rate limiter failed for bucket ${rule.bucket}; failing closed`, cause);

          return {
            limited: true,
            bucket: rule.bucket,
            limit: rule.limit,
            retryAfterSeconds: rule.windowSeconds,
          };
        }

        // A limiter outage must not take down enrollment, MDM or billing. Keep
        // serving with the per-isolate fallback and make the degradation
        // visible.
        warn(
          `Cloudflare rate limiter failed for bucket ${rule.bucket}; using local fallback`,
          cause,
        );
      }
    }

    return consumeFallback(key, rule);
  };

  return { check, store };
};

export type RateLimiter = ReturnType<typeof createRateLimiter>;

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
