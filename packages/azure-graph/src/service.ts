import { Context, Data, Effect, Layer, Option, Schema } from "effect";
import { FetchHttpClient, Headers, HttpClient, HttpClientRequest } from "effect/http";
import { OUTBOUND_TIMEOUTS } from "@mattrax/net";
import {
  GraphAutopilotDeviceResponse,
  GraphAutopilotDevicesResponse,
  GraphAutopilotImportResponse,
  GraphAutopilotProfileResponse,
  GraphAutopilotProfilesResponse,
  GraphDomainsResponse,
  GraphGroupDeltaResponse,
  GraphOAuth2PermissionGrantsResponse,
  GraphServicePrincipalsResponse,
  GraphUserDeltaResponse,
  graphAutopilotDeviceFromWire,
  graphAutopilotProfileFromWire,
  graphGroupFromWire,
  graphUserFromWire,
  importedAutopilotDevices,
} from "./schema.js";
import type {
  GraphAutopilotDevice,
  GraphAutopilotProfile,
  GraphDeltaPage,
  GraphDomain,
  GraphGroup,
  GraphPage,
  GraphUser,
} from "./schema.js";

/** 401 from Graph or the token endpoint. */
export class AzureGraphUnauthorized extends Data.TaggedError("Unauthorized")<{
  message: string;
  status: number;
  body?: string;
}> {}

/** 403 from Graph: the app has not been granted admin consent for the tenant. */
export class AzureGraphConsentRequired extends Data.TaggedError("ConsentRequired")<{
  message: string;
  status: number;
  body?: string;
}> {}

/** 429 from Graph, after the single permitted retry. */
export class AzureGraphThrottled extends Data.TaggedError("Throttled")<{
  message: string;
  status: number;
  retryAfterSeconds?: number;
  body?: string;
}> {}

/** 404 from Graph: the object is absent (or belongs to another tenant). */
export class AzureGraphNotFound extends Data.TaggedError("NotFound")<{
  message: string;
  status: number;
  body?: string;
}> {}

/** Any other non-success response, including 5xx after the single retry. */
export class AzureGraphRequestFailed extends Data.TaggedError("RequestFailed")<{
  message: string;
  status?: number;
  body?: string;
  cause?: unknown;
}> {}

/** Graph returned a body that is not JSON or does not match the expected shape. */
export class AzureGraphInvalidResponse extends Data.TaggedError("InvalidResponse")<{
  message: string;
  cause?: unknown;
}> {}

/**
 * A delegated grant delete failed after earlier grants were already removed.
 * `grantsRemoved` lets the caller report the partial result instead of a bare
 * failure.
 */
export class AzureGraphConsentRevocationFailed extends Data.TaggedError("ConsentRevocationFailed")<{
  message: string;
  servicePrincipalId: string;
  grantsRemoved: number;
  status?: number;
  cause?: unknown;
}> {}

export type AzureGraphError =
  | AzureGraphUnauthorized
  | AzureGraphConsentRequired
  | AzureGraphThrottled
  | AzureGraphNotFound
  | AzureGraphRequestFailed
  | AzureGraphInvalidResponse;

export type AzureGraphConsentRevocationError = AzureGraphError | AzureGraphConsentRevocationFailed;

export type AzureGraphConfig = {
  readonly clientId: string;
  readonly clientSecret: string;
  /**
   * Public origin of the app, used to derive the admin-consent redirect URI.
   * Defaults to no redirect URI when neither this nor `redirectUri` is set.
   */
  readonly origin?: string;
  /** Explicit admin-consent redirect URI. Takes precedence over `origin`. */
  readonly redirectUri?: string;
  /** Graph API base. Defaults to `https://graph.microsoft.com/v1.0`. */
  readonly graphBaseUrl?: string;
  /** Entra login base. Defaults to `https://login.microsoftonline.com`. */
  readonly loginBaseUrl?: string;
  /** Backoff for 5xx and for 429s without a `Retry-After` header, in ms. */
  readonly retryDelayMs?: number;
  /**
   * Deadline for each Graph/token request attempt, in ms. Defaults to
   * {@link OUTBOUND_TIMEOUTS.azureGraph}. A hung request fails with
   * `AzureGraphRequestFailed` instead of holding the caller open forever.
   */
  readonly timeoutMs?: number;
};

