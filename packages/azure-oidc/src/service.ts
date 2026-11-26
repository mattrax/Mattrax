import {
  Clock,
  Context,
  Data,
  Deferred,
  Effect,
  Exit,
  Layer,
  Option,
  Schema,
  Stream,
} from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { AzureJwtClaims, AzureOidcDiscovery, JsonWebKeySet, JwtHeader } from "./schema.js";
import type { JsonWebKey } from "./schema.js";

export class AzureOidcError extends Data.TaggedError("AzureOidcError")<{
  message: string;
  cause?: unknown;
}> {}

export type ValidateAzureJwtOptions = {
  readonly tenantIds: ReadonlyArray<string>;
  readonly audience?: string | ReadonlyArray<string>;
  readonly clockToleranceSeconds?: number;
};

export type AzureOidcConfig = {
  readonly cacheTtlMs?: number;
  /** Minimum time between unknown-key refreshes and retries after a failed fetch. */
  readonly cooldownMs?: number;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly maxKeys?: number;
};

export class AzureOidc extends Context.Service<
  AzureOidc,
  {
    readonly discovery: (tenantId: string) => Effect.Effect<AzureOidcDiscovery, AzureOidcError>;
    readonly jwks: (tenantId: string) => Effect.Effect<JsonWebKeySet, AzureOidcError>;
    readonly validateJwt: (
      token: string,
      options: ValidateAzureJwtOptions,
    ) => Effect.Effect<AzureJwtClaims, AzureOidcError>;
  }
>()("AzureOidc") {}

type CacheEntry<T> = {
  readonly value: T;
  readonly expiresAt: number;
};

type CacheState<T> = {
  entry?: CacheEntry<T>;
  pending?: Deferred.Deferred<CacheEntry<T>, AzureOidcError>;
  lastAttempt: number;
  lastFailed: boolean;
};

type DecodedJwt = {
  readonly header: JwtHeader;
  readonly claims: AzureJwtClaims;
  readonly signingInput: string;
  readonly signature: Uint8Array;
};

const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;

const DEFAULT_CLOCK_TOLERANCE_SECONDS = 300;

const DEFAULT_COOLDOWN_MS = 30_000;

const DEFAULT_TIMEOUT_MS = 5_000;

const DEFAULT_MAX_RESPONSE_BYTES = 128 * 1024;

const DEFAULT_MAX_KEYS = 64;

const MAX_JWT_BYTES = 16 * 1024;

const AZURE_LOGIN_ORIGIN = "https://login.microsoftonline.com";

const textEncoder = new TextEncoder();

export function azureIssuer(tenantId: string): string {
  return `https://login.microsoftonline.com/${tenantId}/v2.0`;
}

function discoveryUrl(tenantId: string): string {
  return `${azureIssuer(tenantId)}/.well-known/openid-configuration`;
}

function normalizeTenantId(tenantId: string): string {
  return tenantId.trim();
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);

  new Uint8Array(buffer).set(bytes);

  return buffer;
}

function parseHttpsUrl(input: string): Effect.Effect<URL, AzureOidcError> {
  return Effect.try({
    try: () => {
      const url = new URL(input);

      if (
        url.protocol !== "https:" ||
        url.username !== "" ||
        url.password !== "" ||
        url.hash !== ""
      ) {
        throw new Error("URL is not a credential-free HTTPS URL");
      }

      return url;
    },
    catch: (cause) =>
      new AzureOidcError({
        message: "Azure OIDC endpoint must be HTTPS without credentials or a fragment",
        cause,
      }),
  });
}

function logOidcFailure(
  tenantId: string,
  operation: string,
  error: AzureOidcError,
): Effect.Effect<void> {
  // Never log endpoint URLs, response bodies, tokens, keys, or error causes.
  return Effect.logWarning("azure_oidc.request_failed", {
    tenantId,
    operation,
    error: error._tag,
  });
}

function base64UrlToBytes(input: string): Uint8Array {
  const padded = input
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(input.length + ((4 - (input.length % 4)) % 4), "=");

  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  return bytes;
}

function base64UrlJson(input: string): Schema.Json {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(input)));
}

