import { Permission } from "./rbac.js";
import { Schema } from "effect";
import { JsonRecord } from "./Errors.js";
import { NullableString } from "./Errors.js";

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
  /**
   * Whether any tenant this account belongs to requires MFA. The requirement
   * applies to every role, so a read-only member of a tenant that demands MFA
   * sees `true` here as well.
   */
  mfaRequired: Schema.Boolean,
  /**
   * Account-level tenant to land on when no tenant is in the URL. Null when
   * the account has not chosen one or is no longer a member of it.
   */
  defaultTenantId: Schema.optional(NullableString),
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
  /** Built-in role key retained for backwards compatibility. */
  role: Schema.String,
  roleId: Schema.optional(NullableString),
  roleName: Schema.String,
  roleKind: Schema.Literals(["built-in", "custom"]),
  /** Effective permissions from the member's built-in or custom role. */
  permissions: Schema.Array(Permission),
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
  /** Built-in role key retained for backwards compatibility. */
  role: Schema.String,
  roleId: Schema.optional(NullableString),
  roleName: Schema.String,
  roleKind: Schema.Literals(["built-in", "custom"]),
  /** Effective permissions from the member's built-in or custom role. */
  permissions: Schema.Array(Permission),
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

/**
 * Session summary returned by bootstrap. It has the same public shape as the
 * auth `getSession` value, without the assurance timing fields the shell does
 * not read.
 */
export const BootstrapSession = Schema.Struct({
  sessionId: Schema.String,
  subjectId: Schema.String,
  claims: Schema.Struct({
    name: Schema.String,
    email: Schema.String,
    emailVerified: Schema.Boolean,
  }),
});

export type BootstrapSession = typeof BootstrapSession.Type;

/**
 * One-shot bootstrap for the web Worker's server render: the session, the
 * account/tenant shell and a short-lived SSR token, all after one
 * `requireUser`. Tokens are signed with the deployment `AUTH_SECRET` and are
 * only useful to the web Worker over its service binding.
 *
 * Bootstrap is not a free cache fill: it resolves memberships and per-tenant
 * roles. The token is display-only, so only a warm token avoids that cost.
 */
export const BootstrapResponse = Schema.Struct({
  session: Schema.NullOr(BootstrapSession),
  me: MeResponse,
  /**
   * Null when the caller has no browser session, the deployment has no shared
   * secret, the account is unverified, or the tenant-bearing token would exceed
   * the cookie budget. A tenant-less token is never issued: it would be a miss
   * on every navigation.
   */
  ssrToken: Schema.NullOr(Schema.String),
  ssrTokenExpiresAt: Schema.NullOr(Schema.Number),
  /**
   * Signed session/auth revision the edge compares before trusting a warm
   * token. Optional during a rolling deploy: an older edge ignores it, and an
   * older API omits it.
   */
  ssrRevision: Schema.optional(Schema.NullOr(Schema.String)),
  ssrRevisionExpiresAt: Schema.optional(Schema.NullOr(Schema.Number)),
});

export type BootstrapResponse = typeof BootstrapResponse.Type;

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
  /** Built-in role key; retained even when a custom role is assigned. */
  role: Schema.String,
  roleId: Schema.optional(NullableString),
  roleName: Schema.optional(Schema.String),
  roleKind: Schema.optional(Schema.Literals(["built-in", "custom"])),
  createdAt: Schema.String,
});

export type TenantUser = typeof TenantUser.Type;

export const TenantUsersResponse = Schema.Struct({ users: Schema.Array(TenantUser) });

export const InvitationEmail = Schema.Trim.pipe(
  Schema.check(Schema.isMaxLength(320), Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)),
);

export const InviteTenantUserRequest = Schema.Struct({
  email: InvitationEmail,
  role: Schema.optional(Schema.String),
  roleId: Schema.optional(NullableString),
});

export const InvitationStatus = Schema.Literals([
  "pending",
  "accepted",
  "canceled",
  "expired",
  "superseded",
]);

export type InvitationStatus = typeof InvitationStatus.Type;

export const InvitationActor = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
});

export type InvitationActor = typeof InvitationActor.Type;

export const TenantInvitation = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  /** Built-in role key; retained even when a custom role is assigned. */
  role: Schema.optional(NullableString),
  roleId: Schema.optional(NullableString),
  customRoleId: Schema.optional(NullableString),
  roleName: Schema.String,
  status: InvitationStatus,
  /** True when a pending invitation is past its expiry. */
  isExpired: Schema.Boolean,
  invitedBy: Schema.optional(InvitationActor),
  createdAt: Schema.String,
  expiresAt: Schema.String,
  lastSentAt: Schema.String,
  sendCount: Schema.Number,
  acceptedAt: Schema.optional(NullableString),
});

export type TenantInvitation = typeof TenantInvitation.Type;

export const TenantInvitationsResponse = Schema.Struct({
  invitations: Schema.Array(TenantInvitation),
});

export const ListTenantInvitationsQuery = Schema.Struct({
  status: Schema.optional(InvitationStatus),
  limit: Schema.optional(Schema.Number),
});

export type ListTenantInvitationsQuery = typeof ListTenantInvitationsQuery.Type;

export const InvitationPreviewState = Schema.Literals([
  "valid",
  "expired",
  "accepted",
  "canceled",
  "superseded",
  "unknown",
]);

