import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import {
  resolveEffectivePolicy,
  type PolicyResolutionInput,
  type PolicyResolutionPolicy,
} from "../policyResolution.js";

const policy = (
  id: string,
  priority = 0,
  updatedAt = "2026-01-01T00:00:00.000Z",
): PolicyResolutionPolicy => ({ id, name: id, priority, updatedAt });

const configuration = (
  policyId: string,
  kind = "mttx.apple.device",
  data: Schema.Json = {},
) => ({
  policyId,
  kind,
  data,
  hash: `hash-${policyId}`,
});

const resolve = (input: Partial<PolicyResolutionInput>) =>
  resolveEffectivePolicy({
    deviceId: "device-1",
    groups: [],
    groupAssignments: [],
    deviceAssignments: [],
    policies: [],
    configurations: [],
    ...input,
  });

describe("policy resolution", () => {
  it("resolves a group include", () => {
    const result = resolve({
      groups: [{ id: "group-1", name: "Engineering" }],
      groupAssignments: [{ groupId: "group-1", policyId: "policy-a" }],
      policies: [policy("policy-a")],
      configurations: [configuration("policy-a")],
    });

    expect(result.configurations).toEqual([
      expect.objectContaining({
        kind: "mttx.apple.device",
        policyId: "policy-a",
        scope: "group",
        groupIds: ["group-1"],
        groupNames: ["Engineering"],
      }),
    ]);
    expect(result.policies).toEqual([
      expect.objectContaining({ policyId: "policy-a", kinds: ["mttx.apple.device"] }),
    ]);
    expect(result.overridden).toEqual([]);
  });

  it("makes a direct include beat a higher-priority group include", () => {
    const result = resolve({
      groups: [{ id: "group-1", name: "Engineering" }],
      groupAssignments: [{ groupId: "group-1", policyId: "group-policy" }],
      deviceAssignments: [{ policyId: "direct-policy", mode: "include" }],
      policies: [policy("group-policy", 100), policy("direct-policy", 0)],
      configurations: [configuration("group-policy"), configuration("direct-policy")],
    });

    expect(result.configurations[0]).toMatchObject({
      policyId: "direct-policy",
      scope: "direct",
    });
    expect(result.overridden).toEqual([
      expect.objectContaining({
        policyId: "group-policy",
        scope: "group",
        reason: "direct-device-include",
      }),
    ]);
  });

  it("lets a direct exclude remove a group include", () => {
    const result = resolve({
      groups: [{ id: "group-1", name: "Engineering" }],
      groupAssignments: [{ groupId: "group-1", policyId: "policy-a" }],
      deviceAssignments: [{ policyId: "policy-a", mode: "exclude" }],
      policies: [policy("policy-a")],
      configurations: [configuration("policy-a")],
    });

    expect(result.configurations).toEqual([]);
    expect(result.exclusions).toEqual([
      expect.objectContaining({
        policyId: "policy-a",
        scope: "direct",
        reason: "device-exclude",
        effective: true,
      }),
    ]);
  });

  it("uses a group exclude to veto group delivery from every group", () => {
    const result = resolve({
      groups: [
        { id: "group-1", name: "Engineering" },
        { id: "group-2", name: "All staff" },
      ],
      groupAssignments: [
        { groupId: "group-1", policyId: "policy-a", mode: "include" },
        { groupId: "group-2", policyId: "policy-a", mode: "exclude" },
      ],
      policies: [policy("policy-a")],
      configurations: [configuration("policy-a")],
    });

    expect(result.configurations).toEqual([]);
    expect(result.exclusions).toEqual([
      expect.objectContaining({
        policyId: "policy-a",
        scope: "group",
        groupId: "group-2",
        reason: "group-exclude",
        effective: true,
      }),
    ]);
  });

  it("lets a direct include override a group exclude", () => {
    const result = resolve({
      groups: [{ id: "group-1", name: "Engineering" }],
      groupAssignments: [{ groupId: "group-1", policyId: "policy-a", mode: "exclude" }],
      deviceAssignments: [{ policyId: "policy-a", mode: "include" }],
      policies: [policy("policy-a")],
      configurations: [configuration("policy-a")],
    });

    expect(result.configurations[0]).toMatchObject({ policyId: "policy-a", scope: "direct" });
  });

  it("picks the highest priority among included group policies", () => {
    const result = resolve({
      groups: [{ id: "group-1", name: "Engineering" }],
      groupAssignments: [
        { groupId: "group-1", policyId: "low" },
        { groupId: "group-1", policyId: "high" },
        { groupId: "group-1", policyId: "middle" },
      ],
      policies: [policy("low", 1), policy("high", 10), policy("middle", 5)],
      configurations: [configuration("low"), configuration("high"), configuration("middle")],
    });

    expect(result.configurations).toHaveLength(1);
    expect(result.configurations[0]).toMatchObject({ policyId: "high" });
    expect(result.overridden.map((entry) => [entry.policyId, entry.reason])).toEqual([
      ["low", "lower-priority"],
      ["middle", "lower-priority"],
    ]);
  });

  it("ties by most recently updated, then ascending id", () => {
    const newest = resolve({
      groups: [{ id: "group-1", name: "Engineering" }],
      groupAssignments: [
        { groupId: "group-1", policyId: "older" },
        { groupId: "group-1", policyId: "newer" },
      ],
      policies: [
        policy("older", 5, "2025-01-01T00:00:00.000Z"),
        policy("newer", 5, "2026-01-01T00:00:00.000Z"),
      ],
      configurations: [configuration("older"), configuration("newer")],
    });

    expect(newest.configurations[0]!.policyId).toBe("newer");

    const lexical = resolve({
      groups: [{ id: "group-1", name: "Engineering" }],
      groupAssignments: [
        { groupId: "group-1", policyId: "policy-b" },
        { groupId: "group-1", policyId: "policy-a" },
      ],
      policies: [
        policy("policy-b", 5, "2026-01-01T00:00:00.000Z"),
        policy("policy-a", 5, "2026-01-01T00:00:00.000Z"),
      ],
      configurations: [configuration("policy-b"), configuration("policy-a")],
    });

    expect(lexical.configurations[0]!.policyId).toBe("policy-a");
    expect(lexical.overridden).toEqual([
      expect.objectContaining({ policyId: "policy-b", reason: "lexicographic-id" }),
    ]);
  });

  it("resolves every configuration kind independently", () => {
    const result = resolve({
      groups: [{ id: "group-1", name: "Engineering" }],
      groupAssignments: [
        { groupId: "group-1", policyId: "wifi" },
        { groupId: "group-1", policyId: "security" },
      ],
      policies: [policy("wifi", 1), policy("security", 20)],
      configurations: [
        configuration("wifi", "mttx.apple.declaration.wifi"),
        configuration("security", "mttx.apple.device"),
        configuration("security", "mttx.apple.declaration.wifi"),
      ],
    });

    expect(result.configurations.map((entry) => [entry.kind, entry.policyId])).toEqual([
      ["mttx.apple.declaration.wifi", "security"],
      ["mttx.apple.device", "security"],
    ]);
    expect(result.policies).toEqual([
      expect.objectContaining({
        policyId: "security",
        kinds: ["mttx.apple.declaration.wifi", "mttx.apple.device"],
      }),
    ]);
  });

  it("reports inert exclusions separately from effective ones", () => {
    const result = resolve({
      groups: [{ id: "group-1", name: "Engineering" }],
      groupAssignments: [
        { groupId: "group-1", policyId: "included" },
        { groupId: "group-1", policyId: "excluded", mode: "exclude" },
      ],
      deviceAssignments: [{ policyId: "unassigned", mode: "exclude" }],
      policies: [policy("included"), policy("excluded"), policy("unassigned")],
      configurations: [
        configuration("included"),
        configuration("excluded"),
        configuration("unassigned"),
      ],
    });

    expect(result.configurations.map((entry) => entry.policyId)).toEqual(["included"]);
    expect(result.exclusions).toEqual([
      expect.objectContaining({
        policyId: "excluded",
        effective: false,
        reason: "group-exclude",
      }),
      expect.objectContaining({
        policyId: "unassigned",
        effective: false,
        reason: "device-exclude",
      }),
    ]);
  });
});

