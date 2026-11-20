import { HttpApiEndpoint } from "effect/http-api";
import { HttpApiGroup } from "effect/http-api";
import { EnterpriseTenantReadErrors } from "../Errors.js";
import { UserDetail } from "../User.js";
import { UserListResponse } from "../User.js";
import { TenantParam } from "./Params.js";
import { TenantUserParam } from "./Params.js";

/**
 * Directory-user views.
 *
 * A separate group keeps `EnterpriseApi` (already at the declaration-size
 * limit) unchanged, and reflects that a directory person is a read-only
 * resource: users are imported by directory sync, not created here.
 */
export const enterpriseUserApi = HttpApiGroup.make("EnterpriseUser")
  .add(
    HttpApiEndpoint.get("listUsers", "/v1/tenants/:tenantId/users", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: UserListResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getUser", "/v1/tenants/:tenantId/users/:userId", {
      error: EnterpriseTenantReadErrors,
      params: TenantUserParam,
      success: UserDetail,
    }),
  )
  .prefix("/api");
