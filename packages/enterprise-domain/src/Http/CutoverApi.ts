import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import { Schema } from "effect";
import {
  CutoverExportRequest,
  CutoverImportRequest,
  CutoverImportResponse,
  CutoverPreflightQuery,
  CutoverPreflightReport,
  CutoverPreview,
  CutoverPreviewRequest,
} from "../Cutover.js";
import {
  EnterpriseApprovalRequired,
  EnterpriseBadRequest,
  EnterpriseConflict,
  EnterpriseStepUpRequired,
  EnterpriseTenantExportErrors,
  EnterpriseTenantImportErrors,
  EnterpriseTenantReadErrors,
} from "../Errors.js";
import { TenantParam } from "./Params.js";

/**
 * Deployment cutover export/import endpoints.
 *
 * Kept out of `EnterpriseApi` because that group is already at the compiler's
 * declaration-emit limit. The URL space is unchanged; only the internal group
 * name differs.
 */
export const enterpriseCutoverApi = HttpApiGroup.make("EnterpriseCutover")
  .add(
    HttpApiEndpoint.post("exportTenantCutover", "/v1/tenants/:tenantId/cutover/export", {
      error: [
        ...EnterpriseTenantExportErrors,
        ...EnterpriseStepUpRequired,
        ...EnterpriseApprovalRequired,
        EnterpriseBadRequest.pipe(HttpApiSchema.status(400)),
        EnterpriseConflict.pipe(HttpApiSchema.status(409)),
      ],
      params: TenantParam,
      payload: CutoverExportRequest,
      success: Schema.String.pipe(
        HttpApiSchema.asText({ contentType: "application/json; charset=utf-8" }),
      ),
    }),
  )
  .add(
    HttpApiEndpoint.post("previewTenantCutover", "/v1/tenants/cutover/preview", {
      error: EnterpriseTenantImportErrors,
      payload: CutoverPreviewRequest,
      success: CutoverPreview,
    }),
  )
  .add(
    HttpApiEndpoint.post("importTenantCutover", "/v1/tenants/cutover/import", {
      error: [...EnterpriseTenantImportErrors, ...EnterpriseStepUpRequired],
      payload: CutoverImportRequest,
      success: CutoverImportResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getTenantCutoverPreflight", "/v1/tenants/:tenantId/cutover/preflight", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      query: CutoverPreflightQuery,
      success: CutoverPreflightReport,
    }),
  )
  .prefix("/api");
