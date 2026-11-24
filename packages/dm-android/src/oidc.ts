import { Clock, Context, Data, Duration, Effect, Layer, Schema } from "effect";
import { SecureRandom, Signature } from "effect/crypto";
import { FetchHttpClient } from "effect/http";
import { JoseError, Jwt, Jwks } from "effect/jose";

/**
 * Google OIDC verification for Pub/Sub push deliveries.
 *
 * Pub/Sub push subscriptions can be configured with an OIDC service account.
 * Google signs a short-lived JWT and sends it as `Authorization: Bearer …`.
 * Verifying it here (issuer, audience, signature via Google's JWKS and the
 * expected service-account email) is what stops an unauthenticated caller from
 * posting fake enrollment or command notifications.
 */

/** Google publishes its OIDC signing keys here. */
export const GOOGLE_OIDC_JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";

/** Google's OIDC issuer, in both forms seen in tokens. */
export const GOOGLE_OIDC_ISSUERS = ["https://accounts.google.com", "accounts.google.com"] as const;

const CLOCK_SKEW_SECONDS = 60;
const MAX_OIDC_TOKEN_BYTES = 16 * 1024;

export class PubSubAuthError extends Data.TaggedError("PubSubAuthError")<{
  message: string;
  cause?: unknown;
}> {}

export type PubSubOidcVerifierConfig = {
  /** The audience Google is configured to use for the push subscription. */
  readonly audience: string;
  /** Service account email allowed to publish to the subscription. */
  readonly serviceAccountEmail?: string;
  /** Override for tests; defaults to Google's JWKS. */
  readonly jwksUri?: string;
  /** Accepted issuers; defaults to Google's. */
  readonly issuers?: ReadonlyArray<string>;
  /**
   * Fetch implementation used by the compatibility verifier. Scoped service
   * consumers should inject `HttpClient.HttpClient` instead.
   */
  readonly fetch?: typeof globalThis.fetch;
  /** Clock override retained for compatibility; prefer the Effect Clock service. */
  readonly now?: () => number;
  /** Reject tokens older than this even if `exp` is still in the future. */
  readonly maxAgeSeconds?: number;
  /** How long a fetched JWKS remains cached. Defaults to one hour. */
  readonly jwksTimeToLive?: Duration.Input;
  /** Minimum interval between unknown-key refreshes. Defaults to one minute. */
  readonly jwksCooldown?: Duration.Input;
  /** Complete JWKS request and body-read deadline. Defaults to five seconds. */
  readonly jwksTimeout?: Duration.Input;
};

export type PubSubOidcClaims = {
  readonly issuer: string;
  readonly audience: string;
  readonly subject?: string;
  readonly email?: string;
  readonly emailVerified?: boolean;
  readonly expiresAt: number;
  readonly issuedAt?: number;
  readonly claims: Schema.JsonObject;
};

type MutableClaims = { -readonly [K in keyof PubSubOidcClaims]: PubSubOidcClaims[K] };

function stringClaim(value: Schema.Json | undefined): string | undefined {
  return Schema.is(Schema.String)(value) && value.length > 0 ? value : undefined;
}

function numberClaim(value: Schema.Json | undefined): number | undefined {
  return Schema.is(Schema.Number)(value) && Number.isFinite(value) ? value : undefined;
}

function authError(message: string, cause?: unknown): PubSubAuthError {
  return new PubSubAuthError({ message, cause });
}

