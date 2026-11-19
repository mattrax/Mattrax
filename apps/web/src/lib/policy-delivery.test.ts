import { describe, expect, it } from "vitest";
import {
  isPolicyEnabled,
  policyDeliveryPresentation,
  policyDeliverySortRank,
  policyScopePresentation,
  policyStatePresentation,
} from "./policy-delivery";

const delivery = (
  state:
    | "never-deployed"
    | "no-devices"
    | "not-tracked"
    | "no-configurations"
    | "user-channel"
    | "not-applicable"
    | "pending"
    | "partial"
    | "failed"
    | "delivered",
  overrides: Partial<{
    version: number | null;
    scopedDevices: number;
    trackedDevices: number;
    legacyDevices: number;
    overriddenDevices: number;
    deliveredDevices: number;
    failedDevices: number;
    pendingDevices: number;
  }> = {},
) => ({
  state,
  version: 3,
  scopedDevices: 4,
  trackedDevices: 4,
  legacyDevices: 0,
  overriddenDevices: 0,
  deliveredDevices: 0,
  failedDevices: 0,
  pendingDevices: 4,
  ...overrides,
});

describe("policyDeliveryPresentation", () => {
  it("uses one label per derived state", () => {
    expect(policyDeliveryPresentation(delivery("delivered")).label).toBe("Delivered");
    expect(policyDeliveryPresentation(delivery("partial")).label).toBe("Partial");
    expect(policyDeliveryPresentation(delivery("failed")).label).toBe("Failed");
    expect(policyDeliveryPresentation(delivery("pending")).label).toBe("Pending");
    expect(policyDeliveryPresentation(delivery("never-deployed")).label).toBe("Never deployed");
    expect(policyDeliveryPresentation(delivery("no-devices")).label).toBe("No devices");
    expect(policyDeliveryPresentation(delivery("not-tracked")).label).toBe("Not tracked");
    expect(policyDeliveryPresentation(delivery("no-configurations")).label).toBe(
      "No configurations",
    );
    expect(policyDeliveryPresentation(delivery("user-channel")).label).toBe("User channel");
    expect(policyDeliveryPresentation(delivery("not-applicable")).label).toBe("Not applicable");
  });

  it("explains counts and names the deployment version it judges", () => {
    const partial = policyDeliveryPresentation(
      delivery("partial", {
        trackedDevices: 5,
        deliveredDevices: 3,
        failedDevices: 1,
        pendingDevices: 1,
      }),
    );

    expect(partial.description).toContain("version 3");
    expect(partial.description).toContain("3 of 5 Apple devices");
    expect(partial.description).toContain("1 failed and 1 pending");
  });

  it("does not claim Apple delivery for a Windows-only scope", () => {
    const untracked = policyDeliveryPresentation(
      delivery("not-tracked", { scopedDevices: 3, trackedDevices: 0 }),
    );

    expect(untracked.description).toContain("Windows, Android or legacy Apple profiles");
    expect(untracked.description).not.toContain("Apple device in scope");
  });

  it("mentions the untracked remainder when the scope is mixed", () => {
    const mixed = policyDeliveryPresentation(
      delivery("delivered", {
        scopedDevices: 5,
        trackedDevices: 3,
        legacyDevices: 1,
        deliveredDevices: 3,
        pendingDevices: 0,
      }),
    );

    expect(mixed.description).toContain("Every applicable Apple device in scope (3)");
    expect(mixed.description).toContain("Windows and Android devices do not report");
    expect(mixed.description).toContain("1 Apple device uses legacy profiles");
  });

  it("explains when another policy provides every kind", () => {
    const overridden = policyDeliveryPresentation(
      delivery("not-applicable", { overriddenDevices: 4, pendingDevices: 0 }),
    );

    expect(overridden.description).toContain("declaration-tracked Apple device");
    expect(overridden.description).toContain("4 devices do not receive this policy");
  });

  it("is honest when a policy has no scoped devices", () => {
    const empty = policyDeliveryPresentation(
      delivery("no-devices", { scopedDevices: 0, trackedDevices: 0, pendingDevices: 0 }),
    );

    expect(empty.description).toBe("This policy's assignments match no devices.");
    expect(empty.tone).toBe("outline");
  });
});

describe("policyDeliverySortRank", () => {
  it("surfaces action-needed states first and unknown rows last", () => {
    expect(policyDeliverySortRank("failed")).toBeLessThan(policyDeliverySortRank("partial"));
    expect(policyDeliverySortRank("partial")).toBeLessThan(policyDeliverySortRank("delivered"));
    expect(policyDeliverySortRank(undefined)).toBeGreaterThan(policyDeliverySortRank("delivered"));
  });
});

describe("policyStatePresentation", () => {
  it("treats an omitted state as enabled for older responses", () => {
    expect(isPolicyEnabled({})).toBe(true);
    expect(isPolicyEnabled({ enabled: undefined })).toBe(true);
    expect(policyStatePresentation({}).label).toBe("Enabled");
  });

  it("labels a disabled policy and explains that its settings are kept", () => {
    const state = policyStatePresentation({ enabled: false });

    expect(state).toMatchObject({ label: "Disabled", tone: "warning" });
    expect(state.description).toContain("withdrawn");
    expect(state.description).toContain("assignments are kept");
  });
});

describe("policyScopePresentation", () => {
  it("labels both counts with correct plurals", () => {
    const scope = policyScopePresentation({ deviceCount: 1, userCount: 2 });

    expect(scope.label).toBe("1 device in scope, 2 users assigned");
    expect(scope.devices.label).toBe("1 device in scope");
    expect(scope.users.label).toBe("2 users assigned");
  });

  it("does not invent zero when an older API omits a count", () => {
    const scope = policyScopePresentation({});

    expect(scope.devices.label).toBe("Device count not reported");
    expect(scope.users.label).toBe("User count not reported");
    expect(scope.devices.description).toContain("does not include");
  });
});
