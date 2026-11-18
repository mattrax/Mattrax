import { describe, expect, it } from "vitest";
import { derivePolicyDelivery, resolvePolicyScopes } from "@mattrax/enterprise-api";

const emptyScopeInput = {
  policyIds: ["policy-1"],
  devices: [],
  groupAssignments: [],
  groupMembers: [],
  deviceAssignments: [],
  userAssignments: [],
  userGroupAssignments: [],
  userGroupMembers: [],
  deviceUsers: [],
  activeUserIds: new Set<string>(),
};

describe("resolvePolicyScopes", () => {
  it("lets a direct device include override a group exclusion", () => {
    const scopes = resolvePolicyScopes({
      ...emptyScopeInput,
      devices: [{ id: "device-1" }, { id: "device-2" }, { id: "device-3" }],
      groupAssignments: [
        { policyId: "policy-1", groupId: "include", mode: "include" },
        { policyId: "policy-1", groupId: "exclude", mode: "exclude" },
      ],
      groupMembers: [
        { groupId: "include", deviceId: "device-1" },
        { groupId: "include", deviceId: "device-2" },
        { groupId: "exclude", deviceId: "device-2" },
      ],
      deviceAssignments: [
        { policyId: "policy-1", deviceId: "device-2", mode: "include" },
        { policyId: "policy-1", deviceId: "device-3", mode: "exclude" },
      ],
    });

    expect([...scopes.get("policy-1")!.deviceIds].sort()).toEqual(["device-1", "device-2"]);
    expect(scopes.get("policy-1")!.userIds.size).toBe(0);
  });

  it("counts a user once across overlapping directory groups", () => {
    const scopes = resolvePolicyScopes({
      ...emptyScopeInput,
      devices: [{ id: "device-1" }],
      userGroupAssignments: [
        { policyId: "policy-1", groupId: "group-a", mode: "include" },
        { policyId: "policy-1", groupId: "group-b", mode: "include" },
      ],
      userGroupMembers: [
        { groupId: "group-a", userId: "user-1" },
        { groupId: "group-b", userId: "user-1" },
      ],
      deviceUsers: [{ deviceId: "device-1", userId: "user-1" }],
      activeUserIds: new Set(["user-1"]),
    });

    expect(scopes.get("policy-1")!.userIds.size).toBe(1);
    expect([...scopes.get("policy-1")!.deviceIds]).toEqual(["device-1"]);
  });

  it("returns empty sets for a policy with no assignments", () => {
    const scopes = resolvePolicyScopes(emptyScopeInput);

    expect(scopes.get("policy-1")!.deviceIds.size).toBe(0);
    expect(scopes.get("policy-1")!.userIds.size).toBe(0);
  });
});

const appleDevice = (id: string, declarationMode?: "ddm" | "legacy") => ({
  id,
  proto: "apple",
  declarationMode,
});

const declaration = (
  deviceId: string,
  identifier: string,
  options: { valid?: string; active?: boolean; serverToken?: string | null } = {},
) => ({
  deviceId,
  identifier,
  valid: options.valid ?? "valid",
  active: options.active ?? true,
  serverToken: options.serverToken ?? null,
});

