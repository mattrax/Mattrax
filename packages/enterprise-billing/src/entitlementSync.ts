import { Effect } from "effect";
import { OUTBOUND_TIMEOUTS, fetchWithTimeout } from "@mattrax/net";

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
  readonly fetch?: typeof globalThis.fetch;
};

export type Entitlement = {
  readonly organizationId: string;
  readonly plan: string;
  readonly status: string | null;
};

export const makeEntitlementSync =
  ({ url, token, fetch = globalThis.fetch }: EntitlementSyncOptions) =>
  (entitlement: Entitlement): Effect.Effect<void, Error> =>
    Effect.gen(function* () {
      const target = new URL(
        "/api/internal/billing/entitlement",
        url.endsWith("/") ? url : url + "/",
      );

      if (target.protocol !== "https:" && target.protocol !== "http:")
        return yield* Effect.fail(new Error("CLOUD_URL must be an http(s) URL"));

      const response = yield* Effect.tryPromise({
        try: () =>
          fetchWithTimeout(
            target.toString(),
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${token}`,
                "content-type": "application/json",
              },
              body: JSON.stringify(entitlement),
            },
            { timeoutMs: OUTBOUND_TIMEOUTS.billing, fetch },
          ),
        catch: () => new Error("The application deployment is unavailable."),
      });

      if (!response.ok) {
        const text = yield* Effect.tryPromise({
          try: () => response.text(),
          catch: () => new Error("The application deployment returned an unreadable response."),
        });

        return yield* Effect.fail(
          new Error(text || "The application deployment rejected the entitlement."),
        );
      }
    });
