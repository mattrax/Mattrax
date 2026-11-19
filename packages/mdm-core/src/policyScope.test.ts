import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  derivePolicyPlatformSupport,
  resolveGroupScope,
  resolvePolicyScope,
  type PolicyScopeResolutionInput,
} from "./policyScope.ts";
import type { PolicyResolutionConfiguration, PolicyResolutionPolicy } from "./policyResolution.ts";

const policy = (
  id: string,
  priority = 0,
  updatedAt = "2026-01-01T00:00:00.000Z",
): PolicyResolutionPolicy => ({ id, name: id, priority, updatedAt });

const device = (
  id: string,
  options: Partial<PolicyScopeResolutionInput["devices"][number]> = {},
) => ({
  id,
  name: id,
  proto: "apple",
  osEdition: "macOS",
  osVersion: "14.0",
  ...options,
});

const configuration = (
  policyId: string,
  kind = "mttx.apple.device",
  options: { scope?: "device" | "user"; data?: Schema.Json } = {},
): PolicyResolutionConfiguration => ({
  policyId,
  kind,
  scope: options.scope ?? ("device" as const),
  data: options.data ?? {},
  hash: `hash-${policyId}-${kind}`,
});

const input = (
  overrides: Partial<PolicyScopeResolutionInput> = {},
): PolicyScopeResolutionInput => ({
  policies: [],
  configurations: [],
  devices: [],
  groups: [],
  groupAssignments: [],
  groupMembers: [],
  deviceAssignments: [],
  users: [],
  deviceUsers: [],
  userGroups: [],
  userGroupMembers: [],
  userAssignments: [],
  userGroupAssignments: [],
  ...overrides,
});

