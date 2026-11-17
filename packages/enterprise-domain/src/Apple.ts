import { Schema } from "effect";
import { NullableString } from "./Errors.js";

export const AppleBusinessManagerStatus = Schema.Literals(["unconfigured", "active", "error"]);

export type AppleBusinessManagerStatus = typeof AppleBusinessManagerStatus.Type;

export const AppleBusinessManagerInfo = Schema.Struct({
  configured: Schema.Boolean,
  status: AppleBusinessManagerStatus,
  /** `abm_api` for the current OAuth API account; `legacy_dep` for a `.p7m` token. */
  credentialType: Schema.optional(NullableString),
  appleOrgId: Schema.optional(NullableString),
  appleOrgName: Schema.optional(NullableString),
  tokenExpiresAt: Schema.optional(NullableString),
  /** ABM device management service used for automatic assignment. */
  mdmServerId: Schema.optional(NullableString),
  /** Stable ADE enrollment profile UUID for this tenant. */
  profileUuid: Schema.optional(NullableString),
  /**
   * Stable URL to register as the ADE profile's `url`. Setup Assistant POSTs a
   * signed MachineInfo here and receives the tenant's MDM enrollment profile.
   */
  enrollmentUrl: Schema.optional(NullableString),
  lastSyncedAt: Schema.optional(NullableString),
  lastError: Schema.optional(NullableString),
  deviceCount: Schema.Number,
  assignedCount: Schema.Number,
  createdAt: Schema.optional(NullableString),
  updatedAt: Schema.optional(NullableString),
});

export type AppleBusinessManagerInfo = typeof AppleBusinessManagerInfo.Type;

/**
 * Upload an ABM API private key (`.pem`) with its Client ID/Key ID, a JSON
 * credential bundle, or a legacy `.p7m` DEP server token. `content` may be raw
 * text or base64; binary `.p7m` uploads should set `encoding = "base64"`.
 */
export const UploadAppleBusinessManagerTokenRequest = Schema.Struct({
  content: Schema.String,
  encoding: Schema.optional(Schema.Literals(["text", "base64"])),
  fileName: Schema.optional(Schema.String),
  clientId: Schema.optional(Schema.String),
  keyId: Schema.optional(Schema.String),
  teamId: Schema.optional(Schema.String),
  orgId: Schema.optional(Schema.String),
  orgName: Schema.optional(Schema.String),
  scope: Schema.optional(Schema.Literals(["business.api", "school.api"])),
});

export type UploadAppleBusinessManagerTokenRequest =
  typeof UploadAppleBusinessManagerTokenRequest.Type;

export const AppleBusinessManagerSyncResponse = Schema.Struct({
  devices: Schema.Number,
  assigned: Schema.Number,
  unassigned: Schema.Number,
  removed: Schema.Number,
  lastSyncedAt: Schema.String,
});

export type AppleBusinessManagerSyncResponse = typeof AppleBusinessManagerSyncResponse.Type;

export const AbmDeviceInfo = Schema.Struct({
  serial: Schema.String,
  model: Schema.optional(NullableString),
  deviceFamily: Schema.optional(NullableString),
  os: Schema.optional(NullableString),
  profileStatus: Schema.String,
  assignedProfileUuid: Schema.optional(NullableString),
  enrollmentState: Schema.String,
  assignedServerId: Schema.optional(NullableString),
  lastSeenAt: Schema.optional(NullableString),
  updatedAt: Schema.String,
});

export type AbmDeviceInfo = typeof AbmDeviceInfo.Type;

export const AbmDevicesResponse = Schema.Struct({ devices: Schema.Array(AbmDeviceInfo) });

export type AbmDevicesResponse = typeof AbmDevicesResponse.Type;

export const AbmAssignDeviceResponse = Schema.Struct({
  status: Schema.Literal("ok"),
  serial: Schema.String,
  mdmServerId: Schema.String,
  activityId: Schema.optional(NullableString),
});

export type AbmAssignDeviceResponse = typeof AbmAssignDeviceResponse.Type;

export const AbmProfileUrlResponse = Schema.Struct({
  serial: Schema.String,
  profileUuid: Schema.String,
  url: Schema.String,
  expiresAt: Schema.String,
});

