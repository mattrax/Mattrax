import { HttpApiSchema } from "effect/http-api";
import { STEP_UP_ACTIONS } from "./stepUp.js";
import { Schema } from "effect";
import { StepUpRequired } from "./stepUp.js";
import { StepUpUnavailable } from "./stepUp.js";

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

/** A tenant member's RBAC role does not grant the endpoint's permission. */
export class EnterprisePermissionDenied extends Schema.TaggedError<EnterprisePermissionDenied>()(
  "EnterprisePermissionDenied",
  {
    message: Schema.String,
    permission: Schema.String,
    roleName: Schema.String,
    roleKind: Schema.Literals(["built-in", "custom"]),
  },
) {}

export class EnterpriseConflict extends Schema.TaggedError<EnterpriseConflict>()(
  "EnterpriseConflict",
  {
    message: Schema.String,
  },
) {}

/**
 * The record a guarded mutation was based on, sent with a 412 so the client
 * can say what changed without a second request. `record` carries the
 * endpoint's current representation when it has one; the summary fields are
 * always present.
 */
export const PreconditionCurrent = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  updatedAt: Schema.String,
  record: Schema.optional(Schema.Json),
});

export type PreconditionCurrent = typeof PreconditionCurrent.Type;

/**
 * Optimistic concurrency failed: the client's `expectedUpdatedAt` (or
 * `If-Unmodified-Since`) no longer matches the stored row. Nothing was
 * written; the client should re-read before retrying.
 */
