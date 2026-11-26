import { HttpApiEndpoint } from "effect/http-api";
import { HttpApiGroup } from "effect/http-api";
import { HttpApiSchema } from "effect/http-api";
import { Schema } from "effect";

const NO_STORE = { "cache-control": Schema.Literal("no-store") } as const;

/** A reveal can fail because the deployment or Microsoft Graph is unavailable. */
const WINDOWS_REVEAL_ERRORS = [
  ...EnterpriseTenantWriteErrors,
  ...EnterpriseStepUpRequired,
  EnterpriseNotConfigured.pipe(HttpApiSchema.status(503)),
  EnterpriseUpstreamError.pipe(HttpApiSchema.status(502)),
  EnterpriseInternal.pipe(HttpApiSchema.status(500)),
] as const;

/** Diagnostic downloads read R2 and validate the short-lived token. */
const WINDOWS_DIAGNOSTICS_DOWNLOAD_ERRORS = [
  ...EnterpriseTenantReadErrors,
  EnterpriseBadRequest.pipe(HttpApiSchema.status(400)),
  EnterpriseR2FileNotFound.pipe(HttpApiSchema.status(404)),
  EnterpriseR2InternalError.pipe(HttpApiSchema.status(500)),
] as const;
import {
  EnterpriseBadRequest,
  EnterpriseInternal,
  EnterpriseNotConfigured,
  EnterpriseR2FileNotFound,
  EnterpriseR2InternalError,
  EnterpriseTenantReadErrors,
  EnterpriseTenantWriteErrors,
  EnterpriseUpstreamError,
} from "../Errors.js";
import { EnterpriseStepUpRequired } from "../Errors.js";
import {
  DeviceBitlockerKeyRevealResponse,
  DeviceDiagnosticsResponse,
  DeviceLapsPasswordResponse,
  DeviceWindowsSecurityResponse,
  DeviceWindowsSecurityQuery,
} from "../windowsSecurity.js";
import {
  TenantBitlockerKeyParam,
  TenantDiagnosticsParam,
  TenantIdParam,
  TenantParam,
} from "./Params.js";
import { WindowsFailureListResponse, WindowsFailureQuery } from "../Device.js";

/**
 * Windows device management reads and privileged reveals.
 *
 * Kept in its own small group like handover and device views: the main
 * `EnterpriseApi` group is already at the declaration emitter's size limit.
 */
export const enterpriseWindowsApi = HttpApiGroup.make("EnterpriseWindows")
  .add(
    HttpApiEndpoint.get("listWindowsFailures", "/v1/tenants/:tenantId/windows/failures", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      query: WindowsFailureQuery,
      success: WindowsFailureListResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get(
      "getDeviceWindowsSecurity",
      "/v1/tenants/:tenantId/devices/:id/windows-security",
      {
        error: EnterpriseTenantReadErrors,
        params: TenantIdParam,
        success: DeviceWindowsSecurityResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get(
      "getDeviceLapsPassword",
      "/v1/tenants/:tenantId/devices/:id/laps-password",
      {
        // Reading the local administrator password is as privileged as a
        // FileVault key: dedicated permission, fresh step-up and audit.
        error: WINDOWS_REVEAL_ERRORS,
        params: TenantIdParam,
        query: DeviceWindowsSecurityQuery,
        success: HttpApiSchema.WithHeaders(DeviceLapsPasswordResponse, NO_STORE),
      },
    ),
  )
  .add(
    HttpApiEndpoint.get(
      "revealDeviceBitlockerKey",
      "/v1/tenants/:tenantId/devices/:id/bitlocker-keys/:keyId/reveal",
      {
        // The reason is mandatory on the server; the UI also asks for it.
        error: WINDOWS_REVEAL_ERRORS,
        params: TenantBitlockerKeyParam,
        query: DeviceWindowsSecurityQuery,
        success: HttpApiSchema.WithHeaders(DeviceBitlockerKeyRevealResponse, NO_STORE),
      },
    ),
  )
  .add(
    HttpApiEndpoint.get("listDeviceDiagnostics", "/v1/tenants/:tenantId/devices/:id/diagnostics", {
      error: EnterpriseTenantReadErrors,
      params: TenantIdParam,
      success: DeviceDiagnosticsResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get(
      "downloadDeviceDiagnostics",
      "/v1/tenants/:tenantId/devices/:id/diagnostics/:archiveId/download",
      {
        // The signed query token carries the short expiry; the handler also
        // re-checks tenant membership and the archive's own deadline.
        error: WINDOWS_DIAGNOSTICS_DOWNLOAD_ERRORS,
        params: TenantDiagnosticsParam,
        query: Schema.Struct({ token: Schema.optional(Schema.String) }),
        success: HttpApiSchema.WithHeaders(
          Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array({ contentType: "application/zip" })),
          NO_STORE,
        ),
      },
    ),
  )
  .prefix("/api");
