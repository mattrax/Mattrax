import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import {
  CreateRestrictedSoftwareRequest,
  DeviceRestrictedSoftwareResponse,
  PatchRestrictedSoftwareAssignmentsRequest,
  PatchRestrictedSoftwareRequest,
  RestrictedSoftwareAgentResultRequest,
  RestrictedSoftwareAgentResultResponse,
  RestrictedSoftwareDetail,
  RestrictedSoftwareListResponse,
  RestrictedSoftwareViolationsResponse,
} from "../restrictedSoftware.js";
import {
  EnterpriseAuthRequiredErrors,
  EnterpriseBadRequest,
  EnterpriseConditionalWriteErrors,
  EnterpriseConflict,
  EnterpriseNotFound,
  EnterpriseStepUpRequired,
  EnterpriseTenantReadErrors,
  EnterpriseTenantWriteErrors,
} from "../Errors.js";
import { TenantIdParam, TenantParam } from "./Params.js";

/**
 * Tenant configuration surface for restricted software.
 *
 * Kept in its own `HttpApi` (like scripts) so the generated client type for
 * the main contract stays within TypeScript's declaration-size limit.
 */
export const restrictedSoftwareApi = HttpApiGroup.make("RestrictedSoftwareApi")
  .add(
    HttpApiEndpoint.get("listRestrictedSoftware", "/v1/tenants/:tenantId/restricted-software", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: RestrictedSoftwareListResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("createRestrictedSoftware", "/v1/tenants/:tenantId/restricted-software", {
      error: [...EnterpriseTenantWriteErrors, ...EnterpriseStepUpRequired],
      params: TenantParam,
      payload: CreateRestrictedSoftwareRequest,
      success: Schema.Struct({ id: Schema.String }),
    }),
  )
  .add(
    HttpApiEndpoint.get("getRestrictedSoftware", "/v1/tenants/:tenantId/restricted-software/:id", {
      error: EnterpriseTenantReadErrors,
      params: TenantIdParam,
      success: RestrictedSoftwareDetail,
    }),
  )
  .add(
    HttpApiEndpoint.patch(
      "patchRestrictedSoftware",
      "/v1/tenants/:tenantId/restricted-software/:id",
      {
        error: [...EnterpriseConditionalWriteErrors, ...EnterpriseStepUpRequired],
        params: TenantIdParam,
        payload: PatchRestrictedSoftwareRequest,
        success: Schema.Struct({ status: Schema.Literal("ok") }),
      },
    ),
  )
  .add(
    HttpApiEndpoint.delete(
      "deleteRestrictedSoftware",
      "/v1/tenants/:tenantId/restricted-software/:id",
      {
        error: [...EnterpriseTenantWriteErrors, ...EnterpriseStepUpRequired],
        params: TenantIdParam,
        success: Schema.Struct({ status: Schema.Literal("ok") }),
      },
    ),
  )
  .add(
    HttpApiEndpoint.patch(
      "patchRestrictedSoftwareAssignments",
      "/v1/tenants/:tenantId/restricted-software/:id/assignments",
      {
        error: [...EnterpriseTenantWriteErrors, ...EnterpriseStepUpRequired],
        params: TenantIdParam,
        payload: PatchRestrictedSoftwareAssignmentsRequest,
        success: Schema.Struct({ status: Schema.Literal("ok") }),
      },
    ),
  )
  .add(
    HttpApiEndpoint.get(
      "listRestrictedSoftwareViolations",
      "/v1/tenants/:tenantId/restricted-software-violations",
      {
        error: EnterpriseTenantReadErrors,
        params: TenantParam,
        query: Schema.Struct({
          status: Schema.optional(Schema.Literals(["open", "resolved"])),
          platform: Schema.optional(Schema.Literals(["apple", "win", "android"])),
          ruleId: Schema.optional(Schema.String),
          limit: Schema.optional(Schema.Number),
        }),
        success: RestrictedSoftwareViolationsResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get(
      "getDeviceRestrictedSoftware",
      "/v1/tenants/:tenantId/devices/:id/restricted-software",
      {
        error: EnterpriseTenantReadErrors,
        params: TenantIdParam,
        success: DeviceRestrictedSoftwareResponse,
      },
    ),
  )
  .prefix("/api");

export const restrictedSoftwareHttpApi = HttpApi.make("MattraxRestrictedSoftware").add(
  restrictedSoftwareApi,
);

/**
 * Device-facing enforcement channel. The bearer token is the signed agent
 * token from the script channel, so a device can only report for itself.
 */
export const restrictedSoftwareAgentApi = HttpApiGroup.make("RestrictedSoftwareAgentApi")
  .add(
    HttpApiEndpoint.post(
      "reportRestrictedSoftwareAgentResult",
      "/v1/restricted-software-agent/results",
      {
        error: [
          ...EnterpriseAuthRequiredErrors,
          EnterpriseBadRequest.pipe(HttpApiSchema.status(400)),
          EnterpriseNotFound.pipe(HttpApiSchema.status(404)),
          EnterpriseConflict.pipe(HttpApiSchema.status(409)),
        ],
        payload: RestrictedSoftwareAgentResultRequest,
        success: RestrictedSoftwareAgentResultResponse,
      },
    ),
  )
  .prefix("/api");
