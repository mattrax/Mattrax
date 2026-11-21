import { Data, Effect, Option, Schema } from "effect";
import type { GoogleWorkspaceCredentials, GoogleWorkspaceConfigError } from "./config.js";
import { redactGoogleCredentials } from "./config.js";
import { GOOGLE_TOKEN_URL, signServiceAccountAssertion } from "./jwt.js";

/** A failed Google Directory/token request. Messages never contain credentials. */
export class GoogleWorkspaceError extends Data.TaggedError("GoogleWorkspaceError")<{
  message: string;
  status?: number;
  retryAfterMs?: number;
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

const errorMessage = (body: string, status: number): string => {
  const code = errorCode(body);
  const snippet = body.replaceAll(/\s+/g, " ").trim().slice(0, 300);

  if (code) return `Google Workspace rejected the request (HTTP ${status}): ${code}`;

  return snippet
    ? `Google Workspace rejected the request (HTTP ${status}): ${snippet}`
    : `Google Workspace rejected the request (HTTP ${status}).`;
};

const isRateLimited = (status: number, body: string): boolean =>
  status === 429 ||
  status >= 500 ||
  (status === 403 &&
    /rateLimitExceeded|userRateLimitExceeded|quotaExceeded|backendError/i.test(body));

const parseRetryAfter = (value: string | null, nowMs: number): number | undefined => {
  if (!value) return undefined;
  const seconds = Number(value);

  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);

  if (Number.isNaN(date)) return undefined;

  return Math.max(0, date - nowMs);
};

type ServiceOptions = {
  readonly credentials: GoogleWorkspaceCredentials;
  readonly fetch?: typeof globalThis.fetch;
  /** Injectable clock (ms) for deterministic tests. */
  readonly now?: () => number;
  /** Injectable delay, so tests do not wait for real backoff. */
  readonly sleep?: (durationMs: number) => Effect.Effect<void>;
  /** Injectable jitter, for deterministic backoff tests. */
  readonly jitter?: () => number;
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly baseUrl?: string;
  readonly tokenUrl?: string;
};

const DEFAULT_BASE_URL = "https://admin.googleapis.com";

const TOKEN_EXPIRY_SKEW_MS = 60_000;

/**
 * A Google Workspace Admin SDK (Directory API) client.
 *
 * Auth is a service-account JWT with domain-wide delegation: the deployment (or
 * tenant) stores the JSON key, and every call impersonates the configured
 * admin. Access tokens are cached in memory until shortly before expiry; the
 * key never leaves the process.
 */