export class EnterprisePreconditionFailed extends Schema.TaggedError<EnterprisePreconditionFailed>()(
  "EnterprisePreconditionFailed",
  {
    message: Schema.String,
    expectedUpdatedAt: Schema.optional(Schema.String),
    current: PreconditionCurrent,
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

/**
 * A teardown step could not finish, so the tenant was left in place for a
 * retry rather than half-deleted. `step` names the reclamation that failed.
 */
export class EnterpriseTenantTeardownFailed extends Schema.TaggedError<EnterpriseTenantTeardownFailed>()(
  "EnterpriseTenantTeardownFailed",
  {
    message: Schema.String,
    step: Schema.String,
  },
) {}

export class EnterpriseLastTenantAccount extends Schema.TaggedError<EnterpriseLastTenantAccount>()(
  "EnterpriseLastTenantAccount",
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

/**
 * A failure that was not individually modelled by an endpoint. The backend
 * logs the original cause; clients get a stable, serializable fallback instead
 * of an empty 500 response.
 */
export class EnterpriseInternal extends Schema.TaggedError<EnterpriseInternal>()(
  "EnterpriseInternal",
  {
    message: Schema.String,
  },
) {}

export const EnterpriseAuthRequiredErrors = [
  EnterpriseUnauthorized.pipe(HttpApiSchema.status(401)),
  // Every authenticated endpoint maps unexpected failures to this typed 500.
  EnterpriseInternal.pipe(HttpApiSchema.status(500)),
] as const;

export const EnterpriseDbErrors = [EnterpriseDbError.pipe(HttpApiSchema.status(500))] as const;

export const EnterpriseTenantReadErrors = [
  ...EnterpriseAuthRequiredErrors,
  ...EnterpriseDbErrors,
  EnterpriseNotFound.pipe(HttpApiSchema.status(404)),
  // Tenant policy can deny reads, for example when MFA enrollment is required.
  EnterpriseForbidden.pipe(HttpApiSchema.status(403)),
  EnterprisePermissionDenied.pipe(HttpApiSchema.status(403)),
] as const;

/** Read endpoints that validate user input (filters, cursors) can return 400. */
export const EnterpriseTenantValidatedReadErrors = [
  ...EnterpriseTenantReadErrors,
  EnterpriseBadRequest.pipe(HttpApiSchema.status(400)),
] as const;

export const EnterpriseTenantWriteErrors = [
  ...EnterpriseTenantReadErrors,
  EnterpriseForbidden.pipe(HttpApiSchema.status(403)),
  EnterpriseConflict.pipe(HttpApiSchema.status(409)),
  EnterpriseBadRequest.pipe(HttpApiSchema.status(400)),
] as const;

/** A guarded mutation was based on a version someone else has replaced. */
export const EnterprisePreconditionErrors = [
  EnterprisePreconditionFailed.pipe(HttpApiSchema.status(412)),
] as const;

/**
 * Write errors for endpoints that support optimistic concurrency. Only the
 * guarded endpoints declare 412; mutations that cannot lose data keep the
 * narrower write set.
 */
export const EnterpriseConditionalWriteErrors = [
  ...EnterpriseTenantWriteErrors,
  ...EnterprisePreconditionErrors,
] as const;

export const EnterpriseTenantDeleteErrors = [
  ...EnterpriseTenantWriteErrors,
  EnterpriseTenantHasMembers.pipe(HttpApiSchema.status(409)),
  // A failed reclamation keeps the tenant so the operator can retry.
  EnterpriseTenantTeardownFailed.pipe(HttpApiSchema.status(409)),
] as const;

export const EnterpriseBackupWriteErrors = [
  ...EnterpriseTenantWriteErrors,
  EnterpriseR2InternalError.pipe(HttpApiSchema.status(500)),
] as const;

export const EnterpriseTenantAccountRemoveErrors = [
  ...EnterpriseTenantWriteErrors,
  EnterpriseLastTenantAccount.pipe(HttpApiSchema.status(409)),
] as const;

export const EnterprisePolicyApplicationUploadErrors = [
  ...EnterpriseTenantWriteErrors,
  EnterpriseR2InternalError.pipe(HttpApiSchema.status(500)),
] as const;

export const EnterprisePolicyApplicationDownloadErrors = [
  ...EnterpriseTenantReadErrors,
  EnterpriseR2FileNotFound.pipe(HttpApiSchema.status(404)),
  EnterpriseR2InternalError.pipe(HttpApiSchema.status(500)),
] as const;

export const EnterpriseBillingPortalErrors = [
  ...EnterpriseTenantWriteErrors,
  EnterpriseStripeError.pipe(HttpApiSchema.status(502)),
] as const;

/** Billing reads call Stripe too, so an outage is a typed 502, not a 500. */
export const EnterpriseBillingReadErrors = [
  ...EnterpriseTenantReadErrors,
  EnterpriseStripeError.pipe(HttpApiSchema.status(502)),
] as const;

export const EnterpriseTenantExportErrors = [
  ...EnterpriseTenantReadErrors,
  EnterpriseForbidden.pipe(HttpApiSchema.status(403)),
] as const;

export const EnterpriseTenantBackupDownloadErrors = [
  ...EnterpriseTenantReadErrors,
  EnterpriseR2FileNotFound.pipe(HttpApiSchema.status(404)),
  EnterpriseR2InternalError.pipe(HttpApiSchema.status(500)),
] as const;

export const EnterpriseTenantImportErrors = [
  ...EnterpriseAuthRequiredErrors,
  ...EnterpriseDbErrors,
  EnterpriseBadRequest.pipe(HttpApiSchema.status(400)),
  EnterpriseForbidden.pipe(HttpApiSchema.status(403)),
  EnterpriseConflict.pipe(HttpApiSchema.status(409)),
] as const;

export const EnterpriseApnsErrors = [...EnterpriseTenantWriteErrors] as const;

export const EnterpriseApplicationErrors = [...EnterpriseTenantWriteErrors] as const;

export const EnterpriseSsoErrors = [...EnterpriseTenantWriteErrors] as const;

export const EnterpriseAndroidReadErrors = [
  ...EnterpriseTenantReadErrors,
  EnterpriseNotConfigured.pipe(HttpApiSchema.status(503)),
  EnterpriseUpstreamError.pipe(HttpApiSchema.status(502)),
] as const;

export const EnterpriseAndroidErrors = [
  ...EnterpriseTenantWriteErrors,
  EnterpriseNotConfigured.pipe(HttpApiSchema.status(503)),
  EnterpriseUpstreamError.pipe(HttpApiSchema.status(502)),
] as const;

export const EnterpriseAppleReadErrors = [
  ...EnterpriseTenantReadErrors,
  EnterpriseNotConfigured.pipe(HttpApiSchema.status(503)),
  EnterpriseUpstreamError.pipe(HttpApiSchema.status(502)),
] as const;

export const EnterpriseAppleWriteErrors = [
  ...EnterpriseTenantWriteErrors,
  EnterpriseNotConfigured.pipe(HttpApiSchema.status(503)),
  EnterpriseUpstreamError.pipe(HttpApiSchema.status(502)),
] as const;

export const EnterpriseNoDomainErrors = [
  ...EnterpriseDbErrors,
  EnterpriseInternal.pipe(HttpApiSchema.status(500)),
] as const;

export const EnterpriseAccountErrors = [
  ...EnterpriseAuthRequiredErrors,
  ...EnterpriseDbErrors,
  EnterpriseBadRequest.pipe(HttpApiSchema.status(400)),
  EnterpriseForbidden.pipe(HttpApiSchema.status(403)),
  EnterpriseNotFound.pipe(HttpApiSchema.status(404)),
] as const;

/** Sensitive account/tenant actions also require a recent step-up. */
export const EnterpriseStepUpRequired = [StepUpRequired.pipe(HttpApiSchema.status(403))] as const;

export const EnterpriseAutopilotReadErrors = [
  ...EnterpriseTenantReadErrors,
  EnterpriseNotConfigured.pipe(HttpApiSchema.status(503)),
  EnterpriseUpstreamError.pipe(HttpApiSchema.status(502)),
] as const;

export const EnterpriseAutopilotWriteErrors = [
  ...EnterpriseTenantWriteErrors,
  EnterpriseNotConfigured.pipe(HttpApiSchema.status(503)),
  EnterpriseUpstreamError.pipe(HttpApiSchema.status(502)),
] as const;

export const EnterpriseStepUpErrors = [
  ...EnterpriseAccountErrors,
  ...EnterpriseStepUpRequired,
] as const;

export const EnterpriseStepUpFactorErrors = [
  ...EnterpriseStepUpErrors,
  StepUpUnavailable.pipe(HttpApiSchema.status(400)),
] as const;

export const StepUpActionSchema = Schema.Literals(STEP_UP_ACTIONS);

export const EnterprisePublicEmailErrors = [
  ...EnterpriseAuthRequiredErrors,
  ...EnterpriseDbErrors,
  EnterpriseForbidden.pipe(HttpApiSchema.status(403)),
  EnterpriseNotFound.pipe(HttpApiSchema.status(404)),
  EnterpriseBadRequest.pipe(HttpApiSchema.status(400)),
  // A deployment with no mail transport, or a broken one, fails here rather
  // than surfacing as an undeclared handler error (HTTP 500).
  EnterpriseNotConfigured.pipe(HttpApiSchema.status(503)),
] as const;

export const EnterprisePublicNotFoundErrors = [
  ...EnterpriseDbErrors,
  EnterpriseInternal.pipe(HttpApiSchema.status(500)),
  EnterpriseNotFound.pipe(HttpApiSchema.status(404)),
] as const;

export const EnterprisePublicEnrollmentProfileErrors = [
  ...EnterprisePublicNotFoundErrors,
  EnterpriseBadRequest.pipe(HttpApiSchema.status(400)),
  EnterpriseForbidden.pipe(HttpApiSchema.status(403)),
] as const;

export const EnterprisePublicAdeProfileErrors = [
  ...EnterprisePublicEnrollmentProfileErrors,
  EnterpriseNotConfigured.pipe(HttpApiSchema.status(503)),
  EnterpriseUpstreamError.pipe(HttpApiSchema.status(502)),
] as const;

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
  "precondition_failed",
  "rate_limited",
  "not_configured",
  "upstream_error",
  "storage_error",
  "database_error",
  "internal_error",
  "tenant_has_members",
  "teardown_failed",
  "last_tenant_account",
  "step_up_required",
  "step_up_unavailable",
  "invitation_expired",
  "slug_taken",
  "token_scope",
  "mcp_connection_revoked",
  "mcp_account_scope",
  "csrf",
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
  readonly details?: Schema.JsonObject;
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

/** Only object values can key the diagnostics WeakMap; primitives never carry one. */
const isDiagnosticCarrier = <Value>(value: Value): value is Value & object =>
  typeof value === "object" && value !== null;

export const errorDiagnostic = <Value>(error: Value): EnterpriseErrorDiagnostic | undefined =>
  isDiagnosticCarrier(error) ? diagnostics.get(error) : undefined;

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
    case "EnterprisePreconditionFailed":
      return "precondition_failed";
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
    case "EnterpriseLastTenantAccount":
      return "last_tenant_account";
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
