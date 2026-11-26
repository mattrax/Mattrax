import { Effect, Layer, Schema } from "effect";
import { SecureRandom, Signature } from "effect/crypto";
import { JoseError, Jwk, Jwt, Jwks } from "effect/jose";

export type FederatedTokenFailureReason =
  | "malformed"
  | "unsupported"
  | "jwks"
  | "signature"
  | "issuer"
  | "audience"
  | "tenant"
  | "expired"
  | "not_yet_valid";

export class FederatedTokenError extends Schema.TaggedError<FederatedTokenError>()(
  "FederatedTokenError",
  {
    reason: Schema.Literals([
      "malformed",
      "unsupported",
      "jwks",
      "signature",
      "issuer",
      "audience",
      "tenant",
      "expired",
      "not_yet_valid",
    ]),
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export type FederatedTokenFailure = {
  readonly ok: false;
  readonly reason: FederatedTokenFailureReason;
  readonly message: string;
};

export type FederatedEntraClaims = {
  readonly tenantId: string;
  readonly issuer: string;
  readonly audience: ReadonlyArray<string>;
  readonly subject: string;
  readonly objectId?: string;
  readonly userPrincipalName?: string;
  readonly name?: string;
  readonly expiresAt: number;
  readonly issuedAt?: number;
  readonly notBefore?: number;
};

export type FederatedTokenSuccess = {
  readonly ok: true;
  readonly claims: FederatedEntraClaims;
};

export type FederatedTokenValidation = FederatedTokenSuccess | FederatedTokenFailure;

export type FederatedJsonWebKey = {
  readonly kty: string;
  readonly kid?: string;
  readonly use?: string;
  readonly alg?: string;
  readonly n?: string;
  readonly e?: string;
};

export type FederatedJsonWebKeySet = {
  readonly keys: ReadonlyArray<FederatedJsonWebKey>;
};

export type ValidateFederatedEntraTokenOptions = {
  readonly token: string;
  /** Entra tenant the enrollment is bound to. */
  readonly tenantId: string;
  /** Accepted token audience(s), normally the Mattrax app registration id. */
  readonly audience: string | ReadonlyArray<string>;
  /** Override for tests or non-public clouds. */
  readonly issuer?: string;
  /** Injected JWKS; when omitted the tenant's Entra JWKS endpoint is fetched. */
  readonly jwks?: FederatedJsonWebKeySet;
  readonly jwksUri?: string;
  readonly fetch?: typeof globalThis.fetch;
  /** Injectable clock in milliseconds. */
  readonly now?: number;
  readonly clockToleranceSeconds?: number;
  readonly jwksTimeoutMs?: number;
};

export const DEFAULT_CLOCK_TOLERANCE_SECONDS = 300;

export const DEFAULT_JWKS_TIMEOUT_MS = 5_000;

export const JWKS_CACHE_TTL_MS = 60 * 60 * 1_000;

export const JWKS_REFRESH_COOLDOWN_MS = 30_000;

export const JWKS_MAX_RESPONSE_BYTES = 128 * 1024;

export const JWKS_MAX_KEYS = 64;

const MAX_TOKEN_LENGTH = 16 * 1024;

const SignatureLive = Signature.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto));

const EntraClaims = Schema.Struct({
  iss: Schema.String,
  aud: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
  exp: Schema.Finite,
  tid: Schema.String,
  sub: Schema.optional(Schema.String),
  oid: Schema.optional(Schema.String),
  upn: Schema.optional(Schema.String),
  preferred_username: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  iat: Schema.optional(Schema.Finite),
  nbf: Schema.optional(Schema.Finite),
});

const RsaJsonWebKey = Schema.Struct({
  kty: Schema.Literal("RSA"),
  n: Schema.String,
  e: Schema.String,
  kid: Schema.optional(Schema.String),
  alg: Schema.optional(Schema.String),
  use: Schema.optional(Schema.String),
});

const failure = (reason: FederatedTokenFailureReason, message: string): FederatedTokenFailure => ({
  ok: false,
  reason,
  message,
});

const tokenError = (reason: FederatedTokenFailureReason, message: string, cause?: unknown) =>
  new FederatedTokenError({ reason, message, cause });

export const federatedIssuer = (tenantId: string): string =>
  `https://login.microsoftonline.com/${tenantId}/v2.0`;

export const federatedJwksUri = (tenantId: string): string =>
  `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`;

/** The realm is the Entra tenant id; exposed for settings/documentation. */
export const federatedRealm = (tenantId: string): string => tenantId;

