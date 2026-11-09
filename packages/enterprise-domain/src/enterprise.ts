import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";

const IdParam = { id: Schema.String };
const TenantParam = { tenantId: Schema.String };
const TenantIdParam = { tenantId: Schema.String, id: Schema.String };
const TenantInvitationParam = { tenantId: Schema.String, invitationId: Schema.String };
const TenantMemberParam = { tenantId: Schema.String, memberId: Schema.String };
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
const EnterpriseApnsErrors = [
  ...EnterpriseTenantWriteErrors,
  EnterpriseBadRequest.pipe(HttpApiSchema.status(400)),
] as const;
const EnterpriseNoDomainErrors = [...EnterpriseDbErrors] as const;
const EnterpriseAccountErrors = [
  ...EnterpriseAuthRequiredErrors,
  ...EnterpriseDbErrors,
  EnterpriseBadRequest.pipe(HttpApiSchema.status(400)),
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
});
export type DeviceRow = typeof DeviceRow.Type;

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

export const DownloadPolicyApplicationResponse = Schema.Struct({
  sha256: Schema.String,
  fileName: Schema.String,
  contentType: Schema.optional(NullableString),
  size: Schema.Number,
  content: Schema.String,
});
export type DownloadPolicyApplicationResponse = typeof DownloadPolicyApplicationResponse.Type;

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

export const SearchResult = Schema.Struct({
  rows: Schema.Array(Schema.Union([DeviceRow, GroupRow, PolicyRow])),
});

export const DeviceListResponse = Schema.Struct({ rows: Schema.Array(DeviceRow) });
export const GroupListResponse = Schema.Struct({ rows: Schema.Array(GroupRow) });
export const PolicyListResponse = Schema.Struct({ rows: Schema.Array(PolicyRow) });

export const NodeResponse = Schema.Union([DeviceRow, GroupNode, PolicyRow]);
export type NodeResponse = typeof NodeResponse.Type;

export const PlatformEnrollment = Schema.Union([
  Schema.Struct({ error: Schema.String }),
  Schema.Struct({ profile: Schema.String }),
  Schema.Literal("available"),
]);
export type PlatformEnrollment = typeof PlatformEnrollment.Type;

export const EnrollmentResponse = Schema.Union([
  Schema.Struct({ name: Schema.String, authenticated: Schema.Literal(false) }),
  Schema.Struct({
    name: Schema.String,
    authenticated: Schema.Literal(true),
    apple: PlatformEnrollment,
    windows: PlatformEnrollment,
    android: PlatformEnrollment,
    assetTag: Schema.Boolean,
  }),
]);
export type EnrollmentResponse = typeof EnrollmentResponse.Type;

export const EnrollmentQuery = { code: Schema.optional(Schema.String) };

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
      error: EnterpriseAuthRequiredErrors,
      payload: ChangeEmailRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.post("verifyEmailChange", "/v1/account/email-change/verify", {
      error: EnterpriseNoDomainErrors,
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
      error: EnterpriseAuthRequiredErrors,
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
      error: EnterpriseAuthRequiredErrors,
      payload: UpdateMeRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteMe", "/v1/me", {
      error: EnterpriseNoDomainErrors,
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
    HttpApiEndpoint.get("getTenantEnrollment", "/v1/tenants/:tenantId/enrollment", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: TenantEnrollmentInfo,
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
    HttpApiEndpoint.get("listDevices", "/v1/tenants/:tenantId/devices", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: DeviceListResponse,
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
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.post("deviceUnenroll", "/v1/tenants/:tenantId/devices/:id/unenroll", {
      error: EnterpriseTenantWriteErrors,
      params: TenantIdParam,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
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
