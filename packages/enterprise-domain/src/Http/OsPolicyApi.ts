import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import {
  EnterpriseStepUpRequired,
  EnterpriseTenantReadErrors,
  EnterpriseTenantWriteErrors,
} from "../Errors.js";
import {
  OsFleetResponse,
  TenantOsPolicyResponse,
  UpdateTenantOsPolicyRequest,
} from "../osPolicy.js";
import { TenantParam } from "./Params.js";

/**
 * Tenant OS update policy and the fleet compliance view.
 *
 * Kept in its own API group for the same reason as the macOS update summary:
 * the main `EnterpriseApi` group is at the compiler's declaration-size limit,
 * and adding three endpoints there makes the generated client type unnameable.
 */
export const enterpriseOsPolicyApi = HttpApiGroup.make("EnterpriseOsPolicy")
  .add(
    HttpApiEndpoint.get("getTenantOsPolicy", "/v1/tenants/:tenantId/os-policy", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: TenantOsPolicyResponse,
    }),
  )
  .add(
    HttpApiEndpoint.patch("patchTenantOsPolicy", "/v1/tenants/:tenantId/os-policy", {
      // Changing an enforcement rule can queue commands on every device in a
      // platform, so it uses the same step-up as a device command.
      error: [...EnterpriseTenantWriteErrors, ...EnterpriseStepUpRequired],
      params: TenantParam,
      payload: UpdateTenantOsPolicyRequest,
      success: TenantOsPolicyResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getOsFleet", "/v1/tenants/:tenantId/os-versions", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: OsFleetResponse,
    }),
  );
