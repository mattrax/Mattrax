/**
 * Policy precedence resolution.
 *
 * A device gets policies from two places: direct device assignments and the
 * policies of every group it belongs to. This pure resolver turns those
 * assignments plus each policy's configurations into one winner per
 * configuration kind.
 *
 * Precedence, from strongest to weakest:
 *
 * 1. A direct device *exclude* removes that policy from the device, including
 *    every group include of the same policy.
 * 2. A direct device *include* beats every group include and group exclude for
 *    the same policy. This is the only way to explicitly override a group
 *    exclusion.
 * 3. A group *exclude* vetoes that policy for all group delivery to the device,
 *    so another group cannot reintroduce it. Direct includes (rule 2) still
 *    win.
 * 4. Among included policies in the winning scope, the highest `priority`
 *    wins. Equal priorities break by most recent `updatedAt`, then by
 *    ascending policy id so the result is stable across check-ins.
 *
 * Exclusions are policy-level and therefore remove every configuration kind
 * that policy provides. A policy only participates in a kind it actually
 * has a configuration for.
 */

export type PolicyAssignmentMode = "include" | "exclude";

export type PolicyResolutionScope = "direct" | "group";

export type PolicyOverrideReason =
  | "direct-device-include"
  | "lower-priority"
  | "older-updated-at"
  | "lexicographic-id";

export type PolicyExclusionReason = "device-exclude" | "group-exclude";

export type PolicyResolutionPolicy = {
  readonly id: string;
  readonly name: string;
  /** Higher wins. Missing values are treated as 0. */
  readonly priority?: number;
  readonly updatedAt: Date | string;
};

export type PolicyResolutionConfiguration = {
  readonly policyId: string;
  readonly kind: string;
  /** Full configuration payload. Delivery needs it to build declarations. */
  readonly data?: unknown;
  readonly hash?: string;
};

export type PolicyResolutionGroup = {
  readonly id: string;
  readonly name: string;
};

export type PolicyResolutionGroupAssignment = {
  readonly groupId: string;
  readonly policyId: string;
  readonly mode?: PolicyAssignmentMode;
};

export type PolicyResolutionDeviceAssignment = {
  readonly policyId: string;
  readonly mode?: PolicyAssignmentMode;
};

export type PolicyResolutionInput = {
  readonly deviceId: string;
  readonly groups: ReadonlyArray<PolicyResolutionGroup>;
  readonly groupAssignments: ReadonlyArray<PolicyResolutionGroupAssignment>;
  readonly deviceAssignments: ReadonlyArray<PolicyResolutionDeviceAssignment>;
  readonly policies: ReadonlyArray<PolicyResolutionPolicy>;
  readonly configurations: ReadonlyArray<PolicyResolutionConfiguration>;
};

export type ResolvedConfiguration = {
  readonly kind: string;
  readonly policyId: string;
  readonly policyName: string;
  readonly priority: number;
  readonly scope: PolicyResolutionScope;
  /** Empty for direct assignments; sorted group ids for group assignments. */
  readonly groupIds: ReadonlyArray<string>;
  readonly groupNames: ReadonlyArray<string>;
  readonly data?: unknown;
  readonly hash?: string;
};

export type ContributingPolicy = {
  readonly policyId: string;
  readonly policyName: string;
  readonly priority: number;
  readonly scope: PolicyResolutionScope;
  readonly groupIds: ReadonlyArray<string>;
  readonly groupNames: ReadonlyArray<string>;
  readonly kinds: ReadonlyArray<string>;
};

export type OverriddenPolicy = {
  readonly kind: string;
  readonly policyId: string;
  readonly policyName: string;
  readonly priority: number;
  readonly scope: PolicyResolutionScope;
  readonly groupIds: ReadonlyArray<string>;
  readonly groupNames: ReadonlyArray<string>;
  readonly reason: PolicyOverrideReason;
};

export type PolicyExclusion = {
  readonly policyId: string;
  readonly policyName: string;
  readonly scope: PolicyResolutionScope;
  readonly groupId: string | null;
  readonly groupName: string | null;
  /** Configuration kinds the excluded policy would have contributed. */
  readonly kinds: ReadonlyArray<string>;
  /**
   * True when this exclusion actually removed a would-be group include. An
   * exclusion for a policy no group assigned is still reported, but inert.
   */
  readonly effective: boolean;
  readonly reason: PolicyExclusionReason;
};

