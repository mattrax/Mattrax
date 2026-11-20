import { DynamicGroupKind } from "./dynamicGroups.js";
import { DynamicGroupRules } from "./dynamicGroups.js";
import { Schema } from "effect";
import { NullableString } from "./Errors.js";

export const GroupRelation = Schema.Struct({ id: Schema.String, name: Schema.String });

/** A directory (Entra/SCIM) group a device group can be linked to. */
export const DirectoryGroupRef = Schema.Struct({ id: Schema.String, name: Schema.String });

export type DirectoryGroupRef = typeof DirectoryGroupRef.Type;

export const GroupRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  notes: Schema.optional(NullableString),
  /** `manual` groups use explicit membership; `dynamic` groups use rules. */
  kind: DynamicGroupKind,
  rules: Schema.optional(Schema.NullOr(DynamicGroupRules)),
  /** When set, membership is derived from this directory group. */
  directoryGroupId: Schema.optional(NullableString),
  directoryGroup: Schema.optional(Schema.NullOr(DirectoryGroupRef)),
  lastEvaluatedAt: Schema.optional(NullableString),
  devicesCount: Schema.optional(Schema.Number),
  policiesCount: Schema.optional(Schema.Number),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export type GroupRow = typeof GroupRow.Type;

/**
 * Membership source shown in the UI.
 *
 * `nested` is inherited from a child group; `directory` is derived from the
 * linked directory group.
 */
export const GroupMembershipKind = Schema.Literals([
  "manual",
  "dynamic",
  "directory",
  "nested",
]);

export type GroupMembershipKind = typeof GroupMembershipKind.Type;

/** A child group whose members this group inherits. */
export const GroupChildGroup = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  devicesCount: Schema.optional(Schema.Number),
  kind: Schema.optional(DynamicGroupKind),
});

export type GroupChildGroup = typeof GroupChildGroup.Type;

export const DeviceRelation = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  /** How the device joined the group; absent on older payloads. */
  source: Schema.optional(GroupMembershipKind),
  /**
   * Direct child groups that bring an inherited device in. Present only when
   * `source` is `nested`; a device can be inherited through more than one child.
   */
  inheritedFrom: Schema.optional(
    Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
  ),
});

export type DeviceRelation = typeof DeviceRelation.Type;

/** An explicit exclusion from a group. */
export const GroupExclusion = Schema.Struct({
  kind: Schema.Literals(["device", "user"]),
  id: Schema.String,
  name: Schema.String,
  email: Schema.optional(NullableString),
});

export type GroupExclusion = typeof GroupExclusion.Type;

/** Policy rows shown inside a group assignment table. */
export const PolicyAssignmentMode = Schema.Literals(["include", "exclude"]);

export type PolicyAssignmentMode = typeof PolicyAssignmentMode.Type;

export const GroupPolicyRelation = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  mode: PolicyAssignmentMode,
  priority: Schema.Number,
});

export type GroupPolicyRelation = typeof GroupPolicyRelation.Type;

/** Accepts a bare id (= include) or an explicit id/mode pair. */
export const PolicyAssignmentRef = Schema.Union([
  Schema.String,
  Schema.Struct({ id: Schema.String, mode: Schema.optional(PolicyAssignmentMode) }),
]);

export type PolicyAssignmentRef = typeof PolicyAssignmentRef.Type;

export const GroupNode = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  notes: Schema.optional(NullableString),
  kind: DynamicGroupKind,
  rules: Schema.optional(Schema.NullOr(DynamicGroupRules)),
  directoryGroupId: Schema.optional(NullableString),
  directoryGroup: Schema.optional(Schema.NullOr(DirectoryGroupRef)),
  lastEvaluatedAt: Schema.optional(NullableString),
  devicesCount: Schema.optional(Schema.Number),
  policiesCount: Schema.optional(Schema.Number),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  devices: Schema.optional(Schema.Array(DeviceRelation)),
  policies: Schema.optional(Schema.Array(GroupPolicyRelation)),
  /** Child groups whose membership this group includes. */
  childGroups: Schema.optional(Schema.Array(GroupChildGroup)),
  /** Devices and directory users explicitly kept out of this group. */
  exclusions: Schema.optional(Schema.Array(GroupExclusion)),
});

export type GroupNode = typeof GroupNode.Type;

export const CreateGroupRequest = Schema.Struct({
  name: Schema.String,
  notes: Schema.optional(NullableString),
  /** Defaults to `manual` so existing clients are unchanged. */
  kind: Schema.optional(DynamicGroupKind),
  rules: Schema.optional(Schema.NullOr(DynamicGroupRules)),
  /** Link membership to a directory group instead of listing devices. */
  directoryGroupId: Schema.optional(NullableString),
  devices: Schema.optional(Schema.Array(Schema.String)),
  policies: Schema.optional(Schema.Array(Schema.String)),
  /** Child groups whose devices the new group inherits. */
  childGroups: Schema.optional(Schema.Array(Schema.String)),
});

export const PatchGroupRequest = Schema.Struct({
  name: Schema.optional(Schema.String),
  notes: Schema.optional(NullableString),
  kind: Schema.optional(DynamicGroupKind),
  rules: Schema.optional(Schema.NullOr(DynamicGroupRules)),
  /** Null unlinks the directory group and leaves membership empty. */
  directoryGroupId: Schema.optional(NullableString),
});

export const GroupMemberTargets = Schema.Struct({
  devices: Schema.optional(Schema.Array(Schema.String)),
  policies: Schema.optional(Schema.Array(PolicyAssignmentRef)),
  /** Child groups whose devices this group inherits. */
  childGroups: Schema.optional(Schema.Array(Schema.String)),
});

/** Targets an operator explicitly keeps out of the group. */
export const GroupExclusionTargets = Schema.Struct({
  devices: Schema.optional(Schema.Array(Schema.String)),
  users: Schema.optional(Schema.Array(Schema.String)),
});

export const PatchGroupMembersRequest = Schema.Struct({
  assign: Schema.optional(GroupMemberTargets),
  unassign: Schema.optional(GroupMemberTargets),
  exclude: Schema.optional(GroupExclusionTargets),
  unexclude: Schema.optional(GroupExclusionTargets),
});