describe("resolvePolicyScope", () => {
  it("applies to a directly assigned device", async () => {
    const scope = await resolvePolicyScope(
      input({
        policies: [policy("policy-a")],
        configurations: [configuration("policy-a")],
        devices: [device("device-1")],
        deviceAssignments: [{ deviceId: "device-1", policyId: "policy-a", mode: "include" }],
      }),
      "policy-a",
    );

    expect(scope.devices).toEqual([
      expect.objectContaining({
        deviceId: "device-1",
        channel: "device",
        status: "applies",
        reason: "applies",
        kinds: ["mttx.apple.device"],
      }),
    ]);
    expect(scope.platforms).toEqual(["apple"]);
    expect(scope.channels).toEqual(["device"]);
  });

  it("applies through a group include", async () => {
    const scope = await resolvePolicyScope(
      input({
        policies: [policy("policy-a")],
        configurations: [configuration("policy-a")],
        devices: [device("device-1")],
        groups: [{ id: "group-1", name: "Engineering" }],
        groupAssignments: [{ groupId: "group-1", policyId: "policy-a", mode: "include" }],
        groupMembers: [{ groupId: "group-1", deviceId: "device-1" }],
      }),
      "policy-a",
    );

    expect(scope.devices[0]).toMatchObject({ status: "applies", reason: "applies" });
  });

  it("reports a direct device exclude ahead of a group include", async () => {
    const scope = await resolvePolicyScope(
      input({
        policies: [policy("policy-a")],
        configurations: [configuration("policy-a")],
        devices: [device("device-1")],
        groups: [{ id: "group-1", name: "Engineering" }],
        groupAssignments: [{ groupId: "group-1", policyId: "policy-a", mode: "include" }],
        groupMembers: [{ groupId: "group-1", deviceId: "device-1" }],
        deviceAssignments: [{ deviceId: "device-1", policyId: "policy-a", mode: "exclude" }],
      }),
      "policy-a",
    );

    expect(scope.devices[0]).toMatchObject({
      status: "excluded",
      reason: "device-exclude",
      kinds: [],
    });
    expect(scope.devices[0]!.exclusions[0]).toMatchObject({
      reason: "device-exclude",
      effective: true,
    });
  });

  it("lets a group exclude veto another group's include", async () => {
    const scope = await resolvePolicyScope(
      input({
        policies: [policy("policy-a")],
        configurations: [configuration("policy-a")],
        devices: [device("device-1")],
        groups: [
          { id: "group-include", name: "Engineering" },
          { id: "group-exclude", name: "Contractors" },
        ],
        groupAssignments: [
          { groupId: "group-include", policyId: "policy-a", mode: "include" },
          { groupId: "group-exclude", policyId: "policy-a", mode: "exclude" },
        ],
        groupMembers: [
          { groupId: "group-include", deviceId: "device-1" },
          { groupId: "group-exclude", deviceId: "device-1" },
        ],
      }),
      "policy-a",
    );

    expect(scope.devices[0]).toMatchObject({
      status: "excluded",
      reason: "group-exclude",
    });
    expect(scope.devices[0]!.exclusions[0]).toMatchObject({
      groupName: "Contractors",
      effective: true,
    });
  });

  it("reports the higher priority policy as the winner", async () => {
    const scope = await resolvePolicyScope(
      input({
        policies: [policy("policy-low", 1), policy("policy-high", 10)],
        configurations: [configuration("policy-low"), configuration("policy-high")],
        devices: [device("device-1")],
        groups: [{ id: "group-1", name: "Engineering" }],
        groupAssignments: [
          { groupId: "group-1", policyId: "policy-low", mode: "include" },
          { groupId: "group-1", policyId: "policy-high", mode: "include" },
        ],
        groupMembers: [{ groupId: "group-1", deviceId: "device-1" }],
      }),
      "policy-low",
    );

    expect(scope.devices[0]).toMatchObject({
      status: "overridden",
      reason: "higher-priority",
      losses: [
        expect.objectContaining({
          kind: "mttx.apple.device",
          reason: "higher-priority",
          winnerPolicyId: "policy-high",
        }),
      ],
    });
  });

  it("reports the newer policy as the winner when priorities tie", async () => {
    const scope = await resolvePolicyScope(
      input({
        policies: [
          policy("policy-old", 0, "2026-01-01T00:00:00.000Z"),
          policy("policy-new", 0, "2026-02-01T00:00:00.000Z"),
        ],
        configurations: [configuration("policy-old"), configuration("policy-new")],
        devices: [device("device-1")],
        groupAssignments: [
          { groupId: "group-1", policyId: "policy-old", mode: "include" },
          { groupId: "group-1", policyId: "policy-new", mode: "include" },
        ],
        groups: [{ id: "group-1", name: "Engineering" }],
        groupMembers: [{ groupId: "group-1", deviceId: "device-1" }],
      }),
      "policy-old",
    );

    expect(scope.devices[0]).toMatchObject({
      status: "overridden",
      reason: "newer-updated-at",
      losses: [expect.objectContaining({ winnerPolicyId: "policy-new" })],
    });
  });

  it("breaks exact ties by ascending policy id", async () => {
    const scope = await resolvePolicyScope(
      input({
        policies: [policy("policy-a"), policy("policy-b")],
        configurations: [configuration("policy-a"), configuration("policy-b")],
        devices: [device("device-1")],
        groups: [{ id: "group-1", name: "Engineering" }],
        groupAssignments: [
          { groupId: "group-1", policyId: "policy-a", mode: "include" },
          { groupId: "group-1", policyId: "policy-b", mode: "include" },
        ],
        groupMembers: [{ groupId: "group-1", deviceId: "device-1" }],
      }),
      "policy-b",
    );

    expect(scope.devices[0]).toMatchObject({
      status: "overridden",
      reason: "lexicographic-id",
      losses: [expect.objectContaining({ winnerPolicyId: "policy-a" })],
    });
  });

  it("marks a device whose OS is older than the policy requires", async () => {
    const scope = await resolvePolicyScope(
      input({
        policies: [policy("policy-a")],
        configurations: [
          configuration("policy-a", "mttx.apple.certificate.cert", { data: { pem: "cert" } }),
        ],
        devices: [device("device-1", { osVersion: "13.6" })],
        deviceAssignments: [{ deviceId: "device-1", policyId: "policy-a", mode: "include" }],
      }),
      "policy-a",
    );

    expect(scope.apple).toContainEqual({ family: "macOS", minimum: "14.0" });
    expect(scope.devices[0]).toMatchObject({
      status: "unsupported-os",
      reason: "os-unsupported",
      kinds: [],
      unsupportedKinds: ["mttx.apple.certificate.cert"],
    });
  });

  it("marks a user-scoped policy as the wrong scope on a platform with no user channel", async () => {
    const scope = await resolvePolicyScope(
      input({
        policies: [policy("policy-a")],
        configurations: [configuration("policy-a", "mttx.apple.device", { scope: "user" })],
        devices: [device("device-1", { proto: "android", osEdition: "Android", osVersion: "14" })],
        deviceAssignments: [{ deviceId: "device-1", policyId: "policy-a", mode: "include" }],
      }),
      "policy-a",
    );

    expect(scope.channels).toEqual(["user"]);
    expect(scope.devices[0]).toMatchObject({
      channel: "user",
      status: "wrong-scope",
      reason: "wrong-scope",
    });
  });

  it("resolves a user-scoped policy on the linked user's Apple channel", async () => {
    const scope = await resolvePolicyScope(
      input({
        policies: [policy("policy-a")],
        configurations: [configuration("policy-a", "mttx.apple.device", { scope: "user" })],
        devices: [device("device-1")],
        users: [{ id: "user-1", name: "Oscar" }],
        deviceUsers: [{ deviceId: "device-1", userId: "user-1" }],
        userAssignments: [{ userId: "user-1", policyId: "policy-a", mode: "include" }],
      }),
      "policy-a",
    );

    expect(scope.devices).toEqual([
      expect.objectContaining({
        deviceId: "device-1",
        channel: "user",
        userId: "user-1",
        userName: "Oscar",
        status: "applies",
        reason: "applies",
        kinds: ["mttx.apple.device"],
      }),
    ]);
  });

  it("reports a device with no linked user on a user policy", async () => {
    const scope = await resolvePolicyScope(
      input({
        policies: [policy("policy-a")],
        configurations: [configuration("policy-a", "mttx.apple.device", { scope: "user" })],
        devices: [device("device-1")],
        deviceAssignments: [{ deviceId: "device-1", policyId: "policy-a", mode: "include" }],
      }),
      "policy-a",
    );

    expect(scope.devices[0]).toMatchObject({
      status: "not-included",
      reason: "no-linked-user",
    });
  });
});

