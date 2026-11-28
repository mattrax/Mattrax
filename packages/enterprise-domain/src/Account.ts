import { TenantId } from "@mattrax/crypto";
import { Schema } from "effect";
import { AuditLogEntry } from "./Audit.js";
import { AuditSearchResponse } from "./Audit.js";
import { NullableString } from "./Errors.js";
import { AccountInfo, MeResponse } from "./Tenant.js";
import { CredentialScope, Permission } from "./rbac.js";

export const AcceptInvitationRequest = Schema.Struct({ token: Schema.String });

export const AcceptInvitationResponse = Schema.Struct({
  tenantId: TenantId.schema,
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
  /**
   * Whether the code email was accepted for delivery. Absent on flows that send
   * nothing; `false` lets the page say the mail did not go out instead of
   * leaving someone waiting for it.
   */
  emailSent: Schema.optional(Schema.Boolean),
});

/**
 * Cookie binding an Email Verification API nonce to the anonymous sign-up
 * session. Registration has no account session yet, so this cookie is the
 * session state the nonce is stored in: the page renders the same value into
 * the hidden token input and the server only accepts a token whose nonce is
 * the one this browser was issued.
 *
 * The nonce is not a secret (it is an attribute in the HTML), so the flags are
 * about keeping it scoped to this origin, this page and this flow rather than
 * hiding it. It is short-lived because a token is only useful while the form
 * is open.
 */
export const REGISTRATION_NONCE_COOKIE = "mattrax_register_nonce";

/** Long enough for a slow sign-up, short enough that a stale nonce dies. */
export const REGISTRATION_NONCE_TTL_SECONDS = 30 * 60;

/** One server-generated nonce per sign-up form render. */
export const newRegistrationNonce = (): string => crypto.randomUUID();

export const registrationNonceCookie = (nonce: string, secure: boolean): string =>
  `${REGISTRATION_NONCE_COOKIE}=${encodeURIComponent(nonce)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${REGISTRATION_NONCE_TTL_SECONDS}${secure ? "; Secure" : ""}`;

/** Read this browser session's nonce from a raw `Cookie` header. */
export const readRegistrationNonce = (
  header: string | string[] | undefined,
): string | undefined => {
  const joined = Array.isArray(header) ? header.join("; ") : header;

  if (!joined) return undefined;

  for (const part of joined.split(";")) {
    const separator = part.indexOf("=");

    if (separator === -1) continue;

    if (part.slice(0, separator).trim() !== REGISTRATION_NONCE_COOKIE) continue;

    const value = part.slice(separator + 1).trim();

    if (!value) return undefined;

    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }

  return undefined;
};

/**
 * Guest sign-up verification. The address is proven before the passkey prompt,
 * so the account is created already verified and no callback URL is needed.
 *
 * `token` and `nonce` are the Email Verification API pair: the browser fills a
 * hidden input when it can verify the address inline. Both are optional and
 * inert without browser support; the emailed six-digit code remains the
 * fallback.
 */
export const BeginRegistrationVerificationRequest = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  email: Schema.String.check(Schema.isMaxLength(320)),
  /**
   * SD-JWT+KB presentation filled by the browser. No length check here: a
   * token that is too unusual to parse must fall back to the code flow, not
   * turn the whole sign-up request into a validation error.
   */
  token: Schema.optional(Schema.String),
  /** The nonce the browser was served for this form. */
  nonce: Schema.optional(Schema.String),
});

export const BeginRegistrationVerificationResponse = Schema.Struct({
  status: Schema.Literal("ok"),
  /**
   * Whether a code email was accepted for delivery. `false` on an EVP
   * verification because no code was sent.
   */
  emailSent: Schema.Boolean,
  /** True when the browser token verified the address inline. */
  verified: Schema.optional(Schema.Boolean),
  /** Proof for passkey registration when `verified` is true. */
  grant: Schema.optional(Schema.String),
  /**
   * Freshly rotated nonce. Present after a token attempt so the page can bind
   * another attempt (and the previous nonce is no longer in the cookie).
   */
  nonce: Schema.optional(Schema.String),
});

