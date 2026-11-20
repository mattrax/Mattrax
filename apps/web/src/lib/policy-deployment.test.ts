import { describe, expect, it } from "vitest";
import type { PolicyDeliveryInfo } from "@mattrax/enterprise-domain/client";
import {
  policyDeploymentDevicePresentation,
  policyDeploymentSegments,
  policyDeliverySegments,
} from "./policy-delivery";

const counts = {
  total: 10,
  scoped: 8,
  delivered: 3,
  pending: 2,
  failed: 1,
  notApplicable: 1,
  untracked: 1,
  notInScope: 2,
};

const delivery = (overrides: Partial<PolicyDeliveryInfo> = {}): PolicyDeliveryInfo => ({
  state: "partial",
  version: 2,
  scopedDevices: 10,
  trackedDevices: 6,
  legacyDevices: 1,
  overriddenDevices: 1,
  deliveredDevices: 2,
  failedDevices: 1,
  pendingDevices: 2,
  ...overrides,
});

describe("policyDeploymentSegments", () => {
  it("covers the scoped set and excludes devices outside scope", () => {
    const segments = policyDeploymentSegments(counts);
    const total = segments.reduce((sum, segment) => sum + segment.value, 0);

    // notInScope is deliberately not a segment: the bar describes current scope.
    expect(total).toBe(counts.scoped);
  });
});

describe("policyDeliverySegments", () => {
  it("derives the untracked slice from scoped, tracked and legacy counts", () => {
    const segments = policyDeliverySegments(delivery());
    const untracked = segments.find((segment) => segment.label === "Untracked");
    const total = segments.reduce((sum, segment) => sum + segment.value, 0);

    // 10 scoped - 6 tracked - 1 legacy = 3 devices that only report through
    // Windows, Android or an Apple user channel.
    expect(untracked?.value).toBe(3);
    expect(total).toBe(10);
  });

  it("never produces a negative untracked slice", () => {
    const segments = policyDeliverySegments(
      delivery({ scopedDevices: 1, trackedDevices: 1, legacyDevices: 1 }),
    );

    expect(segments.find((segment) => segment.label === "Untracked")?.value).toBe(0);
  });
});

describe("policyDeploymentDevicePresentation", () => {
  it("keeps untracked and left-scope devices out of the failure tone", () => {
    expect(policyDeploymentDevicePresentation.delivered.tone).toBe("success");
    expect(policyDeploymentDevicePresentation.pending.tone).toBe("warning");
    expect(policyDeploymentDevicePresentation.failed.tone).toBe("destructive");
    expect(policyDeploymentDevicePresentation.untracked.tone).toBe("outline");
    expect(policyDeploymentDevicePresentation["not-in-scope"].label).toBe("Left scope");
  });
});
