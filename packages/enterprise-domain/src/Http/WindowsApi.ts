import { HttpApiEndpoint } from "effect/http-api";
import { HttpApiGroup } from "effect/http-api";
import { EnterpriseTenantReadErrors } from "../Errors.js";
import { TenantParam } from "./Params.js";
import { WindowsFailureListResponse, WindowsFailureQuery } from "../Device.js";

/**
 * Windows enrollment and management failure history.
 *
 * Kept in its own small group, like attributes and scripts: the main group is
 * already at the declaration emitter's size limit, so even one more response
 * field there fails the build.
 *
 * One endpoint serves both surfaces an operator needs. `deviceId` scopes the
 * history to a device page; omitting it returns the tenant's newest failures,
 * which is how Settings → Delivery shows an enrollment problem for a device
 * that never appeared in the fleet.
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
  .prefix("/api");
