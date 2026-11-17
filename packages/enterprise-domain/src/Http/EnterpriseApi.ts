import { CreateDashboardRequest } from "../dashboard.js";
import { CreateDashboardWidgetRequest } from "../dashboard.js";
import { CreateTenantRoleRequest } from "../rbac.js";
import { CreateWebhookEndpointRequest } from "../webhooks.js";
import { CreateWebhookEndpointResponse } from "../webhooks.js";
import { Dashboard } from "../dashboard.js";
import { DashboardLayoutRequest } from "../dashboard.js";
import { DashboardListResponse } from "../dashboard.js";
import { DashboardQueryRequest } from "../dashboard.js";
import { DashboardQueryResponse } from "../dashboard.js";
import { DashboardWidget } from "../dashboard.js";
import { HttpApiEndpoint } from "effect/http-api";
import { HttpApiGroup } from "effect/http-api";
import { HttpApiSchema } from "effect/http-api";
import { OpenApi } from "effect/http-api";
import { PatchDashboardRequest } from "../dashboard.js";
import { PatchDashboardWidgetRequest } from "../dashboard.js";
import { PatchTenantRoleRequest } from "../rbac.js";
import { PatchWebhookEndpointRequest } from "../webhooks.js";
import { RotateWebhookSecretResponse } from "../webhooks.js";
import { Schema } from "effect";
import { TenantRolesResponse } from "../rbac.js";
import { WebhookDeliveriesResponse } from "../webhooks.js";
import { WebhookDeliveryDetail } from "../webhooks.js";
import { WebhookDeliveryReplayResponse } from "../webhooks.js";
import { WebhookEndpointInfo } from "../webhooks.js";
import { WebhookEndpointsResponse } from "../webhooks.js";
import { WebhookTestResponse } from "../webhooks.js";
import { AbmAssignDeviceResponse } from "../Apple.js";
import { AbmDeviceInfo } from "../Apple.js";
import { AbmDevicesResponse } from "../Apple.js";
import { AbmProfileUrlResponse } from "../Apple.js";
import { AcceptInvitationRequest } from "../Account.js";
import { AcceptInvitationResponse } from "../Account.js";
import { AndroidEnterpriseInfo } from "../Android.js";
import { AndroidSignupResponse } from "../Android.js";
import { AndroidSyncResponse } from "../Android.js";
import { ApnsCsrResponse } from "../Credential.js";
import { ApnsInfo } from "../Credential.js";
import { AppleBusinessManagerInfo } from "../Apple.js";
import { AppleBusinessManagerSyncResponse } from "../Apple.js";
import { AppleDeviceUsersResponse } from "../Device.js";
import { AppleEnrollmentProfileResponse } from "../Enrollment.js";
import { AppleFdeEscrowKeyInfo } from "../Device.js";
import { AppleUserActionRequest } from "../Device.js";
import { AppleUserActionResponse } from "../Device.js";
import { ApplicationInstallResult } from "../Application.js";
import { ApplicationInventoryQuery } from "../Device.js";
import { ApplicationInventoryResponse } from "../Device.js";
import { ApplicationListResponse } from "../Application.js";
import { ApplicationNode } from "../Application.js";
import { ApproveAccountRecoveryRequest } from "../Account.js";
import { AssignAutopilotProfileRequest } from "../Autopilot.js";
import { AuditExportQuery } from "../Audit.js";
import { AuditLogResponse } from "../Audit.js";
import { AuditSearchQuery } from "../Audit.js";
import { AuditSearchResponse } from "../Audit.js";
import { AutopilotDevicesResponse } from "../Autopilot.js";
import { AutopilotImportRequest } from "../Autopilot.js";
import { AutopilotImportResponse } from "../Autopilot.js";
import { AutopilotProfileInfo } from "../Autopilot.js";
import { AutopilotProfilesResponse } from "../Autopilot.js";
import { AutopilotSettingsResponse } from "../Autopilot.js";
import { AutopilotSyncResponse } from "../Autopilot.js";
import { BackupRestoreRequest } from "../Backup.js";
import { BackupRestoreResponse } from "../Backup.js";
import { BackupRunInfo } from "../Backup.js";
import { BillingCheckoutRequest } from "../Billing.js";
import { BillingCheckoutResponse } from "../Billing.js";
import { BillingInvoicesResponse } from "../Billing.js";
import { BillingPortalRequest } from "../Billing.js";
import { BillingPortalResponse } from "../Billing.js";
import { BillingSummary } from "../Tenant.js";
import { BulkOperationResult } from "../Common.js";
import { CreateApplicationRequest } from "../Application.js";
import { CreateAutopilotProfileRequest } from "../Autopilot.js";
import { CreateInvitationResponse } from "../Audit.js";
import { CreatePolicyRequest } from "../Policy.js";
import { CreateScimTokenResponse } from "../Scim.js";
import { CredentialHealthResponse } from "../Device.js";
import { DeleteTenantResponse } from "../Backup.js";
import { DeviceActionRequest } from "../Device.js";
import { DeviceActionResponse } from "../Device.js";
import { DeviceActivationLockBypassCodeResponse } from "../Device.js";
import { DeviceActivityResponse } from "../Device.js";
import { DeviceApplicationsResponse } from "../Device.js";
import { DeviceCommandsResponse } from "../Device.js";
import { DeviceDeclarationsResponse } from "../Device.js";
import { DeviceHealthResponse } from "../Device.js";
import { DeviceHealthSummaryResponse } from "../Device.js";
import { DeviceIdentityRevokeResponse } from "../Device.js";
import { DeviceListResponse } from "../Search.js";
import { DeviceLocalAdminResponse } from "../Device.js";
import { DevicePreRegistrationImportRequest } from "../Search.js";
import { DevicePreRegistrationImportResponse } from "../Search.js";
import { DevicePreRegistrationListResponse } from "../Search.js";
import { DevicePushHealthResponse } from "../Device.js";
import { DeviceRecoveryKeyResponse } from "../Device.js";
import { DeviceRow } from "../Device.js";
import { DeviceSearchQuery } from "../Search.js";
import { DeviceSearchResponse } from "../Search.js";
import { DeviceUsersResponse } from "../Directory.js";
import { DirectoryResponse } from "../Directory.js";
import { DownloadPolicyApplicationResponse } from "../Policy.js";
import { DuplicateRequest } from "../Common.js";
import { EffectivePolicyResponse } from "../Policy.js";
import { EnrollmentAttemptsResponse } from "../Enrollment.js";
import { EnrollmentQuery } from "../Enrollment.js";
import { EnrollmentResponse } from "../Enrollment.js";
import { EnterpriseAndroidErrors } from "../Errors.js";
import { EnterpriseAndroidReadErrors } from "../Errors.js";
import { EnterpriseApnsErrors } from "../Errors.js";
import { EnterpriseAppleReadErrors } from "../Errors.js";
import { EnterpriseAppleWriteErrors } from "../Errors.js";
import { EnterpriseApplicationDownloadErrors } from "../Policy.js";
import { EnterpriseApplicationErrors } from "../Errors.js";
import { EnterpriseApplicationUploadErrors } from "../Policy.js";
import { EnterpriseAuthRequiredErrors } from "../Errors.js";
import { EnterpriseAutopilotReadErrors } from "../Errors.js";
import { EnterpriseAutopilotWriteErrors } from "../Errors.js";
import { EnterpriseBackupWriteErrors } from "../Errors.js";
import { EnterpriseBadRequest } from "../Errors.js";
import { EnterpriseBillingPortalErrors } from "../Errors.js";
import { EnterpriseBillingReadErrors } from "../Errors.js";
import { EnterpriseConflict } from "../Errors.js";
import { EnterpriseDbErrors } from "../Errors.js";
import { EnterpriseForbidden } from "../Errors.js";
import { EnterpriseInternal } from "../Errors.js";
import { EnterpriseNoDomainErrors } from "../Errors.js";
import { EnterpriseNotFound } from "../Errors.js";
import { EnterprisePolicyApplicationDownloadErrors } from "../Errors.js";
import { EnterprisePolicyApplicationUploadErrors } from "../Errors.js";
import { EnterprisePublicAdeProfileErrors } from "../Errors.js";
import { EnterprisePublicEnrollmentProfileErrors } from "../Errors.js";
import { EnterprisePublicNotFoundErrors } from "../Errors.js";
import { EnterpriseSsoErrors } from "../Errors.js";
import { EnterpriseStepUpRequired } from "../Errors.js";
import { EnterpriseTenantBackupDownloadErrors } from "../Errors.js";
import { EnterpriseTenantDeleteErrors } from "../Errors.js";
import { EnterpriseTenantExportErrors } from "../Errors.js";
import { EnterpriseTenantImportErrors } from "../Errors.js";
import { EnterpriseTenantReadErrors } from "../Errors.js";
import { EnterpriseTenantUserRemoveErrors } from "../Errors.js";
import { EnterpriseTenantValidatedReadErrors } from "../Errors.js";
import { EnterpriseTenantWriteErrors } from "../Errors.js";
import { EntraDirectorySyncResult } from "../Tenant.js";
import { EntraDirectorySyncStatus } from "../Tenant.js";
import { EntraDomainsResponse } from "../Tenant.js";
import { GroupListResponse } from "../Search.js";
import { GroupNode } from "../Group.js";
import { GroupPreviewResponse } from "../Search.js";
import { IdParam } from "./Params.js";
import { ImportTenantScepCaRequest } from "../Enrollment.js";
import { InvitationOptionsResponse } from "../Tenant.js";
import { InvitationPreviewQuery } from "../Tenant.js";
import { InvitationPreviewResponse } from "../Tenant.js";
import { InviteTenantUserRequest } from "../Tenant.js";
import { ListTenantInvitationsQuery } from "../Tenant.js";
import { MobileconfigPreview } from "../Policy.js";
import { PatchApplicationRequest } from "../Application.js";
import { PatchDeviceRequest } from "../Device.js";
import { PatchEntraDirectorySyncRequest } from "../Tenant.js";
import { PatchGroupMembersRequest } from "../Group.js";
import { PatchGroupRequest } from "../Group.js";
import { PatchPolicyRequest } from "../Policy.js";
import { PatchSsoConfigRequest } from "../Tenant.js";
import { PolicyApplicationObject } from "../Policy.js";
import { PolicyDeploymentsResponse } from "../Common.js";
import { PolicyListResponse } from "../Search.js";
import { PolicyRow } from "../Policy.js";
import { ResendTenantInvitationResponse } from "../Tenant.js";
import { ScimTokensResponse } from "../Scim.js";
import { SearchResult } from "../Directory.js";
import { SetDeviceUsersRequest } from "../Directory.js";
import { SsoConfigResponse } from "../Tenant.js";
import { TenantAutopilotDeviceParam } from "./Params.js";
import { TenantAutopilotProfileParam } from "./Params.js";
import { TenantBackupsResponse } from "../Backup.js";
import { TenantDashboardParam } from "./Params.js";
import { TenantDashboardWidgetParam } from "./Params.js";
import { TenantDetail } from "../Tenant.js";
import { TenantDeviceUserParam } from "./Params.js";
import { TenantEnrollmentInfo } from "../Enrollment.js";
import { TenantExportQuery } from "../Backup.js";
import { TenantIdParam } from "./Params.js";
import { TenantImportRequest } from "../Backup.js";
import { TenantImportResponse } from "../Backup.js";
import { TenantInvitationParam } from "./Params.js";
import { TenantInvitationsResponse } from "../Tenant.js";
import { TenantMemberParam } from "./Params.js";
import { TenantParam } from "./Params.js";
import { TenantPreRegistrationParam } from "./Params.js";
import { TenantRoleParam } from "./Params.js";
import { TenantScepCaInfo } from "../Enrollment.js";
import { TenantSecuritySettings } from "../Account.js";
import { TenantWebhookDeliveryParam } from "./Params.js";
import { TenantWebhookParam } from "./Params.js";
import { UpdateAutopilotProfileRequest } from "../Autopilot.js";
import { UpdateTenantSecurityRequest } from "../Account.js";
import { UploadApnsRequest } from "../Credential.js";
import { UploadAppleBusinessManagerTokenRequest } from "../Apple.js";
import { UploadAppleFdeEscrowKeyRequest } from "../Device.js";
import { UploadPolicyApplicationRequest } from "../Policy.js";
import { UploadVppTokenRequest } from "../Apple.js";
import { VppAssetsResponse } from "../Apple.js";
import { VppInfo } from "../Apple.js";
import { VppInstallRequest } from "../Apple.js";
import { VppInstallResponse } from "../Apple.js";
import { VppReleaseRequest } from "../Apple.js";
import { VppReleaseResponse } from "../Apple.js";
import { VppSyncResponse } from "../Apple.js";
import { WebhookDeliveryQuery } from "../Common.js";
import { CreateGroupRequest } from "../Group.js";
import { CreateScimTokenRequest } from "../Scim.js";
import { CreateTenantRequest } from "../Tenant.js";
import { IdResponse } from "../Common.js";
import { IdsRequest } from "../Common.js";
import { PatchApplicationAssignmentsRequest } from "../Application.js";
import { PatchPolicyAssignmentsRequest } from "../Policy.js";
import { PatchTenantAndroidRequest } from "../Android.js";
import { PatchTenantEnrollmentRequest } from "../Enrollment.js";
import { PatchTenantRequest } from "../Tenant.js";
import { PatchTenantUserRequest } from "../Tenant.js";
import { PolicyAssignmentsResponse } from "../Policy.js";
import { TenantListResponse } from "../Tenant.js";
import { TenantUsersResponse } from "../Tenant.js";
import { VppAssignmentsResponse } from "../Apple.js";

