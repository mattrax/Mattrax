import { Clock, Context, Data, Effect, Exit, Layer, Option, Schema, Stream } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import type { HttpClientResponse } from "effect/http";
import type { GoogleWorkspaceCredentials, GoogleWorkspaceConfigError } from "./config.js";
import { redactGoogleCredentials } from "./config.js";
import { GOOGLE_TOKEN_URL, signServiceAccountAssertion } from "./jwt.js";

/** A failed Google Directory/token request. Messages never contain credentials. */
export class GoogleWorkspaceError extends Data.TaggedError("GoogleWorkspaceError")<{
  message: string;
  kind?: "configuration" | "transport" | "timeout" | "response" | "decode";
  status?: number;
  retryAfterMs?: number;
  retryable?: boolean;
  cause?: unknown;
}> {}

export type GoogleDirectoryUser = {
  readonly id: string;
  readonly primaryEmail: string;
  readonly name: string;
  readonly suspended: boolean;
  readonly archived: boolean;
  /** The account was deleted upstream and appears only with `showDeleted`. */
  readonly deleted: boolean;
  readonly orgUnitPath?: string;
  readonly isAdmin: boolean;
};

export type GoogleDirectoryGroup = {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly description?: string;
  /** Absent when Google omits the count; callers then must fetch members. */
  readonly directMembersCount?: number;
};

export type GoogleGroupMember = {
  readonly id: string;
  readonly email?: string;
  readonly type: string;
};

export type GoogleWorkspaceService = {
  readonly listUsers: (
    pageToken?: string | null,
  ) => Effect.Effect<
    { readonly users: ReadonlyArray<GoogleDirectoryUser>; readonly nextPageToken?: string },
    GoogleWorkspaceError
  >;
  readonly listGroups: (
    pageToken?: string | null,
  ) => Effect.Effect<
    { readonly groups: ReadonlyArray<GoogleDirectoryGroup>; readonly nextPageToken?: string },
    GoogleWorkspaceError
  >;
  readonly listGroupMembers: (
    groupKey: string,
    pageToken?: string | null,
  ) => Effect.Effect<
    { readonly members: ReadonlyArray<GoogleGroupMember>; readonly nextPageToken?: string },
    GoogleWorkspaceError
  >;
  /** Every member of one group, bounded to 100 pages. */
  readonly listAllGroupMembers: (
    groupKey: string,
  ) => Effect.Effect<ReadonlyArray<GoogleGroupMember>, GoogleWorkspaceError>;
  /** Resolve one person by primary email or Workspace id; null when absent. */
  readonly getUser: (
    key: string,
  ) => Effect.Effect<GoogleDirectoryUser | null, GoogleWorkspaceError>;
  /** Validate the credentials with one small directory read. */
  readonly validate: () => Effect.Effect<
    { readonly ok: true; readonly message: string },
    GoogleWorkspaceError
  >;
};

const optionalString = Schema.optional(Schema.NullOr(Schema.String));

const optionalBoolean = Schema.optional(Schema.NullOr(Schema.Boolean));

const GoogleUserName = Schema.Struct({
  fullName: optionalString,
  givenName: optionalString,
  familyName: optionalString,
});

const GoogleUserWire = Schema.Struct({
  id: Schema.String,
  primaryEmail: Schema.String,
  name: Schema.optional(Schema.NullOr(GoogleUserName)),
  suspended: optionalBoolean,
  archived: optionalBoolean,
  deletionTime: optionalString,
  orgUnitPath: optionalString,
  isAdmin: optionalBoolean,
});

type GoogleUserWire = typeof GoogleUserWire.Type;

const GoogleGroupWire = Schema.Struct({
  id: Schema.String,
  email: optionalString,
  name: optionalString,
  description: optionalString,
  directMembersCount: Schema.optional(Schema.NullOr(Schema.String)),
});

type GoogleGroupWire = typeof GoogleGroupWire.Type;

const GoogleMemberWire = Schema.Struct({
  id: optionalString,
  email: optionalString,
  type: optionalString,
});

const GoogleUserList = Schema.Struct({
  users: Schema.optional(Schema.NullOr(Schema.Array(GoogleUserWire))),
  nextPageToken: optionalString,
});

const GoogleGroupList = Schema.Struct({
  groups: Schema.optional(Schema.NullOr(Schema.Array(GoogleGroupWire))),
  nextPageToken: optionalString,
});

