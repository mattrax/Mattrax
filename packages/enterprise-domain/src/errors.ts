/**
 * Internal diagnostics for backend errors.
 *
 * API responses deliberately carry only a stable tag and message. Operators
 * need the rest: a stable code, the offending field, the upstream reason and
 * structured context for logs. Diagnostics live in a WeakMap so adding detail
 * to a backend error never widens its serialized client shape.
 */
export const ENTERPRISE_ERROR_CODES = [
  "unauthorized",
  "forbidden",
  "not_found",
  "validation",
  "conflict",
  "rate_limited",
  "not_configured",
  "upstream_error",
  "storage_error",
  "database_error",
  "internal_error",
  "tenant_has_members",
  "last_tenant_user",
  "step_up_required",
  "step_up_unavailable",
  "invitation_expired",
  "slug_taken",
  "token_scope",
  "mcp_connection_revoked",
  "mcp_account_scope",
  "sso_not_configured",
  "sso_tenant_missing",
  "sso_disabled",
  "sso_state_mismatch",
  "oauth_invalid_client",
  "oauth_invalid_grant",
  "oauth_invalid_redirect",
] as const;

export type EnterpriseErrorCode = (typeof ENTERPRISE_ERROR_CODES)[number];

export type EnterpriseErrorDiagnostic = {
  readonly code?: EnterpriseErrorCode;
  /** Form field that caused a validation failure. */
  readonly field?: string;
  /** Stable machine-readable reason when a code is too broad. */
  readonly reason?: string;
  readonly resource?: string;
  readonly resourceId?: string;
  readonly retryable?: boolean;
  /** JSON-serializable context for backend logs; never sent to clients. */
  readonly details?: Record<string, unknown>;
};

const diagnostics = new WeakMap<object, EnterpriseErrorDiagnostic>();

/** Attach operational detail to an error without changing its wire shape. */
export const diagnoseError = <E extends object>(
  error: E,
  diagnostic: EnterpriseErrorDiagnostic,
): E => {
  diagnostics.set(error, diagnostic);
  return error;
};

export const errorDiagnostic = (error: unknown): EnterpriseErrorDiagnostic | undefined =>
  typeof error === "object" && error !== null ? diagnostics.get(error) : undefined;

export const defaultErrorCode = (tag: string): EnterpriseErrorCode | undefined => {
  switch (tag) {
    case "EnterpriseUnauthorized":
      return "unauthorized";
    case "EnterpriseForbidden":
      return "forbidden";
    case "EnterpriseNotFound":
      return "not_found";
    case "EnterpriseBadRequest":
      return "validation";
    case "EnterpriseConflict":
      return "conflict";
    case "EnterpriseNotConfigured":
      return "not_configured";
    case "EnterpriseUpstreamError":
      return "upstream_error";
    case "EnterpriseR2FileNotFound":
      return "not_found";
    case "EnterpriseR2InternalError":
      return "storage_error";
    case "EnterpriseDbError":
      return "database_error";
    case "EnterpriseInternal":
      return "internal_error";
    case "EnterpriseTenantHasMembers":
      return "tenant_has_members";
    case "EnterpriseLastTenantUser":
      return "last_tenant_user";
    case "StepUpRequired":
      return "step_up_required";
    case "StepUpUnavailable":
      return "step_up_unavailable";
    case "EnterpriseStripeError":
      return "upstream_error";
    default:
      return undefined;
  }
};