export const enterpriseApi = HttpApiGroup.make("EnterpriseApi")
  .add(
    HttpApiEndpoint.get("listTenants", "/v1/tenants", {
      error: [...EnterpriseAuthRequiredErrors, EnterpriseForbidden.pipe(HttpApiSchema.status(403))],
      success: TenantListResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("createTenant", "/v1/tenants", {
      error: [
        ...EnterpriseAuthRequiredErrors,
        ...EnterpriseDbErrors,
        EnterpriseBadRequest.pipe(HttpApiSchema.status(400)),
        EnterpriseForbidden.pipe(HttpApiSchema.status(403)),
      ],
      payload: CreateTenantRequest,
      success: IdResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getTenant", "/v1/tenants/:tenantId", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: TenantDetail,
    }),
  )
  .add(
    HttpApiEndpoint.get("exportTenant", "/v1/tenants/:tenantId/export", {
      error: EnterpriseTenantExportErrors,
      params: TenantParam,
      query: TenantExportQuery,
      success: Schema.String.pipe(
        HttpApiSchema.asText({ contentType: "application/json; charset=utf-8" }),
      ),
    }),
  )
  .add(
    HttpApiEndpoint.post("importTenant", "/v1/tenants/import", {
      error: EnterpriseTenantImportErrors,
      payload: TenantImportRequest,
      success: TenantImportResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("runTenantBackup", "/v1/tenants/:tenantId/backups", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      success: BackupRunInfo,
    }),
  )
  .add(
    HttpApiEndpoint.get("listTenantBackups", "/v1/tenants/:tenantId/backups", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: TenantBackupsResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("downloadTenantBackup", "/v1/tenants/:tenantId/backups/:id/download", {
      error: [...EnterpriseTenantBackupDownloadErrors, ...EnterpriseStepUpRequired],
      params: TenantIdParam,
      success: Schema.String.pipe(
        HttpApiSchema.asText({ contentType: "application/json; charset=utf-8" }),
      ),
    }),
  )
  .add(
    HttpApiEndpoint.post("pinTenantBackup", "/v1/tenants/:tenantId/backups/:id/pin", {
      error: [...EnterpriseBackupWriteErrors, ...EnterpriseStepUpRequired],
      params: TenantIdParam,
      success: BackupRunInfo,
    }),
  )
  .add(
    HttpApiEndpoint.post("unpinTenantBackup", "/v1/tenants/:tenantId/backups/:id/unpin", {
      error: [...EnterpriseBackupWriteErrors, ...EnterpriseStepUpRequired],
      params: TenantIdParam,
      success: BackupRunInfo,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteTenantBackup", "/v1/tenants/:tenantId/backups/:id", {
      error: [...EnterpriseBackupWriteErrors, ...EnterpriseStepUpRequired],
      params: TenantIdParam,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
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
      ],
      params: TenantIdParam,
      payload: BackupRestoreRequest,
      success: BackupRestoreResponse,
    }),
  )
  .add(
    HttpApiEndpoint.patch("patchTenant", "/v1/tenants/:tenantId", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: PatchTenantRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteTenant", "/v1/tenants/:tenantId", {
      error: [...EnterpriseTenantDeleteErrors, ...EnterpriseStepUpRequired],
      params: TenantParam,
      success: DeleteTenantResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getTenantSecurity", "/v1/tenants/:tenantId/security", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: TenantSecuritySettings,
    }),
  )
  .add(
    HttpApiEndpoint.patch("patchTenantSecurity", "/v1/tenants/:tenantId/security", {
      error: [...EnterpriseTenantWriteErrors, ...EnterpriseStepUpRequired],
      params: TenantParam,
      payload: UpdateTenantSecurityRequest,
      success: TenantSecuritySettings,
    }),
  )
  .add(
    HttpApiEndpoint.post("approveAccountRecovery", "/v1/tenants/:tenantId/recovery/approve", {
      error: [...EnterpriseTenantWriteErrors, ...EnterpriseStepUpRequired],
      params: TenantParam,
      payload: ApproveAccountRecoveryRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.get("getSsoConfig", "/v1/tenants/:tenantId/sso", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      success: SsoConfigResponse,
    }),
  )
  .add(
    HttpApiEndpoint.patch("patchSsoConfig", "/v1/tenants/:tenantId/sso", {
      error: [...EnterpriseSsoErrors, ...EnterpriseStepUpRequired],
      params: TenantParam,
      payload: PatchSsoConfigRequest,
      success: SsoConfigResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getEntraDirectorySync", "/v1/tenants/:tenantId/identity/directory", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: EntraDirectorySyncStatus,
    }),
  )
  .add(
    HttpApiEndpoint.patch("patchEntraDirectorySync", "/v1/tenants/:tenantId/identity/directory", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: PatchEntraDirectorySyncRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.post("syncEntraDirectory", "/v1/tenants/:tenantId/identity/directory/sync", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      success: EntraDirectorySyncResult,
    }),
  )
  .add(
    HttpApiEndpoint.get("listEntraDomains", "/v1/tenants/:tenantId/identity/domains", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: EntraDomainsResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("refreshEntraDomains", "/v1/tenants/:tenantId/identity/domains/refresh", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      success: EntraDomainsResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getAutopilotSettings", "/v1/tenants/:tenantId/autopilot", {
      error: EnterpriseAutopilotReadErrors,
      params: TenantParam,
      success: AutopilotSettingsResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("listAutopilotDevices", "/v1/tenants/:tenantId/autopilot/devices", {
      error: EnterpriseAutopilotReadErrors,
      params: TenantParam,
      success: AutopilotDevicesResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("importAutopilotDevices", "/v1/tenants/:tenantId/autopilot/import", {
      error: EnterpriseAutopilotWriteErrors,
      params: TenantParam,
      payload: AutopilotImportRequest,
      success: AutopilotImportResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("syncAutopilotDevices", "/v1/tenants/:tenantId/autopilot/sync", {
      error: EnterpriseAutopilotWriteErrors,
      params: TenantParam,
      success: AutopilotSyncResponse,
    }),
  )
  .add(
    HttpApiEndpoint.delete(
      "deleteAutopilotDevice",
      "/v1/tenants/:tenantId/autopilot/devices/:serial",
      {
        error: EnterpriseAutopilotWriteErrors,
        params: TenantAutopilotDeviceParam,
        success: Schema.Struct({ status: Schema.Literal("ok") }),
      },
    ),
  )
  .add(
    HttpApiEndpoint.get("listAutopilotProfiles", "/v1/tenants/:tenantId/autopilot/profiles", {
      error: EnterpriseAutopilotReadErrors,
      params: TenantParam,
      success: AutopilotProfilesResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("createAutopilotProfile", "/v1/tenants/:tenantId/autopilot/profiles", {
      error: EnterpriseAutopilotWriteErrors,
      params: TenantParam,
      payload: CreateAutopilotProfileRequest,
      success: AutopilotProfileInfo,
    }),
  )
  .add(
    HttpApiEndpoint.patch(
      "updateAutopilotProfile",
      "/v1/tenants/:tenantId/autopilot/profiles/:profileId",
      {
        error: EnterpriseAutopilotWriteErrors,
        params: TenantAutopilotProfileParam,
        payload: UpdateAutopilotProfileRequest,
        success: AutopilotProfileInfo,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "assignAutopilotProfile",
      "/v1/tenants/:tenantId/autopilot/profiles/:profileId/assign",
      {
        error: EnterpriseAutopilotWriteErrors,
        params: TenantAutopilotProfileParam,
        payload: AssignAutopilotProfileRequest,
        success: AutopilotProfileInfo,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get("listScimTokens", "/v1/tenants/:tenantId/scim-tokens", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      success: ScimTokensResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("createScimToken", "/v1/tenants/:tenantId/scim-tokens", {
      error: [...EnterpriseTenantWriteErrors, ...EnterpriseStepUpRequired],
      params: TenantParam,
      payload: CreateScimTokenRequest,
      success: CreateScimTokenResponse,
    }),
  )
  .add(
    HttpApiEndpoint.delete("revokeScimToken", "/v1/tenants/:tenantId/scim-tokens/:tokenId", {
      error: EnterpriseTenantWriteErrors,
      params: { tenantId: Schema.String, tokenId: Schema.String },
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.get("listAuditLog", "/v1/tenants/:tenantId/audit-log", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: AuditLogResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("searchAuditLog", "/v1/tenants/:tenantId/audit/search", {
      error: EnterpriseTenantValidatedReadErrors,
      params: TenantParam,
      query: AuditSearchQuery,
      success: AuditSearchResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("exportAuditLog", "/v1/tenants/:tenantId/audit/export", {
      error: EnterpriseTenantValidatedReadErrors,
      params: TenantParam,
      query: AuditExportQuery,
      success: Schema.String.pipe(HttpApiSchema.asText({ contentType: "text/csv; charset=utf-8" })),
    }),
  )
  .add(
    HttpApiEndpoint.get("listWebhookEndpoints", "/v1/tenants/:tenantId/webhooks", {
      // Listing reveals delivery health, so it is limited to owner/admin just
      // like the mutations.
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      success: WebhookEndpointsResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("createWebhookEndpoint", "/v1/tenants/:tenantId/webhooks", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: CreateWebhookEndpointRequest,
      success: CreateWebhookEndpointResponse,
    }),
  )
  .add(
    HttpApiEndpoint.patch("patchWebhookEndpoint", "/v1/tenants/:tenantId/webhooks/:webhookId", {
      error: EnterpriseTenantWriteErrors,
      params: TenantWebhookParam,
      payload: PatchWebhookEndpointRequest,
      success: WebhookEndpointInfo,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteWebhookEndpoint", "/v1/tenants/:tenantId/webhooks/:webhookId", {
      error: EnterpriseTenantWriteErrors,
      params: TenantWebhookParam,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "rotateWebhookSecret",
      "/v1/tenants/:tenantId/webhooks/:webhookId/rotate-secret",
      {
        error: EnterpriseTenantWriteErrors,
        params: TenantWebhookParam,
        success: RotateWebhookSecretResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post("testWebhookEndpoint", "/v1/tenants/:tenantId/webhooks/:webhookId/test", {
      error: EnterpriseTenantWriteErrors,
      params: TenantWebhookParam,
      success: WebhookTestResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get(
      "listWebhookDeliveries",
      "/v1/tenants/:tenantId/webhooks/:webhookId/deliveries",
      {
        // Delivery history is read-gated (`webhooks.read`); the handler relies
        // on the method→permission mapping rather than tenant write.
        error: EnterpriseTenantValidatedReadErrors,
        params: TenantWebhookParam,
        query: WebhookDeliveryQuery,
        success: WebhookDeliveriesResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get(
      "getWebhookDelivery",
      "/v1/tenants/:tenantId/webhooks/:webhookId/deliveries/:deliveryId",
      {
        error: EnterpriseTenantValidatedReadErrors,
        params: TenantWebhookDeliveryParam,
        success: WebhookDeliveryDetail,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "replayWebhookDelivery",
      "/v1/tenants/:tenantId/webhooks/:webhookId/deliveries/:deliveryId/replay",
      {
        error: EnterpriseTenantWriteErrors,
        params: TenantWebhookDeliveryParam,
        success: WebhookDeliveryReplayResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get("listTenantUsers", "/v1/tenants/:tenantId/users", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: TenantUsersResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("listTenantRoles", "/v1/tenants/:tenantId/roles", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: TenantRolesResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("createTenantRole", "/v1/tenants/:tenantId/roles", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: CreateTenantRoleRequest,
      success: Schema.Struct({ id: Schema.String }),
    }),
  )
  .add(
    HttpApiEndpoint.patch("patchTenantRole", "/v1/tenants/:tenantId/roles/:roleId", {
      error: EnterpriseTenantWriteErrors,
      params: TenantRoleParam,
      payload: PatchTenantRoleRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteTenantRole", "/v1/tenants/:tenantId/roles/:roleId", {
      error: EnterpriseTenantWriteErrors,
      params: TenantRoleParam,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.post("inviteTenantUser", "/v1/tenants/:tenantId/invitations", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: InviteTenantUserRequest,
      success: CreateInvitationResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("acceptInvitation", "/v1/invitations/accept", {
      error: [
        ...EnterpriseAuthRequiredErrors,
        ...EnterpriseDbErrors,
        EnterpriseBadRequest.pipe(HttpApiSchema.status(400)),
        EnterpriseNotFound.pipe(HttpApiSchema.status(404)),
        EnterpriseForbidden.pipe(HttpApiSchema.status(403)),
        EnterpriseConflict.pipe(HttpApiSchema.status(409)),
      ],
      payload: AcceptInvitationRequest,
      success: AcceptInvitationResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("previewInvitation", "/v1/invitations/preview", {
      error: EnterpriseNoDomainErrors,
      query: InvitationPreviewQuery,
      success: InvitationPreviewResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("listTenantInvitations", "/v1/tenants/:tenantId/invitations", {
      error: EnterpriseTenantValidatedReadErrors,
      params: TenantParam,
      query: ListTenantInvitationsQuery,
      success: TenantInvitationsResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getTenantInvitationOptions", "/v1/tenants/:tenantId/invitation-options", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: InvitationOptionsResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "resendTenantInvitation",
      "/v1/tenants/:tenantId/invitations/:invitationId/resend",
      {
        error: EnterpriseTenantWriteErrors,
        params: TenantInvitationParam,
        success: ResendTenantInvitationResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.delete(
      "cancelTenantInvitation",
      "/v1/tenants/:tenantId/invitations/:invitationId",
      {
        error: EnterpriseTenantWriteErrors,
        params: TenantInvitationParam,
        success: Schema.Struct({ status: Schema.Literal("ok") }),
      },
    ),
  )
  .add(
    HttpApiEndpoint.patch("patchTenantUser", "/v1/tenants/:tenantId/users/:memberId", {
      error: EnterpriseTenantWriteErrors,
      params: TenantMemberParam,
      payload: PatchTenantUserRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.delete("removeTenantUser", "/v1/tenants/:tenantId/users/:memberId", {
      error: EnterpriseTenantUserRemoveErrors,
      params: TenantMemberParam,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.get("getEnrollment", "/v1/enrollment/:id", {
      error: EnterprisePublicNotFoundErrors,
      params: IdParam,
      query: EnrollmentQuery,
      success: EnrollmentResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getAppleEnrollmentProfile", "/v1/enrollment/:id/apple.mobileconfig", {
      error: EnterprisePublicEnrollmentProfileErrors,
      params: IdParam,
      query: EnrollmentQuery,
      success: AppleEnrollmentProfileResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getAdeEnrollmentProfile", "/v1/abm/ade/:token", {
      error: EnterprisePublicAdeProfileErrors,
      params: { token: Schema.String },
      success: AppleEnrollmentProfileResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getTenantScepCa", "/v1/tenants/:tenantId/identity/scep", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: TenantScepCaInfo,
    }),
  )
  .add(
    HttpApiEndpoint.post("rotateTenantScepCa", "/v1/tenants/:tenantId/identity/scep/rotate", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      success: TenantScepCaInfo,
    }),
  )
  .add(
    HttpApiEndpoint.put("importTenantScepCa", "/v1/tenants/:tenantId/identity/scep", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: ImportTenantScepCaRequest,
      success: TenantScepCaInfo,
    }),
  )
  .add(
    HttpApiEndpoint.get("getTenantEnrollment", "/v1/tenants/:tenantId/enrollment", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: TenantEnrollmentInfo,
    }),
  )
  .add(
    HttpApiEndpoint.get("listEnrollmentAttempts", "/v1/tenants/:tenantId/enrollment/attempts", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      query: Schema.Struct({ limit: Schema.optional(Schema.Number) }),
      success: EnrollmentAttemptsResponse,
    }),
  )
  .add(
    HttpApiEndpoint.patch("patchTenantEnrollment", "/v1/tenants/:tenantId/enrollment", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: PatchTenantEnrollmentRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.post("resetTenantEnrollment", "/v1/tenants/:tenantId/enrollment/reset", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      success: IdResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getApns", "/v1/tenants/:tenantId/apns", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: ApnsInfo,
    }),
  )
  .add(
    HttpApiEndpoint.get("getApnsCsr", "/v1/tenants/:tenantId/apns/csr", {
      error: EnterpriseApnsErrors,
      params: TenantParam,
      success: ApnsCsrResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("uploadApns", "/v1/tenants/:tenantId/apns", {
      error: EnterpriseApnsErrors,
      params: TenantParam,
      payload: UploadApnsRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.get("getTenantAndroid", "/v1/tenants/:tenantId/android", {
      error: EnterpriseAndroidReadErrors,
      params: TenantParam,
      success: AndroidEnterpriseInfo,
    }),
  )
  .add(
    HttpApiEndpoint.patch("patchTenantAndroid", "/v1/tenants/:tenantId/android", {
      error: EnterpriseAndroidErrors,
      params: TenantParam,
      payload: PatchTenantAndroidRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.post("createAndroidSignup", "/v1/tenants/:tenantId/android/signup", {
      error: EnterpriseAndroidErrors,
      params: TenantParam,
      success: AndroidSignupResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("syncTenantAndroid", "/v1/tenants/:tenantId/android/sync", {
      error: EnterpriseAndroidErrors,
      params: TenantParam,
      success: AndroidSyncResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getAppleBusinessManager", "/v1/tenants/:tenantId/abm", {
      error: EnterpriseAppleReadErrors,
      params: TenantParam,
      success: AppleBusinessManagerInfo,
    }),
  )
  .add(
    HttpApiEndpoint.put("uploadAppleBusinessManagerToken", "/v1/tenants/:tenantId/abm/token", {
      error: EnterpriseAppleWriteErrors,
      params: TenantParam,
      payload: UploadAppleBusinessManagerTokenRequest,
      success: AppleBusinessManagerInfo,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteAppleBusinessManagerToken", "/v1/tenants/:tenantId/abm/token", {
      error: EnterpriseAppleWriteErrors,
      params: TenantParam,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.post("syncAppleBusinessManager", "/v1/tenants/:tenantId/abm/sync", {
      error: EnterpriseAppleWriteErrors,
      params: TenantParam,
      success: AppleBusinessManagerSyncResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("listAbmDevices", "/v1/tenants/:tenantId/abm/devices", {
      error: EnterpriseAppleReadErrors,
      params: TenantParam,
      success: AbmDevicesResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getAbmDevice", "/v1/tenants/:tenantId/abm/devices/:serial", {
      error: EnterpriseAppleReadErrors,
      params: { tenantId: Schema.String, serial: Schema.String },
      success: AbmDeviceInfo,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "assignAppleBusinessManagerDevice",
      "/v1/tenants/:tenantId/abm/devices/:serial/assign",
      {
        error: EnterpriseAppleWriteErrors,
        params: { tenantId: Schema.String, serial: Schema.String },
        success: AbmAssignDeviceResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get(
      "getAbmDeviceProfileUrl",
      "/v1/tenants/:tenantId/abm/devices/:serial/profile-url",
      {
        error: EnterpriseAppleWriteErrors,
        params: { tenantId: Schema.String, serial: Schema.String },
        success: AbmProfileUrlResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get(
      "getAppleFdeEscrowKey",
      "/v1/tenants/:tenantId/apple/filevault-escrow-key",
      {
        error: EnterpriseAppleReadErrors,
        params: TenantParam,
        success: AppleFdeEscrowKeyInfo,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "generateAppleFdeEscrowKey",
      "/v1/tenants/:tenantId/apple/filevault-escrow-key",
      {
        error: EnterpriseAppleWriteErrors,
        params: TenantParam,
        success: AppleFdeEscrowKeyInfo,
      },
    ),
  )
  .add(
    HttpApiEndpoint.put(
      "uploadAppleFdeEscrowKey",
      "/v1/tenants/:tenantId/apple/filevault-escrow-key",
      {
        error: EnterpriseAppleWriteErrors,
        params: TenantParam,
        payload: UploadAppleFdeEscrowKeyRequest,
        success: AppleFdeEscrowKeyInfo,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get("getVpp", "/v1/tenants/:tenantId/vpp", {
      error: EnterpriseAppleReadErrors,
      params: TenantParam,
      success: VppInfo,
    }),
  )
  .add(
    HttpApiEndpoint.put("uploadVppToken", "/v1/tenants/:tenantId/vpp/token", {
      error: EnterpriseAppleWriteErrors,
      params: TenantParam,
      payload: UploadVppTokenRequest,
      success: VppInfo,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteVppToken", "/v1/tenants/:tenantId/vpp/token", {
      error: EnterpriseAppleWriteErrors,
      params: TenantParam,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.post("syncVpp", "/v1/tenants/:tenantId/vpp/sync", {
      error: EnterpriseAppleWriteErrors,
      params: TenantParam,
      success: VppSyncResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("listVppAssets", "/v1/tenants/:tenantId/vpp/assets", {
      error: EnterpriseAppleReadErrors,
      params: TenantParam,
      success: VppAssetsResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("listVppAssignments", "/v1/tenants/:tenantId/vpp/assignments", {
      error: EnterpriseAppleReadErrors,
      params: TenantParam,
      success: VppAssignmentsResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("installVppAsset", "/v1/tenants/:tenantId/vpp/assets/:adamId/install", {
      error: EnterpriseAppleWriteErrors,
      params: { tenantId: Schema.String, adamId: Schema.String },
      payload: VppInstallRequest,
      success: VppInstallResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("releaseVppAsset", "/v1/tenants/:tenantId/vpp/assets/:adamId/release", {
      error: EnterpriseAppleWriteErrors,
      params: { tenantId: Schema.String, adamId: Schema.String },
      payload: VppReleaseRequest,
      success: VppReleaseResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("search", "/v1/tenants/:tenantId/search", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      query: Schema.Struct({
        q: Schema.optional(Schema.String),
        limit: Schema.optional(Schema.Number),
      }),
      success: SearchResult,
    }),
  )
  .add(
    HttpApiEndpoint.get("listDevices", "/v1/tenants/:tenantId/devices", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: DeviceListResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("searchDevices", "/v1/tenants/:tenantId/devices/search", {
      error: EnterpriseTenantValidatedReadErrors,
      params: TenantParam,
      query: DeviceSearchQuery,
      success: DeviceSearchResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("listDashboards", "/v1/tenants/:tenantId/dashboards", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: DashboardListResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("createDashboard", "/v1/tenants/:tenantId/dashboards", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: CreateDashboardRequest,
      success: Schema.Struct({ id: Schema.String }),
    }),
  )
  .add(
    HttpApiEndpoint.get("getDashboard", "/v1/tenants/:tenantId/dashboards/:dashboardId", {
      error: EnterpriseTenantReadErrors,
      params: TenantDashboardParam,
      success: Dashboard,
    }),
  )
  .add(
    HttpApiEndpoint.patch("patchDashboard", "/v1/tenants/:tenantId/dashboards/:dashboardId", {
      error: EnterpriseTenantWriteErrors,
      params: TenantDashboardParam,
      payload: PatchDashboardRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteDashboard", "/v1/tenants/:tenantId/dashboards/:dashboardId", {
      error: EnterpriseTenantWriteErrors,
      params: TenantDashboardParam,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "createDashboardWidget",
      "/v1/tenants/:tenantId/dashboards/:dashboardId/widgets",
      {
        error: EnterpriseTenantWriteErrors,
        params: TenantDashboardParam,
        payload: CreateDashboardWidgetRequest,
        success: DashboardWidget,
      },
    ),
  )
  .add(
    HttpApiEndpoint.patch(
      "patchDashboardWidget",
      "/v1/tenants/:tenantId/dashboards/:dashboardId/widgets/:widgetId",
      {
        error: EnterpriseTenantWriteErrors,
        params: TenantDashboardWidgetParam,
        payload: PatchDashboardWidgetRequest,
        success: DashboardWidget,
      },
    ),
  )
  .add(
    HttpApiEndpoint.delete(
      "deleteDashboardWidget",
      "/v1/tenants/:tenantId/dashboards/:dashboardId/widgets/:widgetId",
      {
        error: EnterpriseTenantWriteErrors,
        params: TenantDashboardWidgetParam,
        success: Schema.Struct({ status: Schema.Literal("ok") }),
      },
    ),
  )
  .add(
    HttpApiEndpoint.patch(
      "patchDashboardLayout",
      "/v1/tenants/:tenantId/dashboards/:dashboardId/layout",
      {
        error: EnterpriseTenantWriteErrors,
        params: TenantDashboardParam,
        payload: DashboardLayoutRequest,
        success: Schema.Struct({ status: Schema.Literal("ok") }),
      },
    ),
  )
  .add(
    HttpApiEndpoint.post("queryDashboard", "/v1/tenants/:tenantId/dashboard-query", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      payload: DashboardQueryRequest,
      success: DashboardQueryResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("exportDevices", "/v1/tenants/:tenantId/devices/export", {
      error: EnterpriseTenantValidatedReadErrors,
      params: TenantParam,
      query: DeviceSearchQuery,
      success: Schema.String.pipe(HttpApiSchema.asText({ contentType: "text/csv; charset=utf-8" })),
    }),
  )
  .add(
    HttpApiEndpoint.get("getDevice", "/v1/tenants/:tenantId/devices/:id", {
      error: EnterpriseTenantReadErrors,
      params: TenantIdParam,
      success: DeviceRow,
    }),
  )
  .add(
    HttpApiEndpoint.get(
      "listDeviceApplications",
      "/v1/tenants/:tenantId/devices/:id/applications",
      {
        error: EnterpriseTenantReadErrors,
        params: TenantIdParam,
        success: DeviceApplicationsResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get("getDeviceRecoveryKey", "/v1/tenants/:tenantId/devices/:id/recovery-key", {
      // Revealing a recovery key is a privileged, audited read. `write`
      // restricts the endpoint to owners/admins while still requiring the
      // caller to prove tenant membership.
      error: [...EnterpriseTenantWriteErrors, ...EnterpriseStepUpRequired],
      params: TenantIdParam,
      success: DeviceRecoveryKeyResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getDeviceLocalAdmin", "/v1/tenants/:tenantId/devices/:id/local-admin", {
      error: [...EnterpriseTenantWriteErrors, ...EnterpriseStepUpRequired],
      params: TenantIdParam,
      success: DeviceLocalAdminResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get(
      "getDeviceActivationLockBypassCode",
      "/v1/tenants/:tenantId/devices/:id/activation-lock-bypass-code",
      {
        // Same privilege, step-up and audit requirements as the recovery key.
        error: [...EnterpriseTenantWriteErrors, ...EnterpriseStepUpRequired],
        params: TenantIdParam,
        success: DeviceActivationLockBypassCodeResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get(
      "getDeviceEffectivePolicy",
      "/v1/tenants/:tenantId/devices/:id/effective-policy",
      {
        error: EnterpriseTenantReadErrors,
        params: TenantIdParam,
        success: EffectivePolicyResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.delete("deleteDevices", "/v1/tenants/:tenantId/devices", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: IdsRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.get(
      "listDevicePreRegistrations",
      "/v1/tenants/:tenantId/device-pre-registrations",
      {
        error: EnterpriseTenantReadErrors,
        params: TenantParam,
        success: DevicePreRegistrationListResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "importDevicePreRegistrations",
      "/v1/tenants/:tenantId/device-pre-registrations/import",
      {
        error: EnterpriseTenantWriteErrors,
        params: TenantParam,
        payload: DevicePreRegistrationImportRequest,
        success: DevicePreRegistrationImportResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.delete(
      "deleteDevicePreRegistration",
      "/v1/tenants/:tenantId/device-pre-registrations/:id",
      {
        error: EnterpriseTenantWriteErrors,
        params: TenantPreRegistrationParam,
        success: Schema.Struct({ status: Schema.Literal("ok") }),
      },
    ),
  )
  .add(
    HttpApiEndpoint.delete(
      "deleteDevicePreRegistrations",
      "/v1/tenants/:tenantId/device-pre-registrations",
      {
        error: EnterpriseTenantWriteErrors,
        params: TenantParam,
        payload: IdsRequest,
        success: Schema.Struct({ status: Schema.Literal("ok") }),
      },
    ),
  )
  .add(
    HttpApiEndpoint.patch("patchDevice", "/v1/tenants/:tenantId/devices/:id", {
      error: EnterpriseTenantWriteErrors,
      params: TenantIdParam,
      payload: PatchDeviceRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.post("deviceAction", "/v1/tenants/:tenantId/devices/:id/action", {
      error: [...EnterpriseTenantWriteErrors, ...EnterpriseStepUpRequired],
      params: TenantIdParam,
      payload: DeviceActionRequest,
      success: DeviceActionResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("listDeviceCommands", "/v1/tenants/:tenantId/devices/:id/commands", {
      error: EnterpriseTenantReadErrors,
      params: TenantIdParam,
      success: DeviceCommandsResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get(
      "listDeviceDeclarations",
      "/v1/tenants/:tenantId/devices/:id/declarations",
      {
        error: EnterpriseTenantReadErrors,
        params: TenantIdParam,
        success: DeviceDeclarationsResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get("listDeviceAppleUsers", "/v1/tenants/:tenantId/devices/:id/apple-users", {
      error: EnterpriseTenantReadErrors,
      params: TenantIdParam,
      success: AppleDeviceUsersResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "deviceAppleUserAction",
      "/v1/tenants/:tenantId/devices/:id/apple-users/:userId/action",
      {
        // `refresh-profiles` queues a command, so it needs the write role; it
        // is not destructive enough to demand a step-up (device `sync` and
        // `refresh-applications` do not either).
        error: EnterpriseTenantWriteErrors,
        params: TenantDeviceUserParam,
        payload: AppleUserActionRequest,
        success: AppleUserActionResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post("deviceUnenroll", "/v1/tenants/:tenantId/devices/:id/unenroll", {
      error: EnterpriseTenantWriteErrors,
      params: TenantIdParam,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.get("getDeviceHealth", "/v1/tenants/:tenantId/devices/:id/health", {
      error: EnterpriseTenantReadErrors,
      params: TenantIdParam,
      success: DeviceHealthResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getDeviceActivity", "/v1/tenants/:tenantId/devices/:id/activity", {
      error: EnterpriseTenantValidatedReadErrors,
      params: TenantIdParam,
      query: Schema.Struct({
        limit: Schema.optional(Schema.Number),
        /**
         * Opaque keyset position returned as `nextCursor` by the previous
         * page. Keyset paging never re-reads the events already delivered.
         */
        cursor: Schema.optional(Schema.String),
        /**
         * Retired offset paging. Only `0` (the first page) is still accepted;
         * deeper pages must use `cursor`.
         */
        offset: Schema.optional(Schema.Number),
      }),
      success: DeviceActivityResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "revokeDeviceIdentity",
      "/v1/tenants/:tenantId/devices/:id/revoke-identity",
      {
        error: EnterpriseTenantWriteErrors,
        params: TenantIdParam,
        success: DeviceIdentityRevokeResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get("getDeviceHealthSummary", "/v1/tenants/:tenantId/device-health", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: DeviceHealthSummaryResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getDevicePushHealth", "/v1/tenants/:tenantId/push-health", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: DevicePushHealthResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getCredentialHealth", "/v1/tenants/:tenantId/credential-health", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: CredentialHealthResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("listGroups", "/v1/tenants/:tenantId/groups", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: GroupListResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getGroup", "/v1/tenants/:tenantId/groups/:id", {
      error: EnterpriseTenantReadErrors,
      params: TenantIdParam,
      success: GroupNode,
    }),
  )
  .add(
    HttpApiEndpoint.get("previewGroup", "/v1/tenants/:tenantId/groups/:id/preview", {
      error: EnterpriseTenantReadErrors,
      params: TenantIdParam,
      success: GroupPreviewResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("createGroup", "/v1/tenants/:tenantId/groups", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: CreateGroupRequest,
      success: IdResponse,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteGroups", "/v1/tenants/:tenantId/groups", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: IdsRequest,
      success: BulkOperationResult,
    }),
  )
  .add(
    HttpApiEndpoint.patch("patchGroup", "/v1/tenants/:tenantId/groups/:id", {
      error: EnterpriseTenantWriteErrors,
      params: TenantIdParam,
      payload: PatchGroupRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.patch("patchGroupMembers", "/v1/tenants/:tenantId/groups/:id/members", {
      error: EnterpriseTenantWriteErrors,
      params: TenantIdParam,
      payload: PatchGroupMembersRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.post("syncGroups", "/v1/tenants/:tenantId/groups/sync", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: IdsRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.post("duplicateGroup", "/v1/tenants/:tenantId/groups/:id/duplicate", {
      error: EnterpriseTenantWriteErrors,
      params: TenantIdParam,
      payload: DuplicateRequest,
      success: IdResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("listDirectory", "/v1/tenants/:tenantId/directory", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: DirectoryResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getDeviceUsers", "/v1/tenants/:tenantId/devices/:id/users", {
      error: EnterpriseTenantReadErrors,
      params: TenantIdParam,
      success: DeviceUsersResponse,
    }),
  )
  .add(
    HttpApiEndpoint.put("setDeviceUsers", "/v1/tenants/:tenantId/devices/:id/users", {
      error: EnterpriseTenantWriteErrors,
      params: TenantIdParam,
      payload: SetDeviceUsersRequest,
      success: DeviceUsersResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getPolicyAssignments", "/v1/tenants/:tenantId/policies/:id/assignments", {
      error: EnterpriseTenantReadErrors,
      params: TenantIdParam,
      success: PolicyAssignmentsResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("listPolicies", "/v1/tenants/:tenantId/policies", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: PolicyListResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getPolicy", "/v1/tenants/:tenantId/policies/:id", {
      error: EnterpriseTenantReadErrors,
      params: TenantIdParam,
      success: PolicyRow,
    }),
  )
  .add(
    HttpApiEndpoint.post("createPolicy", "/v1/tenants/:tenantId/policies", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: CreatePolicyRequest,
      success: IdResponse,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deletePolicies", "/v1/tenants/:tenantId/policies", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: IdsRequest,
      success: BulkOperationResult,
    }),
  )
  .add(
    HttpApiEndpoint.patch("patchPolicy", "/v1/tenants/:tenantId/policies/:id", {
      error: EnterpriseTenantWriteErrors,
      params: TenantIdParam,
      payload: PatchPolicyRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "uploadPolicyApplication",
      "/v1/tenants/:tenantId/policies/:id/applications",
      {
        error: EnterprisePolicyApplicationUploadErrors,
        params: TenantIdParam,
        payload: UploadPolicyApplicationRequest,
        success: PolicyApplicationObject,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get(
      "downloadPolicyApplication",
      "/v1/tenants/:tenantId/policies/:id/applications/:sha256",
      {
        error: EnterprisePolicyApplicationDownloadErrors,
        params: { tenantId: Schema.String, id: Schema.String, sha256: Schema.String },
        success: DownloadPolicyApplicationResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get("listApplications", "/v1/tenants/:tenantId/applications", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: ApplicationListResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getApplicationInventory", "/v1/tenants/:tenantId/applications/inventory", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      query: ApplicationInventoryQuery,
      success: ApplicationInventoryResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getApplication", "/v1/tenants/:tenantId/applications/:id", {
      error: EnterpriseTenantReadErrors,
      params: TenantIdParam,
      success: ApplicationNode,
    }),
  )
  .add(
    HttpApiEndpoint.post("createApplication", "/v1/tenants/:tenantId/applications", {
      error: EnterpriseApplicationErrors,
      params: TenantParam,
      payload: CreateApplicationRequest,
      success: IdResponse,
    }),
  )
  .add(
    HttpApiEndpoint.patch("patchApplication", "/v1/tenants/:tenantId/applications/:id", {
      error: EnterpriseApplicationErrors,
      params: TenantIdParam,
      payload: PatchApplicationRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteApplications", "/v1/tenants/:tenantId/applications", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: IdsRequest,
      success: BulkOperationResult,
    }),
  )
  .add(
    HttpApiEndpoint.patch(
      "patchApplicationAssignments",
      "/v1/tenants/:tenantId/applications/:id/assignments",
      {
        error: EnterpriseTenantWriteErrors,
        params: TenantIdParam,
        payload: PatchApplicationAssignmentsRequest,
        success: Schema.Struct({ status: Schema.Literal("ok") }),
      },
    ),
  )
  .add(
    HttpApiEndpoint.post("installApplication", "/v1/tenants/:tenantId/applications/:id/install", {
      error: EnterpriseTenantWriteErrors,
      params: TenantIdParam,
      success: ApplicationInstallResult,
    }),
  )
  .add(
    HttpApiEndpoint.post("uploadApplication", "/v1/tenants/:tenantId/applications/:id/upload", {
      error: EnterpriseApplicationUploadErrors,
      params: TenantIdParam,
      payload: UploadPolicyApplicationRequest,
      success: PolicyApplicationObject,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "uploadApplicationInstaller",
      "/v1/tenants/:tenantId/applications/:id/installers/:installerId/upload",
      {
        error: EnterpriseApplicationUploadErrors,
        params: Schema.Struct({
          tenantId: Schema.String,
          id: Schema.String,
          installerId: Schema.String,
        }),
        payload: UploadPolicyApplicationRequest,
        success: PolicyApplicationObject,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get(
      "downloadApplicationInstaller",
      "/v1/tenants/:tenantId/applications/:id/installers/:installerId/download/:sha256",
      {
        error: EnterpriseApplicationDownloadErrors,
        params: Schema.Struct({
          tenantId: Schema.String,
          id: Schema.String,
          installerId: Schema.String,
          sha256: Schema.String,
        }),
        success: DownloadPolicyApplicationResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get(
      "downloadApplication",
      "/v1/tenants/:tenantId/applications/:id/download/:sha256",
      {
        error: EnterpriseApplicationDownloadErrors,
        params: Schema.Struct({
          tenantId: Schema.String,
          id: Schema.String,
          sha256: Schema.String,
        }),
        success: DownloadPolicyApplicationResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.patch(
      "patchPolicyAssignments",
      "/v1/tenants/:tenantId/policies/:id/assignments",
      {
        error: EnterpriseTenantWriteErrors,
        params: TenantIdParam,
        payload: PatchPolicyAssignmentsRequest,
        success: Schema.Struct({ status: Schema.Literal("ok") }),
      },
    ),
  )
  .add(
    HttpApiEndpoint.get("listPolicyDeployments", "/v1/tenants/:tenantId/policies/:id/deployments", {
      error: EnterpriseTenantReadErrors,
      params: TenantIdParam,
      success: PolicyDeploymentsResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "rollbackPolicy",
      "/v1/tenants/:tenantId/policies/:id/deployments/:deploymentId/rollback",
      {
        error: EnterpriseTenantWriteErrors,
        params: {
          tenantId: Schema.String,
          id: Schema.String,
          deploymentId: Schema.String,
        },
        success: Schema.Struct({ status: Schema.Literal("ok") }),
      },
    ),
  )
  .add(
    HttpApiEndpoint.post("syncPolicies", "/v1/tenants/:tenantId/policies/sync", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: IdsRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.post("duplicatePolicy", "/v1/tenants/:tenantId/policies/:id/duplicate", {
      error: EnterpriseTenantWriteErrors,
      params: TenantIdParam,
      payload: DuplicateRequest,
      success: IdResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("extractMobileconfig", "/v1/policy/extract-mobileconfig", {
      error: [...EnterpriseNoDomainErrors, EnterpriseBadRequest.pipe(HttpApiSchema.status(400))],
      payload: Schema.Struct({ mobileconfig: Schema.String }),
      success: Schema.Struct({ plist: Schema.String }),
    }),
  )
  .add(
    HttpApiEndpoint.post("previewMobileconfig", "/v1/policy/preview-mobileconfig", {
      error: [...EnterpriseNoDomainErrors, EnterpriseBadRequest.pipe(HttpApiSchema.status(400))],
      payload: Schema.Struct({ mobileconfig: Schema.String }),
      success: MobileconfigPreview,
    }),
  )
  .add(
    HttpApiEndpoint.get("billing", "/v1/tenants/:tenantId/billing", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: BillingSummary,
    }),
  )
  .add(
    HttpApiEndpoint.post("billingPortal", "/v1/tenants/:tenantId/billing/portal", {
      error: [...EnterpriseBillingPortalErrors, ...EnterpriseStepUpRequired],
      params: TenantParam,
      payload: BillingPortalRequest,
      success: BillingPortalResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("billingCheckout", "/v1/tenants/:tenantId/billing/checkout", {
      error: [...EnterpriseBillingPortalErrors, ...EnterpriseStepUpRequired],
      params: TenantParam,
      payload: BillingCheckoutRequest,
      success: BillingCheckoutResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("billingInvoices", "/v1/tenants/:tenantId/billing/invoices", {
      error: EnterpriseBillingReadErrors,
      params: TenantParam,
      success: BillingInvoicesResponse,
    }),
  )
  .prefix("/api")
  .annotateMerge(
    OpenApi.annotations({
      title: "Mattrax Enterprise API",
      description: "Organization-scoped Mattrax management API.",
    }),
  );

/**
 * Public Automated Device Enrollment endpoints.
 *
 * Kept in a small top-level group: Setup Assistant calls them without an
 * Authorization header, and the main group is already at the declaration
 * emitter's size limit.
 */
