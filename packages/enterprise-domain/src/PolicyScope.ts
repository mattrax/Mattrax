import { Schema } from "effect";

/**
 * Computed delivery scope for a policy or group.
 *
 * This is the reverse of the device page's effective-policy trace: instead of
 * asking what one device receives, it lists the devices a policy reaches and,
 * for each device it does not, the reason. The values are derived by the same
 * resolver that builds the device trace, so the two views cannot disagree.
 */

export const PolicyScopeChannel = Schema.Literals(["device", "user"]);

export type PolicyScopeChannel = typeof PolicyScopeChannel.Type;

export const PolicyScopeStatus = Schema.Literals([
  "applies",
  "partial",
  "overridden",
  "excluded",
  "unsupported-os",
  "wrong-scope",
  "not-included",
  "disabled",
  "no-configurations",
]);

export type PolicyScopeStatus = typeof PolicyScopeStatus.Type;

export const PolicyScopeReason = Schema.Literals([
  "applies",
  "partial",
  "higher-priority",
  "newer-updated-at",
  "lexicographic-id",
  "direct-device-include",
  "direct-user-include",
  "device-scope",
  "device-exclude",
  "group-exclude",
  "user-exclude",
  "user-group-exclude",
  "os-unsupported",
  "wrong-scope",
  "not-included",
  "no-verified-user-channel",
  "disabled",
  "no-configurations",
]);

export type PolicyScopeReason = typeof PolicyScopeReason.Type;

export const PolicyScopeLoss = Schema.Struct({
  kind: Schema.String,
  reason: PolicyScopeReason,
  winnerPolicyId: Schema.optional(Schema.String),
  winnerPolicyName: Schema.optional(Schema.String),
  winnerPriority: Schema.optional(Schema.Number),
});

export type PolicyScopeLoss = typeof PolicyScopeLoss.Type;

export const PolicyScopeExclusion = Schema.Struct({
  reason: PolicyScopeReason,
  groupId: Schema.optional(Schema.String),
  groupName: Schema.optional(Schema.String),
  userNames: Schema.optional(Schema.Array(Schema.String)),
  userGroupId: Schema.optional(Schema.String),
  userGroupName: Schema.optional(Schema.String),
  effective: Schema.Boolean,
});

export type PolicyScopeExclusion = typeof PolicyScopeExclusion.Type;

export const PolicyScopeDevice = Schema.Struct({
  deviceId: Schema.String,
  deviceName: Schema.String,
  platform: Schema.String,
  /** Reported OS name and version, when inventory has arrived. */
  deviceOs: Schema.optional(Schema.NullOr(Schema.String)),
  channel: PolicyScopeChannel,
  /** Set for entries resolved on a linked user's Apple user channel. */
  userId: Schema.optional(Schema.String),
  userName: Schema.optional(Schema.String),
  status: PolicyScopeStatus,
  reason: PolicyScopeReason,
  /** Configuration kinds this device (or user channel) receives. */
  kinds: Schema.Array(Schema.String),
  /** Kinds the policy won but the device's OS cannot apply. */
  unsupportedKinds: Schema.Array(Schema.String),
  losses: Schema.Array(PolicyScopeLoss),
  exclusions: Schema.Array(PolicyScopeExclusion),
});

export type PolicyScopeDevice = typeof PolicyScopeDevice.Type;

export const PolicyOsVersion = Schema.Struct({
  family: Schema.String,
  minimum: Schema.String,
});

export const PolicyScopeSummary = Schema.Struct({
  policyId: Schema.String,
  /** Platforms the policy's configurations target. */
  platforms: Schema.Array(Schema.String),
  /** Minimum supported OS per Apple family. */
  apple: Schema.Array(PolicyOsVersion),
  /** Highest minimum Windows build across the policy's OMA-URI nodes. */
  windowsMinimum: Schema.optional(Schema.NullOr(Schema.String)),
  /** Configuration scopes the policy provides: device, user or both. */
  channels: Schema.Array(PolicyScopeChannel),
  /** Candidate devices considered by the resolver. */
  deviceCount: Schema.Number,
  /** True when `devices` is a capped prefix of the real result. */
  truncated: Schema.Boolean,
  devices: Schema.Array(PolicyScopeDevice),
});

export type PolicyScopeSummary = typeof PolicyScopeSummary.Type;

export const GroupScopePolicy = Schema.Struct({
  policyId: Schema.String,
  policyName: Schema.String,
  mode: Schema.Literals(["include", "exclude"]),
  devices: Schema.Array(PolicyScopeDevice),
});

export type GroupScopePolicy = typeof GroupScopePolicy.Type;

export const GroupScopeSummary = Schema.Struct({
  groupId: Schema.String,
  memberCount: Schema.Number,
  /** True when a per-policy device list (or the member set) hit the cap. */
  truncated: Schema.Boolean,
  policies: Schema.Array(GroupScopePolicy),
});

export type GroupScopeSummary = typeof GroupScopeSummary.Type;
