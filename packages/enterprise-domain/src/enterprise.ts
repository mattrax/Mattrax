import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";
import { DynamicGroupKind, DynamicGroupRules } from "./dynamicGroups.ts";
import {
  STEP_UP_ACTIONS,
  StepUpGrantResponse,
  StepUpMethods,
  StepUpPasskeyStarted,
  StepUpRequired,
  StepUpUnavailable,
} from "./stepUp.ts";
import {
  CreateWebhookEndpointRequest,
  CreateWebhookEndpointResponse,
  PatchWebhookEndpointRequest,
  RotateWebhookSecretResponse,
  WebhookEndpointInfo,
  WebhookEndpointsResponse,
  WebhookTestResponse,
} from "./webhooks.ts";

const IdParam = { id: Schema.String };
const TenantParam = { tenantId: Schema.String };
const TenantIdParam = { tenantId: Schema.String, id: Schema.String };
const TenantInvitationParam = { tenantId: Schema.String, invitationId: Schema.String };
const TenantMemberParam = { tenantId: Schema.String, memberId: Schema.String };
const TenantPreRegistrationParam = { tenantId: Schema.String, id: Schema.String };
const TenantWebhookParam = { tenantId: Schema.String, webhookId: Schema.String };
const TenantAutopilotDeviceParam = { tenantId: Schema.String, serial: Schema.String };
const TenantAutopilotProfileParam = { tenantId: Schema.String, profileId: Schema.String };
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
/** The deployment has no Google Android Management credentials. */
export class EnterpriseNotConfigured extends Schema.TaggedError<EnterpriseNotConfigured>()(
  "EnterpriseNotConfigured",
  {
    message: Schema.String,
  },
) {}
/** Google rejected an Android Management request. */
export class EnterpriseUpstreamError extends Schema.TaggedError<EnterpriseUpstreamError>()(
  "EnterpriseUpstreamError",
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
  // Tenant policy can deny reads, for example when MFA enrollment is required.
  EnterpriseForbidden.pipe(HttpApiSchema.status(403)),
] as const;
/** Read endpoints that validate user input (filters, cursors) can return 400. */
const EnterpriseTenantValidatedReadErrors = [
  ...EnterpriseTenantReadErrors,
  EnterpriseBadRequest.pipe(HttpApiSchema.status(400)),
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
const EnterpriseTenantExportErrors = [
  ...EnterpriseTenantReadErrors,
  EnterpriseForbidden.pipe(HttpApiSchema.status(403)),
] as const;
const EnterpriseTenantBackupDownloadErrors = [
  ...EnterpriseTenantReadErrors,
  EnterpriseR2FileNotFound.pipe(HttpApiSchema.status(404)),
  EnterpriseR2InternalError.pipe(HttpApiSchema.status(500)),
] as const;
const EnterpriseTenantImportErrors = [
  ...EnterpriseAuthRequiredErrors,
  ...EnterpriseDbErrors,
  EnterpriseBadRequest.pipe(HttpApiSchema.status(400)),
  EnterpriseForbidden.pipe(HttpApiSchema.status(403)),
  EnterpriseConflict.pipe(HttpApiSchema.status(409)),
] as const;
const EnterpriseApnsErrors = [...EnterpriseTenantWriteErrors] as const;
const EnterpriseApplicationErrors = [...EnterpriseTenantWriteErrors] as const;
const EnterpriseSsoErrors = [...EnterpriseTenantWriteErrors] as const;
const EnterpriseAndroidReadErrors = [
  ...EnterpriseTenantReadErrors,
  EnterpriseNotConfigured.pipe(HttpApiSchema.status(503)),
  EnterpriseUpstreamError.pipe(HttpApiSchema.status(502)),
] as const;
const EnterpriseAndroidErrors = [
  ...EnterpriseTenantWriteErrors,
  EnterpriseNotConfigured.pipe(HttpApiSchema.status(503)),
  EnterpriseUpstreamError.pipe(HttpApiSchema.status(502)),
] as const;
const EnterpriseAppleReadErrors = [
  ...EnterpriseTenantReadErrors,
  EnterpriseNotConfigured.pipe(HttpApiSchema.status(503)),
  EnterpriseUpstreamError.pipe(HttpApiSchema.status(502)),
] as const;
const EnterpriseAppleWriteErrors = [
  ...EnterpriseTenantWriteErrors,
  EnterpriseNotConfigured.pipe(HttpApiSchema.status(503)),
  EnterpriseUpstreamError.pipe(HttpApiSchema.status(502)),
] as const;
const EnterpriseNoDomainErrors = [...EnterpriseDbErrors] as const;
const EnterpriseAccountErrors = [
  ...EnterpriseAuthRequiredErrors,
  ...EnterpriseDbErrors,
  EnterpriseBadRequest.pipe(HttpApiSchema.status(400)),
  EnterpriseNotFound.pipe(HttpApiSchema.status(404)),
] as const;
/** Sensitive account/tenant actions also require a recent step-up. */
const EnterpriseStepUpRequired = [StepUpRequired.pipe(HttpApiSchema.status(403))] as const;
const EnterpriseAutopilotReadErrors = [
  ...EnterpriseTenantReadErrors,
  EnterpriseNotConfigured.pipe(HttpApiSchema.status(503)),
  EnterpriseUpstreamError.pipe(HttpApiSchema.status(502)),
] as const;
const EnterpriseAutopilotWriteErrors = [
  ...EnterpriseTenantWriteErrors,
  EnterpriseNotConfigured.pipe(HttpApiSchema.status(503)),
  EnterpriseUpstreamError.pipe(HttpApiSchema.status(502)),
] as const;
const EnterpriseStepUpErrors = [...EnterpriseAccountErrors, ...EnterpriseStepUpRequired] as const;
const EnterpriseStepUpFactorErrors = [
  ...EnterpriseStepUpErrors,
  StepUpUnavailable.pipe(HttpApiSchema.status(400)),
] as const;
const StepUpActionSchema = Schema.Literals(STEP_UP_ACTIONS);
const EnterprisePublicEmailErrors = [
  ...EnterpriseAuthRequiredErrors,
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
const EnterprisePublicAdeProfileErrors = [
  ...EnterprisePublicEnrollmentProfileErrors,
  EnterpriseNotConfigured.pipe(HttpApiSchema.status(503)),
  EnterpriseUpstreamError.pipe(HttpApiSchema.status(502)),
] as const;

export const UserInfo = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  emailVerified: Schema.Boolean,
  image: Schema.optional(NullableString),
  /** Whether an authenticator app or a passkey is enrolled for this account. */
  mfaEnabled: Schema.Boolean,
  /** Whether an authenticator app is enrolled for this account. */
  totpEnabled: Schema.Boolean,
  /** Whether at least one active passkey is enrolled for this account. */
  passkeyEnabled: Schema.Boolean,
  /** Whether one of the user's owner/admin tenants requires MFA. */
  mfaRequired: Schema.Boolean,
  /**
   * Whether the account has a password credential. Passwordless/SSO-only
   * accounts cannot satisfy the knowledge factor MFA requires, so enrollment
   * must be blocked until they set a password.
   */
  hasPassword: Schema.Boolean,
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
  displayName: Schema.optional(NullableString),
  supportEmail: Schema.optional(NullableString),
  brandColor: Schema.optional(NullableString),
});
export type TenantInfo = typeof TenantInfo.Type;