/** Optional `Set-Cookie` rotation for the sign-up nonce. */
export const RegistrationNonceHeaders = Schema.Struct({
  "set-cookie": Schema.optional(Schema.String),
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
  /**
   * Account-level landing tenant. `null` clears the choice and restores the
   * browser's last-used tenant; the account must be a member of any non-null
   * value.
   */
  defaultTenantId: Schema.optional(NullableString),
});

export type UpdateMeRequest = typeof UpdateMeRequest.Type;

/**
 * Account deletion is also tenant deletion.
 *
 * The flow is deliberately narrow: it only succeeds for an account that is the
 * sole member of a single tenant, so one person can never remove a shared
 * tenant or silently lose access to another one. The preview endpoint reports
 * every reason the account cannot be deleted so the dashboard can explain the
 * next step before anything is destructive.
 */
export const AccountDeletionRequest = Schema.Struct({
  /** Typed by the person; compared case-insensitively with the account email. */
  confirmEmail: Schema.String,
});

export type AccountDeletionRequest = typeof AccountDeletionRequest.Type;

export const ACCOUNT_DELETION_BLOCKERS = [
  /** More than one membership; deleting would strand or destroy another tenant. */
  "multiple_tenants",
  /** The tenant has another owner, so it would not be deleted with the account. */
  "tenant_has_other_owners",
  /** The tenant has other members who would lose their tenant in the cascade. */
  "tenant_has_other_members",
  /** The single member is not a built-in owner, so it cannot cascade a tenant. */
  "tenant_owner_required",
  /** The tenant's four-eyes policy requires the explicit tenant delete flow. */
  "tenant_delete_requires_approval",
] as const;

export const AccountDeletionBlockerCode = Schema.Literals(ACCOUNT_DELETION_BLOCKERS);

export type AccountDeletionBlockerCode = typeof AccountDeletionBlockerCode.Type;

/** One reason the account cannot be deleted, with copy the dashboard can show. */
export const AccountDeletionBlocker = Schema.Struct({
  code: AccountDeletionBlockerCode,
  message: Schema.String,
});

export type AccountDeletionBlocker = typeof AccountDeletionBlocker.Type;

/** The tenant that would be torn down with the account. */
export const AccountDeletionTenant = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  memberCount: Schema.Number,
  ownerCount: Schema.Number,
  deviceCount: Schema.Number,
});

export type AccountDeletionTenant = typeof AccountDeletionTenant.Type;

export const AccountDeletionPreview = Schema.Struct({
  /** True only when `blockers` is empty; the API enforces the same checks. */
  canDelete: Schema.Boolean,
  blockers: Schema.Array(AccountDeletionBlocker),
  /**
   * The single tenant inspected by the check. Present whenever the account has
   * exactly one membership, even when a blocker prevents deletion, so the
   * dashboard can show what is at stake and link to the right settings. Absent
   * for multiple tenants or an account with no tenant.
   */
  tenant: Schema.optional(AccountDeletionTenant),
  /** True when no other account exists on the deployment. */
  lastAccount: Schema.Boolean,
});

export type AccountDeletionPreview = typeof AccountDeletionPreview.Type;

export const AccountDeletionResponse = Schema.Struct({
  status: Schema.Literal("ok"),
  /** Tenants torn down in the same operation, in the order they were removed. */
  deletedTenants: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
    }),
  ),
});

export type AccountDeletionResponse = typeof AccountDeletionResponse.Type;

export const AuthUser = AccountInfo;

export const ChangeEmailRequest = Schema.Struct({ newEmail: Schema.String });

export const VerifyEmailChangeRequest = Schema.Struct({ token: Schema.String });

/**
 * Token scopes. Fine-grained permission ids restrict the token to those tenant
 * operations; the legacy `read`/`write` values mean the read catalogue or every
 * permission the account's role allows. Tokens created before scoping was
 * introduced have no stored scopes and stay unrestricted.
 */
export const ApiTokenScope = CredentialScope;

export type ApiTokenScope = CredentialScope;

