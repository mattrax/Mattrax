import { Clock, Context, Data, Duration, Effect, Exit, Layer, Option, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { pemDecode } from "@mattrax/crypto";

/** OAuth scope required for every Android Management API call. */
export const ANDROID_MANAGEMENT_SCOPE = "https://www.googleapis.com/auth/androidmanagement";

/** Google's default token endpoint for service account JWTs. */
export const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";

const JWT_LIFETIME_SECONDS = 60 * 60;

const TOKEN_EXPIRY_SKEW_MS = 60 * 1000;

/** Header and body deadlines applied to every Google HTTP request. */
export type GoogleHttpTimeouts = {
  /** Time to receive response headers. Defaults to 10 seconds. */
  readonly headers?: Duration.Input;
  /** Time to consume the response body. Defaults to 30 seconds. */
  readonly body?: Duration.Input;
};

const DEFAULT_HTTP_TIMEOUTS = {
  headers: "10 seconds",
  body: "30 seconds",
} as const;

type ResolvedHttpTimeouts = {
  readonly headers: number;
  readonly body: number;
};

const textEncoder = new TextEncoder();

export class GoogleAuthError extends Data.TaggedError("GoogleAuthError")<{
  message: string;
  cause?: unknown;
}> {}

export class GoogleApiError extends Data.TaggedError("GoogleApiError")<{
  message: string;
  status?: number;
  cause?: unknown;
}> {}

export type GoogleError = GoogleAuthError | GoogleApiError;

/** A cached OAuth access token. `expiresAt` is an epoch millisecond timestamp. */
export type AccessToken = {
  readonly accessToken: string;
  readonly tokenType: string;
  readonly expiresAt: number;
};

/** Service account credentials used to mint access tokens. */
export type ServiceAccountConfig = {
  readonly clientEmail: string;
  /** PKCS#8 PEM ("-----BEGIN PRIVATE KEY-----"). Literal `\n` is tolerated. */
  readonly privateKeyPem: string;
  readonly projectId: string;
  readonly tokenUri?: string;
  readonly httpTimeouts?: GoogleHttpTimeouts;
};

export type BuildJwtOptions = {
  readonly clientEmail: string;
  readonly privateKeyPem: string;
  readonly audience?: string;
  readonly scope?: string;
  /** Current time in seconds; defaults to the Effect clock. */
  readonly issuedAt?: number;
  readonly lifetimeSeconds?: number;
};

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";

  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll(/=+$/g, "");
}

/** Base64url-encode a string or raw bytes (no padding), as JWT requires. */
export function base64UrlEncode(input: string | Uint8Array | ArrayBuffer): string {
  const bytes = Schema.is(Schema.String)(input)
    ? textEncoder.encode(input)
    : input instanceof Uint8Array
      ? input
      : new Uint8Array(input);

  return bytesToBase64Url(bytes);
}

function normalizePem(pem: string): string {
  return pem.includes(String.raw`\n`) ? pem.replaceAll(String.raw`\n`, "\n") : pem;
}

/** Import a service account PKCS#8 RSA private key for RS256 signing. */
export function importServiceAccountKey(
  privateKeyPem: string,
): Effect.Effect<CryptoKey, GoogleAuthError> {
  return Effect.tryPromise({
    try: async () =>
      crypto.subtle.importKey(
        "pkcs8",
        pemDecode("PRIVATE KEY", normalizePem(privateKeyPem)),
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"],
      ),
    catch: (cause) =>
      new GoogleAuthError({
        message: "Failed to import the service account private key (expected PKCS#8 PEM)",
        cause,
      }),
  });
}

/**
 * Build a signed RS256 service account assertion.
 *
 * Claims follow Google's JWT bearer flow: `iss`, `scope`, `aud`, `iat`, `exp`.
 */
export function buildServiceAccountJwt(
  options: BuildJwtOptions,
): Effect.Effect<string, GoogleAuthError> {
  return Effect.gen(function* () {
    const audience = options.audience ?? DEFAULT_TOKEN_URI;
    const scope = options.scope ?? ANDROID_MANAGEMENT_SCOPE;
    const issuedAt = options.issuedAt ?? Math.floor((yield* Clock.currentTimeMillis) / 1000);
    const lifetime = options.lifetimeSeconds ?? JWT_LIFETIME_SECONDS;
    const key = yield* importServiceAccountKey(options.privateKeyPem);

    const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));

    const claims = base64UrlEncode(
      JSON.stringify({
        iss: options.clientEmail,
        scope,
        aud: audience,
        iat: issuedAt,
        exp: issuedAt + lifetime,
      }),
    );

    const signingInput = `${header}.${claims}`;

    const signature = yield* Effect.tryPromise({
      try: () =>
        crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, textEncoder.encode(signingInput)),
      catch: (cause) => new GoogleAuthError({ message: "Failed to sign the JWT", cause }),
    });

    return `${signingInput}.${bytesToBase64Url(new Uint8Array(signature))}`;
  });
}

