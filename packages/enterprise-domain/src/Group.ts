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

/** Membership source shown in the UI; `directory` is a linked group. */
export const GroupMembershipKind = Schema.Literals(["manual", "dynamic", "directory"]);

export type GroupMembershipKind = typeof GroupMembershipKind.Type;

export const DeviceRelation = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  /** How the device joined the group; absent on older payloads. */
  source: Schema.optional(Schema.Literals(["manual", "dynamic", "directory"])),
});

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
});

export const PatchGroupRequest = Schema.Struct({
  name: Schema.optional(Schema.String),
  notes: Schema.optional(NullableString),
  kind: Schema.optional(DynamicGroupKind),
  rules: Schema.optional(Schema.NullOr(DynamicGroupRules)),
  /** Null unlinks the directory group and leaves membership empty. */
  directoryGroupId: Schema.optional(NullableString),
});

export const PatchGroupMembersRequest = Schema.Struct({
  assign: Schema.optional(
    Schema.Struct({
      devices: Schema.optional(Schema.Array(Schema.String)),
      policies: Schema.optional(Schema.Array(PolicyAssignmentRef)),
    }),
  ),
  unassign: Schema.optional(
    Schema.Struct({
      devices: Schema.optional(Schema.Array(Schema.String)),
      policies: Schema.optional(Schema.Array(PolicyAssignmentRef)),
    }),
  ),
});