/** One imported Autopilot identity sent to Graph's bulk import endpoint. */
export type ImportAutopilotDeviceIdentity = {
  readonly serialNumber: string;
  /** Base64 hardware hash (the same value as the CSV import column). */
  readonly hardwareIdentifier: string;
  readonly groupTag?: string;
  readonly orderIdentifier?: string;
};

/** Settings accepted when creating/updating a Graph Autopilot profile. */
export type AutopilotDeploymentProfileInput = {
  readonly displayName: string;
  readonly description?: string;
  readonly deploymentMode: "userDriven" | "selfDeploying" | "preProvisioned";
  readonly joinType: "azureADJoin" | "azureADJoinUsingDeviceAuth" | "hybridAzureADJoin";
  readonly deviceNameTemplate?: string;
  readonly locale?: string;
  /**
   * Pre-provisioning/device preparation. Sent to Graph as `enableWhiteGlove`;
   * the Graph `windowsAutopilotDevicePreparationPolicy` API is a separate
   * resource and is not used here.
   */
  readonly enableDevicePreparation?: boolean;
};

/**
 * Outcome of removing the tenant's delegated consent for this application.
 * `servicePrincipalId` is null when the app was never consented to in the
 * tenant, which is treated as already revoked.
 */
export type DelegatedConsentRevocation = {
  readonly servicePrincipalId: string | null;
  readonly grantsRemoved: number;
};

export type AzureGraphService = {
  readonly get: <T>(
    tenantId: string,
    url: string,
    schema: Schema.Decoder<T>,
  ) => Effect.Effect<T, AzureGraphError>;
  readonly usersDelta: (
    tenantId: string,
    link?: string,
  ) => Effect.Effect<GraphDeltaPage<GraphUser>, AzureGraphError>;
  readonly groupsDelta: (
    tenantId: string,
    link?: string,
  ) => Effect.Effect<GraphDeltaPage<GraphGroup>, AzureGraphError>;
  readonly domains: (
    tenantId: string,
  ) => Effect.Effect<ReadonlyArray<GraphDomain>, AzureGraphError>;
  /**
   * Delete every delegated permission grant this application holds in the
   * tenant. The application's service principal is found by its client id, so
   * grants made to other applications are never touched. A missing service
   * principal or grant is treated as already revoked.
   */
  readonly revokeDelegatedConsent: (
    tenantId: string,
  ) => Effect.Effect<DelegatedConsentRevocation, AzureGraphConsentRevocationError>;
  readonly consentUrl: (tenantId: string) => string;

  /** List `windowsAutopilotDeviceIdentities`, one page at a time. */
  readonly listAutopilotDevices: (
    tenantId: string,
    link?: string,
  ) => Effect.Effect<GraphPage<GraphAutopilotDevice>, AzureGraphError>;
  /** Fetch one `windowsAutopilotDeviceIdentities` row. */
  readonly getAutopilotDevice: (
    tenantId: string,
    id: string,
  ) => Effect.Effect<GraphAutopilotDevice, AzureGraphError>;
  /**
   * Import hardware hashes with
   * `POST /deviceManagement/importedWindowsAutopilotDeviceIdentities`.
   * Graph accepts one identity per request; the caller passes the batch.
   */
  readonly importAutopilotDevices: (
    tenantId: string,
    devices: ReadonlyArray<ImportAutopilotDeviceIdentity>,
  ) => Effect.Effect<ReadonlyArray<GraphAutopilotDevice>, AzureGraphError>;
  /** Delete an Autopilot device identity from the tenant. */
  readonly deleteAutopilotDevice: (
    tenantId: string,
    id: string,
  ) => Effect.Effect<void, AzureGraphError>;
  /** List `windowsAutopilotDeploymentProfiles`, one page at a time. */
  readonly listAutopilotProfiles: (
    tenantId: string,
    link?: string,
  ) => Effect.Effect<GraphPage<GraphAutopilotProfile>, AzureGraphError>;
  /** Create a `windowsAutopilotDeploymentProfile`. */
  readonly createAutopilotProfile: (
    tenantId: string,
    input: AutopilotDeploymentProfileInput,
  ) => Effect.Effect<GraphAutopilotProfile, AzureGraphError>;
  /** Patch a `windowsAutopilotDeploymentProfile`. */
  readonly updateAutopilotProfile: (
    tenantId: string,
    id: string,
    input: AutopilotDeploymentProfileInput,
  ) => Effect.Effect<GraphAutopilotProfile, AzureGraphError>;
  /** Assign a profile to an Entra group (the Graph assignment model). */
  readonly assignAutopilotProfile: (
    tenantId: string,
    id: string,
    groupId: string,
  ) => Effect.Effect<void, AzureGraphError>;
};