export type EffectivePolicy = {
  readonly deviceId: string;
  readonly configurations: ReadonlyArray<ResolvedConfiguration>;
  readonly policies: ReadonlyArray<ContributingPolicy>;
  readonly overridden: ReadonlyArray<OverriddenPolicy>;
  readonly exclusions: ReadonlyArray<PolicyExclusion>;
};

type InternalCandidate = {
  readonly policy: PolicyResolutionPolicy;
  readonly configuration: PolicyResolutionConfiguration;
  readonly scope: PolicyResolutionScope;
  readonly groups: ReadonlyArray<PolicyResolutionGroup>;
};

const compareText = (left: string, right: string) => left.localeCompare(right);

const timestamp = (value: Date | string): number => {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);

  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Higher priority wins, then newest `updatedAt`, then ascending id. Ascending
 * id is arbitrary but stable; it only matters for exact priority/timestamp
 * ties (for example duplicated policies created in the same millisecond).
 */
const compareCandidates = (left: InternalCandidate, right: InternalCandidate): number => {
  const priority = (right.policy.priority ?? 0) - (left.policy.priority ?? 0);

  if (priority !== 0) return priority;
  const updated = timestamp(right.policy.updatedAt) - timestamp(left.policy.updatedAt);

  if (updated !== 0) return updated;

  return compareText(left.policy.id, right.policy.id);
};

const overrideReason = (
  winner: InternalCandidate,
  loser: InternalCandidate,
): PolicyOverrideReason => {
  if (loser.policy.priority !== winner.policy.priority) return "lower-priority";

  if (timestamp(loser.policy.updatedAt) !== timestamp(winner.policy.updatedAt))
    return "older-updated-at";

  return "lexicographic-id";
};

const sortedGroups = (groups: ReadonlyArray<PolicyResolutionGroup>) =>
  [...groups].sort(
    (left, right) => compareText(left.name, right.name) || compareText(left.id, right.id),
  );

