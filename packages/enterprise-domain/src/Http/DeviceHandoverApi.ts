import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import { Schema } from "effect";
import {
  EnterpriseDeviceHandoverDownloadErrors,
  EnterpriseDeviceHandoverErrors,
  EnterpriseStepUpRequired,
  EnterpriseTenantValidatedReadErrors,
} from "../Errors.js";
import {
  DeviceHandoverArchiveInfo,
  DeviceHandoverImpactRequest,
  DeviceHandoverImpactResponse,
  DeviceHandoverRequest,
} from "../Device.js";
import { TenantHandoverParam, TenantParam } from "./Params.js";

/**
 * Device handover exports.
 *
 * Kept in its own small group like device views and Windows failures: the main
 * `EnterpriseApi` group is already at the declaration emitter's size limit.
 */
export const enterpriseDeviceHandoverApi = HttpApiGroup.make("EnterpriseDeviceHandover")
  .add(
    HttpApiEndpoint.post("deviceHandoverImpact", "/v1/tenants/:tenantId/devices/handover-impact", {
      // Presence metadata only: which secret kinds deleting these devices would
      // destroy. It is a read, but a POST because the ids travel in the body.
      error: EnterpriseTenantValidatedReadErrors,
      params: TenantParam,
      payload: DeviceHandoverImpactRequest,
      success: DeviceHandoverImpactResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("createDeviceHandover", "/v1/tenants/:tenantId/devices/handover", {
      // Exporting escrowed secrets needs its own permission and a fresh
      // step-up in addition to the mandatory reason in the payload.
      error: [...EnterpriseDeviceHandoverErrors, ...EnterpriseStepUpRequired],
      params: TenantParam,
      payload: DeviceHandoverRequest,
      success: DeviceHandoverArchiveInfo,
    }),
  )
  .add(
    HttpApiEndpoint.get(
      "downloadDeviceHandover",
      "/v1/tenants/:tenantId/devices/handover/:archiveId/download",
      {
        // The signed token in `token` carries the short expiry; the archive row
        // makes the download single-use.
        error: EnterpriseDeviceHandoverDownloadErrors,
        params: TenantHandoverParam,
        query: Schema.Struct({ token: Schema.optional(Schema.String) }),
        success: Schema.String.pipe(
          HttpApiSchema.asText({ contentType: "application/json; charset=utf-8" }),
        ),
      },
    ),
  )
  .prefix("/api");
