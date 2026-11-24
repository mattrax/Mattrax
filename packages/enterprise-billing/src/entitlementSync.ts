import { Effect, Layer } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

/**
 * Push a tenant's billing entitlement to the application deployment.
 *
 * The application keeps a tiny cached plan/status on its organisation row so
 * device and tenant limits can be enforced without calling this service on
 * every request. Billing state remains authoritative here.
 */
export type EntitlementSyncOptions = {
  /** Application origin, e.g. `https://mattrax.app`. */
  readonly url: string;
  /** Shared machine-to-machine token. */
  readonly token: string;
  /** Override for tests or an egress proxy; defaults to the runtime `fetch`. */
  readonly fetch?: typeof globalThis.fetch;
};

export type Entitlement = {
  readonly organizationId: string;
  readonly plan: string;
  readonly status: string | null;
};

/** An entitlement push is best-effort and must not pin the caller open. */
export const ENTITLEMENT_SYNC_TIMEOUT_MS = 15_000;

const httpClientLayer = (fetchImpl?: typeof globalThis.fetch) =>
  fetchImpl === undefined
    ? FetchHttpClient.layer
    : FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchImpl)));

export const makeEntitlementSync =
  ({ url, token, fetch }: EntitlementSyncOptions) =>
  (entitlement: Entitlement): Effect.Effect<void, Error> =>
    Effect.gen(function* () {
      const target = new URL(
        "/api/internal/billing/entitlement",
        url.endsWith("/") ? url : url + "/",
      );

      if (target.protocol !== "https:" && target.protocol !== "http:")
        return yield* Effect.fail(new Error("CLOUD_URL must be an http(s) URL"));

      const client = yield* HttpClient.HttpClient;

      const exchange = Effect.gen(function* () {
        const response = yield* client.execute(
          HttpClientRequest.post(target.toString()).pipe(
            HttpClientRequest.bearerToken(token),
            HttpClientRequest.bodyText(JSON.stringify(entitlement), "application/json"),
          ),
        );

        return { status: response.status, text: yield* response.text };
      }).pipe(
        Effect.mapError(() => new Error("The application deployment is unavailable.")),
        Effect.timeoutOrElse({
          duration: ENTITLEMENT_SYNC_TIMEOUT_MS,
          orElse: () =>
            Effect.fail(
              new Error(
                `The application deployment did not answer within ${ENTITLEMENT_SYNC_TIMEOUT_MS}ms.`,
              ),
            ),
        }),
      );

      const { status, text } = yield* exchange;

      if (status < 200 || status > 299)
        return yield* Effect.fail(
          new Error(text || "The application deployment rejected the entitlement."),
        );
    }).pipe(Effect.provide(httpClientLayer(fetch)));