function parseJwt(token: string): Effect.Effect<DecodedJwt, AzureOidcError> {
  return Effect.gen(function* () {
    if (token.length > MAX_JWT_BYTES) {
      return yield* Effect.fail(
        new AzureOidcError({ message: `JWT exceeds ${MAX_JWT_BYTES} bytes` }),
      );
    }

    const parts = token.split(".");

    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
      return yield* Effect.fail(
        new AzureOidcError({ message: "JWT must have header, payload, and signature" }),
      );
    }

    const header = yield* Schema.decodeUnknownEffect(JwtHeader)(base64UrlJson(parts[0])).pipe(
      Effect.mapError((cause) => new AzureOidcError({ message: "Invalid JWT header", cause })),
    );

    const claims = yield* Schema.decodeUnknownEffect(AzureJwtClaims)(base64UrlJson(parts[1])).pipe(
      Effect.mapError((cause) => new AzureOidcError({ message: "Invalid JWT claims", cause })),
    );

    return {
      header,
      claims,
      signingInput: `${parts[0]}.${parts[1]}`,
      signature: base64UrlToBytes(parts[2]),
    };
  }).pipe(
    Effect.catchDefect((cause) =>
      Effect.fail(new AzureOidcError({ message: "Invalid JWT encoding", cause })),
    ),
  );
}

function keyForToken(jwks: JsonWebKeySet, kid: string): JsonWebKey | null {
  return jwks.keys.find((key) => key.kid === kid) ?? null;
}

function hasAudience(claims: AzureJwtClaims, audience: string): boolean {
  return Array.isArray(claims.aud) ? claims.aud.includes(audience) : claims.aud === audience;
}

function validateClaims(
  claims: AzureJwtClaims,
  options: ValidateAzureJwtOptions,
  nowSeconds: number,
): Effect.Effect<void, AzureOidcError> {
  const tolerance = options.clockToleranceSeconds ?? DEFAULT_CLOCK_TOLERANCE_SECONDS;
  const tenantIds = options.tenantIds.map(normalizeTenantId).filter(Boolean);

  if (tenantIds.length === 0)
    return Effect.fail(new AzureOidcError({ message: "At least one Azure tenant ID is required" }));

  if (!tenantIds.includes(claims.tid))
    return Effect.fail(new AzureOidcError({ message: "JWT tenant is not allowed" }));

  if (claims.iss !== azureIssuer(claims.tid))
    return Effect.fail(new AzureOidcError({ message: "JWT issuer is not allowed" }));

  if (claims.exp + tolerance < nowSeconds)
    return Effect.fail(new AzureOidcError({ message: "JWT is expired" }));

  if (claims.nbf !== undefined && claims.nbf - tolerance > nowSeconds)
    return Effect.fail(new AzureOidcError({ message: "JWT is not active yet" }));

  if (options.audience !== undefined) {
    const audiences = Array.isArray(options.audience) ? options.audience : [options.audience];

    if (!audiences.some((audience) => hasAudience(claims, audience))) {
      return Effect.fail(new AzureOidcError({ message: "JWT audience is not allowed" }));
    }
  }

  return Effect.void;
}

function verifyRs256(decoded: DecodedJwt, jwk: JsonWebKey): Effect.Effect<void, AzureOidcError> {
  return Effect.tryPromise({
    try: async () => {
      if (decoded.header.alg !== "RS256")
        throw new Error(`Unsupported JWT algorithm: ${decoded.header.alg}`);

      if (jwk.kty !== "RSA") throw new Error(`Unsupported JWK type: ${jwk.kty}`);

      const key = await crypto.subtle.importKey(
        "jwk",
        { kty: jwk.kty, n: jwk.n, e: jwk.e, ext: true },
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      );

      const valid = await crypto.subtle.verify(
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        key,
        toArrayBuffer(decoded.signature),
        toArrayBuffer(textEncoder.encode(decoded.signingInput)),
      );

      if (!valid) throw new Error("Invalid JWT signature");
    },
    catch: (cause) => new AzureOidcError({ message: "JWT signature validation failed", cause }),
  });
}

