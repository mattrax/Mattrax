import { createHash, randomUUID } from "node:crypto";
import type { AnalyticsClient } from "@mattrax/cloud-services/analytics";
import { createRequestAnalytics } from "@mattrax/cloud-services/analytics";

/**
 * Deployment-identity analytics for the hosted APNs relay.
 *
 * The relay is the one place that sees both Cloud and self-hosted push traffic,
 * so it is where a "who is using the relay" signal belongs. PostHog receives
 * one event per relayed push, identified by a SHA-256 hash of the deployment
 * licence id. The raw licence id, push token, certificates, tenant ids and
 * request bodies never leave the process.
 *
 * Analytics is opt-in: without `POSTHOG_KEY` every call is a no-op and the
 * relay never constructs a client.
 */

export type RelayAnalyticsAuth =
  | { readonly kind: "licensed"; readonly licenseId: string }
  | { readonly kind: "shared-secret" };

export type RelayAnalyticsConfig = {
  readonly key?: string;
  readonly host?: string;
  readonly environment?: string;
  readonly release?: string;
  /** Test seam; production builds the client from `key`. */
  readonly client?: AnalyticsClient;
  readonly fetch?: typeof globalThis.fetch;
  readonly warn?: (message: string) => void;
};

export type RelayAnalytics = {
  readonly enabled: boolean;
  /** Best-effort; never throws and never delays the relay response. */
  push(auth: RelayAnalyticsAuth, outcome: "ok" | "error"): void;
};

/**
 * Stable pseudonym for a deployment. Licence ids are random UUIDs, so a plain
 * SHA-256 is not reversible to an identifying value and needs no extra secret.
 */
export const hashDeploymentId = (licenseId: string): string =>
  createHash("sha256").update(licenseId).digest("hex");

/** Hosted Cloud authenticates the relay with SERVICES_TOKEN; it has no deployment id. */
const sharedSecretIdentity = "relay:shared-secret";

export const createRelayAnalytics = (config: RelayAnalyticsConfig = {}): RelayAnalytics => {
  const key = config.key?.trim();
  const enabled = Boolean(config.client || key);

  return {
    enabled,
    push: (auth, outcome) => {
      if (!enabled) return;

      const deploymentId = auth.kind === "licensed" ? hashDeploymentId(auth.licenseId) : undefined;

      const session = createRequestAnalytics({
        key,
        host: config.host,
        environment: config.environment,
        release: config.release,
        lib: "mattrax-services",
        deploymentId,
        requestId: randomUUID(),
        method: "POST",
        path: "/v1/apns/push",
        headers: {},
        client: config.client,
        fetch: config.fetch,
        warn: config.warn,
      });

      session.identify({ userId: deploymentId ?? sharedSecretIdentity });
      session.capture("apns_relay_push", {
        deployment_kind: auth.kind,
        outcome,
      });

      // The HTTP response must not wait on PostHog; the helper already catches
      // delivery failures and reports them through `warn`.
      void session.flush();
    },
  };
};
