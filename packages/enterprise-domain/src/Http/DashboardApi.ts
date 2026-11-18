import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { DashboardQueryBatchRequest, DashboardQueryBatchResponse } from "../dashboard.js";
import { EnterpriseTenantReadErrors } from "../Errors.js";
import { TenantParam } from "./Params.js";

/**
 * Batched dashboard widget queries.
 *
 * A dashboard renders several independent widgets; each one used to be its own
 * request and its own whole-fleet read. This group lives outside
 * `EnterpriseApi` because that group is already at the size the declaration
 * emitter can serialise (the same reason attributes and scripts have their own
 * groups).
 */
export const enterpriseDashboardApi = HttpApiGroup.make("EnterpriseDashboard")
  .add(
    HttpApiEndpoint.post("queryDashboardBatch", "/v1/tenants/:tenantId/dashboard-query/batch", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      payload: DashboardQueryBatchRequest,
      success: DashboardQueryBatchResponse,
    }),
  )
  .prefix("/api");
