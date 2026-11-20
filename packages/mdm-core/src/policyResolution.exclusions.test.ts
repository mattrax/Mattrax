import { describe, expect, it } from "vitest";
import {
  resolveEffectivePolicy,
  type PolicyResolutionInput,
} from "./policyResolution.ts";

const updatedAt = "2026-01-01T00:00:00.000Z";

const base = (): PolicyResolutionInput => ({
  deviceId: "device-1",
  groups: [{ id: "group-1", name: "Engineering" }],
  groupAssignments: [{ groupId: "group-1", policyId: "policy-1", mode: "include" }],
  deviceAssignments: [],
  users: [
    { id: "user-1", name: "Ada", email: "ada@acme.test" },
    { id: "user-2", name: "Grace", email: "grace@acme.test" },
  ],
  userGroups: [],
  userGroupMembers: [],
  userAssignments: [],
  userGroupAssignments: [],
  policies: [{ id: "policy-1", name: "Engineering settings", priority: 0, updatedAt }],
  configurations: [
    { policyId: "policy-1", kind: "com.apple.ManagedClient.preferences", scope: "user" },
  ],
});

describe("group person exclusions", () => {
  it("delivers a group's user-scoped configuration to every linked user", () => {
    for (const userId of ["user-1", "user-2"]) {
      const result = resolveEffectivePolicy({
        ...base(),
        channel: "user",
        forUserId: userId,
      });

      expect(result.configurations.map((configuration) => configuration.policyId)).toEqual([
        "policy-1",
      ]);
    }
  });

  it("skips the group's user-scoped delivery for an excluded person only", () => {
    const input: PolicyResolutionInput = {
      ...base(),
      groupUserExclusions: [{ groupId: "group-1", userId: "user-1" }],
    };

    const excluded = resolveEffectivePolicy({ ...input, channel: "user", forUserId: "user-1" });
    expect(excluded.configurations).toEqual([]);

    const other = resolveEffectivePolicy({ ...input, channel: "user", forUserId: "user-2" });
    expect(other.configurations.map((configuration) => configuration.policyId)).toEqual([
      "policy-1",
    ]);
  });

  it("does not remove device-scoped delivery for a shared device", () => {
    const result = resolveEffectivePolicy({
      ...base(),
      configurations: [
        { policyId: "policy-1", kind: "com.apple.ManagedClient.preferences", scope: "device" },
      ],
      groupUserExclusions: [{ groupId: "group-1", userId: "user-1" }],
    });

    expect(result.configurations.map((configuration) => configuration.policyId)).toEqual([
      "policy-1",
    ]);
  });

  it("ignores a group exclusion that targets a different person", () => {
    const result = resolveEffectivePolicy({
      ...base(),
      groupUserExclusions: [{ groupId: "group-1", userId: "user-2" }],
      channel: "user",
      forUserId: "user-1",
    });

    expect(result.configurations).toHaveLength(1);
  });
});
