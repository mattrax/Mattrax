import { Schema } from "effect";
import { DeviceProtocol, DeviceStatus } from "./Device.js";
import { GroupRelation } from "./Group.js";
import { NullableString } from "./Errors.js";

/**
 * A directory person, viewed from the tenant dashboard.
 *
 * Directory users are imported by Entra/SCIM sync (or created manually) and are
 * never dashboard accounts. A user is linked to a device through `device_user`
 * and to policy through `user_group_member` -> `user_group_policy` (and the
 * direct `user_policy` edge), so this module describes the user-scoped view of
 * data the device and policy pages already expose from the other direction.
 */

/** Directory user sources, matching the `user.source` column. */
export const UserSource = Schema.Literals(["entra", "scim", "manual"]);

export type UserSource = typeof UserSource.Type;

/** Membership source of a directory group, matching `user_group.source`. */
export const UserGroupSource = Schema.Literals(["scim", "graph", "manual"]);

export type UserGroupSource = typeof UserGroupSource.Type;

/** One row of the tenant's user list. */
export const UserListRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  externalId: Schema.optional(NullableString),
  source: UserSource,
  disabled: Schema.Boolean,
  /** True when an SSO identity is bound to this directory person. */
  linked: Schema.Boolean,
  /** Directory groups this person belongs to. */
  groupCount: Schema.Number,
  /**
   * Devices linked to this person. Omitted, rather than zero, when the caller
   * cannot read devices: the count is device data, not directory data.
   */
  deviceCount: Schema.optional(Schema.Number),
});

export type UserListRow = typeof UserListRow.Type;

export const UserListResponse = Schema.Struct({
  rows: Schema.Array(UserListRow),
});

export type UserListResponse = typeof UserListResponse.Type;

/** A directory group the user belongs to. */
export const UserGroupRef = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  source: UserGroupSource,
});

export type UserGroupRef = typeof UserGroupRef.Type;

/** A device linked to the user through `device_user`. */
export const UserDeviceRef = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  proto: DeviceProtocol,
  status: DeviceStatus,
  /** How the link was made: an administrator or directory sync. */
  source: Schema.Literals(["manual", "directory"]),
  linkedAt: Schema.String,
});

export type UserDeviceRef = typeof UserDeviceRef.Type;

/** The Mattrax account this directory person signs in with, once linked. */
export const UserLinkedAccount = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
});

export type UserLinkedAccount = typeof UserLinkedAccount.Type;

/**
 * One policy assignment that scopes to the user, with the grant edges that
 * contribute it.
 *
 * This models assignment scope only. It cannot express which configuration
 * kinds or platforms the policy actually delivers, device-level exclusions, or
 * per-kind priority conflicts; the device page resolves those. It is also
 * deliberately about the *user*: policies assigned to a device group are
 * attributed to the group, not to the person sitting at one of its devices.
 */
export const UserPolicyAssignment = Schema.Struct({
  policyId: Schema.String,
  policyName: Schema.String,
  priority: Schema.Number,
  /** True when the policy is assigned to the user directly. */
  direct: Schema.Boolean,
  /** Directory groups whose assignment includes the policy. */
  groups: Schema.Array(GroupRelation),
  /**
   * Group assignments that exclude the policy but are overridden by a direct
   * assignment. Empty when no group excludes it.
   */
  overriddenExclusions: Schema.Array(GroupRelation),
});

export type UserPolicyAssignment = typeof UserPolicyAssignment.Type;

export const UserDetail = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  externalId: Schema.optional(NullableString),
  source: UserSource,
  disabled: Schema.Boolean,
  /** True when an SSO identity is bound to this directory person. */
  linked: Schema.Boolean,
  /** The linked account, when one exists and is still readable. */
  linkedAccount: Schema.optional(Schema.NullOr(UserLinkedAccount)),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  groups: Schema.Array(UserGroupRef),
  /** Omitted, rather than empty, when the caller cannot read devices. */
  devices: Schema.optional(Schema.Array(UserDeviceRef)),
  /** Omitted, rather than empty, when the caller cannot read policies. */
  policies: Schema.optional(Schema.Array(UserPolicyAssignment)),
});

export type UserDetail = typeof UserDetail.Type;