function mapJwtError(cause: Jwt.JwtError): PubSubAuthError {
  if (!JoseError.isJoseError(cause)) {
    return authError("OIDC token claims are invalid", cause);
  }

  switch (cause.reason._tag) {
    case "InvalidToken":
      return authError("OIDC token is malformed", cause);
    case "AlgorithmNotAllowed":
      return authError("OIDC token alg must be RS256", cause);
    case "SignatureVerificationFailed":
      return authError("OIDC signature is invalid", cause);
    case "KeyNotFound":
      return authError("OIDC signing key not found", cause);
    case "AmbiguousKey":
      return authError("OIDC signing key is ambiguous", cause);
    case "InvalidKey":
      return authError("Invalid OIDC signing key", cause);
    case "KeySetUnavailable":
      return authError(`Could not load Google signing keys: ${cause.reason.message}`, cause);
    case "InvalidArgument":
      return authError(`Pub/Sub OIDC configuration is invalid: ${cause.reason.message}`, cause);
    case "ClaimValidationFailed": {
      const { claim, reason } = cause.reason;

      if (claim === "iss") return authError("OIDC issuer is not trusted", cause);
      if (claim === "aud") return authError("OIDC audience does not match", cause);
      if (claim === "exp") return authError("OIDC token has expired", cause);
      if (claim === "iat") {
        return authError(
          reason === "tooOld" ? "OIDC token is too old" : "OIDC token is not valid yet",
          cause,
        );
      }

      return authError(`OIDC token claim "${claim}" is invalid`, cause);
    }
    case "DecryptionFailed":
      return authError("OIDC signature check failed", cause);
  }
}

const verifyWithServices = Effect.fnUntraced(function* (
  token: string,
  config: PubSubOidcVerifierConfig,
  jwks: Jwks.Jwks["Service"],
  signature: Signature.Signature["Service"],
): Effect.fn.Return<PubSubOidcClaims, PubSubAuthError> {
  if (config.audience.trim() === "") {
    return yield* Effect.fail(authError("Pub/Sub audience is not configured"));
  }

  if (new TextEncoder().encode(token).byteLength > MAX_OIDC_TOKEN_BYTES) {
    return yield* Effect.fail(authError("OIDC token is too large"));
  }

  const unverified = yield* Jwt.decodeUnverified(token).pipe(Effect.mapError(mapJwtError));

  if (unverified.protectedHeader.alg !== "RS256") {
    return yield* Effect.fail(authError("OIDC token alg must be RS256"));
  }

  if (!stringClaim(unverified.protectedHeader.kid)) {
    return yield* Effect.fail(authError("OIDC token has no kid"));
  }

  const verified = yield* Jwt.verifyWithKeySet(Schema.JsonObject, token, {
    algorithms: ["RS256"],
    issuer: config.issuers ?? GOOGLE_OIDC_ISSUERS,
    audience: config.audience,
    clockTolerance: CLOCK_SKEW_SECONDS * 1000,
    requiredClaims: ["iss", "aud", "exp"],
  }).pipe(
    Effect.provideService(Jwks.Jwks, jwks),
    Effect.provideService(Signature.Signature, signature),
    Effect.mapError(mapJwtError),
  );

  const claims = verified.claims;
  const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
  const issuedAt = numberClaim(claims["iat"]);

  if (issuedAt !== undefined && issuedAt - CLOCK_SKEW_SECONDS > now) {
    return yield* Effect.fail(authError("OIDC token is not valid yet"));
  }

  if (
    issuedAt !== undefined &&
    config.maxAgeSeconds !== undefined &&
    issuedAt + config.maxAgeSeconds + CLOCK_SKEW_SECONDS < now
  ) {
    return yield* Effect.fail(authError("OIDC token is too old"));
  }

  const email = stringClaim(claims["email"]);
  const rawEmailVerified = claims["email_verified"];
  const emailVerified = Schema.is(Schema.Boolean)(rawEmailVerified) ? rawEmailVerified : undefined;

  if (config.serviceAccountEmail) {
    if (!email || email.toLowerCase() !== config.serviceAccountEmail.toLowerCase()) {
      return yield* Effect.fail(authError("OIDC token is from an unexpected service account"));
    }

    if (emailVerified === false) {
      return yield* Effect.fail(authError("OIDC token email is not verified"));
    }
  }

  const audience = verified.registeredClaims.aud;
  const issuer = stringClaim(claims["iss"]);
  const expiresAt = numberClaim(claims["exp"]);

  if (issuer === undefined || expiresAt === undefined) {
    return yield* Effect.fail(authError("OIDC token claims are invalid"));
  }

  const result: MutableClaims = {
    issuer,
    audience: typeof audience === "string" ? audience : config.audience,
    expiresAt,
    claims,
  };

  const subject = stringClaim(claims["sub"]);

  if (subject !== undefined) result.subject = subject;
  if (email !== undefined) result.email = email;
  if (emailVerified !== undefined) result.emailVerified = emailVerified;
  if (issuedAt !== undefined) result.issuedAt = issuedAt;

  return result;
});

