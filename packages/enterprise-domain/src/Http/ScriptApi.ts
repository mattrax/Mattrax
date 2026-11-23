import { CreateScriptRequest } from "../scripts.js";
import { HttpApi } from "effect/http-api";
import { HttpApiEndpoint } from "effect/http-api";
import { HttpApiGroup } from "effect/http-api";
import { HttpApiSchema } from "effect/http-api";
import { PatchScriptAssignmentsRequest } from "../scripts.js";
import { PatchScriptRequest } from "../scripts.js";
import { RunScriptRequest } from "../scripts.js";
import { RunScriptResponse } from "../scripts.js";
import { Schema } from "effect";
import { ScriptAgentResultRequest } from "../scripts.js";
import { ScriptAgentResultResponse } from "../scripts.js";
import { ScriptAgentSyncResponse } from "../scripts.js";
import { ScriptAssignmentsResponse } from "../scripts.js";
import { ScriptDetail } from "../scripts.js";
import { ScriptExecutionsResponse } from "../scripts.js";
import { ScriptListResponse } from "../scripts.js";
import { ScriptSettings } from "../scripts.js";
import { WindowsActivationReportRequest } from "../deviceInventory.js";
import { WindowsActivationReportResponse } from "../deviceInventory.js";
import { EnterpriseAuthRequiredErrors } from "../Errors.js";
import { EnterpriseConditionalWriteErrors } from "../Errors.js";
import { EnterpriseBadRequest } from "../Errors.js";
import { EnterpriseConflict } from "../Errors.js";
import { EnterpriseNotFound } from "../Errors.js";
import { EnterpriseApprovalRequired, EnterpriseStepUpRequired } from "../Errors.js";
import { EnterpriseTenantReadErrors } from "../Errors.js";
import { EnterpriseTenantWriteErrors } from "../Errors.js";
import { TenantIdParam } from "./Params.js";
import { TenantParam } from "./Params.js";

export const scriptApi = HttpApiGroup.make("ScriptApi")
  .add(
    HttpApiEndpoint.get("getScriptSettings", "/v1/tenants/:tenantId/scripts/settings", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: ScriptSettings,
    }),
  )
  .add(
    HttpApiEndpoint.patch("patchScriptSettings", "/v1/tenants/:tenantId/scripts/settings", {
      error: [...EnterpriseTenantWriteErrors, ...EnterpriseStepUpRequired],
      params: TenantParam,
      payload: ScriptSettings,
      success: ScriptSettings,
    }),
  )
  .add(
    HttpApiEndpoint.get("listScripts", "/v1/tenants/:tenantId/scripts", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: ScriptListResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getScript", "/v1/tenants/:tenantId/scripts/:id", {
      error: EnterpriseTenantReadErrors,
      params: TenantIdParam,
      success: ScriptDetail,
    }),
  )
  .add(
    HttpApiEndpoint.post("createScript", "/v1/tenants/:tenantId/scripts", {
      error: [
        ...EnterpriseTenantWriteErrors,
        ...EnterpriseStepUpRequired,
        ...EnterpriseApprovalRequired,
      ],
      params: TenantParam,
      payload: CreateScriptRequest,
      success: Schema.Struct({ id: Schema.String }),
    }),
  )
  .add(
    HttpApiEndpoint.patch("patchScript", "/v1/tenants/:tenantId/scripts/:id", {
      error: [
        ...EnterpriseConditionalWriteErrors,
        ...EnterpriseStepUpRequired,
        ...EnterpriseApprovalRequired,
      ],
      params: TenantIdParam,
      payload: PatchScriptRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteScript", "/v1/tenants/:tenantId/scripts/:id", {
      error: [
        ...EnterpriseTenantWriteErrors,
        ...EnterpriseStepUpRequired,
        ...EnterpriseApprovalRequired,
      ],
      params: TenantIdParam,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.get("getScriptAssignments", "/v1/tenants/:tenantId/scripts/:id/assignments", {
      error: EnterpriseTenantReadErrors,
      params: TenantIdParam,
      success: ScriptAssignmentsResponse,
    }),
  )
  .add(
    HttpApiEndpoint.patch(
      "patchScriptAssignments",
      "/v1/tenants/:tenantId/scripts/:id/assignments",
      {
        error: [
          ...EnterpriseTenantWriteErrors,
          ...EnterpriseStepUpRequired,
          ...EnterpriseApprovalRequired,
        ],
        params: TenantIdParam,
        payload: PatchScriptAssignmentsRequest,
        success: Schema.Struct({ status: Schema.Literal("ok") }),
      },
    ),
  )
  .add(
    HttpApiEndpoint.post("runScript", "/v1/tenants/:tenantId/scripts/:id/run", {
      error: [
        ...EnterpriseTenantWriteErrors,
        ...EnterpriseStepUpRequired,
        ...EnterpriseApprovalRequired,
      ],
      params: TenantIdParam,
      payload: RunScriptRequest,
      success: RunScriptResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("listScriptExecutions", "/v1/tenants/:tenantId/scripts/:id/executions", {
      error: EnterpriseTenantReadErrors,
      params: TenantIdParam,
      query: Schema.Struct({
        deviceId: Schema.optional(Schema.String),
        limit: Schema.optional(Schema.Number),
      }),
      success: ScriptExecutionsResponse,
    }),
  )
  .prefix("/api");

export const scriptHttpApi = HttpApi.make("MattraxScripts").add(scriptApi);

/**
 * Device-facing script channel. Kept out of the browser contract: the agent
 * authenticates with a signed device token instead of a session, and no
 * dashboard call touches these endpoints.
 */
export const scriptAgentApi = HttpApiGroup.make("ScriptAgentApi")
  .add(
    HttpApiEndpoint.get("syncScriptAgent", "/v1/script-agent/scripts", {
      error: EnterpriseAuthRequiredErrors,
      success: ScriptAgentSyncResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("reportScriptAgentResult", "/v1/script-agent/results", {
      error: [
        ...EnterpriseAuthRequiredErrors,
        EnterpriseBadRequest.pipe(HttpApiSchema.status(400)),
        EnterpriseNotFound.pipe(HttpApiSchema.status(404)),
        EnterpriseConflict.pipe(HttpApiSchema.status(409)),
      ],
      payload: ScriptAgentResultRequest,
      success: ScriptAgentResultResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("reportWindowsActivation", "/v1/windows-agent/activation", {
      error: [
        ...EnterpriseAuthRequiredErrors,
        EnterpriseBadRequest.pipe(HttpApiSchema.status(400)),
      ],
      payload: WindowsActivationReportRequest,
      success: WindowsActivationReportResponse,
    }),
  )
  .prefix("/api");

/**
 * The dashboard contract. Each group is exported separately for declaration
 * emit; this value only feeds the generated client.
 */