export type AbmProfileUrlResponse = typeof AbmProfileUrlResponse.Type;

/** Apple Apps and Books (VPP) token/licence state for one tenant. */
export const VppStatus = Schema.Literals(["unconfigured", "active", "error"]);

export type VppStatus = typeof VppStatus.Type;

export const VppInfo = Schema.Struct({
  configured: Schema.Boolean,
  status: VppStatus,
  appleOrgId: Schema.optional(NullableString),
  tokenExpiresAt: Schema.optional(NullableString),
  lastSyncedAt: Schema.optional(NullableString),
  lastError: Schema.optional(NullableString),
  assets: Schema.Number,
  totalLicenses: Schema.Number,
  availableLicenses: Schema.Number,
  assignedLicenses: Schema.Number,
  createdAt: Schema.optional(NullableString),
  updatedAt: Schema.optional(NullableString),
});

export type VppInfo = typeof VppInfo.Type;

export const UploadVppTokenRequest = Schema.Struct({
  content: Schema.String,
  encoding: Schema.optional(Schema.Literals(["text", "base64"])),
  fileName: Schema.optional(Schema.String),
});

export type UploadVppTokenRequest = typeof UploadVppTokenRequest.Type;

export const VppSyncResponse = Schema.Struct({
  assets: Schema.Number,
  totalLicenses: Schema.Number,
  availableLicenses: Schema.Number,
  assignedLicenses: Schema.Number,
  lastSyncedAt: Schema.String,
});

export type VppSyncResponse = typeof VppSyncResponse.Type;

export const VppAssetInfo = Schema.Struct({
  adamId: Schema.String,
  name: Schema.String,
  bundleId: Schema.optional(NullableString),
  totalLicenses: Schema.Number,
  availableLicenses: Schema.Number,
  assignedLicenses: Schema.Number,
  retiredLicenses: Schema.Number,
  pricingParam: Schema.optional(NullableString),
  deviceAssignable: Schema.Boolean,
  revocable: Schema.Boolean,
  productType: Schema.optional(NullableString),
  supportedPlatforms: Schema.optional(Schema.Array(Schema.String)),
  lastSyncedAt: Schema.optional(NullableString),
});

export type VppAssetInfo = typeof VppAssetInfo.Type;

export const VppAssetsResponse = Schema.Struct({ assets: Schema.Array(VppAssetInfo) });

export type VppAssetsResponse = typeof VppAssetsResponse.Type;

export const VppInstallRequest = Schema.Struct({
  /** Device ids (not serials) to install on. */
  devices: Schema.optional(Schema.Array(Schema.String)),
  /** Group ids whose devices should receive the app. */
  groups: Schema.optional(Schema.Array(Schema.String)),
});

export type VppInstallRequest = typeof VppInstallRequest.Type;

export const VppInstallResponse = Schema.Struct({
  status: Schema.Literal("ok"),
  assigned: Schema.Number,
  queued: Schema.Number,
  skipped: Schema.Number,
  failed: Schema.Number,
  message: Schema.optional(Schema.String),
});

export type VppInstallResponse = typeof VppInstallResponse.Type;

export const VppReleaseRequest = Schema.Struct({
  devices: Schema.Array(Schema.String),
});

export type VppReleaseRequest = typeof VppReleaseRequest.Type;

export const VppReleaseResponse = Schema.Struct({
  status: Schema.Literal("ok"),
  released: Schema.Number,
  failed: Schema.Number,
  message: Schema.optional(Schema.String),
});

export type VppReleaseResponse = typeof VppReleaseResponse.Type;

export const VppAssignmentInfo = Schema.Struct({
  deviceId: Schema.String,
  serial: Schema.String,
  adamId: Schema.String,
  state: Schema.String,
  eventId: Schema.optional(NullableString),
  lastError: Schema.optional(NullableString),
  updatedAt: Schema.String,
});

export type VppAssignmentInfo = typeof VppAssignmentInfo.Type;

export const VppAssignmentsResponse = Schema.Struct({
  assignments: Schema.Array(VppAssignmentInfo),
});