const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  expires_in: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  token_type: Schema.optional(Schema.String),
  scope: Schema.optional(Schema.String),
});

function errorDetail(text: string): string {
  try {
    const json: Schema.Json = Schema.decodeUnknownSync(Schema.Json)(JSON.parse(text));

    if (Schema.is(Schema.JsonObject)(json)) {
      const error = json["error"];

      if (Schema.is(Schema.String)(error)) {
        const description = json["error_description"];

        return Schema.is(Schema.String)(description) ? `${error}: ${description}` : error;
      }

      if (Schema.is(Schema.JsonObject)(error)) {
        const message = error["message"];

        if (Schema.is(Schema.String)(message)) return message;
      }
    }
  } catch {
    // Fall through to the raw body.
  }

  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}

const resolveHttpTimeouts = Effect.fnUntraced(function* (
  timeouts: GoogleHttpTimeouts | undefined,
): Effect.fn.Return<ResolvedHttpTimeouts, GoogleApiError> {
  const resolve = (name: keyof GoogleHttpTimeouts, fallback: Duration.Input) =>
    Effect.gen(function* () {
      const duration = Duration.fromInput(timeouts?.[name] ?? fallback);

      if (Option.isNone(duration)) {
        return yield* Effect.fail(
          new GoogleApiError({ message: `Google HTTP ${name} timeout is invalid` }),
        );
      }

      const millis = Duration.toMillis(duration.value);

      if (!Number.isFinite(millis) || millis <= 0) {
        return yield* Effect.fail(
          new GoogleApiError({
            message: `Google HTTP ${name} timeout must be positive and finite`,
          }),
        );
      }

      return millis;
    });

  return {
    headers: yield* resolve("headers", DEFAULT_HTTP_TIMEOUTS.headers),
    body: yield* resolve("body", DEFAULT_HTTP_TIMEOUTS.body),
  };
});

const withDeadline =
  (duration: number, message: string) =>
  <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E | GoogleApiError> =>
    effect.pipe(
      Effect.timeoutOrElse({
        duration,
        orElse: () => Effect.fail(new GoogleApiError({ message })),
      }),
    );

/**
 * Exchange a signed service account JWT at Google's token endpoint using the
 * `urn:ietf:params:oauth:grant-type:jwt-bearer` grant.
 */
export function exchangeServiceAccountJwt(options: {
  readonly tokenUri: string;
  readonly assertion: string;
  readonly client: HttpClient.HttpClient;
  readonly timeouts?: GoogleHttpTimeouts;
}): Effect.Effect<AccessToken, GoogleApiError> {
  return Effect.gen(function* () {
    const timeouts = yield* resolveHttpTimeouts(options.timeouts);
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: options.assertion,
    }).toString();

    const request = HttpClientRequest.post(options.tokenUri).pipe(
      HttpClientRequest.setHeader("content-type", "application/x-www-form-urlencoded"),
      HttpClientRequest.bodyText(body),
    );

    const response = yield* options.client.execute(request).pipe(
      Effect.mapError(
        (cause) => new GoogleApiError({ message: "Google token request failed", cause }),
      ),
      withDeadline(timeouts.headers, "Google token request timed out waiting for headers"),
    );

    const text = yield* response.text.pipe(
      Effect.mapError(
        (cause) => new GoogleApiError({ message: "Failed to read Google token response", cause }),
      ),
      withDeadline(timeouts.body, "Google token response body timed out"),
    );

    if (response.status < 200 || response.status > 299) {
      return yield* Effect.fail(
        new GoogleApiError({
          message: `Google token endpoint returned HTTP ${response.status}: ${errorDetail(text)}`,
          status: response.status,
        }),
      );
    }

    const json = yield* Effect.try({
      try: () => Schema.decodeUnknownSync(Schema.Json)(JSON.parse(text)),
      catch: (cause) => new GoogleApiError({ message: "Invalid Google token JSON", cause }),
    });

    const decoded = yield* Schema.decodeUnknownEffect(TokenResponse)(json).pipe(
      Effect.mapError(
        (cause) => new GoogleApiError({ message: "Invalid Google token response shape", cause }),
      ),
    );

    const lifetimeSeconds = decoded.expires_in ?? JWT_LIFETIME_SECONDS;
    const now = yield* Clock.currentTimeMillis;

    return {
      accessToken: decoded.access_token,
      tokenType: decoded.token_type ?? "Bearer",
      expiresAt: now + lifetimeSeconds * 1000 - TOKEN_EXPIRY_SKEW_MS,
    } satisfies AccessToken;
  });
}

