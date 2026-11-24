import { Clock, Context, Data, Duration, Effect, Exit, Layer, Schema, Scope } from "effect";
import type { HttpClient } from "effect/http";
import { SecureRandom, Signature } from "effect/crypto";
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

export type PubSubOidcVerifierOptions = {
  /**
   * Reuse one remote key set across rebuilt request layers. Enable this in a
   * hosted runtime where the Effect graph is per request; tests and short-lived
   * hosts keep the default scoped layer.
   */
  readonly sharedJwks?: boolean;
};

const SHARED_JWKS_LIMIT = 16;
const sharedJwksScope = Scope.makeUnsafe();
const sharedJwks = new Map<
  string,
  { readonly service: Jwks.Jwks["Service"]; readonly expiresAt: number }
>();
const sharedJwksFlights = new Map<
  string,
  Effect.Effect<Jwks.Jwks["Service"], JoseError.JoseError, HttpClient.HttpClient>
>();

const jwksOptions = (config: PubSubOidcVerifierConfig) => ({
  url: config.jwksUri ?? GOOGLE_OIDC_JWKS_URI,
  timeToLive: config.jwksTimeToLive ?? "1 hour",
  cooldown: config.jwksCooldown ?? "1 minute",
  timeout: config.jwksTimeout ?? "5 seconds",
});

/**
 * Drop a cached key set, for example after a suspected key compromise.
 *
 * An in-flight refresh is detached from the cache: existing waiters may still
 * finish their own request, but they cannot repopulate the entry because the
 * completion checks that it is still the registered flight. The next request
 * starts a fresh fetch. No request layer or socket is retained by this cache.
 */
export const invalidateSharedJwks = (uri: string): void => {
  sharedJwks.delete(uri);
  sharedJwksFlights.delete(uri);
};

const trimSharedJwks = () => {
  while (sharedJwks.size > SHARED_JWKS_LIMIT) {
    const oldest = sharedJwks.keys().next().value;

    if (oldest === undefined) break;
    sharedJwks.delete(oldest);
  }
};

const sharedJwksService = (config: PubSubOidcVerifierConfig) =>
  Effect.gen(function* () {
    const options = jwksOptions(config);
    const now = yield* Clock.currentTimeMillis;
    const ttl = Duration.toMillis(Duration.fromInputUnsafe(options.timeToLive));
    const cached = sharedJwks.get(options.url);

    if (cached && cached.expiresAt > now) {
      // Refresh insertion order so capacity evicts the least-recently used URI.
      sharedJwks.delete(options.url);
      sharedJwks.set(options.url, cached);

      return cached.service;
    }

    const inFlight = sharedJwksFlights.get(options.url);

    if (inFlight) return yield* inFlight;

    // `Effect.cached` keeps the shared build alive while at least one caller
    // waits, and it never caches interruption: if every caller leaves, the run
    // is interrupted and the next request retries. A flight therefore cannot
    // wedge future callers on a permanently pending promise. The explicit map
    // entry only removes the completed run so a later expiry starts a fetch.
    const cachedEffect = yield* Effect.cached(
      Jwks.makeRemote(options).pipe(Effect.provideService(Scope.Scope, sharedJwksScope)),
    );
    const entry: Effect.Effect<Jwks.Jwks["Service"], JoseError.JoseError, HttpClient.HttpClient> =
      cachedEffect.pipe(
        Effect.tap((service) =>
          Effect.sync(() => {
            if (sharedJwksFlights.get(options.url) !== entry) return;

            sharedJwks.delete(options.url);
            sharedJwks.set(options.url, {
              service,
              expiresAt: Date.now() + ttl,
            });
            trimSharedJwks();
          }),
        ),
        Effect.onExit((exit) =>
          Exit.hasInterrupts(exit)
            ? Effect.void
            : Effect.sync(() => {
                if (sharedJwksFlights.get(options.url) === entry)
                  sharedJwksFlights.delete(options.url);
              }),
        ),
      );

    sharedJwksFlights.set(options.url, entry);

    return yield* entry;
  });

/**
 * Scoped Google OIDC verifier. Provide an `HttpClient.HttpClient`; closing the
 * layer aborts in-flight JWKS requests and discards the cached key set.
 * The injected client must not follow redirects.
 *
 * With `sharedJwks`, the remote key set is built in a module scope instead, so
 * a hosted request rebuild does not pay for another JWKS fetch. The service
 * still refetches unknown kids after its cooldown, so key rotation is picked up.
 */
export const PubSubOidcVerifierLive = (
  config: PubSubOidcVerifierConfig,
  options: PubSubOidcVerifierOptions = {},
) =>
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
      options.sharedJwks
        ? Layer.effect(Jwks.Jwks, sharedJwksService(config))
        : Jwks.layerRemote(jwksOptions(config)),
    ),
    Layer.provide(Signature.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto))),
  );

/** Extract a bearer token from an `Authorization` header value. */
export function bearerToken(header: string | undefined): string | undefined {
  const match = /^Bearer\s+(.+)$/i.exec((header ?? "").trim());

  return match?.[1]?.trim() || undefined;
}
