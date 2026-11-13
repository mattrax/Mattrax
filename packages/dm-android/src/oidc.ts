import { Data, Effect } from "effect";

/**
 * Google OIDC verification for Pub/Sub push deliveries.
 *
 * Pub/Sub push subscriptions can be configured with an OIDC service account.
 * Google signs a short-lived JWT and sends it as `Authorization: Bearer …`.
 * Verifying it here (issuer, audience, signature via Google's JWKS and the
 * expected service-account email) is what stops an unauthenticated caller from
 * posting fake enrollment or command notifications.
 *
 * Implemented with WebCrypto so it works in Workers, Node and tests without an
 * extra dependency.
 */

/** Google publishes its OIDC signing keys here. */
export const GOOGLE_OIDC_JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";

/** Google's OIDC issuer, in both forms seen in tokens. */
export const GOOGLE_OIDC_ISSUERS = ["https://accounts.google.com", "accounts.google.com"] as const;

const JWKS_CACHE_MS = 60 * 60 * 1000;
const CLOCK_SKEW_SECONDS = 60;

export class PubSubAuthError extends Data.TaggedError("PubSubAuthError")<{
  message: string;
  cause?: unknown;
}> {}

type JsonWebKey = {
  readonly kty?: string;
  readonly kid?: string;
  readonly use?: string;
  readonly alg?: string;
  readonly n?: string;
  readonly e?: string;
  readonly [key: string]: unknown;
};

type JwkSet = { readonly keys: ReadonlyArray<JsonWebKey> };

type CachedJwkSet = { readonly keys: ReadonlyArray<JsonWebKey>; readonly expiresAt: number };

const jwksCache = new Map<string, CachedJwkSet>();

/** Unknown kids that recently forced a refetch; avoid a JWKS-fetch oracle. */
const unknownKidCache = new Map<string, number>();
const UNKNOWN_KID_NEGATIVE_CACHE_MS = 60 * 1000;

const textDecoder = new TextDecoder();

