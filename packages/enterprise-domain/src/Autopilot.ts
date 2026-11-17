import { Schema } from "effect";
import { NullableString } from "./Errors.js";

export const AutopilotProfileStatus = Schema.Literals([
  "unknown",
  "assigned",
  "applying",
  "succeeded",
  "failed",
]);

export type AutopilotProfileStatus = typeof AutopilotProfileStatus.Type;

export const AutopilotEnrollmentState = Schema.Literals([
  "unknown",
  "notEnrolled",
  "enrolled",
  "pendingReset",
  "failed",
  "blocked",
]);

export type AutopilotEnrollmentState = typeof AutopilotEnrollmentState.Type;

export const AutopilotDeploymentMode = Schema.Literals([
  "userDriven",
  "selfDeploying",
  "preProvisioned",
]);

export type AutopilotDeploymentMode = typeof AutopilotDeploymentMode.Type;

export const AutopilotJoinType = Schema.Literals([
  "azureADJoin",
  "azureADJoinUsingDeviceAuth",
  "hybridAzureADJoin",
]);

export type AutopilotJoinType = typeof AutopilotJoinType.Type;

/** A cached Windows Autopilot device. The hardware hash is never returned. */
export const AutopilotDeviceInfo = Schema.Struct({
  serial: Schema.String,
  graphId: Schema.optional(NullableString),
  azureAdDeviceId: Schema.optional(NullableString),
  groupTag: Schema.optional(NullableString),
  model: Schema.optional(NullableString),
  manufacturer: Schema.optional(NullableString),
  profileStatus: AutopilotProfileStatus,
  enrollmentState: AutopilotEnrollmentState,
  /** Local Autopilot profile row id when assigned. */
  profileId: Schema.optional(NullableString),
  /** Enrolled `device` row id, once the device checks in. */
  deviceId: Schema.optional(NullableString),
  lastSyncedAt: Schema.optional(NullableString),
});

export type AutopilotDeviceInfo = typeof AutopilotDeviceInfo.Type;

export const AutopilotDevicesResponse = Schema.Struct({
  devices: Schema.Array(AutopilotDeviceInfo),
});

export type AutopilotDevicesResponse = typeof AutopilotDevicesResponse.Type;

export const AutopilotImportRequest = Schema.Struct({
  /** CSV/headerless text copied from the Autopilot device export. */
  content: Schema.String,
  /** `csv` and `text` are accepted; parsing is identical. */
  format: Schema.optional(Schema.Literals(["csv", "text"])),
  maxRows: Schema.optional(Schema.Number),
});

export type AutopilotImportRequest = typeof AutopilotImportRequest.Type;

export const AutopilotImportResponse = Schema.Struct({
  imported: Schema.Number,
  skipped: Schema.Number,
  truncated: Schema.Boolean,
  errors: Schema.Array(Schema.String),
  devices: Schema.Array(AutopilotDeviceInfo),
});

export type AutopilotImportResponse = typeof AutopilotImportResponse.Type;

export const AutopilotSyncResponse = Schema.Struct({
  status: Schema.Literal("ok"),
  synced: Schema.Number,
  linked: Schema.Number,
  pages: Schema.Number,
});

export type AutopilotSyncResponse = typeof AutopilotSyncResponse.Type;

export const AutopilotProfileInfo = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optional(NullableString),
  deploymentMode: AutopilotDeploymentMode,
  joinType: AutopilotJoinType,
  deviceNameTemplate: Schema.optional(NullableString),
  locale: Schema.optional(NullableString),
  timezone: Schema.optional(NullableString),
  enableDevicePreparation: Schema.Boolean,
  assignedGroupId: Schema.optional(NullableString),
  graphProfileId: Schema.optional(NullableString),
  status: Schema.Literals(["draft", "active", "error"]),
  lastError: Schema.optional(NullableString),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export type AutopilotProfileInfo = typeof AutopilotProfileInfo.Type;

export const AutopilotProfilesResponse = Schema.Struct({
  profiles: Schema.Array(AutopilotProfileInfo),
});

export type AutopilotProfilesResponse = typeof AutopilotProfilesResponse.Type;

export const AutopilotProfileFields = {
  name: Schema.String,
  description: Schema.optional(NullableString),
  deploymentMode: Schema.optional(AutopilotDeploymentMode),
  joinType: Schema.optional(AutopilotJoinType),
  deviceNameTemplate: Schema.optional(NullableString),
  locale: Schema.optional(NullableString),
  timezone: Schema.optional(NullableString),
  enableDevicePreparation: Schema.optional(Schema.Boolean),
  assignedGroupId: Schema.optional(NullableString),
} as const;

export const CreateAutopilotProfileRequest = Schema.Struct(AutopilotProfileFields);

export type CreateAutopilotProfileRequest = typeof CreateAutopilotProfileRequest.Type;

export const UpdateAutopilotProfileRequest = Schema.Struct({
  ...AutopilotProfileFields,
  name: Schema.optional(Schema.String),
});

export type UpdateAutopilotProfileRequest = typeof UpdateAutopilotProfileRequest.Type;

export const AssignAutopilotProfileRequest = Schema.Struct({
  /** Entra group object id targeted by the Graph assignment. */
  groupId: Schema.String,
});

export type AssignAutopilotProfileRequest = typeof AssignAutopilotProfileRequest.Type;

/** Graph/Autopilot configuration shown in Settings → Management. */
export const AutopilotSettingsResponse = Schema.Struct({
  /** True when both Graph credentials and a tenant Entra id are configured. */
  configured: Schema.Boolean,
  graphConfigured: Schema.Boolean,
  azureTenantId: Schema.optional(NullableString),
  consentUrl: Schema.optional(NullableString),
  deviceCount: Schema.Number,
  linkedDeviceCount: Schema.Number,
  profileCount: Schema.Number,
  lastSyncedAt: Schema.optional(NullableString),
  /** Federated WSTEP enrollment state for this tenant. */
  federatedEnrollment: Schema.Struct({
    enabled: Schema.Boolean,
    realm: Schema.optional(NullableString),
    authServiceUrl: Schema.optional(NullableString),
  }),
});

export type AutopilotSettingsResponse = typeof AutopilotSettingsResponse.Type;