export const AzureOidcLive = (config?: AzureOidcConfig) =>
  Layer.effect(
    AzureOidc,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const scope = yield* Effect.scope;
      const ttl = config?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
      const cooldownMs = config?.cooldownMs ?? DEFAULT_COOLDOWN_MS;
      const timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const maxResponseBytes = config?.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
      const maxKeys = config?.maxKeys ?? DEFAULT_MAX_KEYS;

      if (!Number.isFinite(ttl) || ttl < 0) {
        return yield* Effect.fail(
          new AzureOidcError({ message: "cacheTtlMs must be non-negative" }),
        );
      }
      if (!Number.isFinite(cooldownMs) || cooldownMs < 0) {
        return yield* Effect.fail(
          new AzureOidcError({ message: "cooldownMs must be non-negative" }),
        );
      }
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
        return yield* Effect.fail(
          new AzureOidcError({ message: "timeoutMs must be a positive integer" }),
        );
      }
      if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) {
        return yield* Effect.fail(
          new AzureOidcError({ message: "maxResponseBytes must be a positive integer" }),
        );
      }
      if (!Number.isSafeInteger(maxKeys) || maxKeys <= 0) {
        return yield* Effect.fail(
          new AzureOidcError({ message: "maxKeys must be a positive integer" }),
        );
      }

      const getJson = <A>(
        url: string,
        schema: Schema.Decoder<A>,
        label: string,
        keyLimit?: number,
      ): Effect.Effect<A, AzureOidcError> =>
        Effect.gen(function* () {
          const endpoint = yield* parseHttpsUrl(url);
          const defaults = yield* Effect.serviceOption(FetchHttpClient.RequestInit);
          const response = yield* client.execute(HttpClientRequest.get(endpoint.href)).pipe(
            Effect.provideService(FetchHttpClient.RequestInit, {
              ...Option.getOrUndefined(defaults),
              redirect: "manual",
            }),
            Effect.mapError(
              (cause) => new AzureOidcError({ message: label + " request failed", cause }),
            ),
          );

          if (response.status !== 200) {
            return yield* Effect.fail(
              new AzureOidcError({
                message: label + " request returned HTTP " + response.status,
              }),
            );
          }
          if (response.url !== endpoint.href) {
            return yield* Effect.fail(
              new AzureOidcError({ message: label + " response came from another URL" }),
            );
          }

          const body = new Uint8Array(maxResponseBytes);
          const length = yield* Stream.runFoldEffect(
            response.stream,
            () => 0,
            (length, chunk) => {
              if (chunk.byteLength > body.byteLength - length) {
                return Effect.fail(
                  new AzureOidcError({
                    message: label + " response exceeds " + maxResponseBytes + " bytes",
                  }),
                );
              }

              body.set(chunk, length);

              return Effect.succeed(length + chunk.byteLength);
            },
          ).pipe(
            Effect.mapError((cause) =>
              cause instanceof AzureOidcError
                ? cause
                : new AzureOidcError({ message: "Failed to read " + label + " response", cause }),
            ),
          );
          const text = new TextDecoder().decode(body.subarray(0, length));
          const json: unknown = yield* Effect.try({
            try: () => JSON.parse(text),
            catch: (cause) => new AzureOidcError({ message: "Invalid " + label + " JSON", cause }),
          });

          if (
            keyLimit !== undefined &&
            typeof json === "object" &&
            json !== null &&
            "keys" in json &&
            Array.isArray(json.keys) &&
            json.keys.length > keyLimit
          ) {
            return yield* Effect.fail(
              new AzureOidcError({
                message: label + " response has more than " + keyLimit + " keys",
              }),
            );
          }

          return yield* Schema.decodeUnknownEffect(schema)(json).pipe(
            Effect.mapError(
              (cause) => new AzureOidcError({ message: "Invalid " + label + " shape", cause }),
            ),
          );
        }).pipe(
          Effect.scoped,
          Effect.timeoutOrElse({
            duration: timeoutMs,
            orElse: () =>
              Effect.fail(
                new AzureOidcError({
                  message: "Azure OIDC request timed out after " + timeoutMs + "ms",
                }),
              ),
          }),
        );

      const makeLoader = <T>(
        label: string,
        fetchEntry: (tenant: string) => Effect.Effect<CacheEntry<T>, AzureOidcError>,
      ) => {
        const states = new Map<string, CacheState<T>>();
        const stateFor = (tenant: string): CacheState<T> => {
          const existing = states.get(tenant);

          if (existing !== undefined) return existing;

          const created: CacheState<T> = {
            lastAttempt: Number.NEGATIVE_INFINITY,
            lastFailed: false,
          };
          states.set(tenant, created);

          return created;
        };

        const refresh = (
          tenant: string,
          stale?: CacheEntry<T>,
        ): Effect.Effect<CacheEntry<T> | undefined, AzureOidcError> =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;

            return yield* Effect.uninterruptibleMask((restore) =>
              Effect.suspend((): Effect.Effect<CacheEntry<T> | undefined, AzureOidcError> => {
                const state = stateFor(tenant);

                if (
                  state.entry !== undefined &&
                  state.entry !== stale &&
                  state.entry.expiresAt > now
                ) {
                  return Effect.succeed(state.entry);
                }
                if (state.pending !== undefined) {
                  return restore(Deferred.await(state.pending));
                }
                if (
                  (stale !== undefined || state.lastFailed) &&
                  now - state.lastAttempt < cooldownMs
                ) {
                  return Effect.succeed(undefined);
                }

                state.lastAttempt = now;
                const pending = Deferred.makeUnsafe<CacheEntry<T>, AzureOidcError>();
                state.pending = pending;
                const task = Deferred.complete(
                  pending,
                  fetchEntry(tenant).pipe(
                    Effect.onExit((exit) =>
                      Effect.sync(() => {
                        state.pending = undefined;
                        state.lastFailed = Exit.isFailure(exit);

                        if (Exit.isSuccess(exit)) state.entry = exit.value;
                      }),
                    ),
                  ),
                ).pipe(Effect.asVoid);

                return Effect.gen(function* () {
                  yield* Effect.forkIn(task, scope);

                  return yield* restore(Deferred.await(pending));
                });
              }),
            );
          });

        const getEntry = (tenant: string): Effect.Effect<CacheEntry<T>, AzureOidcError> =>
          Effect.gen(function* () {
            const state = stateFor(tenant);
            const now = yield* Clock.currentTimeMillis;
            const cached = state.entry;

            if (cached !== undefined && cached.expiresAt > now) return cached;

            const entry = yield* refresh(tenant);

            if (entry === undefined) {
              return yield* Effect.fail(
                new AzureOidcError({
                  message: label + " is cooling down after a failed fetch",
                }),
              );
            }

            return entry;
          });

        return { getEntry, refresh };
      };

      const fetchDiscovery = (
        tenant: string,
      ): Effect.Effect<CacheEntry<AzureOidcDiscovery>, AzureOidcError> =>
        Effect.gen(function* () {
          const value = yield* getJson(
            discoveryUrl(tenant),
            AzureOidcDiscovery,
            "Azure OIDC discovery",
          );

          if (value.issuer !== azureIssuer(tenant)) {
            return yield* Effect.fail(
              new AzureOidcError({ message: "Azure OIDC discovery returned an unexpected issuer" }),
            );
          }

          const keysUrl = yield* parseHttpsUrl(value.jwks_uri);

          if (keysUrl.origin !== AZURE_LOGIN_ORIGIN) {
            return yield* Effect.fail(
              new AzureOidcError({
                message: "Azure OIDC discovery returned an unexpected JWKS origin",
              }),
            );
          }

          const now = yield* Clock.currentTimeMillis;

          return { value, expiresAt: now + ttl };
        }).pipe(Effect.tapError((error) => logOidcFailure(tenant, "discovery", error)));

      const discoveryLoader = makeLoader("Azure OIDC discovery", fetchDiscovery);

      const fetchJwks = (
        tenant: string,
      ): Effect.Effect<CacheEntry<JsonWebKeySet>, AzureOidcError> =>
        Effect.gen(function* () {
          const discovered = yield* discoveryLoader.getEntry(tenant);
          const value = yield* getJson(
            discovered.value.jwks_uri,
            JsonWebKeySet,
            "Azure OIDC JWKS",
            maxKeys,
          );
          const now = yield* Clock.currentTimeMillis;

          return { value, expiresAt: now + ttl };
        }).pipe(Effect.tapError((error) => logOidcFailure(tenant, "jwks", error)));

      const jwksLoader = makeLoader("Azure OIDC JWKS", fetchJwks);

      const discovery = (tenantId: string): Effect.Effect<AzureOidcDiscovery, AzureOidcError> =>
        discoveryLoader
          .getEntry(normalizeTenantId(tenantId))
          .pipe(Effect.map((entry) => entry.value));

      const jwks = (tenantId: string): Effect.Effect<JsonWebKeySet, AzureOidcError> =>
        jwksLoader.getEntry(normalizeTenantId(tenantId)).pipe(Effect.map((entry) => entry.value));

      const validateJwt = (
        token: string,
        options: ValidateAzureJwtOptions,
      ): Effect.Effect<AzureJwtClaims, AzureOidcError> =>
        Effect.gen(function* () {
          const decoded = yield* parseJwt(token);
          const now = yield* Clock.currentTimeMillis;
          yield* validateClaims(decoded.claims, options, Math.floor(now / 1000));

          const tenant = normalizeTenantId(decoded.claims.tid);
          let entry = yield* jwksLoader.getEntry(tenant);
          let key = keyForToken(entry.value, decoded.header.kid);

          if (key === null) {
            const refreshed = yield* jwksLoader.refresh(tenant, entry);

            if (refreshed === undefined) {
              yield* Effect.logWarning("azure_oidc.jwks_refresh_skipped", {
                tenantId: tenant,
                reason: "cooldown",
              });

              return yield* Effect.fail(
                new AzureOidcError({ message: "JWT signing key was not found" }),
              );
            }

            entry = refreshed;
            key = keyForToken(entry.value, decoded.header.kid);
          }

          if (key === null) {
            return yield* Effect.fail(
              new AzureOidcError({ message: "JWT signing key was not found" }),
            );
          }

          yield* verifyRs256(decoded, key);

          return decoded.claims;
        });

      return AzureOidc.of({ discovery, jwks, validateJwt });
    }),
  );

/** @deprecated Supply HttpClient at the composition root; retained as an alias. */
export const AzureOidcFetchLive = AzureOidcLive;