export class AzureGraph extends Context.Service<AzureGraph, AzureGraphService>()("AzureGraph") {}

const GRAPH_SCOPE = "https://graph.microsoft.com/.default";

const DEFAULT_GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";

const DEFAULT_LOGIN_BASE_URL = "https://login.microsoftonline.com";

const DEFAULT_RETRY_DELAY_MS = 1_000;

const TOKEN_EXPIRY_SKEW_MS = 60_000;

const DEFAULT_TOKEN_LIFETIME_SECONDS = 3_600;

const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  token_type: Schema.optional(Schema.NullOr(Schema.String)),
  expires_in: Schema.optional(Schema.NullOr(Schema.Union([Schema.Number, Schema.String]))),
});

type TokenEntry = {
  readonly token: string;
  readonly expiresAt: number;
};

type RawResponse = {
  readonly status: number;
  readonly headers: Headers.Headers;
  readonly text: string;
};

function normalizeTenantId(tenantId: string): string {
  return tenantId.trim();
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function labelFor(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "Microsoft Graph";
  }
}

function retryAfter(headers: Headers.Headers): { delayMs: number; seconds: number } | undefined {
  const raw = Option.getOrUndefined(Headers.get(headers, "retry-after"))?.trim();

  if (!raw) return undefined;
  const seconds = Number(raw);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return { delayMs: seconds * 1_000, seconds };
  }

  const date = Date.parse(raw);

  if (!Number.isNaN(date)) {
    const delayMs = Math.max(0, date - Date.now());

    return { delayMs, seconds: Math.ceil(delayMs / 1_000) };
  }

  return undefined;
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function isSuccess(status: number): boolean {
  return status >= 200 && status <= 299;
}

function jsonObject(fields: Readonly<Record<string, Schema.Json | undefined>>): Schema.JsonObject {
  const result: Record<string, Schema.Json> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) result[key] = value;
  }

  return result;
}

function consentRedirectUri(config: AzureGraphConfig): string | undefined {
  if (config.redirectUri) return config.redirectUri;

  if (!config.origin) return undefined;

  return `${trimTrailingSlashes(config.origin)}/api/v1/sso/azure/callback`;
}

