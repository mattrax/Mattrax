import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";

const IdParam = { id: Schema.String };
const TenantParam = { tenantId: Schema.String };
const TenantIdParam = { tenantId: Schema.String, id: Schema.String };
const TenantInvitationParam = { tenantId: Schema.String, invitationId: Schema.String };
const TenantMemberParam = { tenantId: Schema.String, memberId: Schema.String };
const TenantPreRegistrationParam = { tenantId: Schema.String, id: Schema.String };
const ApiTokenParam = { tokenId: Schema.String };

export const NullableString = Schema.NullOr(Schema.String);
export const JsonRecord = Schema.Record(Schema.String, Schema.Unknown);

export class EnterpriseUnauthorized extends Schema.TaggedError<EnterpriseUnauthorized>()(
  "EnterpriseUnauthorized",
  {
    message: Schema.String,
  },
) {}
export class EnterpriseBadRequest extends Schema.TaggedError<EnterpriseBadRequest>()(
  "EnterpriseBadRequest",
  {
    message: Schema.String,
  },
) {}
export class EnterpriseForbidden extends Schema.TaggedError<EnterpriseForbidden>()(
  "EnterpriseForbidden",
  {
    message: Schema.String,
  },
) {}
export class EnterpriseConflict extends Schema.TaggedError<EnterpriseConflict>()(
  "EnterpriseConflict",
  {
    message: Schema.String,
  },
) {}
export class EnterpriseNotFound extends Schema.TaggedError<EnterpriseNotFound>()(
  "EnterpriseNotFound",
  {
    message: Schema.String,
  },
) {}
export class EnterpriseTenantHasMembers extends Schema.TaggedError<EnterpriseTenantHasMembers>()(
  "EnterpriseTenantHasMembers",
  {
    message: Schema.String,
  },
) {}
export class EnterpriseLastTenantUser extends Schema.TaggedError<EnterpriseLastTenantUser>()(
  "EnterpriseLastTenantUser",
  {
    message: Schema.String,
  },
) {}
export class EnterpriseDbError extends Schema.TaggedError<EnterpriseDbError>()(
  "EnterpriseDbError",
  {
    message: Schema.String,
  },
) {}
export class EnterpriseStripeError extends Schema.TaggedError<EnterpriseStripeError>()(
  "EnterpriseStripeError",
  {
    message: Schema.String,
  },
) {}
export class EnterpriseR2FileNotFound extends Schema.TaggedError<EnterpriseR2FileNotFound>()(
  "EnterpriseR2FileNotFound",
  {
    message: Schema.String,
  },
) {}
export class EnterpriseR2InternalError extends Schema.TaggedError<EnterpriseR2InternalError>()(
  "EnterpriseR2InternalError",
  {
    message: Schema.String,
  },
) {}

const EnterpriseAuthRequiredErrors = [
  EnterpriseUnauthorized.pipe(HttpApiSchema.status(401)),
] as const;
const EnterpriseDbErrors = [EnterpriseDbError.pipe(HttpApiSchema.status(500))] as const;
const EnterpriseTenantReadErrors = [
  ...EnterpriseAuthRequiredErrors,
  ...EnterpriseDbErrors,
  EnterpriseNotFound.pipe(HttpApiSchema.status(404)),
] as const;
const EnterpriseTenantWriteErrors = [
  ...EnterpriseTenantReadErrors,
  EnterpriseForbidden.pipe(HttpApiSchema.status(403)),
  EnterpriseConflict.pipe(HttpApiSchema.status(409)),
  EnterpriseBadRequest.pipe(HttpApiSchema.status(400)),
] as const;
const EnterpriseTenantDeleteErrors = [
  ...EnterpriseTenantWriteErrors,
  EnterpriseTenantHasMembers.pipe(HttpApiSchema.status(409)),
] as const;
const EnterpriseTenantUserRemoveErrors = [
  ...EnterpriseTenantWriteErrors,
  EnterpriseLastTenantUser.pipe(HttpApiSchema.status(409)),
] as const;
const EnterprisePolicyApplicationUploadErrors = [
  ...EnterpriseTenantWriteErrors,
  EnterpriseR2InternalError.pipe(HttpApiSchema.status(500)),
] as const;
const EnterprisePolicyApplicationDownloadErrors = [
  ...EnterpriseTenantReadErrors,
  EnterpriseR2FileNotFound.pipe(HttpApiSchema.status(404)),
  EnterpriseR2InternalError.pipe(HttpApiSchema.status(500)),
] as const;
const EnterpriseBillingPortalErrors = [
  ...EnterpriseTenantWriteErrors,
  EnterpriseStripeError.pipe(HttpApiSchema.status(502)),
] as const;
const EnterpriseApnsErrors = [...EnterpriseTenantWriteErrors] as const;
const EnterpriseApplicationErrors = [...EnterpriseTenantWriteErrors] as const;
const EnterpriseSsoErrors = [...EnterpriseTenantWriteErrors] as const;
const EnterpriseNoDomainErrors = [...EnterpriseDbErrors] as const;
const EnterpriseAccountErrors = [
  ...EnterpriseAuthRequiredErrors,
  ...EnterpriseDbErrors,
  EnterpriseBadRequest.pipe(HttpApiSchema.status(400)),
  EnterpriseNotFound.pipe(HttpApiSchema.status(404)),
] as const;
const EnterprisePublicEmailErrors = [
  ...EnterpriseDbErrors,
  EnterpriseNotFound.pipe(HttpApiSchema.status(404)),
  EnterpriseBadRequest.pipe(HttpApiSchema.status(400)),
] as const;
const EnterprisePublicNotFoundErrors = [
  ...EnterpriseDbErrors,
  EnterpriseNotFound.pipe(HttpApiSchema.status(404)),
] as const;
const EnterprisePublicEnrollmentProfileErrors = [
  ...EnterprisePublicNotFoundErrors,
  EnterpriseBadRequest.pipe(HttpApiSchema.status(400)),
  EnterpriseForbidden.pipe(HttpApiSchema.status(403)),
] as const;

export const UserInfo = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  emailVerified: Schema.Boolean,
  image: Schema.optional(NullableString),
});
export type UserInfo = typeof UserInfo.Type;

export const OrganizationInfo = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  role: Schema.String,
});

export const TenantInfo = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  role: Schema.String,
  logo: Schema.optional(NullableString),
});
export type TenantInfo = typeof TenantInfo.Type;

export const TenantDetail = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  role: Schema.String,
  logo: Schema.optional(NullableString),
  metadata: Schema.optional(NullableString),
  createdAt: Schema.String,
});
export type TenantDetail = typeof TenantDetail.Type;

export const BillingSummary = Schema.Struct({
  plan: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  billableDevices: Schema.Number,
  subscriptionId: Schema.optional(NullableString),
});
export type BillingSummary = typeof BillingSummary.Type;

export const MeResponse = Schema.Struct({
  user: UserInfo,
  tenants: Schema.Array(TenantInfo),
});
export type MeResponse = typeof MeResponse.Type;

export const CreateTenantRequest = Schema.Struct({
  name: Schema.String,
  slug: Schema.String,
  logo: Schema.optional(NullableString),
  metadata: Schema.optional(JsonRecord),
});