export const TenantDetail = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  role: Schema.String,
  logo: Schema.optional(NullableString),
  displayName: Schema.optional(NullableString),
  supportEmail: Schema.optional(NullableString),
  brandColor: Schema.optional(NullableString),
  metadata: Schema.optional(NullableString),
  createdAt: Schema.String,
});
export type TenantDetail = typeof TenantDetail.Type;

/**
 * Public-facing branding resolved server-side. Unset fields fall back to the
 * hosted defaults, so clients never need to know Mattrax's defaults themselves.
 */
export const TenantBranding = Schema.Struct({
  displayName: Schema.String,
  logo: Schema.optional(NullableString),
  supportEmail: Schema.String,
  brandColor: Schema.String,
});
export type TenantBranding = typeof TenantBranding.Type;

export const BillingSummary = Schema.Struct({
  /** Effective plan name, including the configured default when unsubscribed. */
  plan: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  billableDevices: Schema.Number,
  /** Device allowance for this plan; `null` means unlimited. */
  deviceLimit: Schema.NullOr(Schema.Number),
  /** Tenant allowance for the account; `null` means unlimited. */
  tenantLimit: Schema.NullOr(Schema.Number),
  /** Every device row for this tenant, regardless of status. */
  devicesUsed: Schema.Number,
  /** Tenants owned by the current account. */
  tenantsUsed: Schema.Number,
  overDeviceLimit: Schema.Boolean,
  overTenantLimit: Schema.Boolean,
  /** False when the deployment has no `MATTRAX_PLAN_LIMITS` catalogue. */
  limitsConfigured: Schema.Boolean,
  subscriptionId: Schema.optional(NullableString),
  periodEnd: Schema.optional(NullableString),
  cancelAtPeriodEnd: Schema.Boolean,
  configured: Schema.Boolean,
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
  displayName: Schema.optional(NullableString),
  supportEmail: Schema.optional(NullableString),
  brandColor: Schema.optional(NullableString),
  metadata: Schema.optional(JsonRecord),
});

export const PatchTenantRequest = Schema.Struct({
  name: Schema.optional(Schema.String),
  slug: Schema.optional(Schema.String),
  logo: Schema.optional(NullableString),
  displayName: Schema.optional(NullableString),
  supportEmail: Schema.optional(NullableString),
  brandColor: Schema.optional(NullableString),
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
  /** Require owners and admins to enroll an authenticator before tenant access. */
  requireMfa: Schema.Boolean,
});
export const PatchSsoConfigRequest = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  azureTenantId: Schema.optional(NullableString),
  autoProvision: Schema.optional(Schema.Boolean),
  requireMfa: Schema.optional(Schema.Boolean),
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
  lastAttemptedAt: Schema.optional(NullableString),
  lastRunTrigger: Schema.optional(NullableString),
  lastError: Schema.optional(NullableString),
  lastCounts: Schema.optional(Schema.NullOr(Schema.Unknown)),
  syncIntervalMinutes: Schema.Number,
  nextSyncAt: Schema.optional(NullableString),
  consentUrl: Schema.optional(NullableString),
});
export type EntraDirectorySyncStatus = typeof EntraDirectorySyncStatus.Type;
export const PatchEntraDirectorySyncRequest = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  syncIntervalMinutes: Schema.optional(Schema.Number),
});
export const EntraDirectorySyncResult = Schema.Struct({
  status: Schema.Literal("ok"),
  users: Schema.Number,
  groups: Schema.Number,
  domains: Schema.Number,
});

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

const AutopilotProfileFields = {
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
  actorUserId: Schema.optional(NullableString),
  actorEmail: Schema.optional(NullableString),
  metadata: Schema.optional(Schema.NullOr(Schema.Unknown)),
  createdAt: Schema.String,
});
export type AuditLogEntry = typeof AuditLogEntry.Type;

export const AuditLogResponse = Schema.Struct({ entries: Schema.Array(AuditLogEntry) });

/**
 * Audit search filters. `cursor` is opaque and may encode a keyset position
 * (`createdAt` + `id`) or a legacy offset; `offset` is accepted for callers
 * that page numerically. Dates are ISO timestamps, inclusive on both ends.
 */
export const AuditSearchQuery = Schema.Struct({
  action: Schema.optional(Schema.String),
  /** Matches actor email or user id (case-insensitive substring). */
  actor: Schema.optional(Schema.String),
  targetType: Schema.optional(Schema.String),
  targetId: Schema.optional(Schema.String),
  from: Schema.optional(Schema.String),
  to: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
  cursor: Schema.optional(Schema.String),
  offset: Schema.optional(Schema.Number),
});
export type AuditSearchQuery = typeof AuditSearchQuery.Type;

export const AuditSearchResponse = Schema.Struct({
  entries: Schema.Array(AuditLogEntry),
  nextCursor: Schema.NullOr(Schema.String),
});
export type AuditSearchResponse = typeof AuditSearchResponse.Type;

export const AuditExportQuery = Schema.Struct({
  ...AuditSearchQuery.fields,
  format: Schema.optional(Schema.Literals(["csv", "json"])),
});
export type AuditExportQuery = typeof AuditExportQuery.Type;

export const CreateInvitationResponse = Schema.Struct({
  id: Schema.String,
  /** Present when the server can build an invite link (always in this build). */
  inviteUrl: Schema.optional(NullableString),
});
export const AcceptInvitationRequest = Schema.Struct({ token: Schema.String });
export const AcceptInvitationResponse = Schema.Struct({ tenantId: Schema.String });

export const VerifyEmailRequest = Schema.Struct({
  /** Link-based verification from an email. */
  token: Schema.optional(Schema.String),
  /** Six-digit code entered while signed in. */
  code: Schema.optional(Schema.String),
  /** Signed challenge returned by `requestEmailVerification`. */
  challenge: Schema.optional(Schema.String),
});
export const EmailVerificationResponse = Schema.Struct({
  status: Schema.Literal("ok"),
  /** Present when a verification code was issued. */
  challenge: Schema.optional(Schema.String),
});