export const ApiTokenInfo = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  tokenPrefix: Schema.String,
  scopes: Schema.Array(ApiTokenScope),
  /** The canonical permission ceiling; `scopes` keeps the stored spelling. */
  permissions: Schema.Array(Permission),
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
  /**
   * Fine-grained tenant permissions. Takes precedence over `scopes`; a
   * permission that mutates a resource also implies its read companion.
   */
  permissions: Schema.optional(Schema.Array(Permission)),
  /** Restricts the token to a single tenant; omit for all current memberships. */
  tenantId: Schema.optional(NullableString),
});

export const CreateApiTokenResponse = Schema.Struct({ token: Schema.String, item: ApiTokenInfo });

/** A user's consent grant to an OAuth MCP client. */
export const McpConnectionInfo = Schema.Struct({
  id: Schema.String,
  clientId: Schema.String,
  clientName: Schema.String,
  /** Stored grant; legacy connections use `["mcp"]` for full role access. */
  scopes: Schema.Array(Schema.String),
  /** Canonical permission ceiling of the connection. */
  permissions: Schema.Array(Permission),
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

/**
 * The account and tenant shell plus the methods an MCP credential may call.
 *
 * One request gives the MCP gateway both the identity it needs for
 * `list_tenants` and the permission-filtered toolset, without duplicating the
 * membership query behind `/me`.
 */
export const McpContextResponse = Schema.Struct({
  me: MeResponse,
  permissions: Schema.Array(Permission),
  methods: Schema.Array(Schema.String),
});

export type McpContextResponse = typeof McpContextResponse.Type;

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
 * The vocabularies of the sign-in log. They live here so the persistence
 * schema, the recorder and the web panel cannot drift apart.
 *
 * `method` is the primary proof that signed the session in; `factor` is the
 * step that completed it. A passkey sign-in finished with an authenticator
 * recovery code is therefore `passkey` + `recovery`.
 */
export const LOGIN_ATTEMPT_METHODS = ["passkey", "totp", "sso", "recovery", "api-token"] as const;

export const LOGIN_ATTEMPT_FACTORS = ["passkey", "totp", "recovery", "sso"] as const;

export const LOGIN_ATTEMPT_FAILURES = [
  "invalid_code",
  "unknown_account",
  "expired",
  "disabled",
  "mfa_failed",
  "passkey_rejected",
  "sso_rejected",
  "recovery_rejected",
  "rate_limited",
  "not_member",
  "failed",
] as const;

export const LoginAttemptMethod = Schema.Literals(LOGIN_ATTEMPT_METHODS);

export const LoginAttemptFactor = Schema.Literals(LOGIN_ATTEMPT_FACTORS);

export const LoginAttemptFailure = Schema.Literals(LOGIN_ATTEMPT_FAILURES);

export type LoginAttemptMethod = typeof LoginAttemptMethod.Type;

export type LoginAttemptFactor = typeof LoginAttemptFactor.Type;

export type LoginAttemptFailure = typeof LoginAttemptFailure.Type;

/** One row of the account's own login history. */
export const LoginAttemptInfo = Schema.Struct({
  id: Schema.String,
  createdAt: Schema.String,
  success: Schema.Boolean,
  /** Primary proof that signed the session in. */
  method: LoginAttemptMethod,
  /** Step that completed the sign-in; null for a failure. */
  factor: Schema.optional(Schema.NullOr(LoginAttemptFactor)),
  /** Short machine-readable rejection code; null for a successful sign-in. */
  failureReason: Schema.optional(Schema.NullOr(LoginAttemptFailure)),
  /** Approximate network (IPv4 `/24` or IPv6 `/64`), never a host address. */
  ip: Schema.optional(NullableString),
  /** Parsed `User-Agent` family; the header itself is never returned. */
  browser: Schema.optional(NullableString),
  platform: Schema.optional(NullableString),
  deviceType: Schema.optional(NullableString),
});

export type LoginAttemptInfo = typeof LoginAttemptInfo.Type;

export const LoginAttemptsResponse = Schema.Struct({
  attempts: Schema.Array(LoginAttemptInfo),
});

export type LoginAttemptsResponse = typeof LoginAttemptsResponse.Type;

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
