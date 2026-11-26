import { describe, expect, it } from "vitest";
import type { AnalyticsClient } from "@mattrax/cloud-services/analytics";
import { createRelayAnalytics, hashDeploymentId } from "./analytics.ts";

type Captured = Parameters<AnalyticsClient["capture"]>[0];

const fakeClient = () => {
  const events: Captured[] = [];
  const exceptions: Array<{ cause: unknown }> = [];

  const client: AnalyticsClient = {
    capture: (message) => {
      events.push(message);
    },
    captureException: (cause) => {
      exceptions.push({ cause });
    },
    flush: async () => {},
  };

  return { client, events, exceptions };
};

const licenseId = "mtx_lic_0123456789abcdef";

describe("APNs relay analytics", () => {
  it("is a no-op without POSTHOG_KEY and never constructs a client", () => {
    const analytics = createRelayAnalytics({});

    expect(analytics.enabled).toBe(false);
    expect(() => analytics.push({ kind: "licensed", licenseId }, "ok")).not.toThrow();
  });

  it("identifies a deployment by its hashed licence id and nothing raw", () => {
    const { client, events } = fakeClient();
    const analytics = createRelayAnalytics({ client });
    const hash = hashDeploymentId(licenseId);

    expect(analytics.enabled).toBe(true);
    analytics.push({ kind: "licensed", licenseId }, "error");

    expect(events).toHaveLength(1);
    const [event] = events;

    if (!event) throw new Error("no event captured");

    expect(event.event).toBe("apns_relay_push");
    expect(event.distinctId).toBe(hash);
    expect(event.properties).toMatchObject({
      $lib: "mattrax-services",
      path: "/v1/apns/push",
      deployment_id: hash,
      deployment_kind: "licensed",
      outcome: "error",
    });
    // The licence id itself must never be an identity or a property value.
    expect(JSON.stringify(events)).not.toContain(licenseId);
  });

  it("uses a shared identity for shared-secret callers and omits the deployment id", () => {
    const { client, events } = fakeClient();
    const analytics = createRelayAnalytics({ client });

    analytics.push({ kind: "shared-secret" }, "ok");

    const [event] = events;
    expect(event?.distinctId).toBe("relay:shared-secret");
    expect(event?.properties).toMatchObject({ deployment_kind: "shared-secret", outcome: "ok" });
    expect(event?.properties?.deployment_id).toBeUndefined();
  });

  it("hashes a deployment deterministically", () => {
    expect(hashDeploymentId(licenseId)).toBe(hashDeploymentId(licenseId));
  });

  it("hashes different deployments distinctly", () => {
    expect(hashDeploymentId(licenseId)).not.toBe(hashDeploymentId("mtx_lic_another"));
  });

  it("renders a deployment hash as a 32-byte hex digest", () => {
    expect(hashDeploymentId(licenseId)).toMatch(/^[0-9a-f]{64}$/);
  });
});