export const UpdateMeRequest = Schema.Struct({
  name: Schema.optional(Schema.String),
  image: Schema.optional(NullableString),
});

export const DeviceProtocol = Schema.Literals(["apple", "win", "android"]);
export const DeviceStatus = Schema.Literals(["enrolling", "enrolled", "unenrolling", "unenrolled"]);
export const DeviceFileVaultStatus = Schema.Literals(["enabled", "disabled", "unknown"]);
export type DeviceFileVaultStatus = typeof DeviceFileVaultStatus.Type;

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
  /** Normalised FileVault state shared by DDM inventory and SecurityInfo. */
  fileVaultStatus: Schema.optional(Schema.NullOr(DeviceFileVaultStatus)),
  /**
   * Device detail escrow metadata. The recovery key and bootstrap token are
   * never included in device payloads; use the recovery-key endpoint to read
   * the decrypted FileVault key.
   */
  recoveryKeyEscrowed: Schema.optional(Schema.Boolean),
  bootstrapTokenEscrowed: Schema.optional(Schema.Boolean),
  recoveryKeyUpdatedAt: Schema.optional(NullableString),
  recoveryKeyRotatedAt: Schema.optional(NullableString),
  bootstrapTokenUpdatedAt: Schema.optional(NullableString),
  applicationsUpdatedAt: Schema.optional(NullableString),
  /** Windows Autopilot state when the device is also known to Autopilot. */
  autopilot: Schema.optional(Schema.NullOr(AutopilotDeviceInfo)),
});
export type DeviceRow = typeof DeviceRow.Type;

/** One installed application reported by a managed device. */
export const DeviceApplication = Schema.Struct({
  bundleId: Schema.String,
  name: Schema.optional(NullableString),
  version: Schema.optional(NullableString),
  shortVersion: Schema.optional(NullableString),
  bundleSize: Schema.optional(Schema.NullOr(Schema.Number)),
  dynamicSize: Schema.optional(Schema.NullOr(Schema.Number)),
  hasUpdateAvailable: Schema.Boolean,
  isManaged: Schema.Boolean,
  lastReportedAt: Schema.String,
});
export type DeviceApplication = typeof DeviceApplication.Type;

export const DeviceApplicationsResponse = Schema.Struct({
  applications: Schema.Array(DeviceApplication),
});
export type DeviceApplicationsResponse = typeof DeviceApplicationsResponse.Type;

/** A tenant-wide software inventory row with its installed-device count. */
export const ApplicationInventoryRow = Schema.Struct({
  ...DeviceApplication.fields,
  /** Stable row key for tables: the bundle identifier. */
  id: Schema.String,
  deviceCount: Schema.Number,
});
export type ApplicationInventoryRow = typeof ApplicationInventoryRow.Type;

export const ApplicationInventoryQuery = Schema.Struct({
  /** Matches bundle identifier and display name. */
  q: Schema.optional(Schema.String),
  managed: Schema.optional(Schema.Literals(["managed", "unmanaged"])),
  updates: Schema.optional(Schema.Literals(["available"])),
  limit: Schema.optional(Schema.Number),
  offset: Schema.optional(Schema.Number),
});
export type ApplicationInventoryQuery = typeof ApplicationInventoryQuery.Type;

export const ApplicationInventoryResponse = Schema.Struct({
  applications: Schema.Array(ApplicationInventoryRow),
  /** Total matching bundle identifiers before pagination. */
  total: Schema.Number,
});
export type ApplicationInventoryResponse = typeof ApplicationInventoryResponse.Type;

/** Decrypted FileVault recovery key. Never returned by list/detail endpoints. */
export const DeviceRecoveryKeyResponse = Schema.Struct({
  recoveryKey: Schema.String,
  /** When the escrowed value was last received from the device. */
  updatedAt: Schema.String,
  /** When the value last changed. */
  rotatedAt: Schema.optional(NullableString),
});
export type DeviceRecoveryKeyResponse = typeof DeviceRecoveryKeyResponse.Type;

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
export const DeviceHealthReasonGroup = Schema.Struct({
  /** Stable rule code, for grouping across devices. */
  code: Schema.String,
  /** High-level wording suitable for an overview. */
  label: Schema.String,
  severity: DeviceHealthReasonSeverity,
  /** Devices carrying this reason. */
  count: Schema.Number,
});
export type DeviceHealthReasonGroup = typeof DeviceHealthReasonGroup.Type;

/** A non-healthy device resolved to the fields the overview renders. */
export const DeviceHealthAttentionDevice = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  level: DeviceHealthLevel,
  reasons: Schema.Array(DeviceHealthReason),
  lastSeenAt: NullableString,
});
export type DeviceHealthAttentionDevice = typeof DeviceHealthAttentionDevice.Type;

export const DeviceHealthSummaryResponse = Schema.Struct({
  counts: DeviceHealthCounts,
  /** Fleet-level signals, critical first. Empty when every device is healthy. */
  reasons: Schema.Array(DeviceHealthReasonGroup),
  /** Worst devices to surface; the full list lives on the devices page. */
  devices: Schema.Array(DeviceHealthAttentionDevice),
});
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
      "collect-security-info",
      "refresh-applications",
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
  /** `manual` groups use explicit membership; `dynamic` groups use rules. */
  kind: DynamicGroupKind,
  rules: Schema.optional(Schema.NullOr(DynamicGroupRules)),
  lastEvaluatedAt: Schema.optional(NullableString),
  devicesCount: Schema.optional(Schema.Number),
  policiesCount: Schema.optional(Schema.Number),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type GroupRow = typeof GroupRow.Type;

export const GroupRelation = Schema.Struct({ id: Schema.String, name: Schema.String });
export const DeviceRelation = Schema.Struct({ id: Schema.String, name: Schema.String });

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
  lastEvaluatedAt: Schema.optional(NullableString),
  devicesCount: Schema.optional(Schema.Number),
  policiesCount: Schema.optional(Schema.Number),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  devices: Schema.optional(Schema.Array(GroupRelation)),
  policies: Schema.optional(Schema.Array(GroupPolicyRelation)),
});
export type GroupNode = typeof GroupNode.Type;

export const CreateGroupRequest = Schema.Struct({
  name: Schema.String,
  notes: Schema.optional(NullableString),
  /** Defaults to `manual` so existing clients are unchanged. */
  kind: Schema.optional(DynamicGroupKind),
  rules: Schema.optional(Schema.NullOr(DynamicGroupRules)),
  devices: Schema.optional(Schema.Array(Schema.String)),
  policies: Schema.optional(Schema.Array(Schema.String)),
});

