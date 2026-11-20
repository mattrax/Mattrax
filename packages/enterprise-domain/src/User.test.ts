import { describe, expect, it } from "vitest";
import { deriveUserPolicies, type UserGroupPolicyEdge, type UserPolicyEdge } from "./User.js";

const direct = (
  policyId: string,
  mode: "include" | "exclude" = "include",
  overrides: Partial<UserPolicyEdge> = {},
): UserPolicyEdge => ({
  policyId,
  policyName: `Policy ${policyId}`,
  priority: 0,
  enabled: true,
  mode,
  ...overrides,
});

const group = (
  policyId: string,
  groupId: string,
  mode: "include" | "exclude" = "include",
  overrides: Partial<UserGroupPolicyEdge> = {},
): UserGroupPolicyEdge => ({
  policyId,
  policyName: `Policy ${policyId}`,
  priority: 0,
  enabled: true,
  mode,
  groupId,
  groupName: `Group ${groupId}`,
  ...overrides,
});

describe("deriveUserPolicies", () => {
  it("lists a directly assigned policy with no group attribution", () => {
    expect(deriveUserPolicies({ direct: [direct("p1")], groups: [] })).toEqual([
      {
        policyId: "p1",
        policyName: "Policy p1",
        priority: 0,
        direct: true,
        groups: [],
        overriddenExclusions: [],
      },
    ]);
  });

  it("attributes a group-assigned policy to every including group", () => {
    const policies = deriveUserPolicies({
      direct: [],
      groups: [group("p1", "g2"), group("p1", "g1")],
    });

    expect(policies).toHaveLength(1);
    expect(policies[0]?.direct).toBe(false);
    expect(policies[0]?.groups).toEqual([
      { id: "g1", name: "Group g1" },
      { id: "g2", name: "Group g2" },
    ]);
  });

  it("de-duplicates a repeated group edge", () => {
    const policies = deriveUserPolicies({
      direct: [],
      groups: [group("p1", "g1"), group("p1", "g1")],
    });

    expect(policies[0]?.groups).toEqual([{ id: "g1", name: "Group g1" }]);
  });

  it("drops a policy that no assignment includes", () => {
    expect(deriveUserPolicies({ direct: [], groups: [] })).toEqual([]);
  });

  it("treats a group exclusion as a veto for every member of that group", () => {
    expect(
      deriveUserPolicies({
        direct: [],
        groups: [group("p1", "g1"), group("p1", "g2", "exclude")],
      }),
    ).toEqual([]);
  });

  it("lets a direct inclusion outrank a group exclusion", () => {
    const policies = deriveUserPolicies({
      direct: [direct("p1")],
      groups: [group("p1", "g1"), group("p1", "g2", "exclude")],
    });

    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatchObject({
      direct: true,
      groups: [{ id: "g1", name: "Group g1" }],
      overriddenExclusions: [{ id: "g2", name: "Group g2" }],
    });
  });

  it("lets a direct exclusion veto a direct inclusion and its groups", () => {
    expect(
      deriveUserPolicies({
        direct: [direct("p1"), direct("p1", "exclude")],
        groups: [group("p1", "g1")],
      }),
    ).toEqual([]);
  });

  it("drops a disabled policy even when it is assigned", () => {
    expect(
      deriveUserPolicies({
        direct: [direct("p1", "include", { enabled: false })],
        groups: [group("p1", "g1")],
      }),
    ).toEqual([]);
  });

  it("keeps the policy enabled unless an edge disables it", () => {
    const policies = deriveUserPolicies({
      direct: [direct("p1")],
      groups: [group("p1", "g1", "include", { enabled: false })],
    });

    expect(policies).toEqual([]);
  });

  it("sorts by policy name and then id", () => {
    const policies = deriveUserPolicies({
      direct: [direct("p2", "include", { policyName: "Beta" })],
      groups: [
        group("p1", "g1", "include", { policyName: "Alpha" }),
        group("p3", "g1", "include", { policyName: "Alpha" }),
      ],
    });

    expect(policies.map((policy) => policy.policyId)).toEqual(["p1", "p3", "p2"]);
  });
});