describe("user-assigned policies", () => {
  const user = (id: string) => ({ id, name: `User ${id}`, email: `${id}@example.test` });
  const directoryGroup = (id: string) => ({ id, name: `Directory ${id}` });

  it("applies a direct user policy to the device", () => {
    const result = resolve({
      users: [user("user-a")],
      userAssignments: [{ userId: "user-a", policyId: "user-policy" }],
      policies: [policy("user-policy")],
      configurations: [configuration("user-policy")],
    });

    expect(result.configurations).toEqual([
      expect.objectContaining({
        policyId: "user-policy",
        scope: "user",
        userIds: ["user-a"],
      }),
    ]);
  });

  it("does not override a device policy for the same kind", () => {
    const result = resolve({
      users: [user("user-a")],
      userAssignments: [{ userId: "user-a", policyId: "user-policy" }],
      deviceAssignments: [{ policyId: "device-policy" }],
      policies: [policy("device-policy"), policy("user-policy", 100)],
      configurations: [configuration("device-policy"), configuration("user-policy")],
    });

    expect(result.configurations).toEqual([
      expect.objectContaining({ policyId: "device-policy", scope: "direct" }),
    ]);
    expect(result.overridden).toContainEqual(
      expect.objectContaining({
        policyId: "user-policy",
        scope: "user",
        reason: "device-scope",
      }),
    );
  });

  it("prefers a user policy over a user group policy", () => {
    const result = resolve({
      users: [user("user-a")],
      userGroups: [directoryGroup("group-a")],
      userGroupMembers: [{ groupId: "group-a", userId: "user-a" }],
      userAssignments: [{ userId: "user-a", policyId: "user-policy" }],
      userGroupAssignments: [{ groupId: "group-a", policyId: "group-policy" }],
      policies: [policy("group-policy", 100), policy("user-policy", 0)],
      configurations: [configuration("group-policy"), configuration("user-policy")],
    });

    expect(result.configurations[0]).toMatchObject({
      policyId: "user-policy",
      scope: "user",
    });
    expect(result.overridden).toContainEqual(
      expect.objectContaining({
        policyId: "group-policy",
        scope: "user-group",
      }),
    );
  });

  it("keeps a policy one linked user includes when another is excluded", () => {
    const result = resolve({
      users: [user("user-a"), user("user-b")],
      userAssignments: [
        { userId: "user-a", policyId: "shared-policy", mode: "include" },
        { userId: "user-b", policyId: "shared-policy", mode: "exclude" },
      ],
      policies: [policy("shared-policy")],
      configurations: [configuration("shared-policy")],
    });

    // Delivery is device-wide, so excluding one user must not strip the policy
    // from the device that another linked user still needs.
    expect(result.configurations).toEqual([
      expect.objectContaining({
        policyId: "shared-policy",
        userIds: ["user-a"],
      }),
    ]);
    expect(result.exclusions).toContainEqual(
      expect.objectContaining({
        policyId: "shared-policy",
        scope: "user",
        userIds: ["user-b"],
        reason: "user-exclude",
        effective: false,
      }),
    );
  });

  it("drops a policy when every linked user is excluded", () => {
    const result = resolve({
      users: [user("user-a")],
      userAssignments: [
        { userId: "user-a", policyId: "shared-policy", mode: "include" },
        { userId: "user-a", policyId: "shared-policy", mode: "exclude" },
      ],
      policies: [policy("shared-policy")],
      configurations: [configuration("shared-policy")],
    });

    expect(result.configurations).toEqual([]);
  });

  it("removes only the excluded user from a directory-group policy", () => {
    const result = resolve({
      users: [user("user-a"), user("user-b")],
      userGroups: [directoryGroup("group-a")],
      userGroupMembers: [
        { groupId: "group-a", userId: "user-a" },
        { groupId: "group-a", userId: "user-b" },
      ],
      userAssignments: [{ userId: "user-b", policyId: "group-policy", mode: "exclude" }],
      userGroupAssignments: [{ groupId: "group-a", policyId: "group-policy" }],
      policies: [policy("group-policy")],
      configurations: [configuration("group-policy")],
    });

    expect(result.configurations).toEqual([
      expect.objectContaining({
        policyId: "group-policy",
        scope: "user-group",
        userIds: ["user-a"],
      }),
    ]);
    expect(result.exclusions).toContainEqual(
      expect.objectContaining({
        policyId: "group-policy",
        userIds: ["user-b"],
        reason: "user-exclude",
        effective: true,
      }),
    );
  });

  it("fills kinds not covered by device policies and merges contributing users", () => {
    const result = resolve({
      users: [user("user-a")],
      userAssignments: [{ userId: "user-a", policyId: "user-policy" }],
      deviceAssignments: [{ policyId: "device-policy" }],
      policies: [policy("device-policy"), policy("user-policy")],
      configurations: [
        configuration("device-policy", "mttx.apple.device"),
        configuration("user-policy", "mttx.apple.custom.wifi"),
      ],
    });

    expect(result.configurations).toEqual([
      expect.objectContaining({ kind: "mttx.apple.custom.wifi", scope: "user" }),
      expect.objectContaining({ kind: "mttx.apple.device", scope: "direct" }),
    ]);
    expect(result.policies).toHaveLength(2);
  });

  it("lets a device group exclusion veto a user include", () => {
    const result = resolve({
      groups: [{ id: "group-1", name: "Engineering" }],
      groupAssignments: [{ groupId: "group-1", policyId: "user-policy", mode: "exclude" }],
      users: [user("user-a")],
      userAssignments: [{ userId: "user-a", policyId: "user-policy" }],
      policies: [policy("user-policy")],
      configurations: [configuration("user-policy")],
    });

    expect(result.configurations).toEqual([]);
  });

  it("reports a user group exclusion", () => {
    const result = resolve({
      users: [user("user-a")],
      userGroups: [directoryGroup("group-a")],
      userGroupMembers: [{ groupId: "group-a", userId: "user-a" }],
      userGroupAssignments: [
        { groupId: "group-a", policyId: "policy-a", mode: "exclude" },
      ],
      policies: [policy("policy-a")],
      configurations: [configuration("policy-a")],
    });

    expect(result.configurations).toEqual([]);
    expect(result.exclusions).toContainEqual(
      expect.objectContaining({
        policyId: "policy-a",
        scope: "user-group",
        userGroupId: "group-a",
        reason: "user-group-exclude",
      }),
    );
  });
});