export const PatchGroupRequest = Schema.Struct({
  name: Schema.optional(Schema.String),
  notes: Schema.optional(NullableString),
  kind: Schema.optional(DynamicGroupKind),
  rules: Schema.optional(Schema.NullOr(DynamicGroupRules)),
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

/**
 * Tenant backup bundle format.
 *
 * A bundle is intentionally self-contained: internal ids are exported as
 * opaque `key` values and relationships reference those keys, so an import can
 * allocate fresh ids without trusting (or colliding with) another deployment.
 * Secrets never belong in a bundle: APNs/SCEP private keys, token hashes,
 * passwords, sessions and auth proofs are excluded by construction.
 */
export const TENANT_EXPORT_VERSION = 1;
/** Reject bundles larger than this before doing any database work. */
export const TENANT_IMPORT_MAX_BYTES = 8 * 1024 * 1024;
/** Per-collection cap for an export, so a huge tenant cannot exhaust memory. */
export const TENANT_EXPORT_MAX_ROWS = 10_000;

export const TenantExportProfile = Schema.Struct({
  name: Schema.String,
  /** Optional on import so a bundle can be renamed while restoring. */
  slug: Schema.optional(NullableString),
  logo: Schema.optional(NullableString),
  displayName: Schema.optional(NullableString),
  supportEmail: Schema.optional(NullableString),
  brandColor: Schema.optional(NullableString),
  metadata: Schema.optional(Schema.NullOr(JsonRecord)),
});
export type TenantExportProfile = typeof TenantExportProfile.Type;

export const TenantExportMember = Schema.Struct({
  email: Schema.String,
  name: Schema.optional(NullableString),
  role: Schema.String,
  createdAt: Schema.optional(NullableString),
});
export type TenantExportMember = typeof TenantExportMember.Type;

export const TenantExportDeviceRef = Schema.Struct({
  key: Schema.String,
  name: Schema.optional(NullableString),
  serial: Schema.optional(NullableString),
});
export type TenantExportDeviceRef = typeof TenantExportDeviceRef.Type;

export const TenantExportGroup = Schema.Struct({
  key: Schema.String,
  name: Schema.String,
  notes: Schema.optional(NullableString),
  /** Device members are metadata only; devices themselves are never imported. */
  devices: Schema.optional(Schema.Array(TenantExportDeviceRef)),
  policyKeys: Schema.Array(Schema.String),
});
export type TenantExportGroup = typeof TenantExportGroup.Type;

export const TenantExportPolicy = Schema.Struct({
  key: Schema.String,
  name: Schema.String,
  notes: Schema.optional(NullableString),
  /** Configuration kind mapped to its stored JSON payload. */
  configurations: Schema.optional(JsonRecord),
});
export type TenantExportPolicy = typeof TenantExportPolicy.Type;

export const TenantExportApplication = Schema.Struct({
  key: Schema.String,
  name: Schema.String,
  platform: ApplicationPlatform,
  bundleId: Schema.optional(NullableString),
  version: Schema.optional(NullableString),
  source: ApplicationSource,
  manifestUrl: Schema.optional(NullableString),
  storeId: Schema.optional(NullableString),
  fileName: Schema.optional(NullableString),
  contentType: Schema.optional(NullableString),
  size: Schema.optional(Schema.NullOr(Schema.Number)),
  sha256: Schema.optional(NullableString),
  /** Hint only. Object bytes are never part of a bundle. */
  r2Key: Schema.optional(NullableString),
  notes: Schema.optional(NullableString),
  groupKeys: Schema.Array(Schema.String),
});
export type TenantExportApplication = typeof TenantExportApplication.Type;

export const TenantExportEnrollment = Schema.Struct({
  code: Schema.optional(NullableString),
  enabledApple: Schema.Boolean,
  enabledWindows: Schema.Boolean,
  enabledAndroid: Schema.Boolean,
  enabledAssetTag: Schema.Boolean,
  maxDevices: Schema.Number,
});
export type TenantExportEnrollment = typeof TenantExportEnrollment.Type;

export const TenantExportPreRegistration = Schema.Struct({
  serial: Schema.String,
  name: Schema.optional(NullableString),
  assetTag: Schema.optional(NullableString),
  notes: Schema.optional(NullableString),
  groupKey: Schema.optional(NullableString),
});
export type TenantExportPreRegistration = typeof TenantExportPreRegistration.Type;

/** SCEP-issued identity metadata. Private keys are never exported. */
export const TenantExportCertificate = Schema.Struct({
  serial: Schema.String,
  enrollmentId: Schema.optional(NullableString),
  deviceKey: Schema.optional(NullableString),
  notAfter: Schema.String,
  revokedAt: Schema.optional(NullableString),
  createdAt: Schema.String,
});
export type TenantExportCertificate = typeof TenantExportCertificate.Type;

export const TenantExportAuditEntry = Schema.Struct({
  action: Schema.String,
  targetType: Schema.String,
  targetId: Schema.optional(NullableString),
  actorEmail: Schema.optional(NullableString),
  metadata: Schema.optional(Schema.NullOr(Schema.Unknown)),
  createdAt: Schema.String,
});
export type TenantExportAuditEntry = typeof TenantExportAuditEntry.Type;

export const TenantExportEnvelope = Schema.Struct({
  version: Schema.Literal(TENANT_EXPORT_VERSION),
  exportedAt: Schema.String,
  tenant: TenantExportProfile,
  members: Schema.Array(TenantExportMember),
  groups: Schema.Array(TenantExportGroup),
  policies: Schema.Array(TenantExportPolicy),
  applications: Schema.Array(TenantExportApplication),
  enrollment: Schema.optional(TenantExportEnrollment),
  preRegistrations: Schema.Array(TenantExportPreRegistration),
  scepCertificates: Schema.Array(TenantExportCertificate),
  auditLog: Schema.optional(Schema.Array(TenantExportAuditEntry)),
  auditTruncated: Schema.optional(Schema.Boolean),
});
export type TenantExportEnvelope = typeof TenantExportEnvelope.Type;

export const TenantExportQuery = Schema.Struct({
  /** `true`/`1` includes recent audit entries in the bundle (export-only). */
  includeAudit: Schema.optional(Schema.String),
});
export type TenantExportQuery = typeof TenantExportQuery.Type;

/** One scheduled or manual tenant backup attempt. */
export const BackupRunInfo = Schema.Struct({
  id: Schema.String,
  status: Schema.Literals(["running", "succeeded", "failed"]),
  trigger: Schema.Literals(["scheduled", "manual"]),
  retention: Schema.Literals(["default", "pinned"]),
  /** R2 object key. It is never a public URL; downloads go through the API. */
  r2Key: Schema.optional(NullableString),
  sizeBytes: Schema.optional(Schema.NullOr(Schema.Number)),
  startedAt: Schema.String,
  completedAt: Schema.optional(NullableString),
  /** Truncated, secret-free failure description. */
  error: Schema.optional(NullableString),
});
export type BackupRunInfo = typeof BackupRunInfo.Type;

export const TenantBackupsResponse = Schema.Struct({
  backups: Schema.Array(BackupRunInfo),
});
export type TenantBackupsResponse = typeof TenantBackupsResponse.Type;

/**
 * An imported bundle. Arrays are optional so a trimmed or hand-edited bundle
 * still validates; unsupported versions are rejected by the handler.
 */
export const TenantImportRequest = Schema.Struct({
  version: Schema.Number,
  exportedAt: Schema.optional(Schema.String),
  tenant: TenantExportProfile,
  members: Schema.optional(Schema.Array(TenantExportMember)),
  groups: Schema.optional(Schema.Array(TenantExportGroup)),
  policies: Schema.optional(Schema.Array(TenantExportPolicy)),
  applications: Schema.optional(Schema.Array(TenantExportApplication)),
  enrollment: Schema.optional(TenantExportEnrollment),
  preRegistrations: Schema.optional(Schema.Array(TenantExportPreRegistration)),
  scepCertificates: Schema.optional(Schema.Array(TenantExportCertificate)),
  auditLog: Schema.optional(Schema.Array(TenantExportAuditEntry)),
  auditTruncated: Schema.optional(Schema.Boolean),
});
export type TenantImportRequest = typeof TenantImportRequest.Type;

export const TenantImportCounts = Schema.Struct({
  groups: Schema.Number,
  policies: Schema.Number,
  applications: Schema.Number,
  preRegistrations: Schema.Number,
});
export type TenantImportCounts = typeof TenantImportCounts.Type;

export const TenantImportSkipped = Schema.Struct({
  members: Schema.Number,
  devices: Schema.Number,
  certificates: Schema.Number,
  auditLog: Schema.Number,
});
export type TenantImportSkipped = typeof TenantImportSkipped.Type;

export const TenantImportResponse = Schema.Struct({
  tenantId: Schema.String,
  slug: Schema.String,
  counts: TenantImportCounts,
  skipped: TenantImportSkipped,
  /** Uploaded applications whose object bytes are not part of a bundle. */
  applicationsWithoutFiles: Schema.Number,
});
export type TenantImportResponse = typeof TenantImportResponse.Type;

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
  groups: Schema.Array(GroupPolicyRelation),
  devices: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      mode: PolicyAssignmentMode,
      priority: Schema.Number,
    }),
  ),
});
export type PolicyAssignmentsResponse = typeof PolicyAssignmentsResponse.Type;

