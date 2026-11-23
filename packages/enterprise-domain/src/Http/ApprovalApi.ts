import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import {
  ApprovalPoliciesResponse,
  ApprovalRequestInfo,
  ApprovalRequestQuery,
  ApprovalRequestsResponse,
  ApproveApprovalRequest,
  CreateApprovalPolicyRequest,
  PatchApprovalPolicyRequest,
  RejectApprovalRequest,
} from "../approvals.js";
import {
  EnterpriseAndroidErrors,
  EnterpriseAppleWriteErrors,
  EnterpriseApprovalRequired,
  EnterpriseBackupWriteErrors,
  EnterpriseBadRequest,
  EnterpriseConflict,
  EnterpriseInternal,
  EnterpriseStepUpRequired,
  EnterpriseTenantBackupDownloadErrors,
  EnterpriseTenantDeleteErrors,
  EnterpriseTenantExportErrors,
  EnterpriseTenantReadErrors,
  EnterpriseTenantWriteErrors,
} from "../Errors.js";
import { BulkOperationResult, IdResponse, IdsRequest } from "../Common.js";
import {
  BackupRestoreRequest,
  BackupRestoreResponse,
  DeleteTenantResponse,
  TenantExportQuery,
} from "../Backup.js";
import { DeviceActionRequest, DeviceActionResponse } from "../Device.js";
import {
  TenantApprovalParam,
  TenantApprovalPolicyParam,
  TenantIdParam,
  TenantParam,
} from "./Params.js";

const OkResponse = Schema.Struct({ status: Schema.Literal("ok") });

/**
 * Four-eyes approvals.
 *
 * Kept outside `EnterpriseApi` for the same reason lists, scripts and device
 * views are: that group is already at the size the declaration emitter can
 * serialise. The destructive endpoints that share the approval error live here
 * too, so adding `ApprovalRequired` does not push the large group over that
 * limit. Their URLs are unchanged.
 */
export const enterpriseApprovalApi = HttpApiGroup.make("EnterpriseApproval")
  .add(
    HttpApiEndpoint.get("listApprovalPolicies", "/v1/tenants/:tenantId/approval-policies", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: ApprovalPoliciesResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("createApprovalPolicy", "/v1/tenants/:tenantId/approval-policies", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: CreateApprovalPolicyRequest,
      success: IdResponse,
    }),
  )
  .add(
    HttpApiEndpoint.patch(
      "patchApprovalPolicy",
      "/v1/tenants/:tenantId/approval-policies/:policyId",
      {
        error: EnterpriseTenantWriteErrors,
        params: TenantApprovalPolicyParam,
        payload: PatchApprovalPolicyRequest,
        success: OkResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.delete(
      "deleteApprovalPolicy",
      "/v1/tenants/:tenantId/approval-policies/:policyId",
      {
        error: EnterpriseTenantWriteErrors,
        params: TenantApprovalPolicyParam,
        success: OkResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get("listApprovalRequests", "/v1/tenants/:tenantId/approvals", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      query: ApprovalRequestQuery,
      success: ApprovalRequestsResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getApprovalRequest", "/v1/tenants/:tenantId/approvals/:approvalId", {
      error: EnterpriseTenantReadErrors,
      params: TenantApprovalParam,
      success: ApprovalRequestInfo,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "approveApprovalRequest",
      "/v1/tenants/:tenantId/approvals/:approvalId/approve",
      {
        error: EnterpriseTenantWriteErrors,
        params: TenantApprovalParam,
        payload: ApproveApprovalRequest,
        success: ApprovalRequestInfo,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "rejectApprovalRequest",
      "/v1/tenants/:tenantId/approvals/:approvalId/reject",
      {
        error: EnterpriseTenantWriteErrors,
        params: TenantApprovalParam,
        payload: RejectApprovalRequest,
        success: ApprovalRequestInfo,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "cancelApprovalRequest",
      "/v1/tenants/:tenantId/approvals/:approvalId/cancel",
      {
        error: EnterpriseTenantWriteErrors,
        params: TenantApprovalParam,
        success: ApprovalRequestInfo,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get("exportTenant", "/v1/tenants/:tenantId/export", {
      error: [
        ...EnterpriseTenantExportErrors,
        ...EnterpriseApprovalRequired,
        EnterpriseBadRequest.pipe(HttpApiSchema.status(400)),
        EnterpriseConflict.pipe(HttpApiSchema.status(409)),
      ],
      params: TenantParam,
      query: TenantExportQuery,
      success: Schema.String.pipe(
        HttpApiSchema.asText({ contentType: "application/json; charset=utf-8" }),
      ),
    }),
  )
  .add(
    HttpApiEndpoint.get("downloadTenantBackup", "/v1/tenants/:tenantId/backups/:id/download", {
      error: [
        ...EnterpriseTenantBackupDownloadErrors,
        ...EnterpriseStepUpRequired,
        ...EnterpriseApprovalRequired,
        EnterpriseBadRequest.pipe(HttpApiSchema.status(400)),
        EnterpriseConflict.pipe(HttpApiSchema.status(409)),
      ],
      params: TenantIdParam,
      success: Schema.String.pipe(
        HttpApiSchema.asText({ contentType: "application/json; charset=utf-8" }),
      ),
    }),
  )
  .add(
    HttpApiEndpoint.post("restoreTenantBackup", "/v1/tenants/:tenantId/backups/:id/restore", {
      error: [
        ...EnterpriseBackupWriteErrors,
        EnterpriseConflict.pipe(HttpApiSchema.status(409)),
        EnterpriseBadRequest.pipe(HttpApiSchema.status(400)),
        EnterpriseInternal.pipe(HttpApiSchema.status(500)),
        ...EnterpriseStepUpRequired,
        ...EnterpriseApprovalRequired,
      ],
      params: TenantIdParam,
      payload: BackupRestoreRequest,
      success: BackupRestoreResponse,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteTenant", "/v1/tenants/:tenantId", {
      error: [
        ...EnterpriseTenantDeleteErrors,
        ...EnterpriseStepUpRequired,
        ...EnterpriseApprovalRequired,
      ],
      params: TenantParam,
      success: DeleteTenantResponse,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deletePolicies", "/v1/tenants/:tenantId/policies", {
      error: [...EnterpriseTenantWriteErrors, ...EnterpriseApprovalRequired],
      params: TenantParam,
      payload: IdsRequest,
      success: BulkOperationResult,
    }),
  )
  .add(
    HttpApiEndpoint.post("deviceAction", "/v1/tenants/:tenantId/devices/:id/action", {
      error: [
        ...EnterpriseAndroidErrors,
        ...EnterpriseAppleWriteErrors,
        ...EnterpriseStepUpRequired,
        ...EnterpriseApprovalRequired,
      ],
      params: TenantIdParam,
      payload: DeviceActionRequest,
      success: DeviceActionResponse,
    }),
  )
  .prefix("/api");