/**
 * The two user-policy edges, normalised for {@link deriveUserPolicies}.
 *
 * The database rows carry a policy id and a mode; the name and priority come
 * from the joined policy so the derivation needs no second lookup.
 */
export type UserPolicyEdge = {
  readonly policyId: string;
  readonly policyName: string;
  readonly priority: number;
  readonly enabled: boolean;
  readonly mode: "include" | "exclude";
};

export type UserGroupPolicyEdge = UserPolicyEdge & {
  readonly groupId: string;
  readonly groupName: string;
};

/** The id/name pair both the response schema and the derivation use. */
type GroupRef = { readonly id: string; readonly name: string };

const byName = (left: GroupRef, right: GroupRef) =>
  left.name.localeCompare(right.name) || left.id.localeCompare(right.id);

/**
 * Derive the policies assigned to one user, directly or through a directory
 * group.
 *
 * This is assignment scoping, not delivery. The include/exclude precedence is
 * copied from the user-channel rules in `resolveEffectivePolicy`
 * (`@mattrax/mdm-core`); platform and configuration-kind resolution, and the
 * device an assignment eventually reaches, are not modelled here.
 *
 * - A disabled policy is omitted: it contributes nothing while disabled.
 * - A direct exclusion vetoes the policy entirely, even when a group includes
 *   it or the user is also assigned it directly.
 * - A direct inclusion survives a group exclusion.
 * - A group exclusion vetoes the policy for every member of that group, not
 *   only for the group edge that was excluded. A user in group A (include) and
 *   group B (exclude) therefore has no group-sourced assignment unless one is
 *   also made directly.
 *
 * The order of the input rows is irrelevant: groups are de-duplicated by id and
 * the result is sorted by policy name so the panel is stable across refetches.
 */
export const deriveUserPolicies = (input: {
  readonly direct: ReadonlyArray<UserPolicyEdge>;
  readonly groups: ReadonlyArray<UserGroupPolicyEdge>;
}): ReadonlyArray<UserPolicyAssignment> => {
  type Contribution = {
    readonly policyId: string;
    readonly policyName: string;
    readonly priority: number;
    enabled: boolean;
    directInclude: boolean;
    directExclude: boolean;
    readonly groups: Map<string, GroupRef>;
    readonly exclusions: Map<string, GroupRef>;
  };

  const policies = new Map<string, Contribution>();

  const contribution = (edge: UserPolicyEdge): Contribution => {
    const existing = policies.get(edge.policyId);

    if (existing) {
      existing.enabled &&= edge.enabled;

      return existing;
    }

    const created: Contribution = {
      policyId: edge.policyId,
      policyName: edge.policyName,
      priority: edge.priority,
      enabled: edge.enabled,
      directInclude: false,
      directExclude: false,
      groups: new Map(),
      exclusions: new Map(),
    };

    policies.set(edge.policyId, created);

    return created;
  };

  for (const edge of input.direct) {
    const item = contribution(edge);

    if (edge.mode === "exclude") item.directExclude = true;
    else item.directInclude = true;
  }

  for (const edge of input.groups) {
    const item = contribution(edge);
    const group: GroupRef = { id: edge.groupId, name: edge.groupName };

    if (edge.mode === "exclude") item.exclusions.set(group.id, group);
    else item.groups.set(group.id, group);
  }

  const assignments: UserPolicyAssignment[] = [];

  for (const item of policies.values()) {
    if (!item.enabled || item.directExclude) continue;

    const included = [...item.groups.values()].sort(byName);
    const excluded = [...item.exclusions.values()].sort(byName);

    // Group exclusions are per policy, so a single excluded group removes all
    // group-sourced delivery. Only a direct assignment outranks one.
    if (!item.directInclude && (included.length === 0 || excluded.length > 0)) continue;

    assignments.push({
      policyId: item.policyId,
      policyName: item.policyName,
      priority: item.priority,
      direct: item.directInclude,
      groups: included,
      overriddenExclusions: item.directInclude ? excluded : [],
    });
  }

  return assignments.sort(
    (left, right) =>
      left.policyName.localeCompare(right.policyName) ||
      left.policyId.localeCompare(right.policyId),
  );
};
