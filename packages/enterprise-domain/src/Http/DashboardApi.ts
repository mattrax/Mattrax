import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import {
  CreateDashboardReportRequest,
  DashboardQueryBatchRequest,
  DashboardQueryBatchResponse,
  DashboardReport,
  DashboardReportExportQuery,
  DashboardReportListResponse,
  DashboardReportRun,
  DashboardReportRunListResponse,
  PatchDashboardReportRequest,
} from "../dashboard.js";
import { EnterpriseTenantReadErrors, EnterpriseTenantWriteErrors } from "../Errors.js";

const OkResponse = Schema.Struct({ status: Schema.Literal("ok") });

import { TenantDashboardParam, TenantDashboardReportParam, TenantParam } from "./Params.js";

/**
 * Batched dashboard widget queries and scheduled reports.
 *
 * A dashboard renders several independent widgets; each one used to be its own
 * request and its own whole-fleet read. Reports live here too because they are
 * attached to a dashboard and read the same widgets. This group lives outside
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
  .add(
    HttpApiEndpoint.get(
      "listDashboardReports",
      "/v1/tenants/:tenantId/dashboards/:dashboardId/reports",
      {
        error: EnterpriseTenantReadErrors,
        params: TenantDashboardParam,
        success: DashboardReportListResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "createDashboardReport",
      "/v1/tenants/:tenantId/dashboards/:dashboardId/reports",
      {
        error: EnterpriseTenantWriteErrors,
        params: TenantDashboardParam,
        payload: CreateDashboardReportRequest,
        success: DashboardReport,
      },
    ),
  )
  .add(
    HttpApiEndpoint.patch(
      "patchDashboardReport",
      "/v1/tenants/:tenantId/dashboards/:dashboardId/reports/:reportId",
      {
        error: EnterpriseTenantWriteErrors,
        params: TenantDashboardReportParam,
        payload: PatchDashboardReportRequest,
        success: OkResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.delete(
      "deleteDashboardReport",
      "/v1/tenants/:tenantId/dashboards/:dashboardId/reports/:reportId",
      {
        error: EnterpriseTenantWriteErrors,
        params: TenantDashboardReportParam,
        success: OkResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "sendDashboardReport",
      "/v1/tenants/:tenantId/dashboards/:dashboardId/reports/:reportId/send",
      {
        error: EnterpriseTenantWriteErrors,
        params: TenantDashboardReportParam,
        success: DashboardReportRun,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get(
      "listDashboardReportRuns",
      "/v1/tenants/:tenantId/dashboards/:dashboardId/reports/:reportId/runs",
      {
        error: EnterpriseTenantReadErrors,
        params: TenantDashboardReportParam,
        success: DashboardReportRunListResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get(
      "exportDashboardReport",
      "/v1/tenants/:tenantId/dashboards/:dashboardId/report-export",
      {
        error: EnterpriseTenantReadErrors,
        params: TenantDashboardParam,
        query: DashboardReportExportQuery,
        // Bytes so the same endpoint can return CSV or PDF; the browser turns
        // them into a Blob with the filename from Content-Disposition.
        success: Schema.Uint8Array.pipe(
          HttpApiSchema.asUint8Array({ contentType: "application/octet-stream" }),
        ),
      },
    ),
  )
  .prefix("/api");
