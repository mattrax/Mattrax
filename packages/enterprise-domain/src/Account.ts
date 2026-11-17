import { Schema } from "effect";
import { AuditLogEntry } from "./Audit.js";
import { AuditSearchResponse } from "./Audit.js";
import { NullableString } from "./Errors.js";
import { UserInfo } from "./Tenant.js";

export const AcceptInvitationRequest = Schema.Struct({ token: Schema.String });

export const AcceptInvitationResponse = Schema.Struct({
  tenantId: Schema.String,
  alreadyMember: Schema.Boolean,
});

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

/**
 * Guest sign-up verification. The address is proven before the passkey prompt,
 * so the account is created already verified and no callback URL is needed.
 */
export const BeginRegistrationVerificationRequest = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  email: Schema.String.check(Schema.isMaxLength(320)),
});

export const BeginRegistrationVerificationResponse = Schema.Struct({
  status: Schema.Literal("ok"),
  emailSent: Schema.Boolean,
});

export const CompleteRegistrationVerificationRequest = Schema.Struct({
  email: Schema.String.check(Schema.isMaxLength(320)),
  code: Schema.String.check(Schema.isMinLength(6), Schema.isMaxLength(6)),
});

export const CompleteRegistrationVerificationResponse = Schema.Struct({
  /** Proof to pass to `beginPasskeyRegistration` as `registration.grant`. */
  grant: Schema.String,
});

export const UpdateMeRequest = Schema.Struct({
  /** Same 120-character ceiling as registration. */
  name: Schema.optional(Schema.String.check(Schema.isMaxLength(120))),
  image: Schema.optional(NullableString),
});


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

/** A user's consent grant to an OAuth MCP client. */
export const McpConnectionInfo = Schema.Struct({
  id: Schema.String,
  clientId: Schema.String,
  clientName: Schema.String,
  scopes: Schema.Array(Schema.String),
  requestCount: Schema.Number,
  lastAction: Schema.optional(NullableString),
  lastUsedAt: Schema.optional(NullableString),
  revokedAt: Schema.optional(NullableString),
  createdAt: Schema.String,
});

export type McpConnectionInfo = typeof McpConnectionInfo.Type;

export const McpConnectionsResponse = Schema.Struct({
  connections: Schema.Array(McpConnectionInfo),
});

export type McpConnectionsResponse = typeof McpConnectionsResponse.Type;

/** Activity heartbeat written by the MCP gateway for audit attribution. */
export const McpActivityRequest = Schema.Struct({
  tool: Schema.String,
  method: Schema.String,
  path: Schema.String,
  status: Schema.Number,
});

export type McpActivityRequest = typeof McpActivityRequest.Type;

export const AccountSessionInfo = Schema.Struct({
  id: Schema.String,
  current: Schema.Boolean,
  createdAt: Schema.String,
  expiresAt: Schema.String,
  method: Schema.optional(NullableString),
  /** When the session last authenticated a request; null before first use. */
  lastUsedAt: Schema.optional(NullableString),
  /** Parsed client descriptor: browser and platform come from the User-Agent. */
  browser: Schema.optional(NullableString),
  platform: Schema.optional(NullableString),
  deviceType: Schema.optional(NullableString),
});

export const AccountSessionsResponse = Schema.Struct({
  sessions: Schema.Array(AccountSessionInfo),
});

/**
 * Account-scoped audit entry. It carries no tenant reference: these events
 * happen before a tenant is chosen (sign-in, credential changes) or exist
 * independently of one (API tokens, account deletion).
 */
export const AccountAuditEntry = AuditLogEntry;

export type AccountAuditEntry = typeof AccountAuditEntry.Type;

export const AccountAuditSearchResponse = AuditSearchResponse;

export type AccountAuditSearchResponse = typeof AccountAuditSearchResponse.Type;

/** Effective tenant security policy, independent of the SSO configuration. */
export const TenantSecuritySettings = Schema.Struct({
  /**
   * Every member of the tenant — including viewer and auditor roles — must have
   * a passkey or authenticator app. Account settings stay reachable so a member
   * can enrol a factor.
   */
  requireMfa: Schema.Boolean,
});

export type TenantSecuritySettings = typeof TenantSecuritySettings.Type;

export const UpdateTenantSecurityRequest = Schema.Struct({
  requireMfa: Schema.Boolean,
});

/* -------------------------------------------------------------------------- */
/* Break-glass account recovery                                               */
/* -------------------------------------------------------------------------- */

/**
 * Recovery is deliberately non-enumerable: the response never says whether the
 * address exists. The account owner learns the outcome from email.
 */
export const RequestAccountRecovery = Schema.Struct({
  email: Schema.String.check(Schema.isMaxLength(320)),
});

export const AccountRecoveryStatus = Schema.Literals([
  /** The proof link has not been used yet. */
  "pending_proof",
  /** Email control is proven; another owner must approve. */
  "pending_approval",
  /** A single-use completion link exists and can sign the account in. */
  "ready",
]);

export const AccountRecoveryResponse = Schema.Struct({
  status: AccountRecoveryStatus,
  /**
   * Only present when the ceremony can complete in this browser: proof of the
   * verified address was just consumed and no approval is outstanding. It is a
   * single-use token exchanged for a session by the auth `recoverySignIn`
   * action.
   */
  signInToken: Schema.optional(Schema.String),
});

export type AccountRecoveryResponse = typeof AccountRecoveryResponse.Type;

export const VerifyAccountRecoveryRequest = Schema.Struct({ token: Schema.String });

export const ApproveAccountRecoveryRequest = Schema.Struct({ token: Schema.String });

/**
 * Account-scoped contract: profile, sessions, tokens, step-up and audit.
 *
 * Kept in a separate top-level group so the declaration emitter can serialise
 * each group independently; the tenant contract is already at the compiler's
 * limit.
 */
