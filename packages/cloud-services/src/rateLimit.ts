/**
 * Abuse protection for high-cost public endpoints.
 *
 * This module is policy: which request belongs to which bucket, and what key
 * identifies a caller. The counters live behind the {@link RateLimiter}
 * service so the same rules run on whatever limiter the deployment has:
 *
 * - {@link RateLimiterCloudflare} — Cloudflare's Rate Limiting binding. Its
 *   counters are approximate and counted **per Cloudflare location**, so it is
 *   an abuse backstop, not a global quota.
 * - {@link RateLimiterLocal} — one counter set per process. Exact for the
 *   single-container self-hosted deployment; a Worker isolate only ever sees
 *   its own copy, so there it is a fallback at best.
 *
 * Credential endpoints (`auth`) fail closed when a configured shared limiter
 * throws, rather than silently degrading to something weaker. Other buckets
 * keep the local fallback so a limiter outage cannot take down enrollment,
 * MDM or billing.
 */

import { Context, Effect } from "effect";
import { normalisePath } from "@mattrax/enterprise-domain";
import { clientAddress as trustedClientAddress } from "./clientAddress.js";

export { normalisePath };

export type RateLimitBucket =
  | "auth"
  | "enrollment"
  | "mdm"
  | "scep"
  | "scim"
  | "billing"
  | "policy";

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

/**
 * Stateless policy helpers that parse caller-supplied profiles. They are
 * cheap for a normal editor session but expensive enough per request (base64
 * decode, optional PKCS#7 unwrap, plist parse) to deserve their own bucket
 * instead of the generous MDM/enrollment allowances.
 */
export const MOBILECONFIG_PATHS = new Set([
  "/api/v1/policy/extract-mobileconfig",
  "/api/v1/policy/preview-mobileconfig",
]);

/** POST endpoints that issue sessions or mutate authentication factors. */
export const SENSITIVE_AUTH_PATHS = new Set([
  "/api/v1/beginpasskeysignin",
  "/api/v1/completepasskeysignin",
  "/api/v1/beginpasskeyregistration",
  "/api/v1/completepasskeyregistration",
  "/api/v1/completepasskeypending",
  "/api/v1/ssosignin",
  "/api/v1/recoverysignin",
  "/api/v1/verify-email",
  "/api/v1/account/email-change",
  "/api/v1/account/email-change/verify",
  "/api/v1/account/email-verification",
  "/api/v1/account/recovery",
  "/api/v1/account/recovery/verify",
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
export const rateLimitRuleFor = (request: Request): RateLimitRule | undefined => {
  const pathname = normalisePath(new URL(request.url).pathname);

  // Bootstrap is a cheap, authenticated read over the web Worker's service
  // binding. It is account-scoped (no tenant lookup) and deliberately outside
  // the credential-stuffing buckets: the API still requires a valid session.
  if (pathname === "/api/v1/bootstrap") return undefined;

  if (request.method === "POST" && SENSITIVE_AUTH_PATHS.has(pathname)) return authRule();

  // Policy editors preview a profile as the user types, so this is a normal
  // authenticated session workload, not a credential guess. The dedicated
  // bucket keeps a runaway loop or an unauthenticated flood away from the
  // MDM/enrollment counters while still allowing quick re-previews.
  if (request.method === "POST" && MOBILECONFIG_PATHS.has(pathname))
    return { bucket: "policy", limit: 120, windowSeconds: 60 };

  // SSO discovery is public and reveals whether an address belongs to a
  // tenant; keep it in the credential bucket so it cannot be enumerated. The
  // callback exchanges a public authorization code for an identity and is a
  // credential endpoint in its own right.
  if (
    request.method === "GET" &&
    (pathname === "/api/v1/sso/azure/start" || pathname === "/api/v1/sso/azure/callback")
  )
    return authRule();

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
  // SAFETY: Workers requests expose the platform's `cf` object; Node requests do not.
  const cloudflare = (request as { cf?: unknown }).cf !== undefined;

  // One trust policy is shared with the audit log (`./clientAddress.ts`). The
  // limiter needs a stable key even when the address is unknowable, so every
  // unverifiable caller collapses into the blunt `local` bucket; the audit log
  // stores nothing rather than a spoofable value.
  return trustedClientAddress(request.headers, { trustForwarded, cloudflare }) ?? "local";
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
  readonly RATE_LIMITER_POLICY?: RateLimitBindingLike;
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
  policy: env.RATE_LIMITER_POLICY,
});

export type RateLimitOutcome = {
  readonly limited: boolean;
  readonly bucket?: RateLimitBucket;
  readonly limit?: number;
  readonly retryAfterSeconds: number;
};

export declare namespace RateLimiter {
  export type Service = {
    /**
     * Charge one request to its bucket and report whether the deployment
     * allows it. Never fails: an unavailable shared limiter is either a denial
     * (credential buckets) or a degradation, decided by the implementation.
     */
    readonly check: (request: Request) => Effect.Effect<RateLimitOutcome>;
  };
}

/**
 * The counter behind the rules. Cloud provides it with Cloudflare's Rate
 * Limiting binding; the self-hosted container uses a process-local map.
 */
export class RateLimiter extends Context.Service<RateLimiter, RateLimiter.Service>()(
  "mattrax/RateLimiter",
) {}

/** Charge one request to the limiter provided by the current layer. */
export const check = (request: Request): Effect.Effect<RateLimitOutcome, never, RateLimiter> =>
  Effect.gen(function* () {
    const limiter = yield* RateLimiter;

    return yield* limiter.check(request);
  });

/** Charge one unit for a classified request. */
export type ConsumeRateLimit = (
  rule: RateLimitRule,
  key: string,
) => Effect.Effect<RateLimitOutcome>;

/**
 * Build the service's `check` from a consumer. Rule selection and key policy
 * stay identical across deployments; only the counter differs.
 */
export const checkWith =
  (
    { trustForwarded = false }: ClientKeyOptions,
    consume: ConsumeRateLimit,
  ): RateLimiter.Service["check"] =>
  (request) => {
    const rule = rateLimitRuleFor(request);

    if (rule === undefined) return Effect.succeed({ limited: false, retryAfterSeconds: 0 });

    return consume(rule, `${rule.bucket}:${clientKey(request, { trustForwarded })}`);
  };

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