export type AuthorizedMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** Description of an authenticated Android Management API request. */
export type AuthorizedRequest<A> = {
  readonly method?: AuthorizedMethod;
  readonly url: string;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  /** Schema used to decode the JSON response body. */
  readonly schema: Schema.Codec<A>;
  /** Human-readable name used in error messages. */
  readonly label?: string;
};

export type AuthorizedVoidRequest = Omit<AuthorizedRequest<never>, "schema">;

const TOKEN_CACHE_LIMIT = 8;

/**
 * Shareable Android Management access-token cache. Keyed by the service account
 * identity and key material, so a certificate/key rotation cannot reuse the old
 * token. Supply one across request graphs to reuse tokens within an isolate.
 */
export type GoogleTokenCache = {
  readonly get: (key: string, now: number) => AccessToken | undefined;
  readonly set: (key: string, token: AccessToken) => void;
  readonly delete: (key: string) => void;
  readonly load: (
    key: string,
    load: Effect.Effect<AccessToken, GoogleError>,
  ) => Effect.Effect<AccessToken, GoogleError>;
};

export const makeGoogleTokenCache = (
  options: { readonly maxEntries?: number } = {},
): GoogleTokenCache => {
  const maxEntries =
    options.maxEntries !== undefined && options.maxEntries > 0
      ? Math.floor(options.maxEntries)
      : TOKEN_CACHE_LIMIT;
  const entries = new Map<string, AccessToken>();
  const flights = new Map<string, Effect.Effect<AccessToken, GoogleError>>();

  return {
    get: (key, now) => {
      const entry = entries.get(key);

      if (!entry) return undefined;

      if (entry.expiresAt <= now) {
        entries.delete(key);

        return undefined;
      }

      // Refresh insertion order so capacity evicts the least-recently used key.
      entries.delete(key);
      entries.set(key, entry);

      return entry;
    },
    set: (key, token) => {
      entries.delete(key);
      entries.set(key, token);

      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;

        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    delete: (key) => {
      entries.delete(key);
    },
    load: (key, load) =>
      Effect.gen(function* () {
        const inFlight = flights.get(key);

        if (inFlight) return yield* inFlight;

        const cached = yield* Effect.cached(load);

        // `Effect.cached` already shares one run and only interrupts it when
        // every waiter has left. Forget the completed run so the next expired
        // token starts fresh, but leave interrupted runs in place to retry.
        const entry: Effect.Effect<AccessToken, GoogleError> = cached.pipe(
          Effect.onExit((exit) =>
            Exit.hasInterrupts(exit)
              ? Effect.void
              : Effect.sync(() => {
                  if (flights.get(key) === entry) flights.delete(key);
                }),
          ),
        );
        flights.set(key, entry);

        return yield* entry;
      }),
  };
};

export interface GoogleAuthService {
  /** Returns a cached access token, refreshing when it is within 60s of expiry. */
  readonly accessToken: () => Effect.Effect<AccessToken, GoogleError>;
  /** Performs an authorized request and decodes the JSON response. */
  readonly authorizedFetch: <A>(request: AuthorizedRequest<A>) => Effect.Effect<A, GoogleError>;
  /** Performs an authorized request, accepting any 2xx response and no body. */
  readonly authorizedFetchVoid: (
    request: AuthorizedVoidRequest,
  ) => Effect.Effect<void, GoogleError>;
}

export class GoogleAuth extends Context.Service<GoogleAuth, GoogleAuthService>()("GoogleAuth") {}

export type GoogleAuthLiveOptions = {
  /** Supply one cache across rebuilt request layers to reuse tokens per isolate. */
  readonly tokenCache?: GoogleTokenCache;
};

const tokenCacheKey = (config: ServiceAccountConfig): string =>
  [
    config.clientEmail,
    config.projectId,
    config.tokenUri ?? DEFAULT_TOKEN_URI,
    config.privateKeyPem,
  ].join("\0");

export const GoogleAuthLive = (config: ServiceAccountConfig, options: GoogleAuthLiveOptions = {}) =>
  Layer.effect(
    GoogleAuth,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const tokenUri = config.tokenUri ?? DEFAULT_TOKEN_URI;
      // Layer configuration is static; an invalid deadline is a programmer
      // error rather than a per-request failure.
      const timeouts = yield* resolveHttpTimeouts(config.httpTimeouts).pipe(Effect.orDie);
      const cache = options.tokenCache ?? makeGoogleTokenCache();
      const cacheKey = tokenCacheKey(config);

      const refresh = Effect.fnUntraced(function* (): Effect.fn.Return<AccessToken, GoogleError> {
        const assertion = yield* buildServiceAccountJwt({
          clientEmail: config.clientEmail,
          privateKeyPem: config.privateKeyPem,
          audience: tokenUri,
          scope: ANDROID_MANAGEMENT_SCOPE,
        });

        return yield* exchangeServiceAccountJwt({
          tokenUri,
          assertion,
          client,
          timeouts,
        });
      });

      const accessToken = () =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const cached = cache.get(cacheKey, now);

          if (cached) return cached;

          const entry = yield* cache.load(cacheKey, refresh());

          cache.set(cacheKey, entry);

          return entry;
        });

      const send = (request: AuthorizedVoidRequest) =>
        Effect.gen(function* () {
          const label = request.label ?? `${request.method ?? "GET"} ${request.url}`;
          const token = yield* accessToken();

          let httpRequest = HttpClientRequest.make(request.method ?? "GET")(request.url).pipe(
            HttpClientRequest.bearerToken(token.accessToken),
          );

          for (const [name, value] of Object.entries(request.headers ?? {})) {
            httpRequest = HttpClientRequest.setHeader(httpRequest, name, value);
          }

          if (request.body !== undefined) {
            httpRequest = HttpClientRequest.bodyText(
              httpRequest,
              JSON.stringify(request.body),
              "application/json",
            );
          }

          const response = yield* client.execute(httpRequest).pipe(
            Effect.mapError((cause) => new GoogleApiError({ message: `${label} failed`, cause })),
            withDeadline(timeouts.headers, `${label} timed out waiting for headers`),
          );

          // Revocation or a rotated key invalidates the cached token.
          if (response.status === 401) cache.delete(cacheKey);

          const text = yield* response.text.pipe(
            Effect.mapError(
              (cause) => new GoogleApiError({ message: `Failed to read ${label} response`, cause }),
            ),
            withDeadline(timeouts.body, `${label} response body timed out`),
          );

          if (response.status < 200 || response.status > 299) {
            return yield* Effect.fail(
              new GoogleApiError({
                message: `${label} returned HTTP ${response.status}: ${errorDetail(text)}`,
                status: response.status,
              }),
            );
          }

          return text;
        });

      const decodeJson = <A>(
        text: string,
        schema: Schema.Codec<A>,
        label: string,
      ): Effect.Effect<A, GoogleApiError> =>
        Effect.gen(function* () {
          if (text.trim() === "") {
            return yield* Effect.fail(
              new GoogleApiError({ message: `${label} returned an empty body` }),
            );
          }

          const json = yield* Effect.try({
            try: () => Schema.decodeUnknownSync(Schema.Json)(JSON.parse(text)),
            catch: (cause) => new GoogleApiError({ message: `Invalid ${label} JSON`, cause }),
          });

          return yield* Schema.decodeUnknownEffect(schema)(json).pipe(
            Effect.mapError(
              (cause) => new GoogleApiError({ message: `Invalid ${label} shape`, cause }),
            ),
          );
        });

      return GoogleAuth.of({
        accessToken,
        authorizedFetch: <A>(request: AuthorizedRequest<A>) =>
          Effect.gen(function* () {
            const label = request.label ?? `${request.method ?? "GET"} ${request.url}`;
            const text = yield* send(request);

            return yield* decodeJson(text, request.schema, label);
          }),
        authorizedFetchVoid: (request: AuthorizedVoidRequest) => send(request).pipe(Effect.asVoid),
      });
    }),
  );

/** `GoogleAuthLive` with the platform fetch client wired in. */
export const GoogleAuthFetchLive = (
  config: ServiceAccountConfig,
  options: GoogleAuthLiveOptions = {},
) => GoogleAuthLive(config, options).pipe(Layer.provide(FetchHttpClient.layer));
