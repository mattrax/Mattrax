import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import {
  CreateDeviceViewRequest,
  DeviceViewListResponse,
  PatchDeviceViewRequest,
  SetDefaultDeviceViewRequest,
} from "../Search.js";
import { EnterpriseTenantReadErrors, EnterpriseTenantWriteErrors } from "../Errors.js";
import { TenantDeviceViewParam, TenantParam } from "./Params.js";

const OkResponse = Schema.Struct({ status: Schema.Literal("ok") });

/**
 * Saved device-list views.
 *
 * Kept outside `EnterpriseApi` for the same reason lists, dashboards and
 * scripts are: that group is already at the size the declaration emitter can
 * serialise.
 */
export const enterpriseDeviceViewApi = HttpApiGroup.make("EnterpriseDeviceView")
  .add(
    HttpApiEndpoint.get("listDeviceViews", "/v1/tenants/:tenantId/device-views", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: DeviceViewListResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("createDeviceView", "/v1/tenants/:tenantId/device-views", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: CreateDeviceViewRequest,
      success: Schema.Struct({ id: Schema.String }),
    }),
  )
  .add(
    HttpApiEndpoint.put("setDefaultDeviceView", "/v1/tenants/:tenantId/device-views/default", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: SetDefaultDeviceViewRequest,
      success: OkResponse,
    }),
  )
  .add(
    HttpApiEndpoint.patch("patchDeviceView", "/v1/tenants/:tenantId/device-views/:viewId", {
      error: EnterpriseTenantWriteErrors,
      params: TenantDeviceViewParam,
      payload: PatchDeviceViewRequest,
      success: OkResponse,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteDeviceView", "/v1/tenants/:tenantId/device-views/:viewId", {
      error: EnterpriseTenantWriteErrors,
      params: TenantDeviceViewParam,
      success: OkResponse,
    }),
  )
  .prefix("/api");