describe("derivePolicyDelivery", () => {
  const base = {
    policyId: "policy-1",
    version: 2,
    configurations: [{ kind: "mttx.apple.declaration.files", hash: "current" }],
    devices: [appleDevice("device-1")],
  };

  it("reports a policy without a snapshot as never deployed", () => {
    expect(derivePolicyDelivery({ ...base, version: null, declarations: [] })).toMatchObject({
      state: "never-deployed",
      version: null,
      scopedDevices: 1,
    });
  });

  it("does not call a Windows-only policy tracked", () => {
    expect(
      derivePolicyDelivery({
        ...base,
        devices: [{ id: "device-1", proto: "win" }],
        declarations: [],
      }),
    ).toMatchObject({ state: "not-tracked", scopedDevices: 1, trackedDevices: 0 });
  });

  it("reports no configurations when the policy has nothing Apple can apply", () => {
    expect(
      derivePolicyDelivery({
        ...base,
        configurations: [{ kind: "mttx.windows.custom.example", hash: "current" }],
        declarations: [],
      }),
    ).toMatchObject({ state: "no-configurations", trackedDevices: 1 });
  });

  it("does not wait for declarations for imperative application installs", () => {
    expect(
      derivePolicyDelivery({
        ...base,
        configurations: [{ kind: "mttx.apple.application.example", hash: "current" }],
        declarations: [],
      }),
    ).toMatchObject({ state: "no-configurations", trackedDevices: 1, pendingDevices: 0 });
  });

  it("surfaces an invalid declaration as failed when nothing is delivered", () => {
    expect(
      derivePolicyDelivery({
        ...base,
        devices: [appleDevice("device-1"), appleDevice("device-2")],
        declarations: [
          declaration("device-1", "policy-1:mttx.apple.declaration.files", {
            valid: "invalid",
          }),
        ],
      }),
    ).toMatchObject({ state: "failed", failedDevices: 1, pendingDevices: 1 });
  });

  it("treats an inactive declaration as pending, not delivered", () => {
    expect(
      derivePolicyDelivery({
        ...base,
        declarations: [
          declaration("device-1", "policy-1:mttx.apple.declaration.files", {
            active: false,
            serverToken: "current",
          }),
        ],
      }),
    ).toMatchObject({ state: "pending", pendingDevices: 1 });
  });

  it("requires the current content hash for modern declaration kinds", () => {
    expect(
      derivePolicyDelivery({
        ...base,
        declarations: [
          declaration("device-1", "policy-1:mttx.apple.declaration.files", {
            serverToken: "previous",
          }),
        ],
      }),
    ).toMatchObject({ state: "pending", deliveredDevices: 0, pendingDevices: 1 });
  });

  it("accepts a resolved token for a variable-bearing configuration", () => {
    expect(
      derivePolicyDelivery({
        ...base,
        configurations: [
          {
            kind: "mttx.apple.declaration.files",
            hash: "template-hash",
            hasVariables: true,
          },
        ],
        declarations: [
          declaration("device-1", "policy-1:mttx.apple.declaration.files", {
            serverToken: "resolved-hash",
          }),
        ],
      }),
    ).toMatchObject({ state: "delivered", deliveredDevices: 1 });
  });

  it("treats unknown and inactive declarations as pending, not failed", () => {
    expect(
      derivePolicyDelivery({
        ...base,
        declarations: [
          declaration("device-1", "policy-1:mttx.apple.declaration.files", {
            valid: "unknown",
            active: false,
          }),
        ],
      }),
    ).toMatchObject({ state: "pending", failedDevices: 0, pendingDevices: 1 });
  });

  it("does not report a stale failure as the current failure", () => {
    expect(
      derivePolicyDelivery({
        ...base,
        declarations: [
          declaration("device-1", "policy-1:mttx.apple.declaration.files", {
            valid: "invalid",
            serverToken: "previous",
          }),
        ],
      }),
    ).toMatchObject({ state: "pending", failedDevices: 0, pendingDevices: 1 });
  });

  it("reports a policy whose every kind is provided by another policy as not applicable", () => {
    expect(
      derivePolicyDelivery({
        ...base,
        declarations: [
          declaration("device-1", "policy-2:mttx.apple.declaration.files", {
            serverToken: "current",
          }),
        ],
      }),
    ).toMatchObject({
      state: "not-applicable",
      overriddenDevices: 1,
      deliveredDevices: 0,
      pendingDevices: 0,
    });
  });

  it("does not wait for declarations from legacy-mode Apple devices", () => {
    expect(
      derivePolicyDelivery({
        ...base,
        devices: [appleDevice("device-1", "legacy")],
        declarations: [],
      }),
    ).toMatchObject({
      state: "not-tracked",
      trackedDevices: 0,
      legacyDevices: 1,
      pendingDevices: 0,
    });
  });

  it("falls back to status for legacy profiles whose token embeds the device", () => {
    expect(
      derivePolicyDelivery({
        ...base,
        configurations: [{ kind: "mttx.apple.device", hash: "current" }],
        declarations: [
          declaration("device-1", "policy-1:mttx.apple.device", {
            serverToken: "device-derived-token",
          }),
        ],
      }),
    ).toMatchObject({ state: "delivered", deliveredDevices: 1 });
  });
});
