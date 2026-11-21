import { Context, Data, Effect, Layer, Schema } from "effect";
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

type DecodedJwt = {
  readonly header: JwtHeader;
  readonly claims: AzureJwtClaims;
  readonly signingInput: string;
  readonly signature: Uint8Array;
};

const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;

const DEFAULT_CLOCK_TOLERANCE_SECONDS = 300;

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
): Effect.Effect<void, AzureOidcError> {
  const tolerance = options.clockToleranceSeconds ?? DEFAULT_CLOCK_TOLERANCE_SECONDS;
  const now = Math.floor(Date.now() / 1000);
  const tenantIds = options.tenantIds.map(normalizeTenantId).filter(Boolean);

  if (tenantIds.length === 0)
    return Effect.fail(new AzureOidcError({ message: "At least one Azure tenant ID is required" }));

  if (!tenantIds.includes(claims.tid))
    return Effect.fail(new AzureOidcError({ message: "JWT tenant is not allowed" }));

  if (claims.iss !== azureIssuer(claims.tid))
    return Effect.fail(new AzureOidcError({ message: "JWT issuer is not allowed" }));

  if (claims.exp + tolerance < now)
    return Effect.fail(new AzureOidcError({ message: "JWT is expired" }));

  if (claims.nbf !== undefined && claims.nbf - tolerance > now)
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

export const AzureOidcLive = (config?: { readonly cacheTtlMs?: number }) =>
  Layer.effect(
    AzureOidc,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const ttl = config?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
      const discoveryCache = new Map<string, CacheEntry<AzureOidcDiscovery>>();
      const jwksCache = new Map<string, CacheEntry<JsonWebKeySet>>();

      const getJson = <A>(
        url: string,
        schema: Schema.Decoder<A>,
        label: string,
      ): Effect.Effect<A, AzureOidcError> =>
        Effect.gen(function* () {
          const request = HttpClientRequest.get(url);

          const response = yield* client
            .execute(request)
            .pipe(
              Effect.mapError(
                (cause) => new AzureOidcError({ message: `${label} request failed`, cause }),
              ),
            );

          const text = yield* response.text.pipe(
            Effect.mapError(
              (cause) => new AzureOidcError({ message: `Failed to read ${label} response`, cause }),
            ),
          );

          if (response.status < 200 || response.status > 299) {
            return yield* Effect.fail(
              new AzureOidcError({
                message: `${label} request returned HTTP ${response.status}: ${text}`,
              }),
            );
          }

          const json: Schema.Json = yield* Effect.try({
            try: () => JSON.parse(text),
            catch: (cause) => new AzureOidcError({ message: `Invalid ${label} JSON`, cause }),
          });

          return yield* Schema.decodeUnknownEffect(schema)(json).pipe(
            Effect.mapError(
              (cause) => new AzureOidcError({ message: `Invalid ${label} shape`, cause }),
            ),
          );
        });

      const discovery = (tenantId: string): Effect.Effect<AzureOidcDiscovery, AzureOidcError> =>
        Effect.gen(function* () {
          const tenant = normalizeTenantId(tenantId);
          const cached = discoveryCache.get(tenant);

          if (cached && cached.expiresAt > Date.now()) return cached.value;

          const value = yield* getJson(
            discoveryUrl(tenant),
            AzureOidcDiscovery,
            "Azure OIDC discovery",
          );

          discoveryCache.set(tenant, { value, expiresAt: Date.now() + ttl });

          return value;
        });

      const fetchJwks = (tenantId: string): Effect.Effect<JsonWebKeySet, AzureOidcError> =>
        Effect.gen(function* () {
          const tenant = normalizeTenantId(tenantId);
          const discovered = yield* discovery(tenant);
          const value = yield* getJson(discovered.jwks_uri, JsonWebKeySet, "Azure OIDC JWKS");
          jwksCache.set(tenant, { value, expiresAt: Date.now() + ttl });

          return value;
        });

      const jwks = (tenantId: string): Effect.Effect<JsonWebKeySet, AzureOidcError> =>
        Effect.gen(function* () {
          const tenant = normalizeTenantId(tenantId);
          const cached = jwksCache.get(tenant);

          if (cached && cached.expiresAt > Date.now()) return cached.value;

          return yield* fetchJwks(tenant);
        });

      const validateJwt = (
        token: string,
        options: ValidateAzureJwtOptions,
      ): Effect.Effect<AzureJwtClaims, AzureOidcError> =>
        Effect.gen(function* () {
          const decoded = yield* parseJwt(token);
          yield* validateClaims(decoded.claims, options);
          let keys = yield* jwks(decoded.claims.tid);
          let key = keyForToken(keys, decoded.header.kid);

          if (!key) {
            keys = yield* fetchJwks(decoded.claims.tid);
            key = keyForToken(keys, decoded.header.kid);
          }

          if (!key)
            return yield* Effect.fail(
              new AzureOidcError({ message: "JWT signing key was not found" }),
            );
          yield* verifyRs256(decoded, key);

          return decoded.claims;
        });

      return AzureOidc.of({ discovery, jwks, validateJwt });
    }),
  );

export const AzureOidcFetchLive = (config?: { readonly cacheTtlMs?: number }) =>
  AzureOidcLive(config).pipe(Layer.provide(FetchHttpClient.layer));
