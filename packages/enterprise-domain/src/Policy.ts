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

/**
 * Whether the current deployment has reached the devices in the policy's
 * scope.
 *
 * Delivery is derived from Apple DDM declaration reports (`device_declaration`
 * rows), which are the only per-device delivery evidence Mattrax stores today.
 * Windows and Android devices are in the policy's scope but do not report
 * declaration status, so they are counted separately and never turn a policy
 * into "delivered" or "failed" on their own.
 *
 * - `never-deployed`: no deployment snapshot exists for the policy.
 * - `no-devices`: the policy's assignments resolve to no devices.
 * - `not-tracked`: only devices without DDM declaration evidence are in scope
 *   (Windows, Android, or Apple devices on the legacy profile path).
 * - `no-configurations`: the policy has no Apple declaration kinds to deliver.
 *   Application installs are imperative and do not publish declarations.
 * - `not-applicable`: every declarative Apple device in scope has every kind
 *   provided by a higher-priority policy, so this policy never wins a kind.
 * - `pending`: a declarative Apple device in scope has no evidence yet.
 * - `partial`: some applicable Apple devices report the current version.
 * - `failed`: no device is fully delivered and at least one current report is
 *   invalid or failed.
 * - `delivered`: every applicable Apple device reports every current kind valid
 *   and active.
 */
export const PolicyDeliveryState = Schema.Literals([
  "never-deployed",
  "no-devices",
  "not-tracked",
  "no-configurations",
  /** Only user-scoped settings: delivered per user channel, not per device. */
  "user-channel",
  "not-applicable",
  "pending",
  "partial",
  "failed",
  "delivered",
]);

export type PolicyDeliveryState = typeof PolicyDeliveryState.Type;

export const PolicyDeliveryInfo = Schema.Struct({
  state: PolicyDeliveryState,
  /** Latest deployment version, or null when the policy has no snapshot. */
  version: Schema.NullOr(Schema.Number),
  /** Devices in the policy's assignment scope, on every platform. */
  scopedDevices: Schema.Number,
  /** Apple devices whose declaration reports can prove delivery. */
  trackedDevices: Schema.Number,
  /** Apple devices on the legacy profile path; they do not report DDM. */
  legacyDevices: Schema.Number,
  /** Tracked devices where every kind is provided by another policy. */
  overriddenDevices: Schema.Number,
  deliveredDevices: Schema.Number,
  failedDevices: Schema.Number,
  /** Applicable tracked devices that are neither delivered nor failed. */
  pendingDevices: Schema.Number,
});

export type PolicyDeliveryInfo = typeof PolicyDeliveryInfo.Type;

/** The MDM channel a configuration is delivered on. */
export const ConfigurationScope = Schema.Literals(["device", "user"]);

export type ConfigurationScope = typeof ConfigurationScope.Type;

/**
 * Reserved key in a policy deployment snapshot that records non-default
 * configuration scopes. Old snapshots omit it and are therefore all `device`.
 */
export const POLICY_SNAPSHOT_SCOPES_KEY = "@@scopes";

/**
 * Reserved key in a policy deployment snapshot that records a disabled policy.
 * Old snapshots omit it, and a `true` value is never written, so absence means
 * enabled.
 */
export const POLICY_SNAPSHOT_ENABLED_KEY = "@@enabled";

export const PolicyRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  notes: Schema.optional(NullableString),
  /** Higher wins when policies provide the same configuration kind. */
  priority: Schema.Number,
  /**
   * Disabled policies keep their configuration and assignments but deliver
   * nothing. Responses that predate the flag omit it and are enabled.
   */
  enabled: Schema.optional(Schema.Boolean),
  configurations: Schema.optional(JsonRecord),
  /** Delivery scope per configuration kind. Missing entries are `device`. */
  configurationScopes: Schema.optional(Schema.Record(Schema.String, ConfigurationScope)),
  /**
   * Number of configuration kinds saved on the policy. List rows set this
   * without loading every configuration payload.
   */
  configurationCount: Schema.optional(Schema.Number),
  /** Configuration kinds that are delivered on the user channel. */
  userConfigurationCount: Schema.optional(Schema.Number),
  /** Devices in the policy's resolved assignment scope. */
  scopedDeviceCount: Schema.optional(Schema.Number),
  /** Directory users assigned directly or through a directory group. */
  scopedUserCount: Schema.optional(Schema.Number),
  delivery: Schema.optional(PolicyDeliveryInfo),
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
  /** Defaults to enabled. */
  enabled: Schema.optional(Schema.Boolean),
  /**
   * Configurations stored with the policy in the same request. The policy
   * import uses this so a created policy and its settings cannot drift apart.
   * Every configuration is validated before anything is written.
   */
  configurations: Schema.optional(JsonRecord),
  /** Delivery scope per created kind. Missing entries are `device`. */
  configurationScopes: Schema.optional(Schema.Record(Schema.String, ConfigurationScope)),
});

export const PatchPolicyRequest = Schema.Struct({
  name: Schema.optional(Schema.String),
  notes: Schema.optional(NullableString),
  priority: Schema.optional(Schema.Number),
  /**
   * Disabling withdraws the policy's settings from scoped devices without
   * deleting its configuration or assignments. Omitted leaves the state alone.
   */
  enabled: Schema.optional(Schema.Boolean),
  configurations: Schema.optional(JsonRecord),
  /**
   * Delivery scope per configuration kind. Omitting the map leaves the stored
   * scopes alone, so clients that do not know about scope keep their
   * device-wide behaviour. Supplying it is authoritative: a kind missing from
   * the map is device scope.
   */
  configurationScopes: Schema.optional(Schema.Record(Schema.String, ConfigurationScope)),
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
  /**
   * The profile's top-level `PayloadScope`. Import uses it to name the kind's
   * delivery channel, because `validateConfiguration` rejects a mismatch.
   */
  scope: Schema.optional(ConfigurationScope),
  payloads: Schema.Array(MobileconfigPayloadPreview),
});

export type MobileconfigPreview = typeof MobileconfigPreview.Type;
