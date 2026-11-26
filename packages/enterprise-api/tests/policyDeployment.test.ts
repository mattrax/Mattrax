import { describe, expect, it } from "vitest";
import { derivePolicyDelivery, resolvePolicyDeployment } from "@mattrax/enterprise-api";

const policyId = "policy-1";

const configuration = (kind: string, hash = "hash-current") => ({ kind, hash });

const apple = (id: string, declarationMode: "ddm" | "legacy" = "ddm") => ({
  id,
  name: id,
  proto: "apple",
  declarationMode,
});

const windows = (id: string) => ({ id, name: id, proto: "win", declarationMode: null });

const android = (id: string) => ({ id, name: id, proto: "android", declarationMode: null });

const declaration = (
  deviceId: string,
  kind: string,
  options: {
    policy?: string;
    valid?: string;
    active?: boolean;
    serverToken?: string | null;
    updatedAt?: string;
  } = {},
) => ({
  deviceId,
  identifier: (options.policy ?? policyId) + ":" + kind,
  valid: options.valid ?? "valid",
  active: options.active ?? true,
  serverToken: options.serverToken === undefined ? "hash-current" : options.serverToken,
  updatedAt: options.updatedAt ?? "2026-11-20T10:00:00.000Z",
});

const base = {
  policyId,
  version: 3,
  configurations: [configuration("mttx.apple.declaration.files")],
  devices: [apple("device-1")],
  declarations: [],
};