export type InvitationPreviewState = typeof InvitationPreviewState.Type;

export const InvitationPreviewQuery = Schema.Struct({ token: Schema.String });

export const InvitationPreviewTenant = Schema.Struct({
  name: Schema.String,
  displayName: Schema.optional(NullableString),
  logo: Schema.optional(NullableString),
  brandColor: Schema.optional(NullableString),
});

export type InvitationPreviewTenant = typeof InvitationPreviewTenant.Type;

export const InvitationPreviewResponse = Schema.Struct({
  state: InvitationPreviewState,
  tenant: Schema.optional(InvitationPreviewTenant),
  roleName: Schema.optional(Schema.String),
  invitedEmailMasked: Schema.optional(Schema.String),
  expiresAt: Schema.optional(Schema.String),
});

export type InvitationPreviewResponse = typeof InvitationPreviewResponse.Type;

export const InvitationRoleOption = Schema.Struct({
  /** Present for a built-in role. */
  role: Schema.optional(Schema.String),
  /** Present for a custom role. */
  roleId: Schema.optional(NullableString),
  label: Schema.String,
  assignable: Schema.Boolean,
  blockedReason: Schema.optional(NullableString),
});

export type InvitationRoleOption = typeof InvitationRoleOption.Type;

export const InvitationOptionsResponse = Schema.Struct({
  roles: Schema.Array(InvitationRoleOption),
});

export type InvitationOptionsResponse = typeof InvitationOptionsResponse.Type;

export const ResendTenantInvitationResponse = Schema.Struct({
  id: Schema.String,
  inviteUrl: Schema.String,
  expiresAt: Schema.String,
  emailSent: Schema.Boolean,
});

export type ResendTenantInvitationResponse = typeof ResendTenantInvitationResponse.Type;

export const PatchTenantUserRequest = Schema.Struct({
  role: Schema.optional(Schema.String),
  roleId: Schema.optional(NullableString),
});

export const OwnershipTransferStatus = Schema.Literals([
  "pending",
  "accepted",
  "cancelled",
  "expired",
]);

export type OwnershipTransferStatus = typeof OwnershipTransferStatus.Type;

export const OwnershipTransferUser = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
});

export type OwnershipTransferUser = typeof OwnershipTransferUser.Type;

/**
 * A pending (or recently terminal) ownership transfer. The settings page only
 * ever sees the pending row; the fields below describe who requested it, who
 * must accept it and when the link stops working.
 */
export const TenantOwnershipTransfer = Schema.Struct({
  id: Schema.String,
  status: OwnershipTransferStatus,
  /** True when a pending transfer is past its expiry. */
  isExpired: Schema.Boolean,
  requestedBy: OwnershipTransferUser,
  target: OwnershipTransferUser,
  createdAt: Schema.String,
  expiresAt: Schema.String,
  acceptedAt: Schema.optional(NullableString),
  cancelledAt: Schema.optional(NullableString),
});

export type TenantOwnershipTransfer = typeof TenantOwnershipTransfer.Type;

export const TenantOwnershipTransferResponse = Schema.Struct({
  transfer: Schema.NullOr(TenantOwnershipTransfer),
});

export type TenantOwnershipTransferResponse = typeof TenantOwnershipTransferResponse.Type;

export const RequestTenantOwnershipTransferRequest = Schema.Struct({
  targetUserId: Schema.String,
});

export type RequestTenantOwnershipTransferRequest =
  typeof RequestTenantOwnershipTransferRequest.Type;

export const RequestTenantOwnershipTransferResponse = Schema.Struct({
  id: Schema.String,
  targetUserId: Schema.String,
  /** The emailed link; returned so the owner can forward it if mail fails. */
  acceptUrl: Schema.String,
  expiresAt: Schema.String,
  emailSent: Schema.Boolean,
});

export type RequestTenantOwnershipTransferResponse =
  typeof RequestTenantOwnershipTransferResponse.Type;

export const OwnershipTransferPreviewState = Schema.Literals([
  "valid",
  "expired",
  "accepted",
  "cancelled",
  "unknown",
]);

export type OwnershipTransferPreviewState = typeof OwnershipTransferPreviewState.Type;

export const OwnershipTransferPreviewQuery = Schema.Struct({ token: Schema.String });

export const OwnershipTransferPreviewResponse = Schema.Struct({
  state: OwnershipTransferPreviewState,
  tenant: Schema.optional(InvitationPreviewTenant),
  /** Name only: the requester is an owner the target already knows. */
  requestedByName: Schema.optional(Schema.String),
  targetEmailMasked: Schema.optional(Schema.String),
  expiresAt: Schema.optional(Schema.String),
});

export type OwnershipTransferPreviewResponse = typeof OwnershipTransferPreviewResponse.Type;

export const AcceptTenantOwnershipTransferRequest = Schema.Struct({
  token: Schema.String,
});

export type AcceptTenantOwnershipTransferRequest = typeof AcceptTenantOwnershipTransferRequest.Type;

export const AcceptTenantOwnershipTransferResponse = Schema.Struct({
  tenantId: Schema.String,
});

export type AcceptTenantOwnershipTransferResponse =
  typeof AcceptTenantOwnershipTransferResponse.Type;

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
