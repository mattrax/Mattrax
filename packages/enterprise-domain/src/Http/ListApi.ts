import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { EnterpriseTenantReadErrors } from "../Errors.js";
import { TenantParam } from "./Params.js";
import { GroupSearchQuery } from "../Search.js";
import { GroupSearchResponse } from "../Search.js";
import { PolicySearchQuery } from "../Search.js";
import { PolicySearchResponse } from "../Search.js";
import { ApplicationSearchQuery } from "../Search.js";
import { ApplicationSearchResponse } from "../Search.js";

/**
 * Server-paginated catalogue lists.
 *
 * The unpaginated `listGroups`/`listPolicies`/`listApplications` endpoints stay
 * in `EnterpriseApi` for pickers and the command palette that genuinely need
 * every row. These paginated variants live in their own group because
 * `EnterpriseApi` is already at the size the declaration emitter can
 * serialise — the same reason dashboards, attributes and scripts have groups.
 */
export const enterpriseListApi = HttpApiGroup.make("EnterpriseList")
  .add(
    HttpApiEndpoint.get("searchGroups", "/v1/tenants/:tenantId/groups/search", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      query: GroupSearchQuery,
      success: GroupSearchResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("searchPolicies", "/v1/tenants/:tenantId/policies/search", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      query: PolicySearchQuery,
      success: PolicySearchResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("searchApplications", "/v1/tenants/:tenantId/applications/search", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      query: ApplicationSearchQuery,
      success: ApplicationSearchResponse,
    }),
  )
  .prefix("/api");