describe("resolvePolicyDeployment", () => {
  it("marks a device delivered only when every kind is reported current", () => {
    const result = resolvePolicyDeployment({
      ...base,
      declarations: [declaration("device-1", "mttx.apple.declaration.files")],
    });

    expect(result.state).toBe("delivered");
    expect(result.counts).toMatchObject({
      total: 1,
      scoped: 1,
      delivered: 1,
      pending: 0,
      failed: 0,
      notApplicable: 0,
      untracked: 0,
      notInScope: 0,
    });
    expect(result.devices[0]).toMatchObject({
      deviceId: "device-1",
      platform: "apple",
      status: "delivered",
      applicableKinds: 1,
      deliveredKinds: 1,
      lastEvidenceAt: "2026-11-20T10:00:00.000Z",
    });
  });

  it("leaves a device pending until the device reports", () => {
    const result = resolvePolicyDeployment({ ...base, declarations: [] });

    expect(result.state).toBe("pending");
    expect(result.counts.pending).toBe(1);
    expect(result.devices[0]).toMatchObject({
      status: "pending",
      applicableKinds: 1,
      deliveredKinds: 0,
      lastEvidenceAt: null,
      reason: "No report for this version yet.",
    });
  });

  it("requires every kind, not just one", () => {
    const result = resolvePolicyDeployment({
      ...base,
      configurations: [
        configuration("mttx.apple.declaration.files"),
        configuration("mttx.apple.declaration.passcode", "hash-passcode"),
      ],
      declarations: [declaration("device-1", "mttx.apple.declaration.files")],
    });

    expect(result.state).toBe("pending");
    expect(result.devices[0]).toMatchObject({
      status: "pending",
      applicableKinds: 2,
      deliveredKinds: 1,
      reason: "1 of 2 configurations reported.",
    });
  });

  it("reports an invalid current declaration as failed", () => {
    const result = resolvePolicyDeployment({
      ...base,
      declarations: [declaration("device-1", "mttx.apple.declaration.files", { valid: "invalid" })],
    });

    expect(result.state).toBe("failed");
    expect(result.counts.failed).toBe(1);
    expect(result.devices[0]).toMatchObject({
      status: "failed",
      deliveredKinds: 0,
      reason: "Invalid declaration: mttx.apple.declaration.files.",
    });
  });

  it("does not report a stale failure as the current failure", () => {
    const result = resolvePolicyDeployment({
      ...base,
      declarations: [
        declaration("device-1", "mttx.apple.declaration.files", {
          valid: "invalid",
          serverToken: "hash-previous",
        }),
      ],
    });

    expect(result.state).toBe("pending");
    expect(result.counts.failed).toBe(0);
    expect(result.devices[0]).toMatchObject({ status: "pending", deliveredKinds: 0 });
  });

  it("treats a previous save's valid declaration as pending", () => {
    const result = resolvePolicyDeployment({
      ...base,
      declarations: [
        declaration("device-1", "mttx.apple.declaration.files", {
          serverToken: "hash-previous",
        }),
      ],
    });

    expect(result.state).toBe("pending");
    expect(result.devices[0]).toMatchObject({
      status: "pending",
      lastEvidenceAt: "2026-11-20T10:00:00.000Z",
    });
  });

  it("reports an overridden kind as not applicable instead of pending", () => {
    const result = resolvePolicyDeployment({
      ...base,
      declarations: [
        declaration("device-1", "mttx.apple.declaration.files", { policy: "policy-2" }),
      ],
    });

    expect(result.state).toBe("not-applicable");
    expect(result.counts).toMatchObject({ notApplicable: 1, pending: 0, delivered: 0 });
    expect(result.devices[0]).toMatchObject({
      status: "not-applicable",
      applicableKinds: 0,
      reason: "Every configuration is provided by another policy.",
    });
  });

  it("keeps a device pending when only some kinds are overridden", () => {
    const result = resolvePolicyDeployment({
      ...base,
      configurations: [
        configuration("mttx.apple.declaration.files"),
        configuration("mttx.apple.declaration.passcode", "hash-passcode"),
      ],
      declarations: [
        declaration("device-1", "mttx.apple.declaration.files"),
        declaration("device-1", "mttx.apple.declaration.passcode", { policy: "policy-2" }),
      ],
    });

    expect(result.state).toBe("pending");
    expect(result.devices[0]).toMatchObject({
      status: "pending",
      applicableKinds: 1,
      deliveredKinds: 1,
      reason: "1 of 1 configurations reported.",
    });
  });

  it("accepts the resolved token of a variable-bearing configuration", () => {
    const result = resolvePolicyDeployment({
      ...base,
      configurations: [
        { kind: "mttx.apple.declaration.files", hash: "template-hash", hasVariables: true },
      ],
      declarations: [
        declaration("device-1", "mttx.apple.declaration.files", {
          serverToken: "resolved-hash",
        }),
      ],
    });

    expect(result.devices[0]).toMatchObject({ status: "delivered" });
  });

  it("never counts a legacy Apple device as delivered", () => {
    const result = resolvePolicyDeployment({
      ...base,
      devices: [apple("device-1", "legacy")],
      declarations: [],
      commands: [
        {
          deviceId: "device-1",
          requestType: "InstallProfile",
          status: "succeeded",
          updatedAt: "2026-11-20T09:00:00.000Z",
        },
      ],
    });

    expect(result.state).toBe("not-tracked");
    expect(result.counts).toMatchObject({ untracked: 1, delivered: 0 });
    expect(result.devices[0]).toMatchObject({
      status: "untracked",
      applicableKinds: 0,
      lastEvidenceAt: "2026-11-20T09:00:00.000Z",
      reason:
        "A legacy profile install succeeded, but legacy profiles do not report declaration status.",
    });
  });

  it("ignores failed legacy install commands as evidence", () => {
    const result = resolvePolicyDeployment({
      ...base,
      devices: [apple("device-1", "legacy")],
      commands: [
        {
          deviceId: "device-1",
          requestType: "InstallProfile",
          status: "failed",
          updatedAt: "2026-11-20T09:00:00.000Z",
        },
      ],
    });

    expect(result.devices[0]).toMatchObject({
      status: "untracked",
      lastEvidenceAt: null,
      reason: "Legacy profiles do not report declaration status.",
    });
  });

  it("marks Windows and Android as untracked with platform copy", () => {
    const result = resolvePolicyDeployment({
      ...base,
      devices: [windows("device-1"), android("device-2")],
    });

    expect(result.state).toBe("not-tracked");
    expect(result.counts).toMatchObject({ untracked: 2, delivered: 0, pending: 0 });
    expect(result.devices.map((row) => [row.status, row.reason])).toEqual([
      ["untracked", "Windows does not report declaration status."],
      ["untracked", "Android does not report declaration status."],
    ]);
  });

  it("marks a user-channel-only policy not applicable per device", () => {
    const result = resolvePolicyDeployment({
      ...base,
      configurations: [],
      hasUserScopedConfigurations: true,
      devices: [apple("device-1"), windows("device-2")],
    });

    expect(result.state).toBe("user-channel");
    expect(result.devices[0]).toMatchObject({ status: "untracked", platform: "windows" });
    expect(result.devices[1]).toMatchObject({
      status: "not-applicable",
      reason: "This policy only has user-channel settings.",
    });

    const appleOnly = resolvePolicyDeployment({
      ...base,
      configurations: [],
      hasUserScopedConfigurations: true,
    });

    expect(appleOnly.state).toBe("user-channel");
    expect(appleOnly.devices[0]).toMatchObject({ status: "not-applicable" });
  });

  it("reports a policy with no device kinds as no configurations", () => {
    const result = resolvePolicyDeployment({
      ...base,
      configurations: [{ kind: "mttx.windows.custom.wifi", hash: "hash-windows" }],
    });

    expect(result.state).toBe("no-configurations");
    expect(result.devices[0]).toMatchObject({
      status: "not-applicable",
      reason: "This version has no Apple configuration kinds.",
    });
  });

  it("surfaces a device that left scope while still reporting the version", () => {
    const result = resolvePolicyDeployment({
      ...base,
      outOfScopeDevices: [apple("device-2")],
      declarations: [
        declaration("device-1", "mttx.apple.declaration.files"),
        declaration("device-2", "mttx.apple.declaration.files", {
          updatedAt: "2026-11-19T10:00:00.000Z",
        }),
      ],
    });

    expect(result.state).toBe("delivered");
    expect(result.counts).toMatchObject({
      total: 2,
      scoped: 1,
      delivered: 1,
      notInScope: 1,
    });
    expect(result.devices.map((row) => row.status)).toEqual(["delivered", "not-in-scope"]);
    expect(result.devices[1]).toMatchObject({
      deviceId: "device-2",
      lastEvidenceAt: "2026-11-19T10:00:00.000Z",
      reason: "No longer in the policy's scope, but still reports this version's declarations.",
    });
  });

  it("does not invent an out-of-scope row for a device with no evidence", () => {
    const result = resolvePolicyDeployment({
      ...base,
      outOfScopeDevices: [apple("device-2")],
      declarations: [],
    });

    expect(result.counts.total).toBe(1);
    expect(result.devices.map((row) => row.deviceId)).toEqual(["device-1"]);
  });

  it("orders failed, pending and delivered rows action-first", () => {
    const result = resolvePolicyDeployment({
      ...base,
      devices: [apple("device-a"), apple("device-b"), apple("device-c")],
      declarations: [
        declaration("device-a", "mttx.apple.declaration.files"),
        declaration("device-b", "mttx.apple.declaration.files", { valid: "invalid" }),
      ],
    });

    expect(result.devices.map((row) => [row.deviceId, row.status])).toEqual([
      ["device-b", "failed"],
      ["device-c", "pending"],
      ["device-a", "delivered"],
    ]);
  });

  it("agrees with the policy list rollup for the same scope", () => {
    const devices = [apple("device-1"), apple("device-2"), apple("device-3")];

    const declarations = [
      declaration("device-1", "mttx.apple.declaration.files"),
      declaration("device-2", "mttx.apple.declaration.files", { valid: "invalid" }),
      declaration("device-3", "mttx.apple.declaration.files", { policy: "policy-2" }),
    ];

    const progress = resolvePolicyDeployment({
      ...base,
      devices,
      declarations,
    });

    const rollup = derivePolicyDelivery({
      policyId,
      version: base.version,
      configurations: base.configurations,
      devices,
      declarations,
    });

    expect(progress.counts.delivered).toBe(rollup.deliveredDevices);
    expect(progress.counts.pending).toBe(rollup.pendingDevices);
    expect(progress.counts.failed).toBe(rollup.failedDevices);
    expect(progress.counts.notApplicable).toBe(rollup.overriddenDevices);
    expect(progress.state).toBe(rollup.state);
  });
});