export const PatchTenantRequest = Schema.Struct({
  name: Schema.optional(Schema.String),
  slug: Schema.optional(Schema.String),
  logo: Schema.optional(NullableString),
  metadata: Schema.optional(Schema.NullOr(JsonRecord)),
});

export const TenantListResponse = Schema.Struct({ tenants: Schema.Array(TenantInfo) });

export const TenantUser = Schema.Struct({
  memberId: Schema.String,
  userId: Schema.String,
  name: Schema.String,
  email: Schema.String,
  role: Schema.String,
  createdAt: Schema.String,
});
export type TenantUser = typeof TenantUser.Type;

export const TenantUsersResponse = Schema.Struct({ users: Schema.Array(TenantUser) });

export const InviteTenantUserRequest = Schema.Struct({
  email: Schema.String,
  role: Schema.optional(Schema.String),
  resend: Schema.optional(Schema.Boolean),
});

export const TenantInvitation = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  role: Schema.optional(NullableString),
  status: Schema.String,
  expiresAt: Schema.String,
  createdAt: Schema.String,
});
export type TenantInvitation = typeof TenantInvitation.Type;

export const TenantInvitationsResponse = Schema.Struct({
  invitations: Schema.Array(TenantInvitation),
});

export const PatchTenantUserRequest = Schema.Struct({ role: Schema.String });

export const SsoConfigResponse = Schema.Struct({
  enabled: Schema.Boolean,
  azureTenantId: Schema.optional(NullableString),
  autoProvision: Schema.Boolean,
});
export const PatchSsoConfigRequest = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  azureTenantId: Schema.optional(NullableString),
  autoProvision: Schema.optional(Schema.Boolean),
});

export const EntraDomainInfo = Schema.Struct({
  domain: Schema.String,
  source: Schema.String,
  isVerified: Schema.Boolean,
  verifiedAt: Schema.optional(NullableString),
});
export type EntraDomainInfo = typeof EntraDomainInfo.Type;
export const EntraDomainsResponse = Schema.Struct({ domains: Schema.Array(EntraDomainInfo) });

export const EntraDirectorySyncStatus = Schema.Struct({
  configured: Schema.Boolean,
  enabled: Schema.Boolean,
  status: Schema.String,
  azureTenantId: Schema.optional(NullableString),
  lastSyncedAt: Schema.optional(NullableString),
  lastError: Schema.optional(NullableString),
  lastCounts: Schema.optional(Schema.NullOr(Schema.Unknown)),
  consentUrl: Schema.optional(NullableString),
});
export type EntraDirectorySyncStatus = typeof EntraDirectorySyncStatus.Type;
export const PatchEntraDirectorySyncRequest = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
});
export const EntraDirectorySyncResult = Schema.Struct({
  status: Schema.Literal("ok"),
  users: Schema.Number,
  groups: Schema.Number,
  domains: Schema.Number,
});

export const ScimTokenInfo = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  createdAt: Schema.String,
  lastUsedAt: Schema.optional(NullableString),
});
export const ScimTokensResponse = Schema.Struct({ tokens: Schema.Array(ScimTokenInfo) });
export const CreateScimTokenRequest = Schema.Struct({ name: Schema.String });
export const CreateScimTokenResponse = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  token: Schema.String,
  baseUrl: Schema.String,
});

export const AuditLogEntry = Schema.Struct({
  id: Schema.String,
  action: Schema.String,
  targetType: Schema.String,
  targetId: Schema.optional(NullableString),
  actorEmail: Schema.optional(NullableString),
  metadata: Schema.optional(Schema.NullOr(Schema.Unknown)),
  createdAt: Schema.String,
});
export type AuditLogEntry = typeof AuditLogEntry.Type;

export const AuditLogResponse = Schema.Struct({ entries: Schema.Array(AuditLogEntry) });

export const CreateInvitationResponse = Schema.Struct({
  id: Schema.String,
  /** Present when the server can build an invite link (always in this build). */
  inviteUrl: Schema.optional(NullableString),
});
export const AcceptInvitationRequest = Schema.Struct({ token: Schema.String });
export const AcceptInvitationResponse = Schema.Struct({ tenantId: Schema.String });

export const VerifyEmailRequest = Schema.Struct({ token: Schema.String });
export const EmailVerificationResponse = Schema.Struct({ status: Schema.Literal("ok") });

export const UpdateMeRequest = Schema.Struct({
  name: Schema.optional(Schema.String),
  image: Schema.optional(NullableString),
});

export const DeviceProtocol = Schema.Literals(["apple", "win", "android"]);
export const DeviceStatus = Schema.Literals(["enrolling", "enrolled", "unenrolling", "unenrolled"]);

export const DeviceRow = Schema.Struct({
  id: Schema.String,
  proto: DeviceProtocol,
  name: Schema.String,
  model: Schema.optional(NullableString),
  modelIdentifier: Schema.optional(NullableString),
  serial: Schema.optional(NullableString),
  status: DeviceStatus,
  enrolledAt: Schema.String,
  lastSeenAt: Schema.String,
  assetTag: Schema.optional(NullableString),
  notes: Schema.optional(NullableString),
  physicalName: Schema.optional(NullableString),
  vendor: Schema.optional(NullableString),
  osEdition: Schema.optional(NullableString),
  osVersion: Schema.optional(NullableString),
  osBuild: Schema.optional(NullableString),
  diskTotal: Schema.optional(NullableString),
  diskUsed: Schema.optional(NullableString),
  /** FileVault state reported by the DDM inventory status items. */
  fileVaultEnabled: Schema.optional(Schema.NullOr(Schema.Boolean)),
  /** Normalised battery condition (for example `Good`, `Service Recommended`). */
  batteryHealth: Schema.optional(NullableString),
  /** Raw client capability list reported by `management.client-capabilities`. */
  capabilities: Schema.optional(Schema.NullOr(Schema.Unknown)),
  modelNumber: Schema.optional(NullableString),
  inventoryUpdatedAt: Schema.optional(NullableString),
});
export type DeviceRow = typeof DeviceRow.Type;

