import { Context, Data, Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { pemDecode } from "@mattrax/crypto";

/** OAuth scope required for every Android Management API call. */
export const ANDROID_MANAGEMENT_SCOPE = "https://www.googleapis.com/auth/androidmanagement";

/** Google's default token endpoint for service account JWTs. */
export const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";

const JWT_LIFETIME_SECONDS = 60 * 60;
const TOKEN_EXPIRY_SKEW_MS = 60 * 1000;
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
};

export type BuildJwtOptions = {
  readonly clientEmail: string;
  readonly privateKeyPem: string;
  readonly audience?: string;
  readonly scope?: string;
  /** Current time in seconds; defaults to `Date.now() / 1000`. */
  readonly issuedAt?: number;
  readonly lifetimeSeconds?: number;
};

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** Base64url-encode a string or raw bytes (no padding), as JWT requires. */
export function base64UrlEncode(input: string | Uint8Array | ArrayBuffer): string {
  const bytes =
    typeof input === "string"
      ? textEncoder.encode(input)
      : input instanceof Uint8Array
        ? input
        : new Uint8Array(input);
  return bytesToBase64Url(bytes);
}

function normalizePem(pem: string): string {
  return pem.includes("\\n") ? pem.replace(/\\n/g, "\n") : pem;
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
    const issuedAt = options.issuedAt ?? Math.floor(Date.now() / 1000);
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
  expires_in: Schema.optional(Schema.Number),
  token_type: Schema.optional(Schema.String),
  scope: Schema.optional(Schema.String),
});

function errorDetail(text: string): string {
  try {
    const json = JSON.parse(text) as unknown;
    if (typeof json === "object" && json !== null) {
      const record = json as Record<string, unknown>;
      const error = record["error"];
      if (typeof error === "string") {
        const description = record["error_description"];
        return typeof description === "string" ? `${error}: ${description}` : error;
      }
      if (typeof error === "object" && error !== null) {
        const message = (error as Record<string, unknown>)["message"];
        if (typeof message === "string") return message;
      }
    }
  } catch {
    // Fall through to the raw body.
  }
  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}

/**
 * Exchange a signed service account JWT at Google's token endpoint using the
 * `urn:ietf:params:oauth:grant-type:jwt-bearer` grant.
 */
export function exchangeServiceAccountJwt(options: {
  readonly tokenUri: string;
  readonly assertion: string;
  readonly client: HttpClient.HttpClient;
}): Effect.Effect<AccessToken, GoogleApiError> {
  return Effect.gen(function* () {
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: options.assertion,
    }).toString();
    const request = HttpClientRequest.post(options.tokenUri).pipe(
      HttpClientRequest.setHeader("content-type", "application/x-www-form-urlencoded"),
      HttpClientRequest.bodyText(body),
    );
    const response = yield* options.client
      .execute(request)
      .pipe(
        Effect.mapError(
          (cause) => new GoogleApiError({ message: "Google token request failed", cause }),
        ),
      );
    const text = yield* response.text.pipe(
      Effect.mapError(
        (cause) => new GoogleApiError({ message: "Failed to read Google token response", cause }),
      ),
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
      try: () => JSON.parse(text) as unknown,
      catch: (cause) => new GoogleApiError({ message: "Invalid Google token JSON", cause }),
    });
    const decoded = yield* (
      Schema.decodeUnknownEffect(TokenResponse)(json) as Effect.Effect<
        typeof TokenResponse.Type,
        unknown
      >
    ).pipe(
      Effect.mapError(
        (cause) => new GoogleApiError({ message: "Invalid Google token response shape", cause }),
      ),
    );
    const lifetimeSeconds = decoded.expires_in ?? JWT_LIFETIME_SECONDS;
    return {
      accessToken: decoded.access_token,
      tokenType: decoded.token_type ?? "Bearer",
      expiresAt: Date.now() + lifetimeSeconds * 1000 - TOKEN_EXPIRY_SKEW_MS,
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
  readonly schema: Schema.Schema<A>;
  /** Human-readable name used in error messages. */
  readonly label?: string;
};

export type AuthorizedVoidRequest = Omit<AuthorizedRequest<never>, "schema">;

export interface GoogleAuthShape {
  /** Returns a cached access token, refreshing when it is within 60s of expiry. */
  readonly accessToken: () => Effect.Effect<AccessToken, GoogleError>;
  /** Performs an authorized request and decodes the JSON response. */
  readonly authorizedFetch: <A>(request: AuthorizedRequest<A>) => Effect.Effect<A, GoogleError>;
  /** Performs an authorized request, accepting any 2xx response and no body. */
  readonly authorizedFetchVoid: (
    request: AuthorizedVoidRequest,
  ) => Effect.Effect<void, GoogleError>;
}

export class GoogleAuth extends Context.Service<GoogleAuth, GoogleAuthShape>()("GoogleAuth") {}

export const GoogleAuthLive = (config: ServiceAccountConfig) =>
  Layer.effect(
    GoogleAuth,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const tokenUri = config.tokenUri ?? DEFAULT_TOKEN_URI;
      let cached: AccessToken | undefined;

      const accessToken = () =>
        Effect.gen(function* () {
          if (cached && cached.expiresAt > Date.now()) return cached;
          const assertion = yield* buildServiceAccountJwt({
            clientEmail: config.clientEmail,
            privateKeyPem: config.privateKeyPem,
            audience: tokenUri,
            scope: ANDROID_MANAGEMENT_SCOPE,
          });
          const token = yield* exchangeServiceAccountJwt({ tokenUri, assertion, client });
          cached = token;
          return token;
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
          const response = yield* client
            .execute(httpRequest)
            .pipe(
              Effect.mapError((cause) => new GoogleApiError({ message: `${label} failed`, cause })),
            );
          const text = yield* response.text.pipe(
            Effect.mapError(
              (cause) => new GoogleApiError({ message: `Failed to read ${label} response`, cause }),
            ),
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
        schema: Schema.Schema<A>,
        label: string,
      ): Effect.Effect<A, GoogleApiError> =>
        Effect.gen(function* () {
          if (text.trim() === "") {
            return yield* Effect.fail(
              new GoogleApiError({ message: `${label} returned an empty body` }),
            );
          }
          const json = yield* Effect.try({
            try: () => JSON.parse(text) as unknown,
            catch: (cause) => new GoogleApiError({ message: `Invalid ${label} JSON`, cause }),
          });
          return yield* (
            Schema.decodeUnknownEffect(schema)(json) as Effect.Effect<A, unknown>
          ).pipe(
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
export const GoogleAuthFetchLive = (config: ServiceAccountConfig) =>
  GoogleAuthLive(config).pipe(Layer.provide(FetchHttpClient.layer));