const GoogleMemberList = Schema.Struct({
  members: Schema.optional(Schema.NullOr(Schema.Array(GoogleMemberWire))),
  nextPageToken: optionalString,
});

const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  expires_in: Schema.optional(Schema.NullOr(Schema.Union([Schema.Number, Schema.String]))),
});

export const mapGoogleUser = (wire: GoogleUserWire): GoogleDirectoryUser => {
  const email = wire.primaryEmail.trim().toLowerCase();

  const name =
    wire.name?.fullName?.trim() ||
    [wire.name?.givenName, wire.name?.familyName].filter(Boolean).join(" ").trim() ||
    email;

  return {
    id: wire.id,
    primaryEmail: email,
    name,
    suspended: wire.suspended === true,
    archived: wire.archived === true,
    deleted: Boolean(wire.deletionTime),
    ...(wire.orgUnitPath ? { orgUnitPath: wire.orgUnitPath } : {}),
    isAdmin: wire.isAdmin === true,
  };
};

export const mapGoogleGroup = (wire: GoogleGroupWire): GoogleDirectoryGroup => {
  const email = (wire.email ?? "").trim().toLowerCase();
  const directMembersCount = Number(wire.directMembersCount);

  return {
    id: wire.id,
    email,
    name: wire.name?.trim() || email || wire.id,
    ...(wire.description ? { description: wire.description } : {}),
    ...(wire.directMembersCount !== undefined &&
    wire.directMembersCount !== null &&
    Number.isFinite(directMembersCount)
      ? { directMembersCount }
      : {}),
  };
};

const GoogleErrorBody = Schema.Struct({
  error: Schema.optional(
    Schema.Union([
      Schema.String,
      Schema.Struct({
        status: Schema.optional(Schema.String),
        message: Schema.optional(Schema.String),
      }),
    ]),
  ),
});

/**
 * Extract only the provider's own error code/message. The body is untrusted, so
 * it is parsed with a schema instead of being indexed as a dictionary.
 */
const errorCode = (body: string): string | undefined => {
  const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(GoogleErrorBody))(body);

  if (Option.isNone(decoded)) return undefined;

  const error = decoded.value.error;

  if (error === undefined) return undefined;

  if (Schema.is(Schema.String)(error)) return error;

  return error.status ?? error.message;
};

const errorMessage = (label: string, body: string, status: number): string => {
  const code = errorCode(body)?.replaceAll(/\s+/g, " ").trim().slice(0, 300);

  return code
    ? `${label} rejected the request (HTTP ${status}): ${code}`
    : `${label} rejected the request (HTTP ${status}).`;
};

const isRateLimited = (status: number, body: string): boolean =>
  status === 429 ||
  status >= 500 ||
  (status === 403 &&
    /rateLimitExceeded|userRateLimitExceeded|quotaExceeded|backendError/i.test(body));

const parseRetryAfter = (value: string | undefined, nowMs: number): number | undefined => {
  if (!value) return undefined;
  const seconds = Number(value);

  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);

  if (Number.isNaN(date)) return undefined;

  return Math.max(0, date - nowMs);
};

export type GoogleWorkspaceServiceOptions = {
  readonly credentials: GoogleWorkspaceCredentials;
  /** Test/proxy seam for the convenience constructor; the service itself uses HttpClient. */
  readonly fetch?: typeof globalThis.fetch;
  /** Deadline for each HTTP attempt, including reading the response body. */
  readonly timeoutMs?: number;
  /** Maximum accepted response body size. */
  readonly maxResponseBytes?: number;
  /** Injectable jitter, for deterministic backoff tests. */
  readonly jitter?: () => number;
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly baseUrl?: string;
  readonly tokenUrl?: string;
};

const DEFAULT_BASE_URL = "https://admin.googleapis.com";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const TOKEN_EXPIRY_SKEW_MS = 60_000;

const httpClientLayer = (fetchImpl?: typeof globalThis.fetch) =>
  fetchImpl === undefined
    ? FetchHttpClient.layer
    : FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchImpl)));

type RawResponse = {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly text: string;
};

type CachedToken = {
  readonly token: string;
  readonly ttlMs: number;
};

/**
 * A Google Workspace Admin SDK (Directory API) client.
 *
 * The service requires Effect's HttpClient. Each attempt has a deadline that
 * covers both headers and body, response bytes are bounded, and all JSON is
 * Schema-decoded. Access tokens are shared by concurrent callers and refreshed
 * once when Google rejects a cached token.
 */