export const DeviceCommandInfo = Schema.Struct({
  id: Schema.String,
  requestType: Schema.String,
  status: Schema.String,
  resultStatus: Schema.optional(NullableString),
  resultDetail: Schema.optional(NullableString),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export const DeviceCommandsResponse = Schema.Struct({
  commands: Schema.Array(DeviceCommandInfo),
});
export const DeviceDeclarationInfo = Schema.Struct({
  identifier: Schema.String,
  declarationType: Schema.String,
  active: Schema.Boolean,
  valid: Schema.String,
  serverToken: Schema.optional(NullableString),
  reasons: Schema.optional(Schema.NullOr(Schema.Unknown)),
  updatedAt: Schema.String,
});
export const DeviceDeclarationsResponse = Schema.Struct({
  declarations: Schema.Array(DeviceDeclarationInfo),
});

export const DeviceHealthLevel = Schema.Literals(["healthy", "attention", "critical", "unknown"]);
export type DeviceHealthLevel = typeof DeviceHealthLevel.Type;
export const DeviceHealthReasonSeverity = Schema.Literals(["info", "warning", "critical"]);
export type DeviceHealthReasonSeverity = typeof DeviceHealthReasonSeverity.Type;
export const DeviceHealthReason = Schema.Struct({
  code: Schema.String,
  label: Schema.String,
  severity: DeviceHealthReasonSeverity,
});
export type DeviceHealthReason = typeof DeviceHealthReason.Type;
export const DeviceHealth = Schema.Struct({
  level: DeviceHealthLevel,
  reasons: Schema.Array(DeviceHealthReason),
  lastSeenAt: Schema.optional(NullableString),
  stale: Schema.Boolean,
});
export type DeviceHealth = typeof DeviceHealth.Type;

/** Identity certificate metadata. Private keys are never exposed. */
export const DeviceCertificateInfo = Schema.Struct({
  serial: Schema.String,
  notAfter: Schema.String,
  revokedAt: Schema.optional(NullableString),
  createdAt: Schema.String,
});
export type DeviceCertificateInfo = typeof DeviceCertificateInfo.Type;

/** APNs delivery state for a single Apple device. */
export const DevicePushErrorCode = Schema.Literals(["invalid_token", "delivery_failed"]);
export type DevicePushErrorCode = typeof DevicePushErrorCode.Type;

export const DevicePushInfo = Schema.Struct({
  /** The device has a token and push magic, so a push could be attempted. */
  configured: Schema.Boolean,
  lastAttemptAt: Schema.optional(NullableString),
  lastSuccessAt: Schema.optional(NullableString),
  lastError: Schema.optional(NullableString),
  lastErrorCode: Schema.optional(Schema.NullOr(DevicePushErrorCode)),
  consecutiveFailures: Schema.Number,
  /** Apple rejected the token; the device has to enroll again. */
  invalidToken: Schema.Boolean,
});
export type DevicePushInfo = typeof DevicePushInfo.Type;

/** Tenant-wide APNs delivery rollup. */
export const DevicePushHealthCounts = Schema.Struct({
  /** Apple devices that currently have a push token and magic. */
  configured: Schema.Number,
  /** Devices with at least one recorded delivery attempt. */
  attempted: Schema.Number,
  /** Last delivery succeeded and no failure is outstanding. */
  succeeded: Schema.Number,
  /** Devices whose most recent delivery has not been followed by a success. */
  failing: Schema.Number,
  /** Devices Apple has told us can no longer receive pushes. */
  invalidToken: Schema.Number,
});
export type DevicePushHealthCounts = typeof DevicePushHealthCounts.Type;

export const DevicePushFailure = Schema.Struct({
  deviceId: Schema.String,
  deviceName: Schema.String,
  at: Schema.String,
  error: Schema.optional(NullableString),
  errorCode: Schema.optional(Schema.NullOr(DevicePushErrorCode)),
  consecutiveFailures: Schema.Number,
});
export type DevicePushFailure = typeof DevicePushFailure.Type;

export const DevicePushHealthResponse = Schema.Struct({
  counts: DevicePushHealthCounts,
  recentFailures: Schema.Array(DevicePushFailure),
});
export type DevicePushHealthResponse = typeof DevicePushHealthResponse.Type;

/** Chronological per-device feed assembled from existing records. */
export const DeviceActivityKind = Schema.Literals([
  "audit",
  "command",
  "declaration",
  "lifecycle",
  "certificate",
]);
export type DeviceActivityKind = typeof DeviceActivityKind.Type;

export const DeviceActivityEntry = Schema.Struct({
  id: Schema.String,
  kind: DeviceActivityKind,
  title: Schema.String,
  detail: Schema.optional(NullableString),
  status: Schema.optional(NullableString),
  at: Schema.String,
});
export type DeviceActivityEntry = typeof DeviceActivityEntry.Type;

export const DeviceActivityResponse = Schema.Struct({
  events: Schema.Array(DeviceActivityEntry),
});
export type DeviceActivityResponse = typeof DeviceActivityResponse.Type;

export const DeviceHealthResponse = Schema.Struct({
  health: DeviceHealth,
  declarations: Schema.Array(DeviceDeclarationInfo),
  certificates: Schema.Array(DeviceCertificateInfo),
  push: DevicePushInfo,
});
export type DeviceHealthResponse = typeof DeviceHealthResponse.Type;

export const DeviceHealthCounts = Schema.Struct({
  total: Schema.Number,
  healthy: Schema.Number,
  attention: Schema.Number,
  critical: Schema.Number,
  /** Devices past the stale threshold, regardless of their health level. */
  stale: Schema.Number,
  unknown: Schema.Number,
});
export type DeviceHealthCounts = typeof DeviceHealthCounts.Type;
export const DeviceHealthSummaryResponse = Schema.Struct({ counts: DeviceHealthCounts });
export type DeviceHealthSummaryResponse = typeof DeviceHealthSummaryResponse.Type;

/**
 * Tenant credential rollup. `missing` means the credential has not been
 * configured; `unknown` means it exists but its expiry could not be parsed.
 */
export const CredentialLevel = Schema.Literals([
  "ok",
  "warning",
  "critical",
  "expired",
  "missing",
  "unknown",
]);
export type CredentialLevel = typeof CredentialLevel.Type;

export const CredentialInfo = Schema.Struct({
  configured: Schema.Boolean,
  expiresAt: Schema.optional(NullableString),
  /** Whole days until expiry; zero or negative once expired. Null when unparseable. */
  daysLeft: Schema.optional(Schema.NullOr(Schema.Number)),
  level: CredentialLevel,
});
export type CredentialInfo = typeof CredentialInfo.Type;

export const DeviceCertificateCounts = Schema.Struct({
  total: Schema.Number,
  /** Active certificates expiring within 30 days. */
  expiringSoon: Schema.Number,
  expired: Schema.Number,
  revoked: Schema.Number,
});
export type DeviceCertificateCounts = typeof DeviceCertificateCounts.Type;

export const CredentialHealthResponse = Schema.Struct({
  apns: CredentialInfo,
  scepCa: CredentialInfo,
  deviceCertificates: DeviceCertificateCounts,
});
export type CredentialHealthResponse = typeof CredentialHealthResponse.Type;

export const DeviceIdentityRevokeResponse = Schema.Struct({
  status: Schema.Literal("ok"),
  /** Number of identity certificates that were active and are now revoked. */
  revoked: Schema.Number,
});

export const DeviceActionResponse = Schema.Struct({
  status: Schema.Literal("ok"),
  /** Present for a lock command so the administrator can unlock the device. */
  pin: Schema.optional(Schema.String),
});

export const DeviceActionRequest = Schema.Struct({
  action: Schema.optional(
    Schema.Literals([
      "sync",
      "lock",
      "wipe",
      "restart",
      "shutdown",
      "clear-passcode",
      "install-app",
    ]),
  ),
  manifestUrl: Schema.optional(Schema.String),
  iTunesStoreId: Schema.optional(Schema.Number),
});

export const PatchDeviceRequest = Schema.Struct({
  name: Schema.optional(Schema.String),
  notes: Schema.optional(NullableString),
  assetTag: Schema.optional(NullableString),
});

export const GroupRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  notes: Schema.optional(NullableString),
  devicesCount: Schema.optional(Schema.Number),
  policiesCount: Schema.optional(Schema.Number),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type GroupRow = typeof GroupRow.Type;

export const GroupRelation = Schema.Struct({ id: Schema.String, name: Schema.String });
export const DeviceRelation = Schema.Struct({ id: Schema.String, name: Schema.String });
export const GroupNode = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  notes: Schema.optional(NullableString),
  devicesCount: Schema.optional(Schema.Number),
  policiesCount: Schema.optional(Schema.Number),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  devices: Schema.optional(Schema.Array(GroupRelation)),
  policies: Schema.optional(Schema.Array(GroupRelation)),
});
export type GroupNode = typeof GroupNode.Type;

