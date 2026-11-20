import { HttpApi } from "effect/http-api";
import { HttpApiEndpoint } from "effect/http-api";
import { HttpApiGroup } from "effect/http-api";
import { HttpApiSchema } from "effect/http-api";
import { Schema } from "effect";
import {
  CreateFleetMigrationRequest,
  CreateFleetMigrationResponse,
  FleetMigrationDetail,
  FleetMigrationEntryActionResponse,
  FleetMigrationExportQuery,
  FleetMigrationListResponse,
  IssueFleetMigrationUnenrolRequest,
  IssueFleetMigrationUnenrolResponse,
} from "../fleetMigration.js";
import {
  EnterpriseTenantReadErrors,
  EnterpriseTenantValidatedReadErrors,
  EnterpriseTenantWriteErrors,
  EnterpriseStepUpRequired,
} from "../Errors.js";
import { TenantMigrationEntryParam, TenantMigrationParam, TenantParam } from "./Params.js";

/**
 * Fleet migration cohorts. Its own group (and client) for the same reason
 * scripts have one: the main contract's generated client type must stay inside
 * TypeScript's declaration-size limit. The endpoints are tenant-scoped and
 * permission-checked like every other device mutation.
 */
export const fleetMigrationApi = HttpApiGroup.make("FleetMigration")
  .add(
    HttpApiEndpoint.get("listFleetMigrations", "/v1/tenants/:tenantId/migrations", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: FleetMigrationListResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("createFleetMigration", "/v1/tenants/:tenantId/migrations", {
      error: [...EnterpriseTenantWriteErrors, ...EnterpriseStepUpRequired],
      params: TenantParam,
      payload: CreateFleetMigrationRequest,
      success: CreateFleetMigrationResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getFleetMigration", "/v1/tenants/:tenantId/migrations/:migrationId", {
      error: EnterpriseTenantReadErrors,
      params: TenantMigrationParam,
      success: FleetMigrationDetail,
    }),
  )
  .add(
    HttpApiEndpoint.delete(
      "deleteFleetMigration",
      "/v1/tenants/:tenantId/migrations/:migrationId",
      {
        error: [...EnterpriseTenantWriteErrors, ...EnterpriseStepUpRequired],
        params: TenantMigrationParam,
        success: Schema.Struct({ deleted: Schema.Boolean }),
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "issueFleetMigrationUnenrol",
      "/v1/tenants/:tenantId/migrations/:migrationId/unenrol",
      {
        error: [...EnterpriseTenantWriteErrors, ...EnterpriseStepUpRequired],
        params: TenantMigrationParam,
        payload: IssueFleetMigrationUnenrolRequest,
        success: IssueFleetMigrationUnenrolResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "markFleetMigrationUnenrolled",
      "/v1/tenants/:tenantId/migrations/:migrationId/entries/:entryId/unenrolled",
      {
        error: [...EnterpriseTenantWriteErrors, ...EnterpriseStepUpRequired],
        params: TenantMigrationEntryParam,
        success: FleetMigrationEntryActionResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "confirmFleetMigrationEntry",
      "/v1/tenants/:tenantId/migrations/:migrationId/entries/:entryId/confirm",
      {
        error: [...EnterpriseTenantWriteErrors, ...EnterpriseStepUpRequired],
        params: TenantMigrationEntryParam,
        success: FleetMigrationEntryActionResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get(
      "exportFleetMigration",
      "/v1/tenants/:tenantId/migrations/:migrationId/export",
      {
        error: EnterpriseTenantValidatedReadErrors,
        params: TenantMigrationParam,
        query: FleetMigrationExportQuery,
        success: Schema.String.pipe(
          HttpApiSchema.asText({ contentType: "text/csv; charset=utf-8" }),
        ),
      },
    ),
  )
  .prefix("/api");

/** Dashboard client contract; mounted on the same API root as every other group. */
export const fleetMigrationHttpApi = HttpApi.make("MattraxFleetMigration").add(fleetMigrationApi);