export interface PubSubOidcVerifierService {
  readonly verify: (token: string) => Effect.Effect<PubSubOidcClaims, PubSubAuthError>;
}

/** A verifier whose JWKS cache lives and dies with its Effect layer scope. */
export class PubSubOidcVerifier extends Context.Service<
  PubSubOidcVerifier,
  PubSubOidcVerifierService
>()("@mattrax/dm-android/PubSubOidcVerifier") {}

/**
 * Scoped Google OIDC verifier. Provide an `HttpClient.HttpClient`; closing the
 * layer aborts in-flight JWKS requests and discards the cached key set.
 * The injected client must not follow redirects.
 */
export const PubSubOidcVerifierLive = (config: PubSubOidcVerifierConfig) =>
  Layer.effect(
    PubSubOidcVerifier,
    Effect.gen(function* () {
      const clock = yield* Clock.Clock;
      const jwks = yield* Jwks.Jwks;
      const signature = yield* Signature.Signature;

      return PubSubOidcVerifier.of({
        verify: (token) =>
          verifyWithServices(token, config, jwks, signature).pipe(
            Effect.provideService(Clock.Clock, clock),
          ),
      });
    }),
  ).pipe(
    Layer.provide(
      Jwks.layerRemote({
        url: config.jwksUri ?? GOOGLE_OIDC_JWKS_URI,
        timeToLive: config.jwksTimeToLive ?? "1 hour",
        cooldown: config.jwksCooldown ?? "1 minute",
        timeout: config.jwksTimeout ?? "5 seconds",
      }),
    ),
    Layer.provide(Signature.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto))),
  );

function clockWithOverride(clock: Clock.Clock, now: (() => number) | undefined): Clock.Clock {
  if (now === undefined) return clock;

  const currentTimeMillis = () => Math.trunc(now());
  const currentTimeNanos = () => BigInt(currentTimeMillis()) * 1_000_000n;

  return {
    currentTimeMillisUnsafe: currentTimeMillis,
    currentTimeMillis: Effect.sync(currentTimeMillis),
    currentTimeNanosUnsafe: currentTimeNanos,
    currentTimeNanos: Effect.sync(currentTimeNanos),
    monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
    monotonicTimeNanos: clock.monotonicTimeNanos,
    sleep: (duration) => clock.sleep(duration),
  };
}

/**
 * Verify a Pub/Sub OIDC bearer token and return its claims.
 *
 * This compatibility entry point creates a scoped JWKS service per call. Use
 * `PubSubOidcVerifierLive` when keys should be cached across requests.
 */
export function verifyPubSubOidcToken(
  token: string,
  config: PubSubOidcVerifierConfig,
): Effect.Effect<PubSubOidcClaims, PubSubAuthError> {
  const fetchLayer = FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, config.fetch ?? globalThis.fetch)),
    Layer.provide(Layer.succeed(FetchHttpClient.RequestInit, { redirect: "manual" })),
  );

  return Clock.clockWith((clock) =>
    Effect.gen(function* () {
      const verifier = yield* PubSubOidcVerifier;

      return yield* verifier.verify(token);
    }).pipe(
      Effect.provide(PubSubOidcVerifierLive(config)),
      Effect.provide(fetchLayer),
      Effect.provideService(Clock.Clock, clockWithOverride(clock, config.now)),
      Effect.mapError((cause) => (JoseError.isJoseError(cause) ? mapJwtError(cause) : cause)),
    ),
  );
}

/** Extract a bearer token from an `Authorization` header value. */
export function bearerToken(header: string | undefined): string | undefined {
  const match = /^Bearer\s+(.+)$/i.exec((header ?? "").trim());

  return match?.[1]?.trim() || undefined;
}

/** @deprecated JWKS caches are now scoped to their verifier layer. */
export function clearJwksCache(): void {
  return;
}