export const AzureGraphLive = (config: AzureGraphConfig) =>
  Layer.effect(
    AzureGraph,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const graphBaseUrl = trimTrailingSlashes(config.graphBaseUrl ?? DEFAULT_GRAPH_BASE_URL);
      const loginBaseUrl = trimTrailingSlashes(config.loginBaseUrl ?? DEFAULT_LOGIN_BASE_URL);
      const retryDelayMs = config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
      const timeoutMs = config.timeoutMs ?? OUTBOUND_TIMEOUTS.azureGraph;
      const tokenCache = new Map<string, TokenEntry>();

      const execute = (
        makeRequest: () => HttpClientRequest.HttpClientRequest,
      ): Effect.Effect<RawResponse, AzureGraphError> =>
        Effect.gen(function* () {
          const send = (): Effect.Effect<RawResponse, AzureGraphError> =>
            Effect.gen(function* () {
              const response = yield* Effect.timeoutOrElse(
                client.execute(makeRequest()).pipe(
                  Effect.mapError(
                    (cause) =>
                      new AzureGraphRequestFailed({
                        message: "Microsoft Graph request failed",
                        cause,
                      }),
                  ),
                ),
                {
                  duration: timeoutMs,
                  orElse: () =>
                    Effect.fail(
                      new AzureGraphRequestFailed({
                        message: `Microsoft Graph request timed out after ${timeoutMs}ms`,
                      }),
                    ),
                },
              );

              const text = yield* response.text.pipe(
                Effect.mapError(
                  (cause) =>
                    new AzureGraphRequestFailed({
                      message: "Failed to read Microsoft Graph response",
                      cause,
                    }),
                ),
                Effect.timeoutOrElse({
                  duration: timeoutMs,
                  orElse: () =>
                    Effect.fail(
                      new AzureGraphRequestFailed({
                        message: `Reading the Microsoft Graph response timed out after ${timeoutMs}ms`,
                      }),
                    ),
                }),
              );

              return { status: response.status, headers: response.headers, text };
            });

          const first = yield* send();

          if (!isRetryable(first.status)) return first;

          const retry = first.status === 429 ? retryAfter(first.headers) : undefined;
          yield* Effect.sleep(retry?.delayMs ?? retryDelayMs);

          return yield* send();
        });

      const parseJson = (
        text: string,
        label: string,
      ): Effect.Effect<Schema.Json, AzureGraphInvalidResponse> =>
        Effect.try({
          try: () => JSON.parse(text),
          catch: (cause) =>
            new AzureGraphInvalidResponse({ message: `Invalid JSON from ${label}`, cause }),
        });

      const decode = <A>(
        schema: Schema.Decoder<A>,
        json: Schema.Json,
        label: string,
      ): Effect.Effect<A, AzureGraphInvalidResponse> =>
        Schema.decodeUnknownEffect(schema)(json).pipe(
          Effect.mapError(
            (cause) =>
              new AzureGraphInvalidResponse({
                message: `Invalid response shape from ${label}`,
                cause,
              }),
          ),
        );

      const fetchToken = (tenantId: string): Effect.Effect<TokenEntry, AzureGraphError> =>
        Effect.gen(function* () {
          const url = `${loginBaseUrl}/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;

          const result = yield* execute(() =>
            HttpClientRequest.post(url).pipe(
              HttpClientRequest.bodyUrlParams({
                grant_type: "client_credentials",
                client_id: config.clientId,
                client_secret: config.clientSecret,
                scope: GRAPH_SCOPE,
              }),
            ),
          );

          if (result.status === 401 || result.status === 403) {
            return yield* Effect.fail(
              new AzureGraphUnauthorized({
                message: `Microsoft Graph token request was rejected (HTTP ${result.status})`,
                status: result.status,
                body: result.text,
              }),
            );
          }

          if (result.status === 429) {
            const retry = retryAfter(result.headers);

            return yield* Effect.fail(
              new AzureGraphThrottled({
                message: "Microsoft Graph token request was throttled",
                status: result.status,
                retryAfterSeconds: retry?.seconds,
                body: result.text,
              }),
            );
          }

          if (!isSuccess(result.status)) {
            return yield* Effect.fail(
              new AzureGraphRequestFailed({
                message: `Microsoft Graph token request returned HTTP ${result.status}`,
                status: result.status,
                body: result.text,
              }),
            );
          }

          const json = yield* parseJson(result.text, "Microsoft Graph token endpoint");
          const token = yield* decode(TokenResponse, json, "Microsoft Graph token endpoint");
          const rawExpiresIn = token.expires_in;

          const expiresIn = Schema.is(Schema.String)(rawExpiresIn)
            ? Number(rawExpiresIn)
            : rawExpiresIn;

          const lifetime =
            Schema.is(Schema.Number)(expiresIn) && Number.isFinite(expiresIn) && expiresIn > 0
              ? expiresIn
              : DEFAULT_TOKEN_LIFETIME_SECONDS;

          return {
            token: token.access_token,
            expiresAt: Date.now() + Math.max(0, lifetime * 1_000 - TOKEN_EXPIRY_SKEW_MS),
          };
        });

      const accessToken = (tenantId: string): Effect.Effect<string, AzureGraphError> =>
        Effect.gen(function* () {
          const tenant = normalizeTenantId(tenantId);
          const cached = tokenCache.get(tenant);

          if (cached && cached.expiresAt > Date.now()) return cached.token;
          const entry = yield* fetchToken(tenant);
          tokenCache.set(tenant, entry);

          return entry.token;
        });

      const get = <T>(
        tenantId: string,
        url: string,
        schema: Schema.Decoder<T>,
      ): Effect.Effect<T, AzureGraphError> =>
        Effect.gen(function* () {
          const token = yield* accessToken(tenantId);

          const result = yield* execute(() =>
            HttpClientRequest.get(url).pipe(HttpClientRequest.bearerToken(token)),
          );

          const label = labelFor(url);

          if (result.status === 401) {
            return yield* Effect.fail(
              new AzureGraphUnauthorized({
                message: `Microsoft Graph request to ${label} was unauthorized`,
                status: result.status,
                body: result.text,
              }),
            );
          }

          if (result.status === 403) {
            return yield* Effect.fail(
              new AzureGraphConsentRequired({
                message: `Microsoft Graph request to ${label} requires admin consent`,
                status: result.status,
                body: result.text,
              }),
            );
          }

          if (result.status === 404) {
            return yield* Effect.fail(
              new AzureGraphNotFound({
                message: `Microsoft Graph request to ${label} was not found`,
                status: result.status,
                body: result.text,
              }),
            );
          }

          if (result.status === 429) {
            const retry = retryAfter(result.headers);

            return yield* Effect.fail(
              new AzureGraphThrottled({
                message: `Microsoft Graph request to ${label} was throttled`,
                status: result.status,
                retryAfterSeconds: retry?.seconds,
                body: result.text,
              }),
            );
          }

          if (!isSuccess(result.status)) {
            return yield* Effect.fail(
              new AzureGraphRequestFailed({
                message: `Microsoft Graph request to ${label} returned HTTP ${result.status}`,
                status: result.status,
                body: result.text,
              }),
            );
          }

          const json = yield* parseJson(result.text, label);

          return yield* decode(schema, json, label);
        });

      /**
       * Send a request that may carry a JSON body. The existing token cache,
       * per-attempt timeout and single 429/5xx retry are reused so Autopilot
       * calls behave exactly like directory-sync calls.
       */
      function request(
        tenantId: string,
        method: "POST" | "PATCH" | "DELETE",
        url: string,
        schema: null,
        body?: Schema.Json,
      ): Effect.Effect<void, AzureGraphError>;
      function request<T>(
        tenantId: string,
        method: "POST" | "PATCH" | "DELETE",
        url: string,
        schema: Schema.Decoder<T>,
        body?: Schema.Json,
      ): Effect.Effect<T, AzureGraphError>;
      function request<T>(
        tenantId: string,
        method: "POST" | "PATCH" | "DELETE",
        url: string,
        schema: Schema.Decoder<T> | null,
        body?: Schema.Json,
      ): Effect.Effect<T | void, AzureGraphError> {
        return Effect.gen(function* () {
          const token = yield* accessToken(tenantId);

          const result = yield* execute(() => {
            const base = HttpClientRequest.make(method)(url).pipe(
              HttpClientRequest.bearerToken(token),
            );

            return body === undefined
              ? base
              : base.pipe(HttpClientRequest.bodyText(JSON.stringify(body), "application/json"));
          });

          const label = labelFor(url);

          if (result.status === 401) {
            return yield* Effect.fail(
              new AzureGraphUnauthorized({
                message: `Microsoft Graph request to ${label} was unauthorized`,
                status: result.status,
                body: result.text,
              }),
            );
          }

          if (result.status === 403) {
            return yield* Effect.fail(
              new AzureGraphConsentRequired({
                message: `Microsoft Graph request to ${label} requires admin consent`,
                status: result.status,
                body: result.text,
              }),
            );
          }

          if (result.status === 404) {
            return yield* Effect.fail(
              new AzureGraphNotFound({
                message: `Microsoft Graph request to ${label} was not found`,
                status: result.status,
                body: result.text,
              }),
            );
          }

          if (result.status === 429) {
            const retry = retryAfter(result.headers);

            return yield* Effect.fail(
              new AzureGraphThrottled({
                message: `Microsoft Graph request to ${label} was throttled`,
                status: result.status,
                retryAfterSeconds: retry?.seconds,
                body: result.text,
              }),
            );
          }

          if (!isSuccess(result.status)) {
            return yield* Effect.fail(
              new AzureGraphRequestFailed({
                message: `Microsoft Graph request to ${label} returned HTTP ${result.status}`,
                status: result.status,
                body: result.text,
              }),
            );
          }

          // DELETE and assignment calls return 204 with no body.
          if (schema === null) return yield* Effect.void;
          const json = yield* parseJson(result.text, label);

          return yield* decode(schema, json, label);
        });
      }

      const usersDelta = (
        tenantId: string,
        link?: string,
      ): Effect.Effect<GraphDeltaPage<GraphUser>, AzureGraphError> =>
        Effect.gen(function* () {
          const page = yield* get(
            tenantId,
            link ??
              `${graphBaseUrl}/users/delta?$select=id,displayName,mail,userPrincipalName,accountEnabled,givenName,surname,userType`,
            GraphUserDeltaResponse,
          );

          return {
            items: (page.value ?? []).map(graphUserFromWire),
            nextLink: page["@odata.nextLink"] ?? null,
            deltaLink: page["@odata.deltaLink"] ?? null,
          };
        });

      const groupsDelta = (
        tenantId: string,
        link?: string,
      ): Effect.Effect<GraphDeltaPage<GraphGroup>, AzureGraphError> =>
        Effect.gen(function* () {
          const page = yield* get(
            tenantId,
            link ?? `${graphBaseUrl}/groups/delta?$select=displayName,description,members`,
            GraphGroupDeltaResponse,
          );

          return {
            items: (page.value ?? []).map(graphGroupFromWire),
            nextLink: page["@odata.nextLink"] ?? null,
            deltaLink: page["@odata.deltaLink"] ?? null,
          };
        });

      const domains = (
        tenantId: string,
      ): Effect.Effect<ReadonlyArray<GraphDomain>, AzureGraphError> =>
        Effect.gen(function* () {
          const result: GraphDomain[] = [];

          let link: string | undefined =
            `${graphBaseUrl}/domains?$select=id,isVerified,isDefault,isInitial`;

          for (let pageNumber = 0; link && pageNumber < 100; pageNumber++) {
            const page: GraphDomainsResponse = yield* get(tenantId, link, GraphDomainsResponse);
            result.push(...page.value);
            link = page["@odata.nextLink"] ?? undefined;
          }

          return result;
        });

      const servicePrincipalBase = `${graphBaseUrl}/servicePrincipals`;
      const permissionGrantBase = `${graphBaseUrl}/oauth2PermissionGrants`;

      const odataString = (value: string) => value.replaceAll("'", "''");

      const servicePrincipalsForApp = (
        tenantId: string,
      ): Effect.Effect<ReadonlyArray<{ id: string }>, AzureGraphError> =>
        Effect.gen(function* () {
          const result: Array<{ id: string }> = [];

          let link: string | undefined =
            `${servicePrincipalBase}?$select=id&$filter=${encodeURIComponent(
              `appId eq '${odataString(config.clientId)}'`,
            )}`;

          for (let pageNumber = 0; link && pageNumber < 100; pageNumber++) {
            const page: GraphServicePrincipalsResponse = yield* get(
              tenantId,
              link,
              GraphServicePrincipalsResponse,
            );

            result.push(...page.value);
            link = page["@odata.nextLink"] ?? undefined;
          }

          return result;
        });

      const delegatedGrantsFor = (
        tenantId: string,
        servicePrincipalId: string,
      ): Effect.Effect<ReadonlyArray<{ id: string; clientId?: string | null }>, AzureGraphError> =>
        Effect.gen(function* () {
          const result: Array<{ id: string; clientId?: string | null }> = [];

          let link: string | undefined =
            `${permissionGrantBase}?$select=id,clientId&$filter=${encodeURIComponent(
              `clientId eq '${odataString(servicePrincipalId)}'`,
            )}`;

          for (let pageNumber = 0; link && pageNumber < 100; pageNumber++) {
            const page: GraphOAuth2PermissionGrantsResponse = yield* get(
              tenantId,
              link,
              GraphOAuth2PermissionGrantsResponse,
            );

            result.push(...page.value);
            link = page["@odata.nextLink"] ?? undefined;
          }

          return result;
        });

      /**
       * The token endpoint answers 400 with one of these codes when the
       * application registration or the customer tenant no longer exists
       * (for example after an admin deleted the enterprise application). That
       * is indistinguishable from an already-revoked consent for our purpose.
       */
      const tenantGone = (body: string | undefined) =>
        body !== undefined && (body.includes("AADSTS700016") || body.includes("AADSTS90002"));

      const revokeDelegatedConsent = (
        tenantId: string,
      ): Effect.Effect<DelegatedConsentRevocation, AzureGraphConsentRevocationError> =>
        Effect.gen(function* () {
          const principal = (yield* servicePrincipalsForApp(tenantId))[0];

          // No service principal means the app was never consented to (or the
          // consent was already removed); there is nothing left to revoke.
          if (!principal) return { servicePrincipalId: null, grantsRemoved: 0 };

          const grants = yield* delegatedGrantsFor(tenantId, principal.id);
          let grantsRemoved = 0;

          for (const grant of grants) {
            // Re-check locally as well as in the filter: a mock or a future
            // Graph change must never make us delete another app's grant.
            if (grant.clientId !== principal.id) continue;

            const removed = yield* request(
              tenantId,
              "DELETE",
              `${permissionGrantBase}/${encodeURIComponent(grant.id)}`,
              null,
            ).pipe(
              Effect.as(true as const),
              Effect.catchTag("NotFound", () => Effect.succeed(true as const)),
              Effect.catch((error) => Effect.succeed(error)),
            );

            if (removed !== true) {
              const status = Schema.is(Schema.Struct({ status: Schema.Number }))(removed)
                ? removed.status
                : undefined;

              return yield* Effect.fail(
                new AzureGraphConsentRevocationFailed({
                  message: `Failed to remove delegated consent after ${grantsRemoved} grant${
                    grantsRemoved === 1 ? "" : "s"
                  }: ${removed.message}`,
                  servicePrincipalId: principal.id,
                  grantsRemoved,
                  status,
                  cause: removed,
                }),
              );
            }

            grantsRemoved++;
          }

          return { servicePrincipalId: principal.id, grantsRemoved };
        }).pipe(
          Effect.catchIf(
            // The token endpoint reports a deleted app/tenant through several
            // status codes, so match the AADSTS code in whichever error carries
            // the response body rather than only a 400 RequestFailed.
            (error) => "body" in error && tenantGone(error.body),
            () => Effect.succeed({ servicePrincipalId: null, grantsRemoved: 0 }),
          ),
        );

      const consentUrl = (tenantId: string): string => {
        const url = new URL(
          `${loginBaseUrl}/${encodeURIComponent(normalizeTenantId(tenantId))}/v2.0/adminconsent`,
        );

        url.searchParams.set("client_id", config.clientId);
        const redirect = consentRedirectUri(config);

        if (redirect !== undefined) url.searchParams.set("redirect_uri", redirect);

        return url.toString();
      };

      const autopilotDeviceBase = `${graphBaseUrl}/deviceManagement/windowsAutopilotDeviceIdentities`;
      const autopilotImportUrl = `${graphBaseUrl}/deviceManagement/importedWindowsAutopilotDeviceIdentities`;
      const autopilotProfileBase = `${graphBaseUrl}/deviceManagement/windowsAutopilotDeploymentProfiles`;

      const listAutopilotDevices = (
        tenantId: string,
        link?: string,
      ): Effect.Effect<GraphPage<GraphAutopilotDevice>, AzureGraphError> =>
        Effect.gen(function* () {
          const page = yield* get(
            tenantId,
            link ?? `${autopilotDeviceBase}?$top=100`,
            GraphAutopilotDevicesResponse,
          );

          return {
            items: (page.value ?? []).map(graphAutopilotDeviceFromWire),
            nextLink: page["@odata.nextLink"] ?? null,
          };
        });

      const getAutopilotDevice = (
        tenantId: string,
        id: string,
      ): Effect.Effect<GraphAutopilotDevice, AzureGraphError> =>
        get(
          tenantId,
          `${autopilotDeviceBase}/${encodeURIComponent(id)}`,
          GraphAutopilotDeviceResponse,
        ).pipe(Effect.map(graphAutopilotDeviceFromWire));

      const importAutopilotDevices = (
        tenantId: string,
        devices: ReadonlyArray<ImportAutopilotDeviceIdentity>,
      ): Effect.Effect<ReadonlyArray<GraphAutopilotDevice>, AzureGraphError> =>
        Effect.forEach(
          devices,
          (device) =>
            request(
              tenantId,
              "POST",
              autopilotImportUrl,
              GraphAutopilotImportResponse,
              jsonObject({
                "@odata.type": "#microsoft.graph.importedWindowsAutopilotDeviceIdentity",
                serialNumber: device.serialNumber,
                hardwareIdentifier: device.hardwareIdentifier,
                groupTag: device.groupTag,
                orderIdentifier: device.orderIdentifier,
              }),
            ).pipe(Effect.map(importedAutopilotDevices)),
          { concurrency: 1 },
        ).pipe(Effect.map((batches) => batches.flat()));

      const deleteAutopilotDevice = (
        tenantId: string,
        id: string,
      ): Effect.Effect<void, AzureGraphError> =>
        request(tenantId, "DELETE", `${autopilotDeviceBase}/${encodeURIComponent(id)}`, null);

      const listAutopilotProfiles = (
        tenantId: string,
        link?: string,
      ): Effect.Effect<GraphPage<GraphAutopilotProfile>, AzureGraphError> =>
        Effect.gen(function* () {
          const page = yield* get(
            tenantId,
            link ?? `${autopilotProfileBase}?$top=100`,
            GraphAutopilotProfilesResponse,
          );

          return {
            items: (page.value ?? []).map(graphAutopilotProfileFromWire),
            nextLink: page["@odata.nextLink"] ?? null,
          };
        });

      const profileBody = (input: AutopilotDeploymentProfileInput, create: boolean) =>
        jsonObject({
          "@odata.type": create ? "#microsoft.graph.windowsAutopilotDeploymentProfile" : undefined,
          displayName: input.displayName,
          description: input.description,
          deploymentMode: input.deploymentMode,
          joinType: input.joinType,
          deviceNameTemplate: input.deviceNameTemplate,
          locale: input.locale,
          enableWhiteGlove: input.enableDevicePreparation,
        });

      const createAutopilotProfile = (
        tenantId: string,
        input: AutopilotDeploymentProfileInput,
      ): Effect.Effect<GraphAutopilotProfile, AzureGraphError> =>
        request(
          tenantId,
          "POST",
          autopilotProfileBase,
          GraphAutopilotProfileResponse,
          profileBody(input, true),
        ).pipe(Effect.map(graphAutopilotProfileFromWire));

      const updateAutopilotProfile = (
        tenantId: string,
        id: string,
        input: AutopilotDeploymentProfileInput,
      ): Effect.Effect<GraphAutopilotProfile, AzureGraphError> =>
        request(
          tenantId,
          "PATCH",
          `${autopilotProfileBase}/${encodeURIComponent(id)}`,
          GraphAutopilotProfileResponse,
          profileBody(input, false),
        ).pipe(Effect.map(graphAutopilotProfileFromWire));

      const assignAutopilotProfile = (
        tenantId: string,
        id: string,
        groupId: string,
      ): Effect.Effect<void, AzureGraphError> =>
        request(
          tenantId,
          "POST",
          `${autopilotProfileBase}/${encodeURIComponent(id)}/assign`,
          null,
          {
            "@odata.type": "#microsoft.graph.windowsAutopilotDeploymentProfileAssignment",
            target: {
              "@odata.type": "#microsoft.graph.groupAssignmentTarget",
              groupId,
            },
          },
        );

      return AzureGraph.of({
        get,
        usersDelta,
        groupsDelta,
        domains,
        revokeDelegatedConsent,
        consentUrl,
        listAutopilotDevices,
        getAutopilotDevice,
        importAutopilotDevices,
        deleteAutopilotDevice,
        listAutopilotProfiles,
        createAutopilotProfile,
        updateAutopilotProfile,
        assignAutopilotProfile,
      });
    }),
  );

export const AzureGraphFetchLive = (config: AzureGraphConfig) =>
  AzureGraphLive(config).pipe(Layer.provide(FetchHttpClient.layer));
