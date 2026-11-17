import { Schema } from "effect";
import { DeviceRow } from "./Device.js";
import { GroupPolicyRelation } from "./Group.js";
import { GroupRow } from "./Group.js";
import { JsonRecord } from "./Errors.js";
import { NullableString } from "./Errors.js";
import { EnterprisePolicyApplicationDownloadErrors } from "./Errors.js";
import { EnterprisePolicyApplicationUploadErrors } from "./Errors.js";
import { PolicyAssignmentMode } from "./Group.js";
import { PolicyAssignmentRef } from "./Group.js";

export const PolicyRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  notes: Schema.optional(NullableString),
  /** Higher wins when policies provide the same configuration kind. */
  priority: Schema.Number,
  configurations: Schema.optional(JsonRecord),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export type PolicyRow = typeof PolicyRow.Type;

export type Entity = "device" | "group" | "policy";

export type RowFor<E extends Entity> = E extends "device"
  ? DeviceRow
  : E extends "group"
    ? GroupRow
    : PolicyRow;

export const CreatePolicyRequest = Schema.Struct({
  name: Schema.String,
  notes: Schema.optional(NullableString),
  /** Higher wins when included policies provide the same configuration kind. */
  priority: Schema.optional(Schema.Number),
});

export const PatchPolicyRequest = Schema.Struct({
  name: Schema.optional(Schema.String),
  notes: Schema.optional(NullableString),
  priority: Schema.optional(Schema.Number),
  configurations: Schema.optional(JsonRecord),
});

export const UploadPolicyApplicationRequest = Schema.Struct({
  fileName: Schema.String,
  contentType: Schema.optional(Schema.String),
  content: Schema.String,
});

export const PolicyApplicationObject = Schema.Struct({
  sha256: Schema.String,
  fileName: Schema.String,
  contentType: Schema.optional(NullableString),
  size: Schema.Number,
});

export type PolicyApplicationObject = typeof PolicyApplicationObject.Type;

export const EnterpriseApplicationUploadErrors = EnterprisePolicyApplicationUploadErrors;

export const EnterpriseApplicationDownloadErrors = EnterprisePolicyApplicationDownloadErrors;

export const DownloadPolicyApplicationResponse = Schema.Struct({
  sha256: Schema.String,
  fileName: Schema.String,
  contentType: Schema.optional(NullableString),
  size: Schema.Number,
  content: Schema.String,
});

export type DownloadPolicyApplicationResponse = typeof DownloadPolicyApplicationResponse.Type;


export const PolicyAssignmentUser = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  mode: PolicyAssignmentMode,
  priority: Schema.Number,
});

export type PolicyAssignmentUser = typeof PolicyAssignmentUser.Type;

export const PolicyAssignmentUserGroup = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  mode: PolicyAssignmentMode,
  priority: Schema.Number,
  memberCount: Schema.Number,
});

export type PolicyAssignmentUserGroup = typeof PolicyAssignmentUserGroup.Type;

export const PolicyAssignmentsResponse = Schema.Struct({
  groups: Schema.Array(GroupPolicyRelation),
  devices: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      mode: PolicyAssignmentMode,
      priority: Schema.Number,
    }),
  ),
  users: Schema.Array(PolicyAssignmentUser),
  userGroups: Schema.Array(PolicyAssignmentUserGroup),
});

export type PolicyAssignmentsResponse = typeof PolicyAssignmentsResponse.Type;

export const PatchPolicyAssignmentsRequest = Schema.Struct({
  /** Direct device assignments. */
  assign: Schema.optional(Schema.Array(PolicyAssignmentRef)),
  unassign: Schema.optional(Schema.Array(PolicyAssignmentRef)),
  /** Directory users linked to devices. */
  assignUsers: Schema.optional(Schema.Array(PolicyAssignmentRef)),
  unassignUsers: Schema.optional(Schema.Array(PolicyAssignmentRef)),
  /** Directory user groups. */
  assignUserGroups: Schema.optional(Schema.Array(PolicyAssignmentRef)),
  unassignUserGroups: Schema.optional(Schema.Array(PolicyAssignmentRef)),
});


export const EffectivePolicyScope = Schema.Literals(["direct", "group", "user", "user-group"]);

export type EffectivePolicyScope = typeof EffectivePolicyScope.Type;

export const EffectivePolicyConfiguration = Schema.Struct({
  kind: Schema.String,
  policyId: Schema.String,
  policyName: Schema.String,
  priority: Schema.Number,
  scope: EffectivePolicyScope,
  groupIds: Schema.Array(Schema.String),
  groupNames: Schema.Array(Schema.String),
  userIds: Schema.optional(Schema.Array(Schema.String)),
  userNames: Schema.optional(Schema.Array(Schema.String)),
  userGroupIds: Schema.optional(Schema.Array(Schema.String)),
  userGroupNames: Schema.optional(Schema.Array(Schema.String)),
  hash: Schema.String,
});

