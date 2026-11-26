import type { Schema } from "effect";

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
 * 3. A device assignment (direct or group) beats a user assignment for the
 *    same configuration kind. A user policy therefore fills kinds the device
 *    policies do not provide; it does not replace them.
 * 4. A group *exclude* vetoes that policy for all group delivery to the device,
 *    so another group cannot reintroduce it. Direct includes (rule 2) still
 *    win.
 * 5. Among included policies in the winning scope, the highest `priority`
 *    wins. Equal priorities break by most recent `updatedAt`, then by
 *    ascending policy id so the result is stable across check-ins.
 *
 * Exclusions layered on top:
 *
 * - A device explicitly excluded from a group is not a member of that group at
 *   all. The loader filters those membership rows before resolution, so the
 *   group's includes, excludes, scripts and applications all stop applying.
 *   This wins over manual membership, rule matches and inherited membership.
 * - A directory user explicitly excluded from a group has that group's
 *   user-scoped delivery skipped on their channel (`groupUserExclusions`). The
 *   device channel and other linked users are unaffected: excluding a person
 *   must never silently pull a shared device out of device-scoped policy.
 *
 * Nested groups are flattened into the membership rows the loader reads, so a
 * parent's assignment is resolved once per device; it is never applied twice.
 *
 * A configuration carries a delivery channel. Device-scoped configurations
 * are resolved for the device channel and apply to every user; user-scoped
 * configurations are resolved for one authenticated user channel and never
 * reach the device channel. Device and group assignments contribute their
 * user-scoped configurations to every user of the device; a user assignment
 * contributes only to that user. Device scope beats user scope for the same
 * kind, so a device policy always wins over a user policy on the user channel.
 *
 * User assignments on the device channel are legacy device-wide delivery for
 * device-scoped configurations. User exclusions are applied per user;
 * excluding one linked user never removes a policy that another linked user
 * includes. A direct user include beats that user's directory-group
 * assignments.
 *
 * Exclusions are policy-level and therefore remove every configuration kind
 * that policy provides. A policy only participates in a kind it actually
 * has a configuration for.
 *
 * A disabled policy is treated as if it were not assigned at all. It
 * contributes no configurations and its includes and exclusions are ignored,
 * which is what withdraws its settings from devices without deleting the
 * policy.
 */

export type PolicyAssignmentMode = "include" | "exclude";

/** The MDM channel a resolution is for. */
export type PolicyChannel = "device" | "user";

/** The delivery channel of one configuration. */
export type ConfigurationScope = "device" | "user";

export type PolicyResolutionScope = "direct" | "group" | "user" | "user-group";

export type PolicyOverrideReason =
  | "direct-device-include"
  | "direct-user-include"
  | "device-scope"
  | "lower-priority"
  | "older-updated-at"
  | "lexicographic-id";

export type PolicyExclusionReason =
  | "device-exclude"
  | "group-exclude"
  | "user-exclude"
  | "user-group-exclude";

export type PolicyResolutionPolicy = {
  readonly id: string;
  readonly name: string;
  /** Higher wins. Missing values are treated as 0. */
  readonly priority?: number;
  /**
   * A disabled policy contributes nothing: no configurations, includes or
   * exclusions. Missing values are enabled, so older callers keep working.
   */
  readonly enabled?: boolean;
  readonly updatedAt: Date | string;
};