export const resolveEffectivePolicy = (input: PolicyResolutionInput): EffectivePolicy => {
  const policies = new Map(input.policies.map((policy) => [policy.id, policy]));
  const configurations = new Map<string, Array<PolicyResolutionConfiguration>>();

  for (const configuration of input.configurations) {
    if (!policies.has(configuration.policyId)) continue;
    const list = configurations.get(configuration.policyId) ?? [];
    list.push(configuration);
    configurations.set(configuration.policyId, list);
  }

  const groups = new Map(input.groups.map((group) => [group.id, group]));
  const groupIncludes = new Map<string, Array<PolicyResolutionGroup>>();

  const groupExcludes = new Map<
    string,
    Array<{ group: PolicyResolutionGroup; policyId: string }>
  >();

  for (const assignment of input.groupAssignments) {
    const group = groups.get(assignment.groupId);

    if (!group || !policies.has(assignment.policyId)) continue;

    if ((assignment.mode ?? "include") === "exclude") {
      const list = groupExcludes.get(assignment.policyId) ?? [];
      list.push({ group, policyId: assignment.policyId });
      groupExcludes.set(assignment.policyId, list);
      continue;
    }

    const included = groupIncludes.get(assignment.policyId) ?? [];
    included.push(group);
    groupIncludes.set(assignment.policyId, included);
  }

  const directIncludes = new Set<string>();
  const directExcludes = new Set<string>();

  for (const assignment of input.deviceAssignments) {
    if (!policies.has(assignment.policyId)) continue;

    if ((assignment.mode ?? "include") === "exclude") directExcludes.add(assignment.policyId);
    else directIncludes.add(assignment.policyId);
  }

  const kinds = [
    ...new Set(
      input.configurations
        .filter((configuration) => policies.has(configuration.policyId))
        .map((configuration) => configuration.kind),
    ),
  ].sort(compareText);

  const resolved: Array<ResolvedConfiguration> = [];
  const overridden: Array<OverriddenPolicy> = [];

  for (const kind of kinds) {
    const withKind = (policyId: string) =>
      (configurations.get(policyId) ?? []).find((configuration) => configuration.kind === kind);

    const directCandidates: Array<InternalCandidate> = [];

    for (const policyId of directIncludes) {
      if (directExcludes.has(policyId)) continue;
      const configuration = withKind(policyId);

      if (!configuration) continue;
      directCandidates.push({
        policy: policies.get(policyId)!,
        configuration,
        scope: "direct",
        groups: [],
      });
    }

    const groupCandidates: Array<InternalCandidate> = [];

    for (const [policyId, includedGroups] of groupIncludes) {
      // A direct exclude is absolute, and any group exclusion vetoes group
      // delivery for that policy even when another group includes it.
      if (directExcludes.has(policyId) || groupExcludes.has(policyId)) continue;
      const configuration = withKind(policyId);

      if (!configuration) continue;
      groupCandidates.push({
        policy: policies.get(policyId)!,
        configuration,
        scope: "group",
        groups: sortedGroups(includedGroups),
      });
    }

    const candidates = directCandidates.length > 0 ? directCandidates : groupCandidates;

    if (candidates.length === 0) continue;

    const sorted = [...candidates].sort(compareCandidates);
    const winner = sorted[0]!;
    resolved.push({
      kind,
      policyId: winner.policy.id,
      policyName: winner.policy.name,
      priority: winner.policy.priority ?? 0,
      scope: winner.scope,
      groupIds: winner.groups.map((group) => group.id),
      groupNames: winner.groups.map((group) => group.name),
      data: winner.configuration.data,
      hash: winner.configuration.hash,
    });

    // A direct winner is stronger than every group candidate regardless of
    // priority. Within the winning scope the normal ordering applies.
    const losers: Array<{ candidate: InternalCandidate; reason: PolicyOverrideReason }> =
      directCandidates.length > 0
        ? [
            ...sorted
              .slice(1)
              .map((candidate) => ({ candidate, reason: overrideReason(winner, candidate) })),
            ...groupCandidates.map((candidate) => ({
              candidate,
              reason: "direct-device-include" as const,
            })),
          ]
        : sorted
            .slice(1)
            .map((candidate) => ({ candidate, reason: overrideReason(winner, candidate) }));

    for (const { candidate: loser, reason } of losers) {
      overridden.push({
        kind,
        policyId: loser.policy.id,
        policyName: loser.policy.name,
        priority: loser.policy.priority ?? 0,
        scope: loser.scope,
        groupIds: loser.groups.map((group) => group.id),
        groupNames: loser.groups.map((group) => group.name),
        reason,
      });
    }
  }

  const contributing = new Map<string, ContributingPolicy & { kinds: string[] }>();

  for (const configuration of resolved) {
    const existing = contributing.get(configuration.policyId);

    if (existing) {
      existing.kinds.push(configuration.kind);
      continue;
    }

    contributing.set(configuration.policyId, {
      policyId: configuration.policyId,
      policyName: configuration.policyName,
      priority: configuration.priority,
      scope: configuration.scope,
      groupIds: configuration.groupIds,
      groupNames: configuration.groupNames,
      kinds: [configuration.kind],
    });
  }

  const exclusions: Array<PolicyExclusion> = [];

  for (const policyId of directExcludes) {
    const policy = policies.get(policyId);

    if (!policy) continue;
    exclusions.push({
      policyId,
      policyName: policy.name,
      scope: "direct",
      groupId: null,
      groupName: null,
      kinds: (configurations.get(policyId) ?? []).map((row) => row.kind).sort(compareText),
      effective: groupIncludes.has(policyId),
      reason: "device-exclude",
    });
  }

  for (const [policyId, excludedGroups] of groupExcludes) {
    const policy = policies.get(policyId);

    if (!policy) continue;

    for (const group of sortedGroups(excludedGroups.map((row) => row.group))) {
      exclusions.push({
        policyId,
        policyName: policy.name,
        scope: "group",
        groupId: group.id,
        groupName: group.name,
        kinds: (configurations.get(policyId) ?? []).map((row) => row.kind).sort(compareText),
        effective: groupIncludes.has(policyId),
        reason: "group-exclude",
      });
    }
  }

  return {
    deviceId: input.deviceId,
    configurations: resolved.sort(
      (left, right) =>
        compareText(left.kind, right.kind) || compareText(left.policyId, right.policyId),
    ),
    policies: [...contributing.values()]
      .map((policy) => ({ ...policy, kinds: [...policy.kinds].sort(compareText) }))
      .sort((left, right) => compareText(left.policyName, right.policyName)),
    overridden: overridden.sort(
      (left, right) =>
        compareText(left.kind, right.kind) ||
        compareText(left.policyName, right.policyName) ||
        compareText(left.policyId, right.policyId),
    ),
    exclusions: exclusions.sort(
      (left, right) =>
        compareText(left.policyName, right.policyName) ||
        compareText(left.scope, right.scope) ||
        compareText(left.groupName ?? "", right.groupName ?? ""),
    ),
  };
};