export const CreateGroupRequest = Schema.Struct({
  name: Schema.String,
  notes: Schema.optional(NullableString),
  devices: Schema.optional(Schema.Array(Schema.String)),
  policies: Schema.optional(Schema.Array(Schema.String)),
});

export const PatchGroupRequest = Schema.Struct({
  name: Schema.optional(Schema.String),
  notes: Schema.optional(NullableString),
});

export const PatchGroupMembersRequest = Schema.Struct({
  assign: Schema.optional(
    Schema.Struct({
      devices: Schema.optional(Schema.Array(Schema.String)),
      policies: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
  unassign: Schema.optional(
    Schema.Struct({
      devices: Schema.optional(Schema.Array(Schema.String)),
      policies: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
});

export const PolicyRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  notes: Schema.optional(NullableString),
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
});

export const PatchPolicyRequest = Schema.Struct({
  name: Schema.optional(Schema.String),
  notes: Schema.optional(NullableString),
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

export const ApplicationPlatform = Schema.Literals(["apple", "win", "android"]);
export type ApplicationPlatform = typeof ApplicationPlatform.Type;
export const ApplicationSource = Schema.Literals(["manifest", "store", "upload"]);
export type ApplicationSource = typeof ApplicationSource.Type;

export const ApplicationRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  platform: ApplicationPlatform,
  bundleId: Schema.optional(NullableString),
  version: Schema.optional(NullableString),
  source: ApplicationSource,
  manifestUrl: Schema.optional(NullableString),
  storeId: Schema.optional(NullableString),
  fileName: Schema.optional(NullableString),
  contentType: Schema.optional(NullableString),
  size: Schema.optional(Schema.Number),
  sha256: Schema.optional(NullableString),
  notes: Schema.optional(NullableString),
  groupsCount: Schema.optional(Schema.Number),
  devicesCount: Schema.optional(Schema.Number),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type ApplicationRow = typeof ApplicationRow.Type;

export const ApplicationListResponse = Schema.Struct({
  applications: Schema.Array(ApplicationRow),
});
export const ApplicationNode = Schema.Struct({
  ...ApplicationRow.fields,
  groups: Schema.Array(GroupRelation),
  devices: Schema.Array(DeviceRelation),
});
export type ApplicationNode = typeof ApplicationNode.Type;

export const CreateApplicationRequest = Schema.Struct({
  name: Schema.String,
  platform: ApplicationPlatform,
  bundleId: Schema.optional(NullableString),
  version: Schema.optional(NullableString),
  source: Schema.optional(ApplicationSource),
  manifestUrl: Schema.optional(NullableString),
  storeId: Schema.optional(NullableString),
  notes: Schema.optional(NullableString),
});

export const PatchApplicationRequest = Schema.Struct({
  name: Schema.optional(Schema.String),
  bundleId: Schema.optional(NullableString),
  version: Schema.optional(NullableString),
  source: Schema.optional(ApplicationSource),
  manifestUrl: Schema.optional(NullableString),
  storeId: Schema.optional(NullableString),
  notes: Schema.optional(NullableString),
});

export const PatchApplicationAssignmentsRequest = Schema.Struct({
  assign: Schema.optional(
    Schema.Struct({
      groups: Schema.optional(Schema.Array(Schema.String)),
      devices: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
  unassign: Schema.optional(
    Schema.Struct({
      groups: Schema.optional(Schema.Array(Schema.String)),
      devices: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
});

export const ApplicationInstallResult = Schema.Struct({
  status: Schema.Literal("ok"),
  queued: Schema.Number,
  skipped: Schema.Number,
  message: Schema.optional(Schema.String),
});
export type ApplicationInstallResult = typeof ApplicationInstallResult.Type;

export const PolicyAssignmentsResponse = Schema.Struct({
  groups: Schema.Array(GroupRelation),
  devices: Schema.Array(DeviceRelation),
});
export type PolicyAssignmentsResponse = typeof PolicyAssignmentsResponse.Type;

export const PatchPolicyAssignmentsRequest = Schema.Struct({
  assign: Schema.optional(Schema.Array(Schema.String)),
  unassign: Schema.optional(Schema.Array(Schema.String)),
});

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

export const DuplicateRequest = Schema.Struct({ name: Schema.optional(Schema.String) });
export const IdsRequest = Schema.Array(Schema.String);
export const IdResponse = Schema.Struct({ id: Schema.String });
export const NoContent = Schema.Void;

export const BulkOperationResult = Schema.Struct({
  deleted: Schema.Array(Schema.String),
  failed: Schema.Array(Schema.Struct({ id: Schema.String, reason: Schema.String })),
});

export const PolicyDeploymentInfo = Schema.Struct({
  id: Schema.String,
  version: Schema.Number,
  createdAt: Schema.String,
  createdByUserId: Schema.optional(NullableString),
});
export const PolicyDeploymentsResponse = Schema.Struct({
  deployments: Schema.Array(PolicyDeploymentInfo),
});

export const SearchResult = Schema.Struct({
  rows: Schema.Array(Schema.Union([DeviceRow, GroupRow, PolicyRow])),
});

export const DeviceListResponse = Schema.Struct({ rows: Schema.Array(DeviceRow) });

export const DevicePreRegistrationRow = Schema.Struct({
  id: Schema.String,
  serial: Schema.String,
  name: Schema.optional(NullableString),
  assetTag: Schema.optional(NullableString),
  notes: Schema.optional(NullableString),
  groupId: Schema.optional(NullableString),
  groupName: Schema.optional(NullableString),
  consumedDeviceId: Schema.optional(NullableString),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type DevicePreRegistrationRow = typeof DevicePreRegistrationRow.Type;

export const DevicePreRegistrationListResponse = Schema.Struct({
  rows: Schema.Array(DevicePreRegistrationRow),
});
export type DevicePreRegistrationListResponse = typeof DevicePreRegistrationListResponse.Type;

export const DevicePreRegistrationImportRow = Schema.Struct({
  serial: Schema.String,
  name: Schema.optional(NullableString),
  assetTag: Schema.optional(NullableString),
  notes: Schema.optional(NullableString),
  /** Tenant-scoped group id. Mutually exclusive with `groupName` when both resolve. */
  groupId: Schema.optional(NullableString),
  /** Tenant-scoped group name; resolved case-insensitively. */
  groupName: Schema.optional(NullableString),
});
export type DevicePreRegistrationImportRow = typeof DevicePreRegistrationImportRow.Type;

export const DevicePreRegistrationImportRequest = Schema.Struct({
  rows: Schema.Array(DevicePreRegistrationImportRow),
});
export type DevicePreRegistrationImportRequest = typeof DevicePreRegistrationImportRequest.Type;

export const DevicePreRegistrationImportResult = Schema.Struct({
  serial: Schema.String,
  status: Schema.Literals(["created", "updated", "error"]),
  id: Schema.optional(NullableString),
  error: Schema.optional(NullableString),
});
export type DevicePreRegistrationImportResult = typeof DevicePreRegistrationImportResult.Type;

export const DevicePreRegistrationImportResponse = Schema.Struct({
  results: Schema.Array(DevicePreRegistrationImportResult),
  created: Schema.Number,
  updated: Schema.Number,
  failed: Schema.Number,
});
export type DevicePreRegistrationImportResponse = typeof DevicePreRegistrationImportResponse.Type;
export const GroupListResponse = Schema.Struct({ rows: Schema.Array(GroupRow) });
export const PolicyListResponse = Schema.Struct({ rows: Schema.Array(PolicyRow) });

export const DeviceSearchSort = Schema.Literals(["name", "lastSeenAt", "enrolledAt", "status"]);
export type DeviceSearchSort = typeof DeviceSearchSort.Type;
export const SortDirection = Schema.Literals(["asc", "desc"]);
export type SortDirection = typeof SortDirection.Type;

export const DeviceHealthFilter = Schema.Literals([
  "healthy",
  "attention",
  "critical",
  "unknown",
  "stale",
]);
export type DeviceHealthFilter = typeof DeviceHealthFilter.Type;

/**
 * Server-side device list filters. Every field is optional; the backend applies
 * a bounded default page size and treats an empty query as "all devices".
 */
export const DeviceSearchQuery = Schema.Struct({
  /** Matches name, serial, model, `dmIdentifier` and asset tag. */
  q: Schema.optional(Schema.String),
  status: Schema.optional(DeviceStatus),
  proto: Schema.optional(DeviceProtocol),
  /** Only devices that are members of this group. */
  groupId: Schema.optional(Schema.String),
  /** ISO timestamp; only devices last seen before it. */
  notSeenSince: Schema.optional(Schema.String),
  /** Shorthand for `notSeenSince = now - staleDays`; 0 or omitted disables it. */
  staleDays: Schema.optional(Schema.Number),
  /** Only devices whose derived health rollup matches this level. */
  health: Schema.optional(DeviceHealthFilter),
  /** Only Apple devices whose APNs delivery is failing or has an invalid token. */
  push: Schema.optional(Schema.Literals(["failing", "invalid"])),
  limit: Schema.optional(Schema.Number),
  offset: Schema.optional(Schema.Number),
  sort: Schema.optional(DeviceSearchSort),
  direction: Schema.optional(SortDirection),
});
export type DeviceSearchQuery = typeof DeviceSearchQuery.Type;

/** A device row plus its group memberships, populated by the search endpoint. */
export const DeviceSearchRow = Schema.Struct({
  ...DeviceRow.fields,
  groups: Schema.Array(DeviceRelation),
});
export type DeviceSearchRow = typeof DeviceSearchRow.Type;

export const DeviceSearchResponse = Schema.Struct({
  devices: Schema.Array(DeviceSearchRow),
  total: Schema.Number,
});
export type DeviceSearchResponse = typeof DeviceSearchResponse.Type;

export const NodeResponse = Schema.Union([DeviceRow, GroupNode, PolicyRow]);
export type NodeResponse = typeof NodeResponse.Type;

export const PlatformEnrollment = Schema.Union([
  Schema.Struct({ error: Schema.String }),
  Schema.Struct({ profile: Schema.String }),
  Schema.Literal("available"),
  /** The platform toggle is on, but delivery is not wired up in this build. */
  Schema.Literal("unavailable"),
]);
export type PlatformEnrollment = typeof PlatformEnrollment.Type;

/**
 * Windows enrollment is driven by a deployment-wide discovery URL
 * (`/mdm/windows/discovery`). Discovery requests carry no tenant identity, so a
 * deployment pins Windows devices to one tenant instead of routing per tenant.
 */
export const WindowsEnrollment = Schema.Union([
  Schema.Struct({ error: Schema.String }),
  Schema.Struct({
    discoveryUrl: Schema.String,
    /** False until Windows discovery can resolve a tenant from the request. */
    tenantScoped: Schema.Literal(false),
  }),
]);
export type WindowsEnrollment = typeof WindowsEnrollment.Type;

export const EnrollmentResponse = Schema.Union([
  Schema.Struct({ name: Schema.String, authenticated: Schema.Literal(false) }),
  Schema.Struct({
    name: Schema.String,
    authenticated: Schema.Literal(true),
    apple: PlatformEnrollment,
    windows: WindowsEnrollment,
    android: PlatformEnrollment,
    assetTag: Schema.Boolean,
  }),
]);
export type EnrollmentResponse = typeof EnrollmentResponse.Type;

export const EnrollmentQuery = {
  code: Schema.optional(Schema.String),
  /**
   * The platform the device is enrolling. Optional because the endpoint
   * returns every platform; when omitted the server infers it from the
   * User-Agent for diagnostics.
   */
  platform: Schema.optional(Schema.Literals(["apple", "win", "android"])),
};

/** Public mobileconfig download. The body is a signed Apple property list. */
export const AppleEnrollmentProfileResponse = Schema.String.pipe(
  HttpApiSchema.asText({ contentType: "application/x-apple-aspen-config" }),
);

export const EnrollmentAttemptPlatform = Schema.Literals(["apple", "win", "android", "unknown"]);
export type EnrollmentAttemptPlatform = typeof EnrollmentAttemptPlatform.Type;

export const EnrollmentAttemptOutcome = Schema.Literals([
  "ok",
  "bad_code",
  "disabled",
  "limit",
  "no_apns",
  "scep_error",
  "other",
]);
export type EnrollmentAttemptOutcome = typeof EnrollmentAttemptOutcome.Type;

export const EnrollmentAttempt = Schema.Struct({
  id: Schema.String,
  enrollmentId: Schema.String,
  platform: EnrollmentAttemptPlatform,
  outcome: EnrollmentAttemptOutcome,
  detail: Schema.optional(NullableString),
  createdAt: Schema.String,
});
export type EnrollmentAttempt = typeof EnrollmentAttempt.Type;

export const EnrollmentAttemptsResponse = Schema.Struct({
  attempts: Schema.Array(EnrollmentAttempt),
});
export type EnrollmentAttemptsResponse = typeof EnrollmentAttemptsResponse.Type;

export const TenantEnrollmentInfo = Schema.Struct({
  id: Schema.String,
  code: Schema.optional(NullableString),
  enabledApple: Schema.Boolean,
  enabledWindows: Schema.Boolean,
  enabledAndroid: Schema.Boolean,
  enabledAssetTag: Schema.Boolean,
  maxDevices: Schema.Number,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type TenantEnrollmentInfo = typeof TenantEnrollmentInfo.Type;

export const PatchTenantEnrollmentRequest = Schema.Struct({
  code: Schema.optional(NullableString),
  enabledApple: Schema.optional(Schema.Boolean),
  enabledWindows: Schema.optional(Schema.Boolean),
  enabledAndroid: Schema.optional(Schema.Boolean),
  enabledAssetTag: Schema.optional(Schema.Boolean),
  maxDevices: Schema.optional(Schema.Number),
});

export const ApnsInfo = Schema.Struct({
  configured: Schema.Boolean,
  email: Schema.optional(NullableString),
  topic: Schema.optional(NullableString),
  commonName: Schema.optional(NullableString),
  expiresAt: Schema.optional(NullableString),
});
export type ApnsInfo = typeof ApnsInfo.Type;

export const ApnsCsrResponse = Schema.Struct({ plist: Schema.String });
export type ApnsCsrResponse = typeof ApnsCsrResponse.Type;

export const UploadApnsRequest = Schema.Struct({ email: Schema.String, cert: Schema.String });
export const BillingPortalRequest = Schema.Struct({ returnUrl: Schema.String });
export const BillingPortalResponse = Schema.Struct({ url: Schema.String });

export const AuthUser = UserInfo;
export const ChangeEmailRequest = Schema.Struct({ newEmail: Schema.String });
export const VerifyEmailChangeRequest = Schema.Struct({ token: Schema.String });

export const ApiTokenInfo = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  tokenPrefix: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  lastUsedAt: Schema.optional(NullableString),
  expiresAt: Schema.optional(NullableString),
  revokedAt: Schema.optional(NullableString),
});
export const ApiTokensResponse = Schema.Struct({ tokens: Schema.Array(ApiTokenInfo) });
export const CreateApiTokenRequest = Schema.Struct({
  name: Schema.String,
  expiresAt: Schema.optional(NullableString),
});
export const CreateApiTokenResponse = Schema.Struct({ token: Schema.String, item: ApiTokenInfo });

export const AccountSessionInfo = Schema.Struct({
  id: Schema.String,
  current: Schema.Boolean,
  createdAt: Schema.String,
  expiresAt: Schema.String,
  method: Schema.optional(NullableString),
});
export const AccountSessionsResponse = Schema.Struct({
  sessions: Schema.Array(AccountSessionInfo),
});

export const enterpriseApi = HttpApiGroup.make("EnterpriseApi")
  .add(
    HttpApiEndpoint.post("requestEmailVerification", "/v1/account/email-verification", {
      error: EnterpriseAccountErrors,
      success: EmailVerificationResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("verifyEmail", "/v1/verify-email", {
      error: EnterprisePublicEmailErrors,
      payload: VerifyEmailRequest,
      success: EmailVerificationResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("requestEmailChange", "/v1/account/email-change", {
      error: EnterpriseAccountErrors,
      payload: ChangeEmailRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.post("verifyEmailChange", "/v1/account/email-change/verify", {
      error: EnterpriseAccountErrors,
      payload: VerifyEmailChangeRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.get("listApiTokens", "/v1/account/api-tokens", {
      error: EnterpriseAuthRequiredErrors,
      success: ApiTokensResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("createApiToken", "/v1/account/api-tokens", {
      error: EnterpriseAuthRequiredErrors,
      payload: CreateApiTokenRequest,
      success: CreateApiTokenResponse,
    }),
  )
  .add(
    HttpApiEndpoint.delete("revokeApiToken", "/v1/account/api-tokens/:tokenId", {
      error: EnterpriseAuthRequiredErrors,
      params: ApiTokenParam,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.get("listAccountSessions", "/v1/account/sessions", {
      error: EnterpriseAuthRequiredErrors,
      success: AccountSessionsResponse,
    }),
  )
  .add(
    HttpApiEndpoint.delete("revokeAccountSession", "/v1/account/sessions/:sessionId", {
      error: EnterpriseAccountErrors,
      params: { sessionId: Schema.String },
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.get("me", "/v1/me", {
      error: EnterpriseAuthRequiredErrors,
      success: MeResponse,
    }),
  )
  .add(
    HttpApiEndpoint.patch("updateMe", "/v1/me", {
      error: EnterpriseAccountErrors,
      payload: UpdateMeRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteMe", "/v1/me", {
      error: EnterpriseAccountErrors,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.get("listTenants", "/v1/tenants", {
      error: EnterpriseAuthRequiredErrors,
      success: TenantListResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("createTenant", "/v1/tenants", {
      error: [
        ...EnterpriseAuthRequiredErrors,
        EnterpriseBadRequest.pipe(HttpApiSchema.status(400)),
      ],
      payload: CreateTenantRequest,
      success: IdResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getTenant", "/v1/tenants/:tenantId", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: TenantDetail,
    }),
  )
  .add(
    HttpApiEndpoint.patch("patchTenant", "/v1/tenants/:tenantId", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: PatchTenantRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteTenant", "/v1/tenants/:tenantId", {
      error: EnterpriseTenantDeleteErrors,
      params: TenantParam,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.get("getSsoConfig", "/v1/tenants/:tenantId/sso", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      success: SsoConfigResponse,
    }),
  )
  .add(
    HttpApiEndpoint.patch("patchSsoConfig", "/v1/tenants/:tenantId/sso", {
      error: EnterpriseSsoErrors,
      params: TenantParam,
      payload: PatchSsoConfigRequest,
      success: SsoConfigResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getEntraDirectorySync", "/v1/tenants/:tenantId/identity/directory", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: EntraDirectorySyncStatus,
    }),
  )
  .add(
    HttpApiEndpoint.patch("patchEntraDirectorySync", "/v1/tenants/:tenantId/identity/directory", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: PatchEntraDirectorySyncRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.post("syncEntraDirectory", "/v1/tenants/:tenantId/identity/directory/sync", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      success: EntraDirectorySyncResult,
    }),
  )
  .add(
    HttpApiEndpoint.get("listEntraDomains", "/v1/tenants/:tenantId/identity/domains", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: EntraDomainsResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("refreshEntraDomains", "/v1/tenants/:tenantId/identity/domains/refresh", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      success: EntraDomainsResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("listScimTokens", "/v1/tenants/:tenantId/scim-tokens", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      success: ScimTokensResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("createScimToken", "/v1/tenants/:tenantId/scim-tokens", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: CreateScimTokenRequest,
      success: CreateScimTokenResponse,
    }),
  )
  .add(
    HttpApiEndpoint.delete("revokeScimToken", "/v1/tenants/:tenantId/scim-tokens/:tokenId", {
      error: EnterpriseTenantWriteErrors,
      params: { tenantId: Schema.String, tokenId: Schema.String },
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.get("listAuditLog", "/v1/tenants/:tenantId/audit-log", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: AuditLogResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("listTenantUsers", "/v1/tenants/:tenantId/users", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: TenantUsersResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("inviteTenantUser", "/v1/tenants/:tenantId/invitations", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: InviteTenantUserRequest,
      success: CreateInvitationResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("acceptInvitation", "/v1/invitations/accept", {
      error: [
        ...EnterpriseAuthRequiredErrors,
        ...EnterpriseDbErrors,
        EnterpriseNotFound.pipe(HttpApiSchema.status(404)),
        EnterpriseForbidden.pipe(HttpApiSchema.status(403)),
      ],
      payload: AcceptInvitationRequest,
      success: AcceptInvitationResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("listTenantInvitations", "/v1/tenants/:tenantId/invitations", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      success: TenantInvitationsResponse,
    }),
  )
  .add(
    HttpApiEndpoint.delete(
      "cancelTenantInvitation",
      "/v1/tenants/:tenantId/invitations/:invitationId",
      {
        error: EnterpriseTenantWriteErrors,
        params: TenantInvitationParam,
        success: Schema.Struct({ status: Schema.Literal("ok") }),
      },
    ),
  )
  .add(
    HttpApiEndpoint.patch("patchTenantUser", "/v1/tenants/:tenantId/users/:memberId", {
      error: EnterpriseTenantWriteErrors,
      params: TenantMemberParam,
      payload: PatchTenantUserRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.delete("removeTenantUser", "/v1/tenants/:tenantId/users/:memberId", {
      error: EnterpriseTenantUserRemoveErrors,
      params: TenantMemberParam,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.get("getEnrollment", "/v1/enrollment/:id", {
      error: EnterprisePublicNotFoundErrors,
      params: IdParam,
      query: EnrollmentQuery,
      success: EnrollmentResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getAppleEnrollmentProfile", "/v1/enrollment/:id/apple.mobileconfig", {
      error: EnterprisePublicEnrollmentProfileErrors,
      params: IdParam,
      query: EnrollmentQuery,
      success: AppleEnrollmentProfileResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getTenantEnrollment", "/v1/tenants/:tenantId/enrollment", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: TenantEnrollmentInfo,
    }),
  )
  .add(
    HttpApiEndpoint.get("listEnrollmentAttempts", "/v1/tenants/:tenantId/enrollment/attempts", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      query: Schema.Struct({ limit: Schema.optional(Schema.Number) }),
      success: EnrollmentAttemptsResponse,
    }),
  )
  .add(
    HttpApiEndpoint.patch("patchTenantEnrollment", "/v1/tenants/:tenantId/enrollment", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: PatchTenantEnrollmentRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.post("resetTenantEnrollment", "/v1/tenants/:tenantId/enrollment/reset", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      success: IdResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getApns", "/v1/tenants/:tenantId/apns", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: ApnsInfo,
    }),
  )
  .add(
    HttpApiEndpoint.get("getApnsCsr", "/v1/tenants/:tenantId/apns/csr", {
      error: EnterpriseApnsErrors,
      params: TenantParam,
      success: ApnsCsrResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("uploadApns", "/v1/tenants/:tenantId/apns", {
      error: EnterpriseApnsErrors,
      params: TenantParam,
      payload: UploadApnsRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.get("search", "/v1/tenants/:tenantId/search", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      query: Schema.Struct({
        q: Schema.optional(Schema.String),
        limit: Schema.optional(Schema.Number),
      }),
      success: SearchResult,
    }),
  )
  .add(
    HttpApiEndpoint.get("listDevices", "/v1/tenants/:tenantId/devices", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: DeviceListResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("searchDevices", "/v1/tenants/:tenantId/devices/search", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      query: DeviceSearchQuery,
      success: DeviceSearchResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("exportDevices", "/v1/tenants/:tenantId/devices/export", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      query: DeviceSearchQuery,
      success: Schema.String.pipe(HttpApiSchema.asText({ contentType: "text/csv; charset=utf-8" })),
    }),
  )
  .add(
    HttpApiEndpoint.get("getDevice", "/v1/tenants/:tenantId/devices/:id", {
      error: EnterpriseTenantReadErrors,
      params: TenantIdParam,
      success: DeviceRow,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteDevices", "/v1/tenants/:tenantId/devices", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: IdsRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.get(
      "listDevicePreRegistrations",
      "/v1/tenants/:tenantId/device-pre-registrations",
      {
        error: EnterpriseTenantReadErrors,
        params: TenantParam,
        success: DevicePreRegistrationListResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "importDevicePreRegistrations",
      "/v1/tenants/:tenantId/device-pre-registrations/import",
      {
        error: EnterpriseTenantWriteErrors,
        params: TenantParam,
        payload: DevicePreRegistrationImportRequest,
        success: DevicePreRegistrationImportResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.delete(
      "deleteDevicePreRegistration",
      "/v1/tenants/:tenantId/device-pre-registrations/:id",
      {
        error: EnterpriseTenantWriteErrors,
        params: TenantPreRegistrationParam,
        success: Schema.Struct({ status: Schema.Literal("ok") }),
      },
    ),
  )
  .add(
    HttpApiEndpoint.delete(
      "deleteDevicePreRegistrations",
      "/v1/tenants/:tenantId/device-pre-registrations",
      {
        error: EnterpriseTenantWriteErrors,
        params: TenantParam,
        payload: IdsRequest,
        success: Schema.Struct({ status: Schema.Literal("ok") }),
      },
    ),
  )
  .add(
    HttpApiEndpoint.patch("patchDevice", "/v1/tenants/:tenantId/devices/:id", {
      error: EnterpriseTenantWriteErrors,
      params: TenantIdParam,
      payload: PatchDeviceRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.post("deviceAction", "/v1/tenants/:tenantId/devices/:id/action", {
      error: EnterpriseTenantWriteErrors,
      params: TenantIdParam,
      payload: DeviceActionRequest,
      success: DeviceActionResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("listDeviceCommands", "/v1/tenants/:tenantId/devices/:id/commands", {
      error: EnterpriseTenantReadErrors,
      params: TenantIdParam,
      success: DeviceCommandsResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get(
      "listDeviceDeclarations",
      "/v1/tenants/:tenantId/devices/:id/declarations",
      {
        error: EnterpriseTenantReadErrors,
        params: TenantIdParam,
        success: DeviceDeclarationsResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post("deviceUnenroll", "/v1/tenants/:tenantId/devices/:id/unenroll", {
      error: EnterpriseTenantWriteErrors,
      params: TenantIdParam,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.get("getDeviceHealth", "/v1/tenants/:tenantId/devices/:id/health", {
      error: EnterpriseTenantReadErrors,
      params: TenantIdParam,
      success: DeviceHealthResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getDeviceActivity", "/v1/tenants/:tenantId/devices/:id/activity", {
      error: EnterpriseTenantReadErrors,
      params: TenantIdParam,
      query: Schema.Struct({ limit: Schema.optional(Schema.Number) }),
      success: DeviceActivityResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "revokeDeviceIdentity",
      "/v1/tenants/:tenantId/devices/:id/revoke-identity",
      {
        error: EnterpriseTenantWriteErrors,
        params: TenantIdParam,
        success: DeviceIdentityRevokeResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get("getDeviceHealthSummary", "/v1/tenants/:tenantId/device-health", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: DeviceHealthSummaryResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getDevicePushHealth", "/v1/tenants/:tenantId/push-health", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: DevicePushHealthResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getCredentialHealth", "/v1/tenants/:tenantId/credential-health", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: CredentialHealthResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("listGroups", "/v1/tenants/:tenantId/groups", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: GroupListResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getGroup", "/v1/tenants/:tenantId/groups/:id", {
      error: EnterpriseTenantReadErrors,
      params: TenantIdParam,
      success: GroupNode,
    }),
  )
  .add(
    HttpApiEndpoint.post("createGroup", "/v1/tenants/:tenantId/groups", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: CreateGroupRequest,
      success: IdResponse,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteGroups", "/v1/tenants/:tenantId/groups", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: IdsRequest,
      success: BulkOperationResult,
    }),
  )
  .add(
    HttpApiEndpoint.patch("patchGroup", "/v1/tenants/:tenantId/groups/:id", {
      error: EnterpriseTenantWriteErrors,
      params: TenantIdParam,
      payload: PatchGroupRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.patch("patchGroupMembers", "/v1/tenants/:tenantId/groups/:id/members", {
      error: EnterpriseTenantWriteErrors,
      params: TenantIdParam,
      payload: PatchGroupMembersRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.post("syncGroups", "/v1/tenants/:tenantId/groups/sync", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: IdsRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.post("duplicateGroup", "/v1/tenants/:tenantId/groups/:id/duplicate", {
      error: EnterpriseTenantWriteErrors,
      params: TenantIdParam,
      payload: DuplicateRequest,
      success: IdResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getPolicyAssignments", "/v1/tenants/:tenantId/policies/:id/assignments", {
      error: EnterpriseTenantReadErrors,
      params: TenantIdParam,
      success: PolicyAssignmentsResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("listPolicies", "/v1/tenants/:tenantId/policies", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: PolicyListResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getPolicy", "/v1/tenants/:tenantId/policies/:id", {
      error: EnterpriseTenantReadErrors,
      params: TenantIdParam,
      success: PolicyRow,
    }),
  )
  .add(
    HttpApiEndpoint.post("createPolicy", "/v1/tenants/:tenantId/policies", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: CreatePolicyRequest,
      success: IdResponse,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deletePolicies", "/v1/tenants/:tenantId/policies", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: IdsRequest,
      success: BulkOperationResult,
    }),
  )
  .add(
    HttpApiEndpoint.patch("patchPolicy", "/v1/tenants/:tenantId/policies/:id", {
      error: EnterpriseTenantWriteErrors,
      params: TenantIdParam,
      payload: PatchPolicyRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "uploadPolicyApplication",
      "/v1/tenants/:tenantId/policies/:id/applications",
      {
        error: EnterprisePolicyApplicationUploadErrors,
        params: TenantIdParam,
        payload: UploadPolicyApplicationRequest,
        success: PolicyApplicationObject,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get(
      "downloadPolicyApplication",
      "/v1/tenants/:tenantId/policies/:id/applications/:sha256",
      {
        error: EnterprisePolicyApplicationDownloadErrors,
        params: { tenantId: Schema.String, id: Schema.String, sha256: Schema.String },
        success: DownloadPolicyApplicationResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get("listApplications", "/v1/tenants/:tenantId/applications", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: ApplicationListResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getApplication", "/v1/tenants/:tenantId/applications/:id", {
      error: EnterpriseTenantReadErrors,
      params: TenantIdParam,
      success: ApplicationNode,
    }),
  )
  .add(
    HttpApiEndpoint.post("createApplication", "/v1/tenants/:tenantId/applications", {
      error: EnterpriseApplicationErrors,
      params: TenantParam,
      payload: CreateApplicationRequest,
      success: IdResponse,
    }),
  )
  .add(
    HttpApiEndpoint.patch("patchApplication", "/v1/tenants/:tenantId/applications/:id", {
      error: EnterpriseApplicationErrors,
      params: TenantIdParam,
      payload: PatchApplicationRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteApplications", "/v1/tenants/:tenantId/applications", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: IdsRequest,
      success: BulkOperationResult,
    }),
  )
  .add(
    HttpApiEndpoint.patch(
      "patchApplicationAssignments",
      "/v1/tenants/:tenantId/applications/:id/assignments",
      {
        error: EnterpriseTenantWriteErrors,
        params: TenantIdParam,
        payload: PatchApplicationAssignmentsRequest,
        success: Schema.Struct({ status: Schema.Literal("ok") }),
      },
    ),
  )
  .add(
    HttpApiEndpoint.post("installApplication", "/v1/tenants/:tenantId/applications/:id/install", {
      error: EnterpriseTenantWriteErrors,
      params: TenantIdParam,
      success: ApplicationInstallResult,
    }),
  )
  .add(
    HttpApiEndpoint.post("uploadApplication", "/v1/tenants/:tenantId/applications/:id/upload", {
      error: EnterpriseApplicationUploadErrors,
      params: TenantIdParam,
      payload: UploadPolicyApplicationRequest,
      success: PolicyApplicationObject,
    }),
  )
  .add(
    HttpApiEndpoint.get(
      "downloadApplication",
      "/v1/tenants/:tenantId/applications/:id/download/:sha256",
      {
        error: EnterpriseApplicationDownloadErrors,
        params: Schema.Struct({
          tenantId: Schema.String,
          id: Schema.String,
          sha256: Schema.String,
        }),
        success: DownloadPolicyApplicationResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.patch(
      "patchPolicyAssignments",
      "/v1/tenants/:tenantId/policies/:id/assignments",
      {
        error: EnterpriseTenantWriteErrors,
        params: TenantIdParam,
        payload: PatchPolicyAssignmentsRequest,
        success: Schema.Struct({ status: Schema.Literal("ok") }),
      },
    ),
  )
  .add(
    HttpApiEndpoint.get("listPolicyDeployments", "/v1/tenants/:tenantId/policies/:id/deployments", {
      error: EnterpriseTenantReadErrors,
      params: TenantIdParam,
      success: PolicyDeploymentsResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "rollbackPolicy",
      "/v1/tenants/:tenantId/policies/:id/deployments/:deploymentId/rollback",
      {
        error: EnterpriseTenantWriteErrors,
        params: {
          tenantId: Schema.String,
          id: Schema.String,
          deploymentId: Schema.String,
        },
        success: Schema.Struct({ status: Schema.Literal("ok") }),
      },
    ),
  )
  .add(
    HttpApiEndpoint.post("syncPolicies", "/v1/tenants/:tenantId/policies/sync", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: IdsRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.post("duplicatePolicy", "/v1/tenants/:tenantId/policies/:id/duplicate", {
      error: EnterpriseTenantWriteErrors,
      params: TenantIdParam,
      payload: DuplicateRequest,
      success: IdResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("previewMobileconfig", "/v1/policy/preview-mobileconfig", {
      error: [...EnterpriseNoDomainErrors, EnterpriseBadRequest.pipe(HttpApiSchema.status(400))],
      payload: Schema.Struct({ mobileconfig: Schema.String }),
      success: MobileconfigPreview,
    }),
  )
  .add(
    HttpApiEndpoint.get("billing", "/v1/tenants/:tenantId/billing", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: BillingSummary,
    }),
  )
  .add(
    HttpApiEndpoint.post("billingPortal", "/v1/tenants/:tenantId/billing/portal", {
      error: EnterpriseBillingPortalErrors,
      params: TenantParam,
      payload: BillingPortalRequest,
      success: BillingPortalResponse,
    }),
  )
  .prefix("/api")
  .annotateMerge(
    OpenApi.annotations({
      title: "Mattrax Enterprise API",
      description: "Organization-scoped Mattrax management API.",
    }),
  );

export const enterpriseHttpApi = HttpApi.make("MattraxEnterprise").add(enterpriseApi);
