import { DeviceId, PolicyId } from "@mattrax/crypto";
import { describe, expect, it } from "vitest";
import type { PolicyScopeDevice } from "@mattrax/enterprise-domain/client";
import {
  groupScopeBlockedDeviceIds,
  groupScopePolicyIsInert,
  groupScopeWinningDeviceIds,
  policyOsRangeLabel,
  policyScopeChannelLabel,
  policyScopeCounts,
  policyScopeReasonLabel,
  policyScopeStatusLabel,
  policyScopeWarnings,
} from "./policy-scope";

const entry = (overrides: Partial<PolicyScopeDevice> = {}): PolicyScopeDevice => ({
  deviceId: DeviceId.fromParam("dv_device-1"),
  deviceName: "Oscar's Mac",
  platform: "apple",
  deviceOs: "macOS 14.2",
  channel: "device",
  status: "applies",
  reason: "applies",
  kinds: ["mttx.apple.device"],
  unsupportedKinds: [],
  losses: [],
  exclusions: [],
  ...overrides,
});

describe("policyOsRangeLabel", () => {
  it("renders every derived family plus the Windows build", () => {
    expect(
      policyOsRangeLabel({
        platforms: ["apple", "windows"],
        apple: [
          { family: "macOS", minimum: "14.0" },
          { family: "iOS", minimum: "17.0" },
        ],
        windowsMinimum: "10.0.22000",
      }),
    ).toBe("macOS 14.0+ · iOS 17.0+ · Windows 10.0.22000+");
  });

  it("returns null when no metadata is available", () => {
    expect(
      policyOsRangeLabel({ platforms: ["android"], apple: [], windowsMinimum: null }),
    ).toBeNull();
  });
});

describe("policyScopeChannelLabel", () => {
  it("names a mixed policy as both scopes", () => {
    expect(policyScopeChannelLabel(["device", "user"])).toBe("Device and user scoped");
    expect(policyScopeChannelLabel(["user"])).toBe("User scoped");
    expect(policyScopeChannelLabel(["device"])).toBe("Device scoped");
  });
});

describe("policyScopeReasonLabel", () => {
  it("names the higher priority policy that wins", () => {
    expect(
      policyScopeReasonLabel(
        entry({
          status: "overridden",
          reason: "higher-priority",
          kinds: [],
          losses: [
            {
              kind: "mttx.apple.device",
              reason: "higher-priority",
              winnerPolicyId: "policy-high",
              winnerPolicyName: "High",
            },
          ],
        }),
      ),
    ).toBe("Higher priority policy High wins");
  });

  it("names the group that excludes the device", () => {
    expect(
      policyScopeReasonLabel(
        entry({
          status: "excluded",
          reason: "group-exclude",
          kinds: [],
          exclusions: [{ reason: "group-exclude", groupName: "Contractors", effective: true }],
        }),
      ),
    ).toBe("It is excluded by group Contractors");
  });

  it("explains a policy the device OS cannot apply", () => {
    expect(
      policyScopeReasonLabel(
        entry({
          status: "unsupported-os",
          reason: "os-unsupported",
          deviceOs: "macOS 13.6",
          kinds: [],
          unsupportedKinds: ["mttx.apple.certificate.cert"],
        }),
      ),
    ).toBe("macOS 13.6 does not support mttx.apple.certificate.cert");
  });

  it("explains a user-scoped policy on a platform with no user channel", () => {
    expect(
      policyScopeReasonLabel(
        entry({ channel: "user", status: "wrong-scope", reason: "wrong-scope" }),
      ),
    ).toBe("Only device-scoped settings, which are delivered on the device channel");
  });
});

describe("policyScopeWarnings", () => {
  it("deduplicates per-device warnings and includes the required range", () => {
    const warnings = policyScopeWarnings({
      apple: [{ family: "macOS", minimum: "14.0" }],
      windowsMinimum: null,
      channels: ["device"],
      devices: [
        entry({
          deviceId: DeviceId.fromParam("dv_device-1"),
          status: "unsupported-os",
          reason: "os-unsupported",
          deviceOs: "macOS 13.6",
          unsupportedKinds: ["mttx.apple.certificate.cert"],
        }),
        entry({
          deviceId: DeviceId.fromParam("dv_device-1"),
          status: "unsupported-os",
          reason: "os-unsupported",
          deviceOs: "macOS 13.6",
          unsupportedKinds: ["mttx.apple.certificate.cert"],
        }),
        entry({ deviceId: DeviceId.fromParam("dv_device-2") }),
      ],
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      kind: "unsupported-os",
      deviceId: DeviceId.fromParam("dv_device-1"),
      message: "macOS 13.6 does not support mttx.apple.certificate.cert (requires macOS 14.0+).",
    });
  });

  it("warns about a platform with no user channel", () => {
    const warnings = policyScopeWarnings({
      apple: [],
      windowsMinimum: null,
      channels: ["user"],
      devices: [
        entry({
          deviceId: DeviceId.fromParam("dv_device-2"),
          platform: "android",
          channel: "user",
          status: "wrong-scope",
          reason: "wrong-scope",
        }),
      ],
    });

    expect(warnings[0]?.message).toContain("platform has no user channel");
  });
});

describe("policyScopeCounts", () => {
  it("counts distinct devices across user-channel entries", () => {
    const counts = policyScopeCounts([
      entry({ userId: "user-1", channel: "user", userName: "Oscar" }),
      entry({ userId: "user-2", channel: "user", userName: "Sam" }),
      entry({
        deviceId: DeviceId.fromParam("dv_device-2"),
        status: "overridden",
        reason: "higher-priority",
        kinds: [],
      }),
    ]);

    expect(counts).toMatchObject({ devices: 2, applies: 1, overridden: 1 });
  });
});

describe("group scope helpers", () => {
  const policy = {
    policyId: PolicyId.fromParam("pl_policy-1"),
    policyName: "Security",
    mode: "include" as const,
    devices: [
      entry({ deviceId: DeviceId.fromParam("dv_device-1"), status: "applies" as const }),
      entry({
        deviceId: DeviceId.fromParam("dv_device-2"),
        status: "overridden" as const,
        reason: "higher-priority" as const,
        kinds: [],
      }),
    ],
  };

  it("lists only the devices the policy wins on", () => {
    expect(groupScopeWinningDeviceIds(policy)).toEqual(["dv_device-1"]);
  });

  it("lists the devices an exclude assignment blocks", () => {
    expect(
      groupScopeBlockedDeviceIds({
        ...policy,
        mode: "exclude",
        devices: [
          entry({ deviceId: DeviceId.fromParam("dv_device-1"), status: "excluded", reason: "group-exclude" }),
          entry({ deviceId: DeviceId.fromParam("dv_device-1"), status: "excluded", reason: "group-exclude" }),
        ],
      }),
    ).toEqual(["dv_device-1"]);
  });

  it("marks an include that wins nowhere as inert", () => {
    expect(groupScopePolicyIsInert({ ...policy, devices: policy.devices.slice(1) })).toBe(true);
    expect(groupScopePolicyIsInert(policy)).toBe(false);
  });

  it("keeps a status label for every outcome", () => {
    expect(policyScopeStatusLabel(entry({ status: "partial" }))).toBe("Partly applies");
    expect(policyScopeStatusLabel(entry({ status: "not-included" }))).toBe("Not included");
  });
});
