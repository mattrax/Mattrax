import { Context, Data, Effect, Layer, Option, Schema } from "effect";
import { FetchHttpClient, Headers, HttpClient, HttpClientRequest } from "effect/http";
import { OUTBOUND_TIMEOUTS } from "@mattrax/net";
import {
  GraphDomainsResponse,
  GraphGroupDeltaResponse,
  GraphUserDeltaResponse,
  graphGroupFromWire,
  graphUserFromWire,
  type GraphDeltaPage,
  type GraphDomain,
  type GraphGroup,
  type GraphUser,
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

export type AzureGraphError =
  | AzureGraphUnauthorized
  | AzureGraphConsentRequired
  | AzureGraphThrottled
  | AzureGraphRequestFailed
  | AzureGraphInvalidResponse;

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

export type AzureGraphService = {
  readonly get: <T>(
    tenantId: string,
    url: string,
    schema: Schema.Schema<T>,
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
  readonly consentUrl: (tenantId: string) => string;
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
      ): Effect.Effect<unknown, AzureGraphInvalidResponse> =>
        Effect.try({
          try: () => JSON.parse(text) as unknown,
          catch: (cause) =>
            new AzureGraphInvalidResponse({ message: `Invalid JSON from ${label}`, cause }),
        });

      const decode = <A>(
        schema: Schema.Schema<A>,
        json: unknown,
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
        ) as Effect.Effect<A, AzureGraphInvalidResponse>;

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
                ...(retry ? { retryAfterSeconds: retry.seconds } : {}),
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
          const expiresIn = typeof rawExpiresIn === "string" ? Number(rawExpiresIn) : rawExpiresIn;
          const lifetime =
            typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0
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
        schema: Schema.Schema<T>,
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
          if (result.status === 429) {
            const retry = retryAfter(result.headers);
            return yield* Effect.fail(
              new AzureGraphThrottled({
                message: `Microsoft Graph request to ${label} was throttled`,
                status: result.status,
                ...(retry ? { retryAfterSeconds: retry.seconds } : {}),
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

      const consentUrl = (tenantId: string): string => {
        const url = new URL(
          `${loginBaseUrl}/${encodeURIComponent(normalizeTenantId(tenantId))}/v2.0/adminconsent`,
        );
        url.searchParams.set("client_id", config.clientId);
        const redirect = consentRedirectUri(config);
        if (redirect !== undefined) url.searchParams.set("redirect_uri", redirect);
        return url.toString();
      };

      return AzureGraph.of({ get, usersDelta, groupsDelta, domains, consentUrl });
    }),
  );

export const AzureGraphFetchLive = (config: AzureGraphConfig) =>
  AzureGraphLive(config).pipe(Layer.provide(FetchHttpClient.layer));