export type PolicyResolutionConfiguration = {
  readonly policyId: string;
  readonly kind: string;
  /** Defaults to `device` for rows that predate explicit scoping. */
  readonly scope?: ConfigurationScope;
  /** Full configuration payload. Delivery needs it to build declarations. */
  readonly data?: Schema.Json;
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

export type PolicyResolutionUser = {
  readonly id: string;
  readonly name?: string | null;
  readonly email?: string | null;
};

export type PolicyResolutionUserGroup = {
  readonly id: string;
  readonly name: string;
};

/**
 * A directory user explicitly excluded from a device group.
 *
 * The group's user-scoped delivery is skipped for that person on the user
 * channel. Device-scoped membership is unaffected: an excluded person never
 * removes a shared device from device policy, and that is why this is separate
 * from the loader's device-exclusion filter.
 */
export type PolicyResolutionGroupUserExclusion = {
  readonly groupId: string;
  readonly userId: string;
};

/** A policy assigned directly to a directory user linked to the device. */
export type PolicyResolutionUserAssignment = {
  readonly userId: string;
  readonly policyId: string;
  readonly mode?: PolicyAssignmentMode;
};

/** A policy assigned to a directory group a linked user belongs to. */
export type PolicyResolutionUserGroupAssignment = {
  readonly groupId: string;
  readonly policyId: string;
  readonly mode?: PolicyAssignmentMode;
};

export type PolicyResolutionInput = {
  readonly deviceId: string;
  /** Defaults to the device channel. */
  readonly channel?: PolicyChannel;
  /**
   * The directory user whose user channel is being resolved. Required for
   * `channel: "user"` and ignored for the device channel.
   */
  readonly forUserId?: string;
  /**
   * Resolve user-scoped configurations on the device channel too.
   *
   * Windows has no per-login MDM channel, so a `./User/` OMA-URI is delivered
   * by the device check-in and applies to every user of the device. Apple never
   * sets this: its user scope belongs on the user channel, not the device
   * channel. Android has no user-scoped policy at all.
   */
  readonly includeUserScoped?: boolean;
  readonly groups: ReadonlyArray<PolicyResolutionGroup>;
  readonly groupAssignments: ReadonlyArray<PolicyResolutionGroupAssignment>;
  readonly deviceAssignments: ReadonlyArray<PolicyResolutionDeviceAssignment>;
  /** Users excluded from a group; applied on that user's channel only. */
  readonly groupUserExclusions?: ReadonlyArray<PolicyResolutionGroupUserExclusion>;
  /** Directory users linked to this device. */
  readonly users?: ReadonlyArray<PolicyResolutionUser>;
  /** Directory groups those users belong to. */
  readonly userGroups?: ReadonlyArray<PolicyResolutionUserGroup>;
  /** Which linked users belong to each directory group. */
  readonly userGroupMembers?: ReadonlyArray<{
    readonly groupId: string;
    readonly userId: string;
  }>;
  readonly userAssignments?: ReadonlyArray<PolicyResolutionUserAssignment>;
  readonly userGroupAssignments?: ReadonlyArray<PolicyResolutionUserGroupAssignment>;
  readonly policies: ReadonlyArray<PolicyResolutionPolicy>;
  readonly configurations: ReadonlyArray<PolicyResolutionConfiguration>;
};

export type ResolvedConfiguration = {
  readonly kind: string;
  readonly policyId: string;
  readonly policyName: string;
  readonly priority: number;
  /** The channel this configuration was resolved for. */
  readonly channel: PolicyChannel;
  /** The configuration's own scope, which can differ on a device-wide platform. */
  readonly configurationScope: ConfigurationScope;
  readonly scope: PolicyResolutionScope;
  /** Empty for direct assignments; sorted group ids for group assignments. */
  readonly groupIds: ReadonlyArray<string>;
  readonly groupNames: ReadonlyArray<string>;
  /** Set for user-assigned configurations. */
  readonly userIds?: ReadonlyArray<string>;
  readonly userNames?: ReadonlyArray<string>;
  readonly userGroupIds?: ReadonlyArray<string>;
  readonly userGroupNames?: ReadonlyArray<string>;
  readonly data?: Schema.Json;
  readonly hash?: string;
};

export type ContributingPolicy = {
  readonly policyId: string;
  readonly policyName: string;
  readonly priority: number;
  readonly scope: PolicyResolutionScope;
  readonly groupIds: ReadonlyArray<string>;
  readonly groupNames: ReadonlyArray<string>;
  readonly userIds?: ReadonlyArray<string>;
  readonly userNames?: ReadonlyArray<string>;
  readonly userGroupIds?: ReadonlyArray<string>;
  readonly userGroupNames?: ReadonlyArray<string>;
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
  readonly userIds?: ReadonlyArray<string>;
  readonly userNames?: ReadonlyArray<string>;
  readonly userGroupIds?: ReadonlyArray<string>;
  readonly userGroupNames?: ReadonlyArray<string>;
  readonly reason: PolicyOverrideReason;
};

export type PolicyExclusion = {
  readonly policyId: string;
  readonly policyName: string;
  readonly scope: PolicyResolutionScope;
  readonly groupId: string | null;
  readonly groupName: string | null;
  readonly userIds?: ReadonlyArray<string>;
  readonly userNames?: ReadonlyArray<string>;
  readonly userGroupId?: string | null;
  readonly userGroupName?: string | null;
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
  readonly channel: PolicyChannel;
  readonly userId?: string;
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
  readonly users: ReadonlyArray<PolicyResolutionUser>;
  readonly userGroups: ReadonlyArray<PolicyResolutionUserGroup>;
};

const compareText = (left: string, right: string) => left.localeCompare(right);

/** Code-unit ordering keeps tie-breaks identical across runtimes and locales. */
const compareId = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

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

  return compareId(left.policy.id, right.policy.id);
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

const sortedUserGroups = (groups: ReadonlyArray<PolicyResolutionUserGroup>) =>
  [...groups].sort(
    (left, right) => compareText(left.name, right.name) || compareText(left.id, right.id),
  );

export const resolveEffectivePolicy = (input: PolicyResolutionInput): EffectivePolicy => {
  const channel = input.channel ?? "device";
  const forUserId = channel === "user" ? input.forUserId : undefined;

  if (channel === "user" && !forUserId)
    throw new Error("resolveEffectivePolicy requires forUserId for the user channel");

  const scopeOf = (configuration: PolicyResolutionConfiguration): ConfigurationScope =>
    configuration.scope ?? "device";

  const accepts = (configuration: PolicyResolutionConfiguration): ConfigurationScope | null => {
    const configurationScope = scopeOf(configuration);

    if (configurationScope === channel) return configurationScope;

    // A platform without a per-login channel delivers user-scoped settings on
    // the device channel; they apply to every user on the device.
    if (channel === "device" && input.includeUserScoped && configurationScope === "user")
      return configurationScope;

    return null;
  };

  // A disabled policy is absent from resolution entirely. Filtering here
  // (rather than only skipping its configurations) also drops its includes and
  // exclusions, so a disabled policy cannot veto another policy's delivery.
  const policies = new Map(
    input.policies
      .filter((policy) => policy.enabled !== false)
      .map((policy) => [policy.id, policy]),
  );

  const configurations = new Map<string, Array<PolicyResolutionConfiguration>>();

  for (const configuration of input.configurations) {
    if (!policies.has(configuration.policyId)) continue;

    if (accepts(configuration) === null) continue;
    const list = configurations.get(configuration.policyId) ?? [];
    list.push(configuration);
    configurations.set(configuration.policyId, list);
  }

  // A group-level person exclusion only applies to that person's channel. On
  // the device channel (and for every other user) the group's policy is
  // untouched, so a shared device never loses device-scoped delivery.
  const excludedFromGroups = new Set(
    forUserId === undefined
      ? []
      : (input.groupUserExclusions ?? [])
          .filter((exclusion) => exclusion.userId === forUserId)
          .map((exclusion) => exclusion.groupId),
  );

  const groups = new Map(input.groups.map((group) => [group.id, group]));
  const groupIncludes = new Map<string, Array<PolicyResolutionGroup>>();

  const groupExcludes = new Map<
    string,
    Array<{ group: PolicyResolutionGroup; policyId: string }>
  >();

  for (const assignment of input.groupAssignments) {
    const group = groups.get(assignment.groupId);

    if (!group || !policies.has(assignment.policyId)) continue;

    // The person is excluded from this group, so neither its include nor its
    // exclude speaks for their channel.
    if (excludedFromGroups.has(assignment.groupId)) continue;

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
        .filter(
          (configuration) =>
            policies.has(configuration.policyId) && accepts(configuration) !== null,
        )
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
        users: [],
        userGroups: [],
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
        users: [],
        userGroups: [],
      });
    }

    const candidates = directCandidates.length > 0 ? directCandidates : groupCandidates;

    if (candidates.length === 0) continue;

    const sorted = [...candidates].sort(compareCandidates);

    const winner = sorted[0];
    resolved.push({
      kind,
      policyId: winner.policy.id,
      policyName: winner.policy.name,
      priority: winner.policy.priority ?? 0,
      channel,
      configurationScope: scopeOf(winner.configuration),
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

  const exclusions: Array<PolicyExclusion> = [];

  // --- User-assigned policies -------------------------------------------
  // A policy assigned to a linked user (directly or through a directory group)
  // applies to the device. Delivery is device-wide, so an exclusion is applied
  // per user: excluding one linked user never removes a policy another linked
  // user includes. A direct user assignment beats that user's group
  // assignments, and a device exclude still removes the policy entirely.
  const linkedUsers = new Map((input.users ?? []).map((user) => [user.id, user]));
  const linkedUserGroups = new Map((input.userGroups ?? []).map((group) => [group.id, group]));
  const membership = new Map<string, Set<string>>();

  for (const row of input.userGroupMembers ?? []) {
    if (!linkedUsers.has(row.userId) || !linkedUserGroups.has(row.groupId)) continue;
    const members = membership.get(row.groupId) ?? new Set<string>();
    members.add(row.userId);
    membership.set(row.groupId, members);
  }

  type UserContribution = {
    readonly user: PolicyResolutionUser;
    direct: boolean;
    readonly groups: Array<PolicyResolutionUserGroup>;
  };

  const userContributions = new Map<string, Map<string, UserContribution>>();
  const userExcluded = new Map<string, Set<string>>();
  const groupExcludedUsers = new Map<string, Set<string>>();
  const excludedUserGroups = new Map<string, Array<PolicyResolutionUserGroup>>();

  const addContribution = (
    policyId: string,
    user: PolicyResolutionUser,
    direct: boolean,
    group?: PolicyResolutionUserGroup,
  ) => {
    const byUser = userContributions.get(policyId) ?? new Map<string, UserContribution>();
    const existing = byUser.get(user.id) ?? { user, direct: false, groups: [] };

    if (direct) existing.direct = true;

    if (group && !existing.groups.some((item) => item.id === group.id)) existing.groups.push(group);
    byUser.set(user.id, existing);
    userContributions.set(policyId, byUser);
  };

  for (const assignment of input.userAssignments ?? []) {
    if (!policies.has(assignment.policyId)) continue;

    const user = linkedUsers.get(assignment.userId);

    if (!user) continue;

    if ((assignment.mode ?? "include") === "exclude") {
      const excluded = userExcluded.get(assignment.policyId) ?? new Set<string>();
      excluded.add(user.id);
      userExcluded.set(assignment.policyId, excluded);
      continue;
    }

    addContribution(assignment.policyId, user, true);
  }

  for (const assignment of input.userGroupAssignments ?? []) {
    if (!policies.has(assignment.policyId)) continue;

    const group = linkedUserGroups.get(assignment.groupId);

    if (!group) continue;

    const members = [...(membership.get(group.id) ?? [])];

    if ((assignment.mode ?? "include") === "exclude") {
      const excluded = groupExcludedUsers.get(assignment.policyId) ?? new Set<string>();

      for (const userId of members) excluded.add(userId);
      groupExcludedUsers.set(assignment.policyId, excluded);
      const groups = excludedUserGroups.get(assignment.policyId) ?? [];
      groups.push(group);
      excludedUserGroups.set(assignment.policyId, groups);
      continue;
    }

    for (const userId of members) {
      const user = linkedUsers.get(userId);

      if (!user) continue;
      addContribution(assignment.policyId, user, false, group);
    }
  }

  const effectiveUsers = (policyId: string) => {
    const contributions = [...(userContributions.get(policyId)?.values() ?? [])].filter(
      (contribution) => forUserId === undefined || contribution.user.id === forUserId,
    );

    const directExcluded = userExcluded.get(policyId) ?? new Set<string>();
    const groupExcluded = groupExcludedUsers.get(policyId) ?? new Set<string>();

    return contributions.filter((contribution) => {
      if (directExcluded.has(contribution.user.id)) return false;

      if (contribution.direct) return true;

      return !groupExcluded.has(contribution.user.id);
    });
  };

  const deviceKinds = new Set(resolved.map((configuration) => configuration.kind));
  const userResolved: Array<ResolvedConfiguration> = [];

  for (const kind of kinds) {
    const withKind = (policyId: string) =>
      (configurations.get(policyId) ?? []).find((configuration) => configuration.kind === kind);

    const directCandidates: Array<InternalCandidate> = [];
    const groupCandidates: Array<InternalCandidate> = [];

    for (const policyId of userContributions.keys()) {
      // Device exclusions are absolute: a direct exclude always removes the
      // policy, and a group exclude removes it for devices in that group even
      // when a linked user includes it.
      if (directExcludes.has(policyId) || groupExcludes.has(policyId)) continue;
      const configuration = withKind(policyId);

      if (!configuration) continue;

      const included = effectiveUsers(policyId);

      if (included.length === 0) continue;

      const directUsers = included.filter((contribution) => contribution.direct);
      const candidateUsers = directUsers.length > 0 ? directUsers : included;
      const groups = new Map<string, PolicyResolutionUserGroup>();

      for (const contribution of candidateUsers)
        for (const group of contribution.groups) groups.set(group.id, group);

      const candidate: InternalCandidate = {
        policy: policies.get(policyId)!,
        configuration,
        scope: directUsers.length > 0 ? "user" : "user-group",
        groups: [],
        users: candidateUsers
          .map((contribution) => contribution.user)
          .sort((left, right) => compareId(left.id, right.id)),
        userGroups: directUsers.length > 0 ? [] : sortedUserGroups([...groups.values()]),
      };

      if (directUsers.length > 0) directCandidates.push(candidate);
      else groupCandidates.push(candidate);
    }

    const candidates = directCandidates.length > 0 ? directCandidates : groupCandidates;

    if (candidates.length === 0) continue;

    const sorted = [...candidates].sort(compareCandidates);

    const winner = sorted[0];

    const result: ResolvedConfiguration = {
      kind,
      policyId: winner.policy.id,
      policyName: winner.policy.name,
      priority: winner.policy.priority ?? 0,
      channel,
      configurationScope: scopeOf(winner.configuration),
      scope: winner.scope,
      groupIds: [],
      groupNames: [],
      userIds: winner.users.map((user) => user.id),
      userNames: winner.users.map((user) => user.name ?? user.email ?? user.id),
      userGroupIds: winner.userGroups.map((group) => group.id),
      userGroupNames: winner.userGroups.map((group) => group.name),
      data: winner.configuration.data,
      hash: winner.configuration.hash,
    };

    if (deviceKinds.has(kind)) {
      for (const candidate of [...directCandidates, ...groupCandidates])
        overridden.push({
          kind,
          policyId: candidate.policy.id,
          policyName: candidate.policy.name,
          priority: candidate.policy.priority ?? 0,
          scope: candidate.scope,
          groupIds: [],
          groupNames: [],
          userIds: candidate.users.map((user) => user.id),
          userNames: candidate.users.map((user) => user.name ?? user.email ?? user.id),
          userGroupIds: candidate.userGroups.map((group) => group.id),
          userGroupNames: candidate.userGroups.map((group) => group.name),
          reason: "device-scope",
        });
      continue;
    }

    userResolved.push(result);

    const losers: Array<{
      readonly candidate: InternalCandidate;
      readonly reason: PolicyOverrideReason;
    }> =
      directCandidates.length > 0
        ? [
            ...sorted
              .slice(1)
              .map((candidate) => ({ candidate, reason: overrideReason(winner, candidate) })),
            ...groupCandidates.map((candidate) => ({
              candidate,
              reason: "direct-user-include" as const,
            })),
          ]
        : sorted
            .slice(1)
            .map((candidate) => ({ candidate, reason: overrideReason(winner, candidate) }));

    for (const { candidate, reason } of losers)
      overridden.push({
        kind,
        policyId: candidate.policy.id,
        policyName: candidate.policy.name,
        priority: candidate.policy.priority ?? 0,
        scope: candidate.scope,
        groupIds: [],
        groupNames: [],
        userIds: candidate.users.map((user) => user.id),
        userNames: candidate.users.map((user) => user.name ?? user.email ?? user.id),
        userGroupIds: candidate.userGroups.map((group) => group.id),
        userGroupNames: candidate.userGroups.map((group) => group.name),
        reason,
      });
  }

  resolved.push(...userResolved);

  for (const [policyId, excludedUserIds] of userExcluded) {
    const policy = policies.get(policyId);

    if (!policy) continue;

    const excludedUsers = [...excludedUserIds]
      .filter((userId) => forUserId === undefined || userId === forUserId)
      .flatMap((userId) => {
        const user = linkedUsers.get(userId);

        return user ? [user] : [];
      })
      .sort((left, right) => compareId(left.id, right.id));

    if (excludedUsers.length === 0) continue;

    const contributions = userContributions.get(policyId);

    const effective = excludedUsers.some((user) => {
      const contribution = contributions?.get(user.id);

      return contribution !== undefined && contribution.groups.length > 0;
    });

    exclusions.push({
      policyId,
      policyName: policy.name,
      scope: "user",
      groupId: null,
      groupName: null,
      userIds: excludedUsers.map((user) => user.id),
      userNames: excludedUsers.map((user) => user.name ?? user.email ?? user.id),
      kinds: (configurations.get(policyId) ?? []).map((row) => row.kind).sort(compareId),
      effective,
      reason: "user-exclude",
    });
  }

  for (const [policyId, excludedGroups] of excludedUserGroups) {
    const policy = policies.get(policyId);

    if (!policy) continue;

    const members = (group: PolicyResolutionUserGroup) => membership.get(group.id) ?? new Set();

    for (const group of sortedUserGroups(excludedGroups)) {
      const contributions = userContributions.get(policyId);

      const effective = [...members(group)].some((userId) => {
        const contribution = contributions?.get(userId);

        return contribution !== undefined && contribution.groups.length > 0 && !contribution.direct;
      });

      exclusions.push({
        policyId,
        policyName: policy.name,
        scope: "user-group",
        groupId: null,
        groupName: null,
        userGroupId: group.id,
        userGroupName: group.name,
        kinds: (configurations.get(policyId) ?? []).map((row) => row.kind).sort(compareId),
        effective,
        reason: "user-group-exclude",
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

    const contributor = {
      policyId: configuration.policyId,
      policyName: configuration.policyName,
      priority: configuration.priority,
      scope: configuration.scope,
      groupIds: configuration.groupIds,
      groupNames: configuration.groupNames,
      userIds: configuration.userIds ?? [],
      userNames: configuration.userNames ?? [],
      userGroupIds: configuration.userGroupIds ?? [],
      userGroupNames: configuration.userGroupNames ?? [],
      kinds: [configuration.kind],
    };

    contributing.set(configuration.policyId, contributor);
  }

  for (const policyId of directExcludes) {
    const policy = policies.get(policyId);

    if (!policy) continue;
    exclusions.push({
      policyId,
      policyName: policy.name,
      scope: "direct",
      groupId: null,
      groupName: null,
      kinds: (configurations.get(policyId) ?? []).map((row) => row.kind).sort(compareId),
      // A device exclude also suppresses user-sourced delivery, so it is
      // effective when either a group or a linked user included the policy.
      effective: groupIncludes.has(policyId) || userContributions.has(policyId),
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
        kinds: (configurations.get(policyId) ?? []).map((row) => row.kind).sort(compareId),
        effective: groupIncludes.has(policyId) || userContributions.has(policyId),
        reason: "group-exclude",
      });
    }
  }

  return {
    deviceId: input.deviceId,
    channel,
    ...(forUserId ? { userId: forUserId } : {}),
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