export const makeGoogleWorkspaceService = (options: ServiceOptions): GoogleWorkspaceService => {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((durationMs: number) => Effect.sleep(durationMs));
  const jitter = options.jitter ?? (() => Math.random() * 250);
  const maxAttempts = Math.max(1, options.maxAttempts ?? 4);
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 8_000;
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const tokenUrl = options.tokenUrl ?? GOOGLE_TOKEN_URL;

  let cached: { readonly token: string; readonly expiresAt: number } | undefined;

  const safe = (message: string) => redactGoogleCredentials(message, options.credentials);

  const tokenRequest = (): Effect.Effect<
    { readonly token: string; readonly expiresAt: number },
    GoogleWorkspaceError
  > =>
    Effect.gen(function* () {
      const assertion = yield* signServiceAccountAssertion({
        serviceAccount: options.credentials.serviceAccount,
        adminEmail: options.credentials.adminEmail,
        audience: tokenUrl,
      }).pipe(
        Effect.mapError(
          (error) => new GoogleWorkspaceError({ message: safe(error.message), cause: error }),
        ),
      );

      const body = new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: assertion.assertion,
      });

      let lastError: GoogleWorkspaceError | undefined;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const response = yield* Effect.tryPromise({
          try: () =>
            fetchImpl(tokenUrl, {
              method: "POST",
              headers: { "content-type": "application/x-www-form-urlencoded" },
              body,
            }),
          catch: (cause) =>
            new GoogleWorkspaceError({
              message: "The Google token endpoint could not be reached.",
              cause,
            }),
        });

        const text = yield* Effect.tryPromise({
          try: () => response.text(),
          catch: (cause) =>
            new GoogleWorkspaceError({
              message: "The Google token response could not be read.",
              cause,
            }),
        });

        if (response.ok) {
          const decoded = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(TokenResponse))(
            text,
          ).pipe(
            Effect.mapError(
              () =>
                new GoogleWorkspaceError({
                  message: "The Google token endpoint returned an unexpected response.",
                }),
            ),
          );

          const expiresIn = Number(decoded.expires_in ?? 3_600);

          return {
            token: decoded.access_token,
            expiresAt:
              now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3_600) * 1_000,
          };
        }

        lastError = new GoogleWorkspaceError({
          message: safe(errorMessage(text, response.status)),
          status: response.status,
          retryAfterMs: parseRetryAfter(response.headers.get("retry-after"), now()),
        });

        if (attempt === maxAttempts - 1 || !isRateLimited(response.status, text)) break;

        const delay = Math.min(
          maxDelayMs,
          lastError.retryAfterMs ?? baseDelayMs * 2 ** attempt + jitter(),
        );

        yield* sleep(delay);
      }

      return yield* Effect.fail(
        lastError ??
          new GoogleWorkspaceError({ message: "The Google token endpoint rejected the request." }),
      );
    });

  const accessToken = (): Effect.Effect<string, GoogleWorkspaceError> =>
    Effect.gen(function* () {
      const current = cached;

      if (current && current.expiresAt - TOKEN_EXPIRY_SKEW_MS > now()) return current.token;

      const next = yield* tokenRequest();

      cached = next;

      return next.token;
    });

  const requestJson = <T>(
    url: string,
    schema: Schema.Decoder<T>,
  ): Effect.Effect<T, GoogleWorkspaceError> =>
    Effect.gen(function* () {
      let lastError: GoogleWorkspaceError | undefined;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const token = yield* accessToken();

        const response = yield* Effect.tryPromise({
          try: () =>
            fetchImpl(url, {
              headers: { authorization: `Bearer ${token}`, accept: "application/json" },
            }),
          catch: (cause) =>
            new GoogleWorkspaceError({
              message: "Google Workspace could not be reached.",
              cause,
            }),
        });

        const text = yield* Effect.tryPromise({
          try: () => response.text(),
          catch: (cause) =>
            new GoogleWorkspaceError({
              message: "The Google Workspace response could not be read.",
              cause,
            }),
        });

        if (response.ok) {
          return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(text).pipe(
            Effect.mapError(
              () =>
                new GoogleWorkspaceError({
                  message: "Google Workspace returned an unexpected response.",
                }),
            ),
          );
        }

        lastError = new GoogleWorkspaceError({
          message: safe(errorMessage(text, response.status)),
          status: response.status,
          retryAfterMs: parseRetryAfter(response.headers.get("retry-after"), now()),
        });

        if (response.status === 401 && attempt < maxAttempts - 1) {
          // A revoked/expired token is worth one refresh; the assertion itself
          // may also be rejected, in which case the next response is final.
          cached = undefined;
          continue;
        }

        if (attempt === maxAttempts - 1 || !isRateLimited(response.status, text)) break;

        const delay = Math.min(
          maxDelayMs,
          lastError.retryAfterMs ?? baseDelayMs * 2 ** attempt + jitter(),
        );

        yield* sleep(delay);
      }

      return yield* Effect.fail(
        lastError ?? new GoogleWorkspaceError({ message: "Google Workspace request failed." }),
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

  const listGroupMembers: GoogleWorkspaceService["listGroupMembers"] = (groupKey, pageToken) =>
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
          message: `Group ${groupKey} exceeded 100 membership pages.`,
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

  return {
    listUsers,
    listGroups,
    listGroupMembers,
    listAllGroupMembers,
    getUser,
    validate,
  };
};

/** Turn a config error into the service error shape used by sync. */
export const googleConfigFailure = (error: GoogleWorkspaceConfigError): GoogleWorkspaceError =>
  new GoogleWorkspaceError({ message: error.message, cause: error });