/**
 * Tenant-specific STS URL returned in discovery. Entra's WS-Federation
 * endpoint is the conventional `AuthenticationServiceUrl` for a federated
 * Windows enrollment. Deployments that need a different endpoint can inject
 * `federated.authServiceUrl`.
 */
export const federatedAuthServiceUrl = (
  tenantId: string,
  options: { readonly clientId?: string } = {},
): string => {
  const url = new URL(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/wsfed`);

  if (options.clientId) url.searchParams.set("wtrealm", options.clientId);

  return url.toString();
};

const audienceValues = (audience: string | ReadonlyArray<string>): string[] =>
  (Schema.is(Schema.String)(audience) ? [audience] : [...audience]).filter(Boolean);

const claimString = (value: unknown): string | undefined =>
  Schema.is(Schema.String)(value) && value.trim() ? value.trim() : undefined;

const claimNumber = (value: unknown): number | undefined =>
  Schema.is(Schema.Number)(value) && Number.isFinite(value) ? value : undefined;

/** True when the value is a compact JWT that decodes to a header and claims. */
export function isFederatedToken(token: string): boolean {
  if (token.length > MAX_TOKEN_LENGTH) return false;

  return Effect.runSync(
    Jwt.decodeUnverified(token).pipe(
      Effect.as(true),
      Effect.catch(() => Effect.succeed(false)),
    ),
  );
}

/** Decode `tid` without verifying. Only used to route to a tenant before full validation. */
export function unverifiedFederatedTenantId(token: string): string | null {
  if (token.length > MAX_TOKEN_LENGTH) return null;

  return Effect.runSync(
    Jwt.decodeUnverified(token).pipe(
      Effect.map((decoded) => claimString(decoded.claims.tid) ?? null),
      Effect.catch(() => Effect.succeed(null)),
    ),
  );
}

async function readBoundedBody(response: Response): Promise<Schema.Json> {
  if (!response.body) return Schema.decodeUnknownSync(Schema.Json)(await response.json());

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: Array<string> = [];
  let size = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      size += value.byteLength;

      if (size > JWKS_MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Entra JWKS response is too large");
      }

      chunks.push(decoder.decode(value, { stream: true }));
    }

    chunks.push(decoder.decode());

    return JSON.parse(chunks.join("")) as Schema.Json;
  } finally {
    reader.releaseLock();
  }
}

async function fetchJwks(
  uri: string,
  fetchImpl: typeof globalThis.fetch,
  timeoutMs: number,
): Promise<Schema.Json> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(uri, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });

    if (response.status !== 200) {
      throw new Error(`Entra JWKS request returned HTTP ${response.status}`);
    }

    const contentLength = response.headers.get("content-length");

    if (contentLength !== null && Number(contentLength) > JWKS_MAX_RESPONSE_BYTES) {
      throw new Error("Entra JWKS response is too large");
    }

    return await readBoundedBody(response);
  } finally {
    clearTimeout(timeout);
  }
}

interface CacheState {
  value: Jwks.KeySet | undefined;
  expiresAt: number;
  cooldownUntil: number;
  inFlight: Effect.Effect<Jwks.KeySet, FederatedTokenError> | undefined;
}

export interface FederatedTokenVerifier {
  readonly validate: (
    options: ValidateFederatedEntraTokenOptions,
  ) => Effect.Effect<FederatedEntraClaims, FederatedTokenError>;
}

/** Build a verifier whose JWKS cache and refresh cooldown belong to one backend. */
export const makeFederatedTokenVerifier = (
  defaults: {
    readonly fetch?: typeof globalThis.fetch;
    readonly jwksTimeoutMs?: number;
  } = {},
): FederatedTokenVerifier => {
  const states = new Map<string, CacheState>();

  const stateFor = (uri: string): CacheState => {
    let state = states.get(uri);

    if (!state) {
      state = { value: undefined, expiresAt: 0, cooldownUntil: 0, inFlight: undefined };
      states.set(uri, state);
    }

    return state;
  };

  const decodeKeySet = (value: unknown): Effect.Effect<Jwks.KeySet, FederatedTokenError> =>
    Schema.decodeUnknownEffect(Jwks.KeySet)(value).pipe(
      Effect.mapError((cause) =>
        tokenError("jwks", "Entra JWKS response did not contain a valid public key set", cause),
      ),
    );

  const loadJwks = Effect.fnUntraced(function* (
    options: ValidateFederatedEntraTokenOptions,
    force: boolean,
  ) {
    if (options.jwks) return yield* decodeKeySet(options.jwks);

    const uri = options.jwksUri ?? federatedJwksUri(options.tenantId);
    const state = stateFor(uri);
    const now = options.now ?? Date.now();

    if (!force && state.value && state.expiresAt > now) return state.value;
    if (now < state.cooldownUntil) {
      return yield* tokenError("jwks", "Entra JWKS refresh is cooling down");
    }
    if (state.inFlight) return yield* state.inFlight;

    const fetchImpl = options.fetch ?? defaults.fetch ?? globalThis.fetch;

    if (!fetchImpl) return yield* tokenError("jwks", "No fetch implementation is available");

    const request = Effect.gen(function* () {
      const raw = yield* Effect.tryPromise({
        try: () =>
          fetchJwks(
            uri,
            fetchImpl,
            options.jwksTimeoutMs ?? defaults.jwksTimeoutMs ?? DEFAULT_JWKS_TIMEOUT_MS,
          ),
        catch: (cause) => tokenError("jwks", `Entra JWKS request failed: ${String(cause)}`, cause),
      });

      if (
        !Schema.is(Schema.Struct({ keys: Schema.Array(Schema.Unknown) }))(raw) ||
        raw.keys.length > JWKS_MAX_KEYS
      ) {
        return yield* tokenError(
          "jwks",
          "Entra JWKS response has an invalid or oversized keys array",
        );
      }

      return yield* decodeKeySet(raw);
    }).pipe(
      Effect.tap((keySet) =>
        Effect.sync(() => {
          state.value = keySet;
          state.expiresAt = now + JWKS_CACHE_TTL_MS;
          state.cooldownUntil = force ? now + JWKS_REFRESH_COOLDOWN_MS : 0;
        }),
      ),
      Effect.tapError(() =>
        Effect.sync(() => {
          state.cooldownUntil = now + JWKS_REFRESH_COOLDOWN_MS;
        }),
      ),
    );

    const pending = yield* Effect.cached(request);

    state.inFlight = pending;

    return yield* pending.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (state.inFlight === pending) state.inFlight = undefined;
        }),
      ),
    );
  });

  const validate = Effect.fnUntraced(function* (options: ValidateFederatedEntraTokenOptions) {
    if (options.token.length > MAX_TOKEN_LENGTH) {
      return yield* tokenError("malformed", "The federated token is too large");
    }

    const decoded = yield* Jwt.decodeUnverified(options.token).pipe(
      Effect.mapError((cause) =>
        tokenError("malformed", "The federated token is not a JWT", cause),
      ),
    );

    if (decoded.protectedHeader.alg !== "RS256") {
      return yield* tokenError(
        "unsupported",
        `Unsupported token algorithm: ${String(decoded.protectedHeader.alg)}`,
      );
    }

    const tenantId = options.tenantId.trim();

    if (!tenantId) return yield* tokenError("tenant", "An expected Entra tenant id is required");

    const claimTenant = claimString(decoded.claims.tid);

    if (!claimTenant) return yield* tokenError("tenant", "The token has no tenant id (tid) claim");
    if (claimTenant.toLowerCase() !== tenantId.toLowerCase()) {
      return yield* tokenError("tenant", "The token tenant does not match this enrollment");
    }

    const issuer = claimString(decoded.claims.iss);

    if (!issuer) return yield* tokenError("issuer", "The token has no issuer (iss) claim");

    const allowedIssuers = options.issuer
      ? [options.issuer]
      : [federatedIssuer(claimTenant), `https://sts.windows.net/${claimTenant}/`];

    if (!allowedIssuers.includes(issuer)) {
      return yield* tokenError("issuer", "The token issuer is not an Entra issuer for this tenant");
    }

    const audiences = audienceValues(options.audience);

    if (audiences.length === 0)
      return yield* tokenError("audience", "At least one expected token audience is required");

    const now = options.now ?? Date.now();
    const tolerance = options.clockToleranceSeconds ?? DEFAULT_CLOCK_TOLERANCE_SECONDS;
    const expiresAt = claimNumber(decoded.claims.exp);

    if (expiresAt === undefined)
      return yield* tokenError("expired", "The token has no expiry (exp) claim");
    if (expiresAt + tolerance < Math.floor(now / 1000)) {
      return yield* tokenError("expired", "The token is expired");
    }

    const notBefore = claimNumber(decoded.claims.nbf);

    if (notBefore !== undefined && notBefore - tolerance > Math.floor(now / 1000)) {
      return yield* tokenError("not_yet_valid", "The token is not valid yet");
    }

    const kid = decoded.protectedHeader.kid;

    if (!kid) return yield* tokenError("signature", "The token has no key id (kid)");

    let keySet = yield* loadJwks(options, false);
    let jwk = keySet.keys.find((key) => key.kid === kid);

    if (!jwk) {
      keySet = yield* loadJwks(options, true);
      jwk = keySet.keys.find((key) => key.kid === kid);
    }

    if (!jwk)
      return yield* tokenError("signature", "No Entra signing key matches the token key id");
    const rsaJwk = yield* Schema.decodeUnknownEffect(RsaJsonWebKey)(jwk).pipe(
      Effect.mapError(() => tokenError("signature", "The Entra signing key is not an RSA key")),
    );

    const publicKey = yield* Jwk.importPublic(
      {
        kty: rsaJwk.kty,
        n: rsaJwk.n,
        e: rsaJwk.e,
        ...(rsaJwk.kid ? { kid: rsaJwk.kid } : {}),
        ...(rsaJwk.alg ? { alg: rsaJwk.alg } : {}),
        ...(rsaJwk.use ? { use: rsaJwk.use } : {}),
      },
      "RS256",
    ).pipe(
      Effect.mapError((cause) =>
        tokenError("signature", "The Entra signing key is invalid", cause),
      ),
    );

    const verified = yield* Jwt.verify(EntraClaims, options.token, publicKey, {
      issuer: allowedIssuers,
      audience: audiences,
      requiredClaims: ["iss", "aud", "exp"],
      clockTolerance: tolerance * 1000,
    }).pipe(
      Effect.mapError((cause) => {
        if (JoseError.isJoseError(cause)) {
          const reason = cause.reason;

          if (reason._tag === "ClaimValidationFailed") {
            if (reason.claim === "exp") return tokenError("expired", "The token is expired", cause);
            if (reason.claim === "nbf")
              return tokenError("not_yet_valid", "The token is not valid yet", cause);
            if (reason.claim === "iss")
              return tokenError("issuer", "The token issuer is not allowed", cause);
            if (reason.claim === "aud")
              return tokenError("audience", "The token audience is not allowed", cause);
          }
          if (reason._tag === "SignatureVerificationFailed")
            return tokenError("signature", "The token signature is invalid", cause);
          if (reason._tag === "KeyNotFound" || reason._tag === "AmbiguousKey")
            return tokenError("signature", "The Entra signing key could not be selected", cause);
          if (reason._tag === "AlgorithmNotAllowed")
            return tokenError("unsupported", "The token algorithm is not allowed", cause);
          if (reason._tag === "InvalidToken")
            return tokenError("malformed", "The federated token is malformed", cause);
        }

        return tokenError("malformed", "The federated token claims are invalid", cause);
      }),
    );

    const claims = verified.claims;

    if (claims.tid.toLowerCase() !== tenantId.toLowerCase()) {
      return yield* tokenError("tenant", "The token tenant does not match this enrollment");
    }

    const subject =
      claimString(claims.oid) ?? claimString(claims.sub) ?? claimString(claims.preferred_username);

    if (!subject) return yield* tokenError("malformed", "The token has no subject claim");

    return {
      tenantId: claims.tid,
      issuer: claims.iss,
      audience: Schema.is(Schema.String)(claims.aud) ? [claims.aud] : claims.aud,
      subject,
      objectId: claimString(claims.oid),
      userPrincipalName: claimString(claims.upn) ?? claimString(claims.preferred_username),
      name: claimString(claims.name),
      expiresAt: claims.exp,
      issuedAt: claimNumber(claims.iat),
      notBefore: claimNumber(claims.nbf),
    };
  }, Effect.provide(SignatureLive));

  return { validate };
};

/**
 * Validate an Entra token. This compatibility API keeps the existing result
 * union; new backend code uses {@link makeFederatedTokenVerifier} so failures
 * remain in the Effect error channel and the cache belongs to that backend.
 */
export async function validateFederatedEntraToken(
  options: ValidateFederatedEntraTokenOptions,
): Promise<FederatedTokenValidation> {
  const result = await Effect.runPromise(
    makeFederatedTokenVerifier().validate(options).pipe(Effect.result),
  );

  if (result._tag === "Failure") {
    const error = result.failure;

    if (error instanceof FederatedTokenError) return failure(error.reason, error.message);

    return failure("malformed", "The federated token could not be validated");
  }

  return { ok: true, claims: result.success };
}
