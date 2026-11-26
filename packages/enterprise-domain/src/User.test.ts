import { describe, expect, it } from "vitest";
import {
  deriveUserPolicies,
  userMergeCandidateReasons,
  userMergeRequiresExternalIdConfirmation,
} from "./User.js";
import type { UserGroupPolicyEdge, UserPolicyEdge } from "./User.js";

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

describe("merge duplicate directory users", () => {
  const evidence = (overrides: Partial<Parameters<typeof userMergeCandidateReasons>[0]> = {}) => ({
    targetEmail: "ada@acme.test",
    candidateEmail: "ada.old@acme.test",
    candidateExternalId: "new-object",
    mergedExternalIds: new Set<string>(),
    mergedEmails: new Set<string>(),
    ...overrides,
  });

  it("does not flag an unrelated directory person", () => {
    expect(userMergeCandidateReasons(evidence())).toEqual([]);
  });

  it("flags a shared address, case and whitespace insensitively", () => {
    expect(userMergeCandidateReasons(evidence({ candidateEmail: "  ADA@acme.test " }))).toEqual([
      "same-email",
    ]);
  });

  it("flags a recreated provider object from an earlier merge", () => {
    expect(
      userMergeCandidateReasons(evidence({ mergedExternalIds: new Set(["new-object"]) })),
    ).toEqual(["previously-merged"]);
  });

  it("flags an address an earlier merge absorbed", () => {
    expect(
      userMergeCandidateReasons(evidence({ mergedEmails: new Set(["ada.old@acme.test"]) })),
    ).toEqual(["previously-merged"]);
  });

  it("reports both reasons in a stable order", () => {
    expect(
      userMergeCandidateReasons(
        evidence({
          candidateEmail: "ada@acme.test",
          mergedExternalIds: new Set(["new-object"]),
        }),
      ),
    ).toEqual(["previously-merged", "same-email"]);
  });

  it("only needs confirmation when a non-null external id differs", () => {
    expect(
      userMergeRequiresExternalIdConfirmation({
        targetExternalId: "target-object",
        sourceExternalIds: ["target-object", null, undefined],
      }),
    ).toBe(false);

    expect(
      userMergeRequiresExternalIdConfirmation({
        targetExternalId: "target-object",
        sourceExternalIds: ["other-object"],
      }),
    ).toBe(true);

    // A null target id still has no object identity to contradict.
    expect(
      userMergeRequiresExternalIdConfirmation({
        targetExternalId: null,
        sourceExternalIds: [null],
      }),
    ).toBe(false);

    expect(
      userMergeRequiresExternalIdConfirmation({
        targetExternalId: null,
        sourceExternalIds: ["object"],
      }),
    ).toBe(true);
  });
});