export type EffectivePolicyConfiguration = typeof EffectivePolicyConfiguration.Type;

export const EffectivePolicyContributor = Schema.Struct({
  policyId: Schema.String,
  policyName: Schema.String,
  priority: Schema.Number,
  scope: EffectivePolicyScope,
  groupIds: Schema.Array(Schema.String),
  groupNames: Schema.Array(Schema.String),
  userIds: Schema.optional(Schema.Array(Schema.String)),
  userNames: Schema.optional(Schema.Array(Schema.String)),
  userGroupIds: Schema.optional(Schema.Array(Schema.String)),
  userGroupNames: Schema.optional(Schema.Array(Schema.String)),
  kinds: Schema.Array(Schema.String),
});

export type EffectivePolicyContributor = typeof EffectivePolicyContributor.Type;

export const EffectivePolicyOverrideReason = Schema.Literals([
  "direct-device-include",
  "direct-user-include",
  "device-scope",
  "lower-priority",
  "older-updated-at",
  "lexicographic-id",
]);

export type EffectivePolicyOverrideReason = typeof EffectivePolicyOverrideReason.Type;

export const EffectivePolicyOverride = Schema.Struct({
  kind: Schema.String,
  policyId: Schema.String,
  policyName: Schema.String,
  priority: Schema.Number,
  scope: EffectivePolicyScope,
  groupIds: Schema.Array(Schema.String),
  groupNames: Schema.Array(Schema.String),
  userIds: Schema.optional(Schema.Array(Schema.String)),
  userNames: Schema.optional(Schema.Array(Schema.String)),
  userGroupIds: Schema.optional(Schema.Array(Schema.String)),
  userGroupNames: Schema.optional(Schema.Array(Schema.String)),
  reason: EffectivePolicyOverrideReason,
});

export type EffectivePolicyOverride = typeof EffectivePolicyOverride.Type;

export const EffectivePolicyExclusionReason = Schema.Literals([
  "device-exclude",
  "group-exclude",
  "user-exclude",
  "user-group-exclude",
]);

export type EffectivePolicyExclusionReason = typeof EffectivePolicyExclusionReason.Type;

export const EffectivePolicyExclusion = Schema.Struct({
  policyId: Schema.String,
  policyName: Schema.String,
  scope: EffectivePolicyScope,
  groupId: Schema.NullOr(Schema.String),
  groupName: Schema.NullOr(Schema.String),
  userIds: Schema.optional(Schema.Array(Schema.String)),
  userNames: Schema.optional(Schema.Array(Schema.String)),
  userGroupId: Schema.optional(Schema.NullOr(Schema.String)),
  userGroupName: Schema.optional(Schema.NullOr(Schema.String)),
  kinds: Schema.Array(Schema.String),
  effective: Schema.Boolean,
  reason: EffectivePolicyExclusionReason,
});

export type EffectivePolicyExclusion = typeof EffectivePolicyExclusion.Type;

export const EffectivePolicyResponse = Schema.Struct({
  deviceId: Schema.String,
  configurations: Schema.Array(EffectivePolicyConfiguration),
  policies: Schema.Array(EffectivePolicyContributor),
  overridden: Schema.Array(EffectivePolicyOverride),
  exclusions: Schema.Array(EffectivePolicyExclusion),
});

export type EffectivePolicyResponse = typeof EffectivePolicyResponse.Type;

export const MobileconfigPayloadPreview = Schema.Struct({
  type: Schema.String,
  identifier: Schema.optional(Schema.String),
  displayName: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  /** Friendly category name (for example "Wi-Fi" or "Restrictions"). */
  category: Schema.optional(Schema.String),
});

export type MobileconfigPayloadPreview = typeof MobileconfigPayloadPreview.Type;

export const MobileconfigPreview = Schema.Struct({
  displayName: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  organization: Schema.optional(Schema.String),
  identifier: Schema.optional(Schema.String),
  uuid: Schema.optional(Schema.String),
  type: Schema.optional(Schema.String),
  /** Compatibility aliases for the dashboard's existing preview component. */
  payloadDisplayName: Schema.optional(Schema.String),
  payloadDescription: Schema.optional(Schema.String),
  payloadOrganization: Schema.optional(Schema.String),
  payloads: Schema.Array(MobileconfigPayloadPreview),
});

export type MobileconfigPreview = typeof MobileconfigPreview.Type;