function decodeBase64Url(input: string): Uint8Array {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const binary = atob(padded);

  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJsonPart(input: string, label: string): Record<string, unknown> {
  try {
    const value = JSON.parse(textDecoder.decode(decodeBase64Url(input))) as unknown;

    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw new Error(`${label} is not an object`);

    return value as Record<string, unknown>;
  } catch (cause) {
    throw new PubSubAuthError({ message: `OIDC token ${label} is not valid JSON`, cause });
  }
}

export type PubSubOidcVerifierConfig = {
  /** The audience Google is configured to use for the push subscription. */
  readonly audience: string;
  /** Service account email allowed to publish to the subscription. */
  readonly serviceAccountEmail?: string;
  /** Override for tests; defaults to Google's JWKS. */
  readonly jwksUri?: string;
  /** Accepted issuers; defaults to Google's. */
  readonly issuers?: ReadonlyArray<string>;
  /** Injectable fetch and clock for tests. */
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
  /** Reject tokens older than this even if `exp` is still in the future. */
  readonly maxAgeSeconds?: number;
};

export type PubSubOidcClaims = {
  readonly issuer: string;
  readonly audience: string;
  readonly subject?: string;
  readonly email?: string;
  readonly emailVerified?: boolean;
  readonly expiresAt: number;
  readonly issuedAt?: number;
  readonly claims: Readonly<Record<string, unknown>>;
};

async function fetchJwks(uri: string, fetcher: typeof globalThis.fetch): Promise<CachedJwkSet> {
  const cached = jwksCache.get(uri);

  if (cached && cached.expiresAt > Date.now()) return cached;

  const response = await fetcher(uri, {
    headers: { accept: "application/json" },
  });

  if (!response.ok) throw new Error(`JWKS request returned HTTP ${response.status}`);
  const json = (await response.json()) as unknown;

  if (typeof json !== "object" || json === null || !Array.isArray((json as JwkSet).keys))
    throw new Error("JWKS response has no keys array");

  const keys = (json as JwkSet).keys.filter(
    (key): key is JsonWebKey =>
      typeof key === "object" &&
      key !== null &&
      key.kty === "RSA" &&
      typeof key.n === "string" &&
      typeof key.e === "string" &&
      (key.alg === undefined || key.alg === "RS256") &&
      (key.use === undefined || key.use === "sig"),
  );

  if (keys.length === 0) throw new Error("JWKS response has no usable RS256 keys");
  const entry = { keys, expiresAt: Date.now() + JWKS_CACHE_MS } satisfies CachedJwkSet;
  jwksCache.set(uri, entry);

  return entry;
}

function audienceMatches(audience: unknown, expected: string): boolean {
  if (typeof audience === "string") return audience === expected;

  if (Array.isArray(audience)) return audience.some((value) => value === expected);

  return false;
}

function stringClaim(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberClaim(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Verify a Pub/Sub OIDC bearer token and return its claims.
 *
 * Fails closed on any malformed header, unknown key, bad signature, wrong
 * issuer/audience, expired token or unexpected service-account email.
 */
export function verifyPubSubOidcToken(
  token: string,
  config: PubSubOidcVerifierConfig,
): Effect.Effect<PubSubOidcClaims, PubSubAuthError> {
  return Effect.gen(function* () {
    if (config.audience.trim() === "")
      return yield* Effect.fail(
        new PubSubAuthError({ message: "Pub/Sub audience is not configured" }),
      );

    const parts = token.split(".");

    if (parts.length !== 3 || parts.some((part) => part === ""))
      return yield* Effect.fail(new PubSubAuthError({ message: "OIDC token is malformed" }));

    const header = yield* Effect.try({
      try: () => decodeJsonPart(parts[0]!, "header"),
      catch: (cause) =>
        cause instanceof PubSubAuthError
          ? cause
          : new PubSubAuthError({ message: "OIDC token header is invalid", cause }),
    });

    if (header["alg"] !== "RS256")
      return yield* Effect.fail(new PubSubAuthError({ message: "OIDC token alg must be RS256" }));
    const kid = stringClaim(header["kid"]);

    if (!kid) return yield* Effect.fail(new PubSubAuthError({ message: "OIDC token has no kid" }));

    const claims = yield* Effect.try({
      try: () => decodeJsonPart(parts[1]!, "payload"),
      catch: (cause) =>
        cause instanceof PubSubAuthError
          ? cause
          : new PubSubAuthError({ message: "OIDC token payload is invalid", cause }),
    });

    const jwksUri = config.jwksUri ?? GOOGLE_OIDC_JWKS_URI;
    const fetcher = config.fetch ?? globalThis.fetch;

    const loadKeys = () =>
      Effect.tryPromise({
        try: () => fetchJwks(jwksUri, fetcher),
        catch: (cause) =>
          new PubSubAuthError({ message: "Could not load Google signing keys", cause }),
      });

    const nowMs = config.now?.() ?? Date.now();
    const negativeKey = `${jwksUri}:${kid}`;
    const blockedUntil = unknownKidCache.get(negativeKey);

    if (blockedUntil !== undefined && blockedUntil > nowMs)
      return yield* Effect.fail(new PubSubAuthError({ message: "OIDC signing key not found" }));

    let keySet = yield* loadKeys();
    let jwk = keySet.keys.find((candidate) => candidate.kid === kid);

    if (!jwk) {
      // Keys rotate; an unknown kid may just mean our cache is stale. Only
      // refetch once per kid per minute so random kids cannot amplify egress.
      jwksCache.delete(jwksUri);
      keySet = yield* loadKeys();
      jwk = keySet.keys.find((candidate) => candidate.kid === kid);
    }

    if (!jwk) {
      if (unknownKidCache.size > 1000) unknownKidCache.clear();
      unknownKidCache.set(negativeKey, nowMs + UNKNOWN_KID_NEGATIVE_CACHE_MS);

      return yield* Effect.fail(new PubSubAuthError({ message: "OIDC signing key not found" }));
    }

    const signingJwk = jwk;

    const key = yield* Effect.tryPromise({
      try: () =>
        crypto.subtle.importKey(
          "jwk",
          { kty: "RSA", n: signingJwk.n!, e: signingJwk.e! },
          { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
          false,
          ["verify"],
        ),
      catch: (cause) => new PubSubAuthError({ message: "Invalid OIDC signing key", cause }),
    });

    const valid = yield* Effect.tryPromise({
      try: () =>
        crypto.subtle.verify(
          { name: "RSASSA-PKCS1-v1_5" },
          key,
          decodeBase64Url(parts[2]!) as unknown as BufferSource,
          new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
        ),
      catch: (cause) => new PubSubAuthError({ message: "OIDC signature check failed", cause }),
    });

    if (!valid)
      return yield* Effect.fail(new PubSubAuthError({ message: "OIDC signature is invalid" }));

    const issuer = stringClaim(claims["iss"]);
    const acceptedIssuers: ReadonlyArray<string> = config.issuers ?? GOOGLE_OIDC_ISSUERS;

    if (!issuer || !acceptedIssuers.includes(issuer))
      return yield* Effect.fail(new PubSubAuthError({ message: "OIDC issuer is not trusted" }));

    if (!audienceMatches(claims["aud"], config.audience))
      return yield* Effect.fail(new PubSubAuthError({ message: "OIDC audience does not match" }));

    const now = Math.floor((config.now?.() ?? Date.now()) / 1000);
    const expiresAt = numberClaim(claims["exp"]);

    if (expiresAt === undefined || expiresAt + CLOCK_SKEW_SECONDS <= now)
      return yield* Effect.fail(new PubSubAuthError({ message: "OIDC token has expired" }));

    const issuedAt = numberClaim(claims["iat"]);

    if (issuedAt !== undefined && issuedAt - CLOCK_SKEW_SECONDS > now)
      return yield* Effect.fail(new PubSubAuthError({ message: "OIDC token is not valid yet" }));

    if (issuedAt !== undefined && config.maxAgeSeconds !== undefined) {
      if (issuedAt + config.maxAgeSeconds + CLOCK_SKEW_SECONDS < now)
        return yield* Effect.fail(new PubSubAuthError({ message: "OIDC token is too old" }));
    }

    const email = stringClaim(claims["email"]);

    const emailVerified =
      typeof claims["email_verified"] === "boolean" ? claims["email_verified"] : undefined;

    if (config.serviceAccountEmail) {
      if (!email || email.toLowerCase() !== config.serviceAccountEmail.toLowerCase())
        return yield* Effect.fail(
          new PubSubAuthError({ message: "OIDC token is from an unexpected service account" }),
        );

      if (emailVerified === false)
        return yield* Effect.fail(
          new PubSubAuthError({ message: "OIDC token email is not verified" }),
        );
    }

    return {
      issuer,
      audience: typeof claims["aud"] === "string" ? claims["aud"] : config.audience,
      ...(stringClaim(claims["sub"]) ? { subject: stringClaim(claims["sub"])! } : {}),
      ...(email ? { email } : {}),
      ...(emailVerified !== undefined ? { emailVerified } : {}),
      expiresAt,
      ...(issuedAt !== undefined ? { issuedAt } : {}),
      claims,
    } satisfies PubSubOidcClaims;
  });
}

/** Extract a bearer token from an `Authorization` header value. */
export function bearerToken(header: string | undefined): string | undefined {
  const match = /^Bearer\s+(.+)$/i.exec((header ?? "").trim());

  return match?.[1]?.trim() || undefined;
}

/** Clear the module-level JWKS cache. Tests only. */
export function clearJwksCache(): void {
  jwksCache.clear();
  unknownKidCache.clear();
}