describe("resolveGroupScope", () => {
  it("lists the group's policies and the member devices each wins on", async () => {
    const scope = await resolveGroupScope(
      input({
        policies: [policy("policy-low"), policy("policy-high", 10)],
        configurations: [configuration("policy-low"), configuration("policy-high")],
        devices: [device("device-1")],
        groups: [{ id: "group-1", name: "Engineering" }],
        groupAssignments: [
          { groupId: "group-1", policyId: "policy-low", mode: "include" },
          { groupId: "group-1", policyId: "policy-high", mode: "include" },
        ],
        groupMembers: [{ groupId: "group-1", deviceId: "device-1" }],
      }),
      "group-1",
    );

    expect(scope.memberCount).toBe(1);
    expect(scope.policies).toEqual([
      expect.objectContaining({
        policyId: "policy-high",
        devices: [expect.objectContaining({ status: "applies" })],
      }),
      expect.objectContaining({
        policyId: "policy-low",
        devices: [expect.objectContaining({ status: "overridden" })],
      }),
    ]);
  });

  it("keeps an excluded policy visible with its effect", async () => {
    const scope = await resolveGroupScope(
      input({
        policies: [policy("policy-a")],
        configurations: [configuration("policy-a")],
        devices: [device("device-1")],
        groups: [{ id: "group-1", name: "Engineering" }],
        groupAssignments: [{ groupId: "group-1", policyId: "policy-a", mode: "exclude" }],
        groupMembers: [{ groupId: "group-1", deviceId: "device-1" }],
      }),
      "group-1",
    );

    expect(scope.policies[0]).toMatchObject({ policyId: "policy-a", mode: "exclude" });
    expect(scope.policies[0]!.devices[0]).toMatchObject({ status: "excluded" });
  });
});

describe("derivePolicyPlatformSupport", () => {
  it("derives platforms, OS range and channel scope from configurations", async () => {
    const support = await derivePolicyPlatformSupport([
      configuration("policy-a", "mttx.apple.device", { scope: "device" }),
      configuration("policy-a", "mttx.windows.custom.wifi", {
        scope: "device",
        data: { nodes: [{ omaUri: "./Vendor/MSFT/WiFi", minOs: "10.0.22000+" }] },
      }),
    ]);

    expect(support.platforms).toEqual(["apple", "windows"]);
    expect(support.apple).toContainEqual({ family: "macOS", minimum: "10.7" });
    expect(support.windowsMinimum).toBe("10.0.22000");
    expect(support.channels).toEqual(["device"]);
  });

  it("reports both channels for a mixed policy", async () => {
    const support = await derivePolicyPlatformSupport([
      configuration("policy-a", "mttx.apple.device"),
      configuration("policy-a", "mttx.apple.device", { scope: "user" }),
    ]);

    expect(support.channels).toEqual(["device", "user"]);
  });
});