export class GoogleWorkspace extends Context.Service<GoogleWorkspace, GoogleWorkspaceService>()(
  "@mattrax/google-workspace/GoogleWorkspace",
) {
  static readonly layer = (options: GoogleWorkspaceServiceOptions) =>
    Layer.effect(
      GoogleWorkspace,
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        const maxResponseBytes = Math.max(
          1,
          options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
        );
        const jitter = options.jitter ?? (() => Math.random() * 250);
        const maxAttempts = Math.max(1, options.maxAttempts ?? 4);
        const baseDelayMs = Math.max(0, options.baseDelayMs ?? 500);
        const maxDelayMs = Math.max(0, options.maxDelayMs ?? 8_000);
        const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
        const tokenUrl = options.tokenUrl ?? GOOGLE_TOKEN_URL;
        const safe = (message: string) => redactGoogleCredentials(message, options.credentials);

        const readBoundedText = (
          response: HttpClientResponse.HttpClientResponse,
          label: string,
        ): Effect.Effect<string, GoogleWorkspaceError> => {
          const declaredLength = Number(response.headers["content-length"]);

          if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes)
            return Effect.fail(
              new GoogleWorkspaceError({
                kind: "response",
                message: `The ${label} response exceeded ${maxResponseBytes} bytes.`,
              }),
            );

          return Stream.runFoldEffect(
            response.stream,
            () => ({ bytes: 0, text: "", decoder: new TextDecoder() }),
            (state, chunk) => {
              const bytes = state.bytes + chunk.byteLength;

              if (bytes > maxResponseBytes)
                return Effect.fail(
                  new GoogleWorkspaceError({
                    kind: "response",
                    message: `The ${label} response exceeded ${maxResponseBytes} bytes.`,
                  }),
                );

              return Effect.succeed({
                bytes,
                text: state.text + state.decoder.decode(chunk, { stream: true }),
                decoder: state.decoder,
              });
            },
          ).pipe(
            Effect.map((state) => state.text + state.decoder.decode()),
            Effect.mapError((cause) =>
              cause instanceof GoogleWorkspaceError
                ? cause
                : new GoogleWorkspaceError({
                    kind: "transport",
                    message: `The ${label} response could not be read.`,
                    retryable: true,
                    cause,
                  }),
            ),
          );
        };

        const execute = (
          request: HttpClientRequest.HttpClientRequest,
          label: string,
        ): Effect.Effect<RawResponse, GoogleWorkspaceError> =>
          Effect.gen(function* () {
            const response = yield* client.execute(request).pipe(
              Effect.mapError(
                (cause) =>
                  new GoogleWorkspaceError({
                    kind: "transport",
                    message: `${label} could not be reached.`,
                    retryable: true,
                    cause,
                  }),
              ),
            );
            const text = yield* readBoundedText(response, label);

            return { status: response.status, headers: response.headers, text };
          }).pipe(
            Effect.timeoutOrElse({
              duration: timeoutMs,
              orElse: () =>
                Effect.fail(
                  new GoogleWorkspaceError({
                    kind: "timeout",
                    message: `${label} timed out after ${timeoutMs}ms.`,
                    retryable: true,
                  }),
                ),
            }),
          );

        const retryDelay = (error: GoogleWorkspaceError, attempt: number): number =>
          Math.min(maxDelayMs, error.retryAfterMs ?? baseDelayMs * 2 ** attempt + jitter());

        const decodeJson = <T>(
          text: string,
          schema: Schema.Decoder<T>,
          message: string,
        ): Effect.Effect<T, GoogleWorkspaceError> =>
          Effect.gen(function* () {
            const json = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json))(
              text,
            );

            return yield* Schema.decodeUnknownEffect(schema)(json);
          }).pipe(
            Effect.mapError(
              () =>
                new GoogleWorkspaceError({
                  kind: "decode",
                  message,
                }),
            ),
          );

        const tokenRequest: Effect.Effect<CachedToken, GoogleWorkspaceError> = Effect.gen(
          function* () {
            const assertion = yield* signServiceAccountAssertion({
              serviceAccount: options.credentials.serviceAccount,
              adminEmail: options.credentials.adminEmail,
              audience: tokenUrl,
            }).pipe(
              Effect.mapError(
                (error) =>
                  new GoogleWorkspaceError({
                    kind: "configuration",
                    message: safe(error.message),
                    cause: error,
                  }),
              ),
            );

            const request = HttpClientRequest.post(tokenUrl).pipe(
              HttpClientRequest.bodyUrlParams({
                grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
                assertion: assertion.assertion,
              }),
            );

            let lastError: GoogleWorkspaceError | undefined;

            for (let attempt = 0; attempt < maxAttempts; attempt++) {
              const result = yield* execute(request, "The Google token endpoint").pipe(
                Effect.map((raw) => ({ raw, error: undefined })),
                Effect.catch((error) => Effect.succeed({ raw: undefined, error })),
              );

              if (result.error) {
                lastError = result.error;

                if (attempt === maxAttempts - 1 || !result.error.retryable) break;

                yield* Effect.sleep(retryDelay(lastError, attempt));
                continue;
              }

              const raw = result.raw!;

              if (raw.status >= 200 && raw.status <= 299) {
                const decoded = yield* decodeJson(
                  raw.text,
                  TokenResponse,
                  "The Google token endpoint returned an unexpected response.",
                );

                const expiresIn = Number(decoded.expires_in ?? 3_600);
                const lifetimeMs =
                  (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3_600) * 1_000;

                return {
                  token: decoded.access_token,
                  ttlMs: Math.max(0, lifetimeMs - TOKEN_EXPIRY_SKEW_MS),
                };
              }

              lastError = new GoogleWorkspaceError({
                kind: "response",
                message: safe(errorMessage("The Google token endpoint", raw.text, raw.status)),
                status: raw.status,
                retryAfterMs: parseRetryAfter(
                  raw.headers["retry-after"],
                  yield* Clock.currentTimeMillis,
                ),
                retryable: isRateLimited(raw.status, raw.text),
              });

              if (attempt === maxAttempts - 1 || !lastError.retryable) break;

              yield* Effect.sleep(retryDelay(lastError, attempt));
            }

            return yield* Effect.fail(
              lastError ??
                new GoogleWorkspaceError({
                  kind: "response",
                  message: "The Google token endpoint rejected the request.",
                }),
            );
          },
        );

        const [accessToken, invalidateAccessToken] = yield* Effect.cachedInvalidateWithTTL(
          tokenRequest,
          (exit) => (Exit.isSuccess(exit) ? exit.value.ttlMs : 0),
        );

        const requestJson = <T>(
          url: string,
          schema: Schema.Decoder<T>,
        ): Effect.Effect<T, GoogleWorkspaceError> =>
          Effect.gen(function* () {
            let lastError: GoogleWorkspaceError | undefined;
            let refreshed = false;

            for (let attempt = 0; attempt < maxAttempts; attempt++) {
              const token = (yield* accessToken).token;
              const request = HttpClientRequest.get(url).pipe(
                HttpClientRequest.bearerToken(token),
                HttpClientRequest.acceptJson,
              );
              const result = yield* execute(request, "Google Workspace").pipe(
                Effect.map((raw) => ({ raw, error: undefined })),
                Effect.catch((error) => Effect.succeed({ raw: undefined, error })),
              );

              if (result.error) {
                lastError = result.error;

                if (attempt === maxAttempts - 1 || !lastError.retryable) break;

                yield* Effect.sleep(retryDelay(lastError, attempt));
                continue;
              }

              const raw = result.raw!;

              if (raw.status >= 200 && raw.status <= 299)
                return yield* decodeJson(
                  raw.text,
                  schema,
                  "Google Workspace returned an unexpected response.",
                );

              lastError = new GoogleWorkspaceError({
                kind: "response",
                message: safe(errorMessage("Google Workspace", raw.text, raw.status)),
                status: raw.status,
                retryAfterMs: parseRetryAfter(
                  raw.headers["retry-after"],
                  yield* Clock.currentTimeMillis,
                ),
                retryable: isRateLimited(raw.status, raw.text),
              });

              if (raw.status === 401 && !refreshed) {
                refreshed = true;
                yield* invalidateAccessToken;
                continue;
              }

              if (attempt === maxAttempts - 1 || !lastError.retryable) break;

              yield* Effect.sleep(retryDelay(lastError, attempt));
            }

            return yield* Effect.fail(
              lastError ??
                new GoogleWorkspaceError({ message: "Google Workspace request failed." }),
            );
          });

        const directoryUrl = (path: string, query: Record<string, string | undefined>): string => {
          const url = new URL(`${baseUrl}/admin/directory/v1${path}`);

          for (const [key, value] of Object.entries(query))
            if (value !== undefined) url.searchParams.set(key, value);

          return url.toString();
        };

        const listUsers: GoogleWorkspaceService["listUsers"] = (pageToken) =>
          requestJson(
            directoryUrl("/users", {
              customer: options.credentials.customer,
              maxResults: "200",
              showDeleted: "true",
              pageToken: pageToken ?? undefined,
            }),
            GoogleUserList,
          ).pipe(
            Effect.map((page) => ({
              users: (page.users ?? []).map(mapGoogleUser),
              ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}),
            })),
          );

        const listGroups: GoogleWorkspaceService["listGroups"] = (pageToken) =>
          requestJson(
            directoryUrl("/groups", {
              customer: options.credentials.customer,
              maxResults: "200",
              pageToken: pageToken ?? undefined,
            }),
            GoogleGroupList,
          ).pipe(
            Effect.map((page) => ({
              groups: (page.groups ?? []).map(mapGoogleGroup),
              ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}),
            })),
          );

        const listGroupMembers: GoogleWorkspaceService["listGroupMembers"] = (
          groupKey,
          pageToken,
        ) =>
          requestJson(
            directoryUrl(`/groups/${encodeURIComponent(groupKey)}/members`, {
              maxResults: "200",
              pageToken: pageToken ?? undefined,
            }),
            GoogleMemberList,
          ).pipe(
            Effect.map((page) => ({
              members: (page.members ?? [])
                // Nested groups and customer principals are not people. The shared
                // pipeline only links directory users.
                .filter((member) => !member.type || member.type.toUpperCase() === "USER")
                .flatMap((member) =>
                  member.id
                    ? [
                        {
                          id: member.id,
                          ...(member.email ? { email: member.email.toLowerCase() } : {}),
                          type: member.type ?? "USER",
                        },
                      ]
                    : [],
                ),
              ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}),
            })),
          );

        const listAllGroupMembers: GoogleWorkspaceService["listAllGroupMembers"] = (groupKey) =>
          Effect.gen(function* () {
            const members: GoogleGroupMember[] = [];
            let pageToken: string | undefined;

            for (let page = 0; page < 100; page++) {
              const result = yield* listGroupMembers(groupKey, pageToken);

              members.push(...result.members);

              if (!result.nextPageToken) return members;
              pageToken = result.nextPageToken;
            }

            return yield* Effect.fail(
              new GoogleWorkspaceError({
                message: "A group exceeded 100 membership pages.",
              }),
            );
          }).pipe(
            // A group deleted between list and member calls simply has no members;
            // the next group listing reconciles it away.
            Effect.catchTag("GoogleWorkspaceError", (error) =>
              error.status === 404 ? Effect.succeed([]) : Effect.fail(error),
            ),
          );

        const getUser: GoogleWorkspaceService["getUser"] = (key) =>
          requestJson(directoryUrl(`/users/${encodeURIComponent(key)}`, {}), GoogleUserWire).pipe(
            Effect.map(mapGoogleUser),
            Effect.catchTag("GoogleWorkspaceError", (error) =>
              error.status === 404 ? Effect.succeed(null) : Effect.fail(error),
            ),
          );

        const validate: GoogleWorkspaceService["validate"] = () =>
          Effect.gen(function* () {
            const page = yield* listUsers();

            return {
              ok: true as const,
              message: `Google Workspace is reachable; ${page.users.length} user(s) visible on the first page.`,
            };
          });

        return GoogleWorkspace.of({
          listUsers,
          listGroups,
          listGroupMembers,
          listAllGroupMembers,
          getUser,
          validate,
        });
      }),
    );
}

/** Build a client with the runtime fetch transport, or an injected test/proxy fetch. */
export const makeGoogleWorkspaceService = (
  options: GoogleWorkspaceServiceOptions,
): Effect.Effect<GoogleWorkspaceService> =>
  Effect.gen(function* () {
    return yield* GoogleWorkspace;
  }).pipe(
    Effect.provide(GoogleWorkspace.layer(options)),
    Effect.provide(httpClientLayer(options.fetch)),
  );

/** Turn a config error into the service error shape used by sync. */
export const googleConfigFailure = (error: GoogleWorkspaceConfigError): GoogleWorkspaceError =>
  new GoogleWorkspaceError({ kind: "configuration", message: error.message, cause: error });