export const PatchPolicyAssignmentsRequest = Schema.Struct({
  assign: Schema.optional(Schema.Array(PolicyAssignmentRef)),
  unassign: Schema.optional(Schema.Array(PolicyAssignmentRef)),
});

/** Scope of an assignment that contributed to the effective policy. */
export const EffectivePolicyScope = Schema.Literals(["direct", "group"]);
export type EffectivePolicyScope = typeof EffectivePolicyScope.Type;

export const EffectivePolicyConfiguration = Schema.Struct({
  kind: Schema.String,
  policyId: Schema.String,
  policyName: Schema.String,
  priority: Schema.Number,
  scope: EffectivePolicyScope,
  groupIds: Schema.Array(Schema.String),
  groupNames: Schema.Array(Schema.String),
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
  kinds: Schema.Array(Schema.String),
});
export type EffectivePolicyContributor = typeof EffectivePolicyContributor.Type;

export const EffectivePolicyOverrideReason = Schema.Literals([
  "direct-device-include",
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
  reason: EffectivePolicyOverrideReason,
});
export type EffectivePolicyOverride = typeof EffectivePolicyOverride.Type;

export const EffectivePolicyExclusionReason = Schema.Literals(["device-exclude", "group-exclude"]);
export type EffectivePolicyExclusionReason = typeof EffectivePolicyExclusionReason.Type;

export const EffectivePolicyExclusion = Schema.Struct({
  policyId: Schema.String,
  policyName: Schema.String,
  scope: EffectivePolicyScope,
  groupId: Schema.NullOr(Schema.String),
  groupName: Schema.NullOr(Schema.String),
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

/** A tenant member returned by the command palette's cross-entity search. */
export const UserSearchRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  role: Schema.String,
});
export type UserSearchRow = typeof UserSearchRow.Type;

