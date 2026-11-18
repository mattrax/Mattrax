import { HttpApiEndpoint } from "effect/http-api";
import { HttpApiGroup } from "effect/http-api";
import { HttpApiSchema } from "effect/http-api";
import { Schema } from "effect";
import { StepUpGrantResponse } from "../stepUp.js";
import { StepUpMethods } from "../stepUp.js";
import { StepUpPasskeyStarted } from "../stepUp.js";
import { AccountAuditSearchResponse } from "../Account.js";
import { AccountRecoveryResponse } from "../Account.js";
import { AccountSessionsResponse } from "../Account.js";
import { ApiTokenParam } from "./Params.js";
import { ApiTokensResponse } from "../Account.js";
import { AuditExportQuery } from "../Audit.js";
import { AuditSearchQuery } from "../Audit.js";
import { BeginRegistrationVerificationRequest } from "../Account.js";
import { BeginRegistrationVerificationResponse } from "../Account.js";
import { BootstrapResponse } from "../Tenant.js";
import { ChangeEmailRequest } from "../Account.js";
import { CompleteRegistrationVerificationRequest } from "../Account.js";
import { CompleteRegistrationVerificationResponse } from "../Account.js";
import { CreateApiTokenRequest } from "../Account.js";
import { CreateApiTokenResponse } from "../Account.js";
import { EmailVerificationResponse } from "../Account.js";
import { EnterpriseAuthRequiredErrors } from "../Errors.js";
import { EnterpriseBadRequest } from "../Errors.js";
import { EnterpriseConflict } from "../Errors.js";
import { EnterpriseDbErrors } from "../Errors.js";
import { EnterpriseForbidden } from "../Errors.js";
import { EnterpriseInternal } from "../Errors.js";
import { EnterpriseNotFound } from "../Errors.js";
import { EnterprisePublicEmailErrors } from "../Errors.js";
import { EnterpriseStepUpErrors } from "../Errors.js";
import { EnterpriseStepUpFactorErrors } from "../Errors.js";
import { EnterpriseStepUpRequired } from "../Errors.js";
import { EnterpriseTenantReadErrors } from "../Errors.js";
import { McpActivityRequest } from "../Account.js";
import { McpConnectionParam } from "./Params.js";
import { McpConnectionsResponse } from "../Account.js";
import { McpContextResponse } from "../Account.js";
import { RequestAccountRecovery } from "../Account.js";
import { StepUpActionSchema } from "../Errors.js";
import { TenantParam } from "./Params.js";
import { UpdateMeRequest } from "../Account.js";
import { VerifyAccountRecoveryRequest } from "../Account.js";
import { VerifyEmailChangeRequest } from "../Account.js";
import { VerifyEmailRequest } from "../Account.js";
import { EnterpriseAccountErrors } from "../Errors.js";
import { MeResponse } from "../Tenant.js";

export const enterpriseAccountApi = HttpApiGroup.make("EnterpriseAccount")
  .add(
    HttpApiEndpoint.post("requestEmailVerification", "/v1/account/email-verification", {
      error: EnterpriseAccountErrors,
      success: EmailVerificationResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("requestRegistrationCode", "/v1/register/verification", {
      error: EnterprisePublicEmailErrors,
      payload: BeginRegistrationVerificationRequest,
      success: BeginRegistrationVerificationResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("verifyRegistrationCode", "/v1/register/verification/verify", {
      error: EnterprisePublicEmailErrors,
      payload: CompleteRegistrationVerificationRequest,
      success: CompleteRegistrationVerificationResponse,
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
      error: [...EnterpriseAccountErrors, EnterpriseConflict.pipe(HttpApiSchema.status(409))],
      payload: VerifyEmailChangeRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.get("listApiTokens", "/v1/account/api-tokens", {
      error: EnterpriseAccountErrors,
      success: ApiTokensResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getMcpContext", "/v1/mcp/context", {
      error: EnterpriseAccountErrors,
      success: McpContextResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("listMcpConnections", "/v1/account/mcp-connections", {
      error: EnterpriseAccountErrors,
      success: McpConnectionsResponse,
    }),
  )
  .add(
    HttpApiEndpoint.delete("revokeMcpConnection", "/v1/account/mcp-connections/:connectionId", {
      error: EnterpriseAccountErrors,
      params: McpConnectionParam,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.post("recordMcpActivity", "/v1/tenants/:tenantId/mcp/activity", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      payload: McpActivityRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.get("stepUpMethods", "/v1/account/step-up", {
      error: EnterpriseAccountErrors,
      success: StepUpMethods,
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
        EnterpriseForbidden.pipe(HttpApiSchema.status(403)),
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
      error: EnterpriseAccountErrors,
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
    HttpApiEndpoint.post("revokeAllAccountSessions", "/v1/account/sessions/revoke-all", {
      error: EnterpriseStepUpErrors,
      success: Schema.Struct({ status: Schema.Literal("ok"), revoked: Schema.Number }),
    }),
  )
  .add(
    HttpApiEndpoint.get("searchAccountAuditLog", "/v1/account/audit/search", {
      error: EnterpriseAccountErrors,
      query: AuditSearchQuery,
      success: AccountAuditSearchResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("exportAccountAuditLog", "/v1/account/audit/export", {
      error: EnterpriseAccountErrors,
      query: AuditExportQuery,
      success: Schema.String.pipe(HttpApiSchema.asText({ contentType: "text/csv; charset=utf-8" })),
    }),
  )
  .add(
    HttpApiEndpoint.post("requestAccountRecovery", "/v1/account/recovery", {
      error: [
        ...EnterpriseDbErrors,
        EnterpriseInternal.pipe(HttpApiSchema.status(500)),
        EnterpriseBadRequest.pipe(HttpApiSchema.status(400)),
      ],
      payload: RequestAccountRecovery,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.post("verifyAccountRecovery", "/v1/account/recovery/verify", {
      error: [
        ...EnterpriseDbErrors,
        EnterpriseInternal.pipe(HttpApiSchema.status(500)),
        EnterpriseBadRequest.pipe(HttpApiSchema.status(400)),
      ],
      payload: VerifyAccountRecoveryRequest,
      success: AccountRecoveryResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("cancelEmailChange", "/v1/account/email-change/cancel", {
      error: [
        ...EnterpriseDbErrors,
        EnterpriseInternal.pipe(HttpApiSchema.status(500)),
        EnterpriseBadRequest.pipe(HttpApiSchema.status(400)),
      ],
      payload: VerifyEmailChangeRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.get("me", "/v1/me", {
      error: EnterpriseAccountErrors,
      success: MeResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("bootstrap", "/v1/bootstrap", {
      error: EnterpriseAccountErrors,
      success: BootstrapResponse,
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
  .prefix("/api");
