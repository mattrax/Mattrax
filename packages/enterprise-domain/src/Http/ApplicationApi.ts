import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { ApplicationInstallResult, ApplicationUninstallResult } from "../Application.js";
import { EnterpriseTenantWriteErrors } from "../Errors.js";
import {
  DownloadPolicyApplicationResponse,
  EnterpriseApplicationDownloadErrors,
  EnterpriseApplicationUploadErrors,
  PolicyApplicationObject,
  UploadPolicyApplicationRequest,
} from "../Policy.js";
import { TenantIdParam } from "./Params.js";

/**
 * Catalogue delivery actions kept out of `EnterpriseApi`.
 *
 * That group is already at the compiler's declaration-emit size limit; adding
 * another endpoint to it fails to serialise. These endpoints form a coherent
 * group of their own and share one generated client entry.
 */
export const enterpriseApplicationApi = HttpApiGroup.make("EnterpriseApplication")
  .add(
    HttpApiEndpoint.post("installApplication", "/v1/tenants/:tenantId/applications/:id/install", {
      error: EnterpriseTenantWriteErrors,
      params: TenantIdParam,
      success: ApplicationInstallResult,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "uninstallApplication",
      "/v1/tenants/:tenantId/applications/:id/uninstall",
      {
        error: EnterpriseTenantWriteErrors,
        params: TenantIdParam,
        success: ApplicationUninstallResult,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post("uploadApplication", "/v1/tenants/:tenantId/applications/:id/upload", {
      error: EnterpriseApplicationUploadErrors,
      params: TenantIdParam,
      payload: UploadPolicyApplicationRequest,
      success: PolicyApplicationObject,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "uploadApplicationInstaller",
      "/v1/tenants/:tenantId/applications/:id/installers/:installerId/upload",
      {
        error: EnterpriseApplicationUploadErrors,
        params: Schema.Struct({
          tenantId: Schema.String,
          id: Schema.String,
          installerId: Schema.String,
        }),
        payload: UploadPolicyApplicationRequest,
        success: PolicyApplicationObject,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get(
      "downloadApplicationInstaller",
      "/v1/tenants/:tenantId/applications/:id/installers/:installerId/download/:sha256",
      {
        error: EnterpriseApplicationDownloadErrors,
        params: Schema.Struct({
          tenantId: Schema.String,
          id: Schema.String,
          installerId: Schema.String,
          sha256: Schema.String,
        }),
        success: DownloadPolicyApplicationResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get(
      "downloadApplication",
      "/v1/tenants/:tenantId/applications/:id/download/:sha256",
      {
        error: EnterpriseApplicationDownloadErrors,
        params: Schema.Struct({
          tenantId: Schema.String,
          id: Schema.String,
          sha256: Schema.String,
        }),
        success: DownloadPolicyApplicationResponse,
      },
    ),
  );