export const SearchResult = Schema.Struct({
  rows: Schema.Array(Schema.Union([DeviceRow, GroupRow, PolicyRow, UserSearchRow])),
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

/**
 * Live membership preview. Dynamic groups evaluate their rules without
 * materialising anything, so the dashboard can show a count while the rule
 * builder is being edited.
 */
export const GroupPreviewResponse = Schema.Struct({
  groupId: Schema.String,
  kind: DynamicGroupKind,
  count: Schema.Number,
  devices: Schema.Array(GroupRelation),
  evaluatedAt: Schema.String,
});
export type GroupPreviewResponse = typeof GroupPreviewResponse.Type;
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

/** Android Enterprise signup/delivery state exposed to administrators. */
export const AndroidEnterpriseStatus = Schema.Literals(["pending", "active", "error", "disabled"]);
export type AndroidEnterpriseStatus = typeof AndroidEnterpriseStatus.Type;

/**
 * Tenant-facing Android Enterprise configuration.
 *
 * `configured` describes the deployment (Google credentials are present);
 * `status` describes this tenant's signup. An endpoint that needs Google access
 * fails with `EnterpriseNotConfigured` when `configured` is false.
 */
export const AndroidEnterpriseInfo = Schema.Struct({
  configured: Schema.Boolean,
  status: AndroidEnterpriseStatus,
  /** `enterprises/{enterpriseId}` once signup completes. */
  enterpriseName: Schema.optional(NullableString),
  pubsubTopic: Schema.optional(NullableString),
  pubsubSubscription: Schema.optional(NullableString),
  serviceAccountEmail: Schema.optional(NullableString),
  lastError: Schema.optional(NullableString),
  lastSyncedAt: Schema.optional(NullableString),
  /** Android devices known to this tenant and linked to the enterprise. */
  deviceCount: Schema.Number,
  /** True when the public enrollment page can issue an enrollment token. */
  available: Schema.Boolean,
  createdAt: Schema.optional(NullableString),
  updatedAt: Schema.optional(NullableString),
});
export type AndroidEnterpriseInfo = typeof AndroidEnterpriseInfo.Type;

/** Starts the Google-hosted Android Enterprise signup flow. */
export const AndroidSignupResponse = Schema.Struct({ url: Schema.String });
export type AndroidSignupResponse = typeof AndroidSignupResponse.Type;

export const PatchTenantAndroidRequest = Schema.Struct({
  /**
   * `false` disables Android delivery for the tenant without deleting the
   * Google enterprise. `true` re-enables an existing enterprise, or returns to
   * pending if signup never completed.
   */
  enabled: Schema.optional(Schema.Boolean),
});
export type PatchTenantAndroidRequest = typeof PatchTenantAndroidRequest.Type;

/**
 * Public enrollment details for an Android device.
 *
 * Google returns an enrollment token plus a QR payload. There is no documented
 * universal deep link for AMAPI enrollment: consumers scan the QR code from the
 * setup wizard, or enter `afw#setup` and then the token value manually.
 */
export const AndroidEnrollment = Schema.Union([
  Schema.Struct({ error: Schema.String }),
  Schema.Struct({
    /** JSON string to encode as a QR code. */
    qrCode: Schema.optional(NullableString),
    /** Manual token value used after `afw#setup`. */
    enrollmentToken: Schema.String,
    policyName: Schema.optional(NullableString),
    expiresAt: Schema.optional(NullableString),
  }),
  /** No enterprise is connected; the page shows setup instructions. */
  Schema.Literal("unavailable"),
]);
export type AndroidEnrollment = typeof AndroidEnrollment.Type;

/** Result of an explicit Android policy sync. */
export const AndroidSyncResponse = Schema.Struct({
  devices: Schema.Number,
  updated: Schema.Number,
  skipped: Schema.Number,
  failed: Schema.Number,
});
export type AndroidSyncResponse = typeof AndroidSyncResponse.Type;

/** Apple Business Manager credential/sync state for one tenant. */
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
export type VppAssignmentsResponse = typeof VppAssignmentsResponse.Type;

/**
 * Windows enrollment is driven by a tenant-scoped discovery URL
 * (`/mdm/windows/discovery?tenant=<signed token>`). The token identifies the
 * organization, so every tenant gets its own link. `expiresAt` tells the UI how
 * long the current link stays valid; reloading the enrollment page mints a new
 * one.
 */
export const WindowsEnrollment = Schema.Union([
  Schema.Struct({ error: Schema.String }),
  Schema.Struct({
    discoveryUrl: Schema.String,
    tenantScoped: Schema.Literal(true),
    expiresAt: Schema.optional(Schema.String),
    /** Autopilot/Entra state so the public page can explain the flow. */
    autopilot: Schema.optional(
      Schema.Struct({
        configured: Schema.Boolean,
        federated: Schema.Boolean,
        authServiceUrl: Schema.optional(NullableString),
        realm: Schema.optional(NullableString),
      }),
    ),
  }),
]);
export type WindowsEnrollment = typeof WindowsEnrollment.Type;

/** Deployment plan device allowance shown on the public enrollment page. */
export const EnrollmentDeviceLimit = Schema.Struct({
  reached: Schema.Boolean,
  plan: Schema.String,
  /** Omitted when the plan is unlimited. */
  limit: Schema.optional(Schema.Number),
  /** Omitted when the plan is unlimited. */
  used: Schema.optional(Schema.Number),
});
export type EnrollmentDeviceLimit = typeof EnrollmentDeviceLimit.Type;

export const EnrollmentResponse = Schema.Union([
  Schema.Struct({
    name: Schema.String,
    branding: TenantBranding,
    authenticated: Schema.Literal(false),
  }),
  Schema.Struct({
    name: Schema.String,
    branding: TenantBranding,
    authenticated: Schema.Literal(true),
    apple: PlatformEnrollment,
    windows: WindowsEnrollment,
    android: AndroidEnrollment,
    assetTag: Schema.Boolean,
    deviceLimit: Schema.optional(EnrollmentDeviceLimit),
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
  /**
   * Tenant-scoped Windows discovery URL with a signed tenant token. Omitted
   * when Windows enrollment is disabled or the deployment has no signing
   * secret; the public enrollment page mints the same URL on demand.
   */
  windowsDiscoveryUrl: Schema.optional(Schema.String),
  windowsDiscoveryExpiresAt: Schema.optional(Schema.String),
  /** True when this tenant can issue Android enrollment tokens right now. */
  androidAvailable: Schema.optional(Schema.Boolean),
  /** `enterprises/{enterpriseId}` when Android Enterprise is connected. */
  androidEnterpriseName: Schema.optional(NullableString),
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

/**
 * Token scopes. `read` allows read-only tenant access; `write` allows reads and
 * mutations (subject to the user's tenant role). Tokens created before scoping
 * was introduced report both scopes.
 */
export const ApiTokenScope = Schema.Union([Schema.Literal("read"), Schema.Literal("write")]);
export type ApiTokenScope = typeof ApiTokenScope.Type;

export const ApiTokenInfo = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  tokenPrefix: Schema.String,
  scopes: Schema.Array(ApiTokenScope),
  tenantId: Schema.optional(NullableString),
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
  /** Defaults to `["read", "write"]` for backwards compatibility. */
  scopes: Schema.optional(Schema.Array(ApiTokenScope)),
  /** Restricts the token to a single tenant; omit for all current memberships. */
  tenantId: Schema.optional(NullableString),
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
    HttpApiEndpoint.get("stepUpMethods", "/v1/account/step-up", {
      error: EnterpriseAuthRequiredErrors,
      success: StepUpMethods,
    }),
  )
  .add(
    HttpApiEndpoint.post("stepUpPassword", "/v1/account/step-up/password", {
      error: EnterpriseStepUpErrors,
      payload: Schema.Struct({ password: Schema.String, action: StepUpActionSchema }),
      success: StepUpGrantResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("stepUpTotp", "/v1/account/step-up/totp", {
      error: EnterpriseStepUpErrors,
      payload: Schema.Struct({ code: Schema.String, action: StepUpActionSchema }),
      success: StepUpGrantResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("beginStepUpPasskey", "/v1/account/step-up/passkey/begin", {
      error: EnterpriseStepUpFactorErrors,
      payload: Schema.Struct({ action: StepUpActionSchema }),
      success: StepUpPasskeyStarted,
    }),
  )
  .add(
    HttpApiEndpoint.post("completeStepUpPasskey", "/v1/account/step-up/passkey/complete", {
      error: EnterpriseStepUpFactorErrors,
      payload: Schema.Struct({ stepUpToken: Schema.String, response: Schema.String }),
      success: StepUpGrantResponse,
    }),
  )
  .add(
    HttpApiEndpoint.delete("removeAccountPasskey", "/v1/account/passkeys/:credentialId", {
      error: [
        ...EnterpriseAuthRequiredErrors,
        ...EnterpriseDbErrors,
        EnterpriseNotFound.pipe(HttpApiSchema.status(404)),
        EnterpriseBadRequest.pipe(HttpApiSchema.status(400)),
        ...EnterpriseStepUpRequired,
      ],
      params: { credentialId: Schema.String },
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.post("createApiToken", "/v1/account/api-tokens", {
      error: EnterpriseStepUpErrors,
      payload: CreateApiTokenRequest,
      success: CreateApiTokenResponse,
    }),
  )
  .add(
    HttpApiEndpoint.delete("revokeApiToken", "/v1/account/api-tokens/:tokenId", {
      error: EnterpriseStepUpErrors,
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
      error: [...EnterpriseAuthRequiredErrors, EnterpriseForbidden.pipe(HttpApiSchema.status(403))],
      success: TenantListResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("createTenant", "/v1/tenants", {
      error: [
        ...EnterpriseAuthRequiredErrors,
        ...EnterpriseDbErrors,
        EnterpriseBadRequest.pipe(HttpApiSchema.status(400)),
        EnterpriseForbidden.pipe(HttpApiSchema.status(403)),
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
    HttpApiEndpoint.get("exportTenant", "/v1/tenants/:tenantId/export", {
      error: EnterpriseTenantExportErrors,
      params: TenantParam,
      query: TenantExportQuery,
      success: Schema.String.pipe(
        HttpApiSchema.asText({ contentType: "application/json; charset=utf-8" }),
      ),
    }),
  )
  .add(
    HttpApiEndpoint.post("importTenant", "/v1/tenants/import", {
      error: EnterpriseTenantImportErrors,
      payload: TenantImportRequest,
      success: TenantImportResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("runTenantBackup", "/v1/tenants/:tenantId/backups", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      success: BackupRunInfo,
    }),
  )
  .add(
    HttpApiEndpoint.get("listTenantBackups", "/v1/tenants/:tenantId/backups", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: TenantBackupsResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("downloadTenantBackup", "/v1/tenants/:tenantId/backups/:id/download", {
      error: [...EnterpriseTenantBackupDownloadErrors, ...EnterpriseStepUpRequired],
      params: TenantIdParam,
      success: Schema.String.pipe(
        HttpApiSchema.asText({ contentType: "application/json; charset=utf-8" }),
      ),
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
      error: [...EnterpriseTenantDeleteErrors, ...EnterpriseStepUpRequired],
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
      error: [...EnterpriseSsoErrors, ...EnterpriseStepUpRequired],
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
    HttpApiEndpoint.get("getAutopilotSettings", "/v1/tenants/:tenantId/autopilot", {
      error: EnterpriseAutopilotReadErrors,
      params: TenantParam,
      success: AutopilotSettingsResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("listAutopilotDevices", "/v1/tenants/:tenantId/autopilot/devices", {
      error: EnterpriseAutopilotReadErrors,
      params: TenantParam,
      success: AutopilotDevicesResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("importAutopilotDevices", "/v1/tenants/:tenantId/autopilot/import", {
      error: EnterpriseAutopilotWriteErrors,
      params: TenantParam,
      payload: AutopilotImportRequest,
      success: AutopilotImportResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("syncAutopilotDevices", "/v1/tenants/:tenantId/autopilot/sync", {
      error: EnterpriseAutopilotWriteErrors,
      params: TenantParam,
      success: AutopilotSyncResponse,
    }),
  )
  .add(
    HttpApiEndpoint.delete(
      "deleteAutopilotDevice",
      "/v1/tenants/:tenantId/autopilot/devices/:serial",
      {
        error: EnterpriseAutopilotWriteErrors,
        params: TenantAutopilotDeviceParam,
        success: Schema.Struct({ status: Schema.Literal("ok") }),
      },
    ),
  )
  .add(
    HttpApiEndpoint.get("listAutopilotProfiles", "/v1/tenants/:tenantId/autopilot/profiles", {
      error: EnterpriseAutopilotReadErrors,
      params: TenantParam,
      success: AutopilotProfilesResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("createAutopilotProfile", "/v1/tenants/:tenantId/autopilot/profiles", {
      error: EnterpriseAutopilotWriteErrors,
      params: TenantParam,
      payload: CreateAutopilotProfileRequest,
      success: AutopilotProfileInfo,
    }),
  )
  .add(
    HttpApiEndpoint.patch(
      "updateAutopilotProfile",
      "/v1/tenants/:tenantId/autopilot/profiles/:profileId",
      {
        error: EnterpriseAutopilotWriteErrors,
        params: TenantAutopilotProfileParam,
        payload: UpdateAutopilotProfileRequest,
        success: AutopilotProfileInfo,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "assignAutopilotProfile",
      "/v1/tenants/:tenantId/autopilot/profiles/:profileId/assign",
      {
        error: EnterpriseAutopilotWriteErrors,
        params: TenantAutopilotProfileParam,
        payload: AssignAutopilotProfileRequest,
        success: AutopilotProfileInfo,
      },
    ),
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
    HttpApiEndpoint.get("searchAuditLog", "/v1/tenants/:tenantId/audit/search", {
      error: EnterpriseTenantValidatedReadErrors,
      params: TenantParam,
      query: AuditSearchQuery,
      success: AuditSearchResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("exportAuditLog", "/v1/tenants/:tenantId/audit/export", {
      error: EnterpriseTenantValidatedReadErrors,
      params: TenantParam,
      query: AuditExportQuery,
      success: Schema.String.pipe(HttpApiSchema.asText({ contentType: "text/csv; charset=utf-8" })),
    }),
  )
  .add(
    HttpApiEndpoint.get("listWebhookEndpoints", "/v1/tenants/:tenantId/webhooks", {
      // Listing reveals delivery health, so it is limited to owner/admin just
      // like the mutations.
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      success: WebhookEndpointsResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("createWebhookEndpoint", "/v1/tenants/:tenantId/webhooks", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: CreateWebhookEndpointRequest,
      success: CreateWebhookEndpointResponse,
    }),
  )
  .add(
    HttpApiEndpoint.patch("patchWebhookEndpoint", "/v1/tenants/:tenantId/webhooks/:webhookId", {
      error: EnterpriseTenantWriteErrors,
      params: TenantWebhookParam,
      payload: PatchWebhookEndpointRequest,
      success: WebhookEndpointInfo,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteWebhookEndpoint", "/v1/tenants/:tenantId/webhooks/:webhookId", {
      error: EnterpriseTenantWriteErrors,
      params: TenantWebhookParam,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "rotateWebhookSecret",
      "/v1/tenants/:tenantId/webhooks/:webhookId/rotate-secret",
      {
        error: EnterpriseTenantWriteErrors,
        params: TenantWebhookParam,
        success: RotateWebhookSecretResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post("testWebhookEndpoint", "/v1/tenants/:tenantId/webhooks/:webhookId/test", {
      error: EnterpriseTenantWriteErrors,
      params: TenantWebhookParam,
      success: WebhookTestResponse,
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
    HttpApiEndpoint.get("getAdeEnrollmentProfile", "/v1/abm/ade/:token", {
      error: EnterprisePublicAdeProfileErrors,
      params: { token: Schema.String },
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
    HttpApiEndpoint.get("getTenantAndroid", "/v1/tenants/:tenantId/android", {
      error: EnterpriseAndroidReadErrors,
      params: TenantParam,
      success: AndroidEnterpriseInfo,
    }),
  )
  .add(
    HttpApiEndpoint.patch("patchTenantAndroid", "/v1/tenants/:tenantId/android", {
      error: EnterpriseAndroidErrors,
      params: TenantParam,
      payload: PatchTenantAndroidRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.post("createAndroidSignup", "/v1/tenants/:tenantId/android/signup", {
      error: EnterpriseAndroidErrors,
      params: TenantParam,
      success: AndroidSignupResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("syncTenantAndroid", "/v1/tenants/:tenantId/android/sync", {
      error: EnterpriseAndroidErrors,
      params: TenantParam,
      success: AndroidSyncResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getAppleBusinessManager", "/v1/tenants/:tenantId/abm", {
      error: EnterpriseAppleReadErrors,
      params: TenantParam,
      success: AppleBusinessManagerInfo,
    }),
  )
  .add(
    HttpApiEndpoint.put("uploadAppleBusinessManagerToken", "/v1/tenants/:tenantId/abm/token", {
      error: EnterpriseAppleWriteErrors,
      params: TenantParam,
      payload: UploadAppleBusinessManagerTokenRequest,
      success: AppleBusinessManagerInfo,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteAppleBusinessManagerToken", "/v1/tenants/:tenantId/abm/token", {
      error: EnterpriseAppleWriteErrors,
      params: TenantParam,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.post("syncAppleBusinessManager", "/v1/tenants/:tenantId/abm/sync", {
      error: EnterpriseAppleWriteErrors,
      params: TenantParam,
      success: AppleBusinessManagerSyncResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("listAbmDevices", "/v1/tenants/:tenantId/abm/devices", {
      error: EnterpriseAppleReadErrors,
      params: TenantParam,
      success: AbmDevicesResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getAbmDevice", "/v1/tenants/:tenantId/abm/devices/:serial", {
      error: EnterpriseAppleReadErrors,
      params: { tenantId: Schema.String, serial: Schema.String },
      success: AbmDeviceInfo,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "assignAppleBusinessManagerDevice",
      "/v1/tenants/:tenantId/abm/devices/:serial/assign",
      {
        error: EnterpriseAppleWriteErrors,
        params: { tenantId: Schema.String, serial: Schema.String },
        success: AbmAssignDeviceResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get(
      "getAbmDeviceProfileUrl",
      "/v1/tenants/:tenantId/abm/devices/:serial/profile-url",
      {
        error: EnterpriseAppleWriteErrors,
        params: { tenantId: Schema.String, serial: Schema.String },
        success: AbmProfileUrlResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get("getVpp", "/v1/tenants/:tenantId/vpp", {
      error: EnterpriseAppleReadErrors,
      params: TenantParam,
      success: VppInfo,
    }),
  )
  .add(
    HttpApiEndpoint.put("uploadVppToken", "/v1/tenants/:tenantId/vpp/token", {
      error: EnterpriseAppleWriteErrors,
      params: TenantParam,
      payload: UploadVppTokenRequest,
      success: VppInfo,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteVppToken", "/v1/tenants/:tenantId/vpp/token", {
      error: EnterpriseAppleWriteErrors,
      params: TenantParam,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.post("syncVpp", "/v1/tenants/:tenantId/vpp/sync", {
      error: EnterpriseAppleWriteErrors,
      params: TenantParam,
      success: VppSyncResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("listVppAssets", "/v1/tenants/:tenantId/vpp/assets", {
      error: EnterpriseAppleReadErrors,
      params: TenantParam,
      success: VppAssetsResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("listVppAssignments", "/v1/tenants/:tenantId/vpp/assignments", {
      error: EnterpriseAppleReadErrors,
      params: TenantParam,
      success: VppAssignmentsResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("installVppAsset", "/v1/tenants/:tenantId/vpp/assets/:adamId/install", {
      error: EnterpriseAppleWriteErrors,
      params: { tenantId: Schema.String, adamId: Schema.String },
      payload: VppInstallRequest,
      success: VppInstallResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("releaseVppAsset", "/v1/tenants/:tenantId/vpp/assets/:adamId/release", {
      error: EnterpriseAppleWriteErrors,
      params: { tenantId: Schema.String, adamId: Schema.String },
      payload: VppReleaseRequest,
      success: VppReleaseResponse,
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
    HttpApiEndpoint.get(
      "listDeviceApplications",
      "/v1/tenants/:tenantId/devices/:id/applications",
      {
        error: EnterpriseTenantReadErrors,
        params: TenantIdParam,
        success: DeviceApplicationsResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get("getDeviceRecoveryKey", "/v1/tenants/:tenantId/devices/:id/recovery-key", {
      // Revealing a recovery key is a privileged, audited read. `write`
      // restricts the endpoint to owners/admins while still requiring the
      // caller to prove tenant membership.
      error: [...EnterpriseTenantWriteErrors, ...EnterpriseStepUpRequired],
      params: TenantIdParam,
      success: DeviceRecoveryKeyResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get(
      "getDeviceEffectivePolicy",
      "/v1/tenants/:tenantId/devices/:id/effective-policy",
      {
        error: EnterpriseTenantReadErrors,
        params: TenantIdParam,
        success: EffectivePolicyResponse,
      },
    ),
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
      error: [...EnterpriseTenantWriteErrors, ...EnterpriseStepUpRequired],
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
    HttpApiEndpoint.get("previewGroup", "/v1/tenants/:tenantId/groups/:id/preview", {
      error: EnterpriseTenantReadErrors,
      params: TenantIdParam,
      success: GroupPreviewResponse,
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
    HttpApiEndpoint.get("getApplicationInventory", "/v1/tenants/:tenantId/applications/inventory", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      query: ApplicationInventoryQuery,
      success: ApplicationInventoryResponse,
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
    HttpApiEndpoint.post("extractMobileconfig", "/v1/policy/extract-mobileconfig", {
      error: [...EnterpriseNoDomainErrors, EnterpriseBadRequest.pipe(HttpApiSchema.status(400))],
      payload: Schema.Struct({ mobileconfig: Schema.String }),
      success: Schema.Struct({ plist: Schema.String }),
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
      error: [...EnterpriseBillingPortalErrors, ...EnterpriseStepUpRequired],
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
