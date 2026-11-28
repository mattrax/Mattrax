import { AccountId, ApprovalId, AttributeId, ConnectionId, DashboardId, DeploymentId, GroupId, InstallerId, InvitationId, MigrationEntryId, MigrationId, PolicyId, ProfileId, ReportId, RoleId, SessionId, TagId, TenantId, TokenId, UserId, ViewId, WebhookDeliveryId, WebhookId, WidgetId } from "@mattrax/crypto";
import { infiniteQueryOptions, keepPreviousData, queryOptions } from "@tanstack/solid-query";
import type { InfiniteData, QueryClient, QueryFunctionContext } from "@tanstack/solid-query";
import type {
  AdminAccountsQuery,
  AppleUserActionName,
  UpdateMeRequest,
  UpdateTenantOsPolicyRequest,
} from "@mattrax/enterprise-domain/client";
import { Effect, Option, Schema } from "effect";
import {
  HttpBody,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpMethod,
} from "effect/http";
import { HttpApiClient } from "effect/http-api";
import type { Accessor } from "solid-js";
import { approvalFailure, errorTag, raisedFailure, stepUpFailure } from "~/lib/errors";
import {
  ApprovalRequiredError,
  approvalHeaders,
  registerApprovalRetry,
} from "~/lib/approval-retry";
import type { ApprovalRetryInput } from "~/lib/approval-retry";
import { webHttpClientLayer } from "~/lib/web-http";
import { enterpriseSecurityHeaders } from "~/lib/enterprise-headers";
import { ME_QUERY_KEY } from "~/lib/me-keys";
import { buildMeQueryOptions } from "~/lib/me-options";
import { currentTenantDirectory, resolveTenant, resolveTenantId } from "~/lib/tenant";
import {
  requestStepUp,
  stepUpGrant,
  StepUpActionSchema,
  StepUpMethodSchema,
} from "~/lib/step-up-bus";
import type { StepUpAction } from "~/lib/step-up-bus";
import { getRequestEvent, isServer } from "@solidjs/web";
import {
  ApprovalRequired,
  EnterpriseBadRequest,
  StepUpRequired,
  fleetMigrationHttpApi,
  makeEnterpriseClient,
  restrictedSoftwareHttpApi,
  scriptHttpApi,
  DeviceRow,
  GroupRow,
  PolicyRow,
  formatDeviceQueryText,
  parseDeviceQueryText,
} from "@mattrax/enterprise-domain/client";
import type {
  AndroidEnterpriseInfo,
  AndroidProvisioningMode,
  AndroidSignupResponse,
  AndroidSyncResponse,
  AbmAssignDeviceResponse,
  AbmDeviceInfo,
  AbmDevicesResponse,
  AbmProfileUrlResponse,
  AppleBusinessManagerInfo,
  AppleBusinessManagerSyncResponse,
  ApplicationInventoryQuery,
  ApplicationSearchQuery,
  ApplicationSearchResponse,
  AddCatalogueTitleRequest,
  CatalogueSearchQuery,
  CatalogueSearchResponse,
  AuditSearchQuery,
  AuditSearchResponse,
  AutopilotImportRequest,
  CutoverExportRequest,
  CutoverImportRequest,
  CutoverPreviewRequest,
  CutoverPreflightQuery,
  CreateAttributeRequest,
  CreateFleetMigrationRequest,
  IssueFleetMigrationUnenrolRequest,
  PatchAttributeRequest,
  PatchEnrollmentQuestionsRequest,
  SetDeviceAttributesRequest,
  CreateAutopilotProfileRequest,
  DevicePreRegistrationImportRequest,
  DeviceHandoverRequest,
  DeviceSearchQuery,
  DeviceViewQuery,
  DashboardQueryRequest,
  DashboardReportFormat,
  CreateDashboardReportRequest,
  PatchDashboardReportRequest,
  DashboardSummary,
  PatchDashboardWidgetRequest,
  DashboardWidgetType,
  DynamicGroupKind,
  DynamicGroupRules,
  Entity,
  GroupNode,
  GroupSearchQuery,
  GroupSearchResponse,
  PolicySearchQuery,
  PolicySearchResponse,
  RowFor,
  TenantEnrollmentInfo,
  TenantScepCaInfo,
  TenantImportRequest,
  TenantInfo,
  BackupRestoreResponse,
  CreateTenantRoleRequest,
  CreateApprovalPolicyRequest,
  PatchApprovalPolicyRequest,
  ApprovalRequestQuery,
  ListTenantInvitationsQuery,
  PatchTenantRoleRequest,
  UpdateAutopilotProfileRequest,
  VppAssetsResponse,
  VppInfo,
  VppInstallResponse,
  VppReleaseResponse,
  VppSyncResponse,
  WebhookEndpointInfo,
  WebhookDeliveryQuery,
  CreateScriptRequest,
  PatchScriptRequest,
  PatchScriptAssignmentsRequest,
  RunScriptRequest,
  ScriptSettings,
  CreateRestrictedSoftwareRequest,
  PatchRestrictedSoftwareRequest,
  PatchRestrictedSoftwareAssignmentsRequest,
} from "@mattrax/enterprise-domain/client";

export type {
  DashboardReport,
  DashboardReportFormat,
  DashboardReportFrequency,
  DashboardReportRecipients,
  DashboardReportRun,
  DashboardReportRunListResponse,
  DashboardReportListResponse,
} from "@mattrax/enterprise-domain/client";

export type {
  CreateRestrictedSoftwareRequest,
  DeviceRestrictedSoftwareResponse,
  PatchRestrictedSoftwareAssignmentsRequest,
  PatchRestrictedSoftwareRequest,
  RestrictedSoftwareAssignmentInfo,
  RestrictedSoftwareDetail,
  RestrictedSoftwareListResponse,
  RestrictedSoftwareRuleInfo,
  RestrictedSoftwareViolationInfo,
  RestrictedSoftwareViolationsResponse,
} from "@mattrax/enterprise-domain/client";

export type {
  AdminAccountInfo,
  AdminAccountMembership,
  AdminAccountsQuery,
  AdminAccountsResponse,
  AndroidEnrollment,
  AndroidEnterpriseInfo,
  AndroidSignupResponse,
  AndroidSyncResponse,
  AbmAssignDeviceResponse,
  AbmDeviceInfo,
  AbmDevicesResponse,
  AbmProfileUrlResponse,
  AppleBusinessManagerInfo,
  AppleBusinessManagerSyncResponse,
  ApplicationInventoryQuery,
  ApplicationInventoryResponse,
  ApplicationInventoryRow,
  ApplicationNode,
  ApplicationRow,
  ApplicationSearchQuery,
  ApplicationSearchResponse,
  CatalogueAddition,
  CatalogueDeployment,
  CatalogueTitle,
  CatalogueTitleResponse,
  ApnsInfo,
  AcceptInvitationResponse,
  AccountAuditEntry,
  AccountAuditSearchResponse,
  AccountRecoveryResponse,
  AccountSessionInfo,
  AccountSessionsResponse,
  AuditLogEntry,
  AuditSearchQuery,
  AuditSearchResponse,
  TenantSecuritySettings,
  AutopilotDeploymentMode,
  AutopilotDeviceInfo,
  AutopilotImportRequest,
  AutopilotJoinType,
  AutopilotProfileInfo,
  AutopilotSettingsResponse,
  CreateAutopilotProfileRequest,
  UpdateAutopilotProfileRequest,
  CreateInvitationResponse,
  InvitationOptionsResponse,
  InvitationPreviewResponse,
  InvitationPreviewState,
  InvitationRoleOption,
  InvitationStatus,
  ListTenantInvitationsQuery,
  ResendTenantInvitationResponse,
  BillingSummary,
  BillingInvoice,
  BillingInvoicesResponse,
  CredentialHealthResponse,
  BackupRunInfo,
  BackupRestoreResponse,
  TenantBackupsResponse,
  StorageCategory,
  StorageObject,
  StorageUsageResponse,
  CredentialInfo,
  CredentialLevel,
  DeviceActivityEntry,
  DeviceActivityKind,
  DeviceApplication,
  DeviceApplicationsResponse,
  AppleDeviceUser,
  AppleDeviceUsersResponse,
  AppleUserActionName,
  DeviceCertificateCounts,
  DeviceCertificateInfo,
  DeviceFileVaultStatus,
  DeviceHealth,
  DeviceHealthCounts,
  DeviceHealthFilter,
  DeviceHealthReason,
  DeviceHealthResponse,
  DevicePreRegistrationImportRequest,
  DevicePreRegistrationImportResponse,
  DevicePreRegistrationImportResult,
  DevicePreRegistrationListResponse,
  DeviceCondition,
  DevicePreRegistrationRow,
  DeviceQuery,
  DevicePushErrorCode,
  DevicePushFailure,
  DevicePushHealthCounts,
  DevicePushHealthResponse,
  DevicePushInfo,
  DeviceActivationLockBypassCodeResponse,
  DeviceRecoveryKeyResponse,
  AppleFdeEscrowKeyInfo,
  DeviceRow,
  DeviceSearchQuery,
  DeviceSearchRow,
  DeviceView,
  DeviceViewQuery,
  McpConnectionInfo,
  McpConnectionsResponse,
  DynamicGroupCondition,
  DynamicGroupKind,
  DynamicGroupRules,
  Dashboard,
  DashboardDataset,
  DashboardQueryRequest,
  DashboardQueryResponse,
  DashboardSummary,
  DashboardWidget,
  DashboardWidgetType,
  DownloadPolicyApplicationResponse as PolicyApplicationDownload,
  EffectivePolicyResponse,
  EnrollmentAttempt,
  EnrollmentAttemptOutcome,
  EnrollmentAttemptPlatform,
  EnrollmentResponse,
  Entity,
  GroupNode,
  GroupPreviewResponse,
  GroupRow,
  GroupSearchQuery,
  GroupSearchResponse,
  MeResponse,
  NodeResponse,
  PlatformEnrollment,
  PolicyApplicationObject,
  PolicyDeploymentCounts,
  PolicyDeploymentDevice,
  PolicyDeploymentDeviceStatus,
  PolicyDeploymentProgressResponse,
  PolicyRow,
  PolicySearchQuery,
  PolicySearchResponse,
  RowFor,
  ScimTokenInfo,
  SsoConfigResponse,
  TenantDetail,
  TenantBranding,
  TenantEnrollmentInfo,
  TenantImportRequest,
  TenantImportResponse,
  TenantInfo,
  TenantRole,
  TenantRolesResponse,
  CreateTenantRoleRequest,
  PatchTenantRoleRequest,
  TenantInvitation,
  TenantAccount,
  TenantOwnershipTransfer,
  UserDetail,
  UserPolicyAssignment,
  UserGroupRef,
  UserListRow,
  UserDeviceRef,
  DirectoryUserMergeCandidate,
  DirectoryUserMergeCandidatesResponse,
  DirectoryUserMergePreview,
  DirectoryUserMergeResult,
  DirectoryUserMergeSource,
  DirectoryUserRef,
  UserMergeCounts,
  OwnershipTransferPreviewResponse,
  RequestTenantOwnershipTransferResponse,
  AccountInfo,
  VppAssetInfo,
  VppAssetsResponse,
  VppAssignmentInfo,
  VppInfo,
  VppInstallResponse,
  VppReleaseResponse,
  VppSyncResponse,
  WebhookEndpointInfo,
  WebhookDeliveryInfo,
  WebhookDeliveryDetail,
  WebhookDeliveriesResponse,
  WebhookDeliveryReplayResponse,
  WebhookTestResponse,
  WindowsEnrollment,
  ScriptInfo,
  ScriptDetail,
  ScriptExecutionInfo,
  ScriptAssignmentsResponse,
  ScriptExecutionsResponse,
  ScriptSettings,
  CreateScriptRequest,
  PatchScriptRequest,
  PatchScriptAssignmentsRequest,
  RunScriptRequest,
} from "@mattrax/enterprise-domain/client";

export { formatDeviceQueryText, parseDeviceQueryText };

type RouteParam = string | undefined;

type EndpointPromise<A, E> = Promise<A> & { readonly __error?: E };

type EnterpriseApiClient = Effect.Success<ReturnType<typeof clientEffect>>["EnterpriseApi"] &
  Effect.Success<ReturnType<typeof clientEffect>>["EnterpriseApplication"] &
  Effect.Success<ReturnType<typeof clientEffect>>["EnterpriseSoftwareCatalogue"] &
  Effect.Success<ReturnType<typeof clientEffect>>["EnterpriseGroup"] &
  Effect.Success<ReturnType<typeof clientEffect>>["EnterpriseDeviceView"] &
  Effect.Success<ReturnType<typeof clientEffect>>["EnterpriseDeviceHandover"] &
  Effect.Success<ReturnType<typeof clientEffect>>["EnterpriseWindows"] &
  Effect.Success<ReturnType<typeof clientEffect>>["EnterpriseOnboarding"] &
  Effect.Success<ReturnType<typeof clientEffect>>["EnterpriseApproval"] &
  Effect.Success<ReturnType<typeof clientEffect>>["EnterpriseScopeTag"];

type EnterpriseAccountClient = Effect.Success<ReturnType<typeof clientEffect>>["EnterpriseAccount"];

type EnterpriseAdminClient = Effect.Success<ReturnType<typeof clientEffect>>["EnterpriseAdmin"];

type EnterpriseAttributeClient = Effect.Success<
  ReturnType<typeof clientEffect>
>["EnterpriseAttribute"];

type EnterpriseDashboardClient = Effect.Success<
  ReturnType<typeof clientEffect>
>["EnterpriseDashboard"];

type EnterpriseIdentityClient = Effect.Success<
  ReturnType<typeof clientEffect>
>["EnterpriseIdentity"];

type EnterpriseUserClient = Effect.Success<ReturnType<typeof clientEffect>>["EnterpriseUser"];

type EnterpriseListClient = Effect.Success<ReturnType<typeof clientEffect>>["EnterpriseList"];

type EnterpriseWindowsClient = Effect.Success<ReturnType<typeof clientEffect>>["EnterpriseWindows"];

type EnterpriseSoftwareUpdateClient = Effect.Success<
  ReturnType<typeof clientEffect>
>["EnterpriseSoftwareUpdate"];

type EnterpriseOsPolicyClient = Effect.Success<
  ReturnType<typeof clientEffect>
>["EnterpriseOsPolicy"];

type EnterpriseCutoverClient = Effect.Success<ReturnType<typeof clientEffect>>["EnterpriseCutover"];

type ScriptApiClient = Effect.Success<ReturnType<typeof scriptClientEffect>>["ScriptApi"];

/**
 * Migration cohorts are their own HttpApi, like scripts, so the main contract's
 * generated client type stays within TypeScript's declaration-size limit.
 */
const migrationClientEffect = (
  headers: Readonly<Record<string, string>>,
  context: EnterpriseRequestContext = {},
) => {
  const event = requestEventOf(context);
  const origin = enterpriseRequestOrigin(context);
  const baseUrl = event
    ? new URL("/", event.request.url).toString()
    : (globalThis.location?.origin ?? "/");

  return HttpApiClient.make(fleetMigrationHttpApi, {
    baseUrl,
    transformClient: (client) =>
      HttpClient.mapRequest((request) =>
        HttpClientRequest.setHeaders(request, {
          ...headers,
          ...enterpriseSecurityHeaders(request.method, origin),
        }),
      )(client),
  });
};

type FleetMigrationApiClient = Effect.Success<
  ReturnType<typeof migrationClientEffect>
>["FleetMigration"];

/**
 * Types the migration pages render. Re-exported here so a page imports them
 * alongside the queries instead of reaching into the domain package.
 */
export type {
  FleetMigrationDetail,
  FleetMigrationEntry,
  FleetMigrationSummary,
} from "@mattrax/enterprise-domain/client";

/**
 * Query keys must not change when a tenant URL moves between its canonical slug
 * and its id (the shell rewrites one to the other). Keying on the resolved id
 * keeps the cached data mounted, so the segment swap neither refetches nor
 * suspends the navigation.
 */
const keyTenant = (tenantId: RouteParam) =>
  tenantId ? (resolveTenantId(tenantId) ?? tenantId) : "";

/**
 * A row normalised from a list or search response. Summaries live in their own
 * cache entries so a partial or permission-filtered row can never be mistaken
 * for the authoritative detail response.
 */
export type EntitySummary<E extends Entity = Entity> = {
  readonly tenantId: string;
  readonly entity: E;
  readonly id: string;
  readonly row: RowFor<E>;
};

type EntitySummaryQueryCache = Pick<QueryClient, "getQueryData" | "getQueryState" | "setQueryData">;

const isEntityRow = <E extends Entity>(entity: E, value: unknown): value is RowFor<E> => {
  // SAFETY: each branch validates against the schema selected by `entity`, so
  // the predicate is exactly the conditional `RowFor<E>` mapping.
  switch (entity) {
    case "device":
      return Schema.is(DeviceRow)(value);
    case "group":
      return Schema.is(GroupRow)(value);
    case "policy":
      return Schema.is(PolicyRow)(value);
  }
};

/** Cache only complete row shapes, under an identity separate from detail data. */
export const cacheEntityRows = <E extends Entity>(
  queryClient: EntitySummaryQueryCache,
  tenantId: RouteParam,
  entity: E,
  rows: readonly unknown[],
): void => {
  const tenant = keyTenant(tenantId);

  if (!tenant) return;

  for (const value of rows) {
    if (!isEntityRow(entity, value) || value.id.length === 0) continue;

    const summary: EntitySummary<E> = {
      tenantId: tenant,
      entity,
      id: value.id,
      // Detach the top-level row from the list response. Nested values are
      // immutable domain data and are never written to by summary consumers.
      row: { ...value },
    };

    queryClient.setQueryData(enterpriseKeys.entitySummary(tenant, entity, value.id), summary);
  }
};

/**
 * Read a summary for a detail query's `placeholderData`. Invalidated summaries
 * are ignored until a fresh list/search response replaces them, and the stored
 * identity is rechecked so a malformed or cross-tenant entry is never rendered.
 */
export const entitySummaryPlaceholder = <E extends Entity>(
  queryClient: EntitySummaryQueryCache,
  tenantId: RouteParam,
  entity: E,
  id: RouteParam,
): RowFor<E> | undefined => {
  const tenant = keyTenant(tenantId);

  if (!tenant || !id) return undefined;

  const queryKey = enterpriseKeys.entitySummary(tenant, entity, id);

  if (queryClient.getQueryState(queryKey)?.isInvalidated) return undefined;

  const summary = queryClient.getQueryData<EntitySummary<E>>(queryKey);

  if (
    !summary ||
    summary.tenantId !== tenant ||
    summary.entity !== entity ||
    summary.id !== id ||
    !isEntityRow(entity, summary.row) ||
    summary.row.id !== id
  )
    return undefined;

  return summary.row;
};

export const enterpriseKeys = {
  me: () => ME_QUERY_KEY,
  accountDeletion: () => ["enterprise", "account-deletion"] as const,
  tenants: () => ["enterprise", "tenants"] as const,
  tenant: (tenantId: RouteParam) => ["enterprise", "tenant", keyTenant(tenantId)] as const,
  backups: (tenantId: RouteParam) => ["enterprise", "backups", keyTenant(tenantId)] as const,
  /** Every cached list of one entity, ignoring any group filter. */
  listPrefix: (tenantId: RouteParam, entity: Entity) =>
    ["enterprise", "list", keyTenant(tenantId), entity] as const,
  list: (tenantId: RouteParam, entity: Entity, group?: string) =>
    ["enterprise", "list", keyTenant(tenantId), entity, group ?? ""] as const,
  summaryPrefix: (tenantId: RouteParam) =>
    ["enterprise", "entity-summary", keyTenant(tenantId)] as const,
  entitySummaryPrefix: (tenantId: RouteParam, entity: Entity) =>
    [...enterpriseKeys.summaryPrefix(tenantId), entity] as const,
  entitySummary: (tenantId: RouteParam, entity: Entity, id: RouteParam) =>
    [...enterpriseKeys.entitySummaryPrefix(tenantId, entity), id ?? ""] as const,
  /** Every cached page of one entity's server-paginated list. */
  entitySearchPrefix: (tenantId: RouteParam, entity: Entity | "application") =>
    ["enterprise", "entity-search", keyTenant(tenantId), entity] as const,
  entitySearch: (
    tenantId: RouteParam,
    entity: Entity | "application",
    query: GroupSearchQuery | PolicySearchQuery | ApplicationSearchQuery = {},
  ) => ["enterprise", "entity-search", keyTenant(tenantId), entity, query] as const,
  /** Every cached device search for a tenant, ignoring the active filters. */
  deviceSearchPrefix: (tenantId: RouteParam) =>
    ["enterprise", "device-search", keyTenant(tenantId)] as const,
  deviceSearch: (tenantId: RouteParam, query: DeviceSearchQuery = {}) =>
    ["enterprise", "device-search", keyTenant(tenantId), query] as const,
  deviceViews: (tenantId: RouteParam) =>
    ["enterprise", "device-views", keyTenant(tenantId)] as const,
  deviceHealth: (tenantId: RouteParam, id: RouteParam) =>
    ["enterprise", "device-health", keyTenant(tenantId), id ?? ""] as const,
  deviceHealthSummary: (tenantId: RouteParam) =>
    ["enterprise", "device-health-summary", keyTenant(tenantId)] as const,
  softwareUpdates: (tenantId: RouteParam) =>
    ["enterprise", "software-updates", keyTenant(tenantId)] as const,
  osPolicy: (tenantId: RouteParam) => ["enterprise", "os-policy", keyTenant(tenantId)] as const,
  osFleet: (tenantId: RouteParam) => ["enterprise", "os-fleet", keyTenant(tenantId)] as const,
  devicePushHealth: (tenantId: RouteParam) =>
    ["enterprise", "device-push-health", keyTenant(tenantId)] as const,
  windowsFailures: (tenantId: RouteParam, deviceId?: string) =>
    ["enterprise", "windows-failures", keyTenant(tenantId), deviceId ?? "tenant"] as const,
  deviceActivity: (tenantId: RouteParam, id: RouteParam) =>
    ["enterprise", "device-activity", keyTenant(tenantId), id ?? ""] as const,
  credentialHealth: (tenantId: RouteParam) =>
    ["enterprise", "credential-health", keyTenant(tenantId)] as const,
  item: (tenantId: RouteParam, entity: Entity, id: RouteParam) =>
    ["enterprise", "item", keyTenant(tenantId), entity, id ?? ""] as const,
  accounts: (tenantId: RouteParam) =>
    ["enterprise", "tenant-accounts", keyTenant(tenantId)] as const,
  roles: (tenantId: RouteParam) => ["enterprise", "tenant-roles", keyTenant(tenantId)] as const,
  scopeTags: (tenantId: RouteParam) => ["enterprise", "scope-tags", keyTenant(tenantId)] as const,
  scopeTagAssignmentsPrefix: (tenantId: RouteParam) =>
    ["enterprise", "scope-tag-assignments", keyTenant(tenantId)] as const,
  scopeTagAssignments: (tenantId: RouteParam, resourceType: string, resourceIds?: string) =>
    [
      "enterprise",
      "scope-tag-assignments",
      keyTenant(tenantId),
      resourceType,
      resourceIds ?? "",
    ] as const,
  approvalPolicies: (tenantId: RouteParam) =>
    ["enterprise", "approval-policies", keyTenant(tenantId)] as const,
  approvalRequests: (tenantId: RouteParam, query: ApprovalRequestQuery = {}) =>
    ["enterprise", "approval-requests", keyTenant(tenantId), query] as const,
  invitations: (tenantId: RouteParam) =>
    ["enterprise", "tenant-invitations", keyTenant(tenantId)] as const,
  invitationOptions: (tenantId: RouteParam) =>
    ["enterprise", "tenant-invitation-options", keyTenant(tenantId)] as const,
  ownershipTransfer: (tenantId: RouteParam) =>
    ["enterprise", "tenant-ownership-transfer", keyTenant(tenantId)] as const,
  apns: (tenantId: RouteParam) => ["enterprise", "apns", keyTenant(tenantId)] as const,
  android: (tenantId: RouteParam) => ["enterprise", "android", keyTenant(tenantId)] as const,
  abm: (tenantId: RouteParam) => ["enterprise", "abm", keyTenant(tenantId)] as const,
  abmDevices: (tenantId: RouteParam) => ["enterprise", "abm-devices", keyTenant(tenantId)] as const,
  abmDevice: (tenantId: RouteParam, serial: RouteParam) =>
    ["enterprise", "abm-device", keyTenant(tenantId), serial ?? ""] as const,
  vpp: (tenantId: RouteParam) => ["enterprise", "vpp", keyTenant(tenantId)] as const,
  vppAssets: (tenantId: RouteParam) => ["enterprise", "vpp-assets", keyTenant(tenantId)] as const,
  vppAssignments: (tenantId: RouteParam) =>
    ["enterprise", "vpp-assignments", keyTenant(tenantId)] as const,
  storageUsage: (tenantId: RouteParam) =>
    ["enterprise", "storage-usage", keyTenant(tenantId)] as const,
  billing: (tenantId: RouteParam) => ["enterprise", "billing", keyTenant(tenantId)] as const,
  billingInvoices: (tenantId: RouteParam) =>
    ["enterprise", "billing-invoices", keyTenant(tenantId)] as const,
  enrollment: (tenantId: RouteParam) => ["enterprise", "enrollment", keyTenant(tenantId)] as const,
  appleByod: (tenantId: RouteParam) => ["enterprise", "apple-byod", keyTenant(tenantId)] as const,
  scepCa: (tenantId: RouteParam) => ["enterprise", "scep-ca", keyTenant(tenantId)] as const,
  enrollmentAttempts: (tenantId: RouteParam, limit = 50) =>
    ["enterprise", "enrollment-attempts", keyTenant(tenantId), limit] as const,
  devicePreRegistrations: (tenantId: RouteParam) =>
    ["enterprise", "device-pre-registrations", keyTenant(tenantId)] as const,
  attributes: (tenantId: RouteParam) => ["enterprise", "attributes", keyTenant(tenantId)] as const,
  deviceAttributeCollection: (tenantId: RouteParam, deviceId: RouteParam) =>
    ["enterprise", "attributes", "collection", keyTenant(tenantId), deviceId] as const,
  enrollmentQuestions: (tenantId: RouteParam) =>
    ["enterprise", "enrollment-questions", keyTenant(tenantId)] as const,
  policyVariables: (tenantId: RouteParam) =>
    ["enterprise", "policy-variables", keyTenant(tenantId)] as const,
  search: (tenantId: RouteParam, term: string, limit = 30) =>
    ["enterprise", "search", keyTenant(tenantId), term, limit] as const,
  mcpConnections: () => ["enterprise", "mcp-connections"] as const,
  dashboards: (tenantId: RouteParam) => ["enterprise", "dashboards", keyTenant(tenantId)] as const,
  onboarding: (tenantId: RouteParam) => ["enterprise", "onboarding", keyTenant(tenantId)] as const,
  dashboard: (tenantId: RouteParam, id: RouteParam) =>
    ["enterprise", "dashboard", keyTenant(tenantId), id ?? ""] as const,
  dashboardQuery: (tenantId: RouteParam, request: DashboardQueryRequest) =>
    ["enterprise", "dashboard-query", keyTenant(tenantId), request] as const,
  dashboardQueryBatch: (tenantId: RouteParam, requests: ReadonlyArray<DashboardQueryRequest>) =>
    ["enterprise", "dashboard-query-batch", keyTenant(tenantId), requests] as const,
  dashboardReports: (tenantId: RouteParam, dashboardId: RouteParam) =>
    ["enterprise", "dashboard-reports", keyTenant(tenantId), dashboardId ?? ""] as const,
  dashboardReportRuns: (tenantId: RouteParam, dashboardId: RouteParam, reportId: RouteParam) =>
    [
      "enterprise",
      "dashboard-report-runs",
      keyTenant(tenantId),
      dashboardId ?? "",
      reportId ?? "",
    ] as const,
  auditLog: (tenantId: RouteParam) => ["enterprise", "audit-log", keyTenant(tenantId)] as const,
  accountActivity: (query: AuditSearchQuery = {}) =>
    ["enterprise", "account-activity", query] as const,
  loginAttempts: (accountId: string | undefined) =>
    ["enterprise", "login-attempts", accountId ?? ""] as const,
  tenantSecurity: (tenantId: RouteParam) =>
    ["enterprise", "tenant-security", keyTenant(tenantId)] as const,
  auditSearch: (tenantId: RouteParam, query: AuditSearchQuery = {}) =>
    ["enterprise", "audit-search", keyTenant(tenantId), query] as const,
  scim: (tenantId: RouteParam) => ["enterprise", "scim", keyTenant(tenantId)] as const,
  webhooks: (tenantId: RouteParam) => ["enterprise", "webhooks", keyTenant(tenantId)] as const,
  webhookDeliveries: (
    tenantId: RouteParam,
    webhookId: RouteParam,
    filters: { event?: string; status?: "succeeded" | "failed" } = {},
  ) =>
    [
      "enterprise",
      "webhook-deliveries",
      keyTenant(tenantId),
      webhookId ?? "",
      filters.event ?? "",
      filters.status ?? "",
    ] as const,
  sso: (tenantId: RouteParam) => ["enterprise", "sso", keyTenant(tenantId)] as const,
  applications: (tenantId: RouteParam) =>
    ["enterprise", "applications", keyTenant(tenantId)] as const,
  softwareCatalogue: (tenantId: RouteParam, query: CatalogueSearchQuery = {}) =>
    ["enterprise", "software-catalogue", keyTenant(tenantId), query] as const,
  softwareCatalogueTitle: (tenantId: RouteParam, titleId: RouteParam) =>
    ["enterprise", "software-catalogue", keyTenant(tenantId), "title", titleId ?? ""] as const,
  softwareCataloguePrefix: (tenantId: RouteParam) =>
    ["enterprise", "software-catalogue", keyTenant(tenantId)] as const,
  applicationInventory: (tenantId: RouteParam, query: ApplicationInventoryQuery = {}) =>
    ["enterprise", "application-inventory", keyTenant(tenantId), query] as const,
  deviceApplications: (tenantId: RouteParam, id: RouteParam) =>
    ["enterprise", "device-applications", keyTenant(tenantId), id ?? ""] as const,
  deviceRecoveryKey: (tenantId: RouteParam, id: RouteParam) =>
    ["enterprise", "device-recovery-key", keyTenant(tenantId), id ?? ""] as const,
  application: (tenantId: RouteParam, id: RouteParam) =>
    ["enterprise", "application", keyTenant(tenantId), id ?? ""] as const,
  scripts: (tenantId: RouteParam) => ["enterprise", "scripts", keyTenant(tenantId)] as const,
  restrictedSoftware: (tenantId: RouteParam) =>
    ["enterprise", "restricted-software", keyTenant(tenantId)] as const,
  restrictedSoftwareRule: (tenantId: RouteParam, id: RouteParam) =>
    ["enterprise", "restricted-software-rule", keyTenant(tenantId), id ?? ""] as const,
  restrictedSoftwareViolations: (
    tenantId: RouteParam,
    query: { status?: string; platform?: string; ruleId?: string } = {},
  ) =>
    [
      "enterprise",
      "restricted-software-violations",
      keyTenant(tenantId),
      query.status ?? "",
      query.platform ?? "",
      query.ruleId ?? "",
    ] as const,
  deviceRestrictedSoftware: (tenantId: RouteParam, id: RouteParam) =>
    ["enterprise", "device-restricted-software", keyTenant(tenantId), id ?? ""] as const,
  restrictedSoftwareTargets: (tenantId: RouteParam) =>
    ["enterprise", "restricted-software-targets", keyTenant(tenantId)] as const,
  fleetMigrations: (tenantId: RouteParam) =>
    ["enterprise", "fleet-migrations", keyTenant(tenantId)] as const,
  fleetMigration: (tenantId: RouteParam, migrationId: RouteParam) =>
    ["enterprise", "fleet-migration", keyTenant(tenantId), migrationId ?? ""] as const,
  script: (tenantId: RouteParam, id: RouteParam) =>
    ["enterprise", "script", keyTenant(tenantId), id ?? ""] as const,
  scriptAssignments: (tenantId: RouteParam, id: RouteParam) =>
    ["enterprise", "script-assignments", keyTenant(tenantId), id ?? ""] as const,
  scriptExecutions: (tenantId: RouteParam, id: RouteParam, deviceId?: string) =>
    ["enterprise", "script-executions", keyTenant(tenantId), id ?? "", deviceId ?? ""] as const,
  policyAssignments: (tenantId: RouteParam, id: RouteParam) =>
    ["enterprise", "policy-assignments", keyTenant(tenantId), id ?? ""] as const,
  policyScope: (tenantId: RouteParam, id: RouteParam) =>
    ["enterprise", "policy-scope", keyTenant(tenantId), id ?? ""] as const,
  policyDeployment: (
    tenantId: RouteParam,
    id: RouteParam,
    version: string | number,
    limit = 50,
    offset = 0,
  ) =>
    [
      "enterprise",
      "policy-deployment",
      keyTenant(tenantId),
      id ?? "",
      String(version),
      limit,
      offset,
    ] as const,
  groupScope: (tenantId: RouteParam, id: RouteParam) =>
    ["enterprise", "group-scope", keyTenant(tenantId), id ?? ""] as const,
  deviceEffectivePolicy: (tenantId: RouteParam, id: RouteParam) =>
    ["enterprise", "device-effective-policy", keyTenant(tenantId), id ?? ""] as const,
  directory: (tenantId: RouteParam) => ["enterprise", "directory", keyTenant(tenantId)] as const,
  users: (tenantId: RouteParam) => ["enterprise", "users", keyTenant(tenantId)] as const,
  user: (tenantId: RouteParam, userId: RouteParam) =>
    ["enterprise", "user", keyTenant(tenantId), userId ?? ""] as const,
  userMergeCandidates: (tenantId: RouteParam, userId: RouteParam) =>
    ["enterprise", "user-merge-candidates", keyTenant(tenantId), userId ?? ""] as const,
  userMergePreview: (tenantId: RouteParam, userId: RouteParam, sourceIds: ReadonlyArray<string>) =>
    [
      "enterprise",
      "user-merge-preview",
      keyTenant(tenantId),
      userId ?? "",
      [...sourceIds].sort().join(","),
    ] as const,
  deviceUsers: (tenantId: RouteParam, id: RouteParam) =>
    ["enterprise", "device-users", keyTenant(tenantId), id ?? ""] as const,
  deviceAppleUsers: (tenantId: RouteParam, id: RouteParam) =>
    ["enterprise", "device-apple-users", keyTenant(tenantId), id ?? ""] as const,
  directorySync: (tenantId: RouteParam) =>
    ["enterprise", "directory-sync", keyTenant(tenantId)] as const,
  googleDirectorySync: (tenantId: RouteParam) =>
    ["enterprise", "google-directory-sync", keyTenant(tenantId)] as const,
  domains: (tenantId: RouteParam) => ["enterprise", "domains", keyTenant(tenantId)] as const,
  autopilot: (tenantId: RouteParam) => ["enterprise", "autopilot", keyTenant(tenantId)] as const,
  autopilotDevices: (tenantId: RouteParam) =>
    ["enterprise", "autopilot-devices", keyTenant(tenantId)] as const,
  autopilotProfiles: (tenantId: RouteParam) =>
    ["enterprise", "autopilot-profiles", keyTenant(tenantId)] as const,
  adminAccounts: (query: AdminAccountsQuery = {}) =>
    ["enterprise", "admin-accounts", query] as const,
};

const routeIdKinds = {
  tenantId: TenantId,
  accountId: AccountId,
  dashboardId: DashboardId,
  webhookId: WebhookId,
  migrationId: MigrationId,
  reportId: ReportId,
  userId: UserId,
  attributeId: AttributeId,
  approvalId: ApprovalId,
  viewId: ViewId,
  widgetId: WidgetId,
  entryId: MigrationEntryId,
  deliveryId: WebhookDeliveryId,
  invitationId: InvitationId,
  tagId: TagId,
  policyId: PolicyId,
  roleId: RoleId,
  connectionId: ConnectionId,
  groupId: GroupId,
  sessionId: SessionId,
} as const;

type RouteValue<N extends string> = N extends keyof typeof routeIdKinds
  ? ReturnType<(typeof routeIdKinds)[N]["fromParam"]>
  : string;

const required = <N extends string>(value: RouteParam, name: N): RouteValue<N> => {
  if (!value) throw new EnterpriseBadRequest({ message: `Missing ${name}` });

  // Tenant routes carry the canonical slug; the API addresses tenants by id.
  const resolved = name === "tenantId" ? (resolveTenantId(value) ?? value) : value;
  return resolved as RouteValue<N>;
};

const enterpriseRequestOrigin = (context: EnterpriseRequestContext = {}) => {
  const event = requestEventOf(context);

  return event ? new URL(event.request.url).origin : undefined;
};

const clientEffect = (
  headers: Readonly<Record<string, string>>,
  context: EnterpriseRequestContext = {},
) => {
  const event = requestEventOf(context);
  const origin = enterpriseRequestOrigin(context);
  const baseUrl = event
    ? new URL("/", event.request.url).toString()
    : (globalThis.location?.origin ?? "/");

  return makeEnterpriseClient({
    baseUrl,
    transformClient: (client) =>
      HttpClient.mapRequest((request) =>
        HttpClientRequest.setHeaders(request, {
          ...headers,
          ...enterpriseSecurityHeaders(request.method, origin),
        }),
      )(client),
  });
};

/**
 * Scripts are their own HttpApi so the main contract's generated client type
 * stays within TypeScript's declaration-size limit.
 */
const scriptClientEffect = (
  headers: Readonly<Record<string, string>>,
  context: EnterpriseRequestContext = {},
) => {
  const event = requestEventOf(context);
  const origin = enterpriseRequestOrigin(context);
  const baseUrl = event
    ? new URL("/", event.request.url).toString()
    : (globalThis.location?.origin ?? "/");

  return HttpApiClient.make(scriptHttpApi, {
    baseUrl,
    transformClient: (client) =>
      HttpClient.mapRequest((request) =>
        HttpClientRequest.setHeaders(request, {
          ...headers,
          ...enterpriseSecurityHeaders(request.method, origin),
        }),
      )(client),
  });
};

/** Restricted software is its own contract for the same declaration-size reason. */
const restrictedSoftwareClientEffect = (
  headers: Readonly<Record<string, string>>,
  context: EnterpriseRequestContext = {},
) => {
  const event = requestEventOf(context);
  const origin = enterpriseRequestOrigin(context);
  const baseUrl = event
    ? new URL("/", event.request.url).toString()
    : (globalThis.location?.origin ?? "/");

  return HttpApiClient.make(restrictedSoftwareHttpApi, {
    baseUrl,
    transformClient: (client) =>
      HttpClient.mapRequest((request) =>
        HttpClientRequest.setHeaders(request, {
          ...headers,
          ...enterpriseSecurityHeaders(request.method, origin),
        }),
      )(client),
  });
};

/**
 * Per-call request seams. Production callers omit both; tests provide a fake
 * transport and, for SSR header assertions, a request event. Unlike a module
 * mock this stays local to one call, so the shared module graph is unaffected.
 */
export type EnterpriseRequestContext = {
  readonly transport?: typeof webHttpClientLayer;
  readonly event?: { readonly request: Request };
};

/** Solid's SSR event for this call, unless a test supplied one explicitly. */
const requestEventOf = (context: EnterpriseRequestContext) =>
  context.event ?? (isServer ? getRequestEvent() : undefined);

type EndpointStepUp = EnterpriseRequestContext & {
  /** The action this endpoint requires a recent step-up for. */
  readonly stepUp?: StepUpAction | false;
  /** Approval-page action name when it differs from the step-up action. */
  readonly approvalAction?: string;
};

const enterpriseRequestHeaders = (
  grant: string | undefined,
  approval: ApprovalRetryInput | undefined,
  context: EnterpriseRequestContext = {},
) => {
  const cookie = requestEventOf(context)?.request.headers.get("cookie");
  return {
    ...approvalHeaders(approval),
    ...(grant ? { "x-mattrax-step-up": grant } : {}),
    ...(cookie ? { cookie } : {}),
  };
};

const decodeAction = Schema.decodeUnknownOption(StepUpActionSchema);
const decodeMethods = Schema.decodeUnknownOption(Schema.Array(StepUpMethodSchema));

/** One step-up/approval state machine for JSON and header-preserving downloads. */
const runEndpoint = <A>(
  attempt: (grant?: string, approval?: ApprovalRetryInput) => Promise<A>,
  options: EndpointStepUp = { stepUp: false },
): Promise<A> => {
  const action = options.stepUp || undefined;

  const run = async (approval?: ApprovalRetryInput): Promise<A> => {
    try {
      return await attempt(stepUpGrant(action), approval);
    } catch (error) {
      const failure = raisedFailure(error);

      if (errorTag(failure) === "ApprovalRequired") {
        const fields = approvalFailure(failure);
        const requestId = fields.requestId;

        if (requestId) {
          const status = fields.status === "approved" ? "approved" : "pending";

          registerApprovalRetry({
            requestId,
            action: options.approvalAction ?? action ?? "approval",
            retry: async (input) => {
              await run(input);
            },
          });

          throw new ApprovalRequiredError({
            message:
              status === "approved"
                ? "This request is approved. Retry with this approval."
                : "This action needs approval from another administrator.",
            requestId,
            status,
          });
        }

        throw error;
      }

      if (errorTag(failure) !== "StepUpRequired") throw error;

      const fields = stepUpFailure(failure);
      const required = Option.getOrUndefined(decodeAction(fields.action)) ?? action;

      if (!required) throw error;

      const methods = Option.getOrUndefined(decodeMethods(fields.methods));
      const grant = await requestStepUp(required, methods);

      return await attempt(grant, approval);
    }
  };

  return run();
};

function endpointWith<Client, A, E>(
  makeClient: (
    headers: Readonly<Record<string, string>>,
    context: EnterpriseRequestContext,
  ) => Effect.Effect<Client, never, HttpClient.HttpClient>,
  call: (api: Client) => Effect.Effect<A, E, never>,
  options: EndpointStepUp = { stepUp: false },
): EndpointPromise<A, E | EnterpriseBadRequest> {
  const attempt = (grant?: string, approval?: ApprovalRetryInput) => {
    const effect = makeClient(enterpriseRequestHeaders(grant, approval, options), options).pipe(
      Effect.flatMap((api) =>
        Effect.try({
          try: () => call(api),
          catch: (cause) =>
            cause instanceof EnterpriseBadRequest
              ? cause
              : new EnterpriseBadRequest({ message: "Invalid endpoint parameters" }),
        }).pipe(Effect.flatten),
      ),
    );

    // SAFETY: the assertion restores the generic success type the client erases.
    return Effect.runPromise(
      effect.pipe(Effect.provide(options.transport ?? webHttpClientLayer)),
    ) as Promise<A>;
  };

  return runEndpoint(attempt, options) as EndpointPromise<A, E | EnterpriseBadRequest>;
}

const GuardedDownloadFailure = Schema.Union([StepUpRequired, ApprovalRequired]);
const decodeGuardedDownloadFailure = Schema.decodeUnknownOption(GuardedDownloadFailure);

export type EnterpriseDownloadOptions = EndpointStepUp & {
  readonly method?: HttpMethod.HttpMethod;
  readonly body?: Schema.Json;
  readonly headers?: Readonly<Record<string, string>>;
};

const download = (
  path: string | (() => string),
  options: EnterpriseDownloadOptions = { stepUp: false },
): Promise<Response> =>
  runEndpoint((grant, approval) => {
    const effect = Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const requestPath = yield* Effect.try({
        try: () => (typeof path === "function" ? path() : path),
        catch: (cause) =>
          cause instanceof EnterpriseBadRequest
            ? cause
            : new EnterpriseBadRequest({ message: "Invalid download parameters" }),
      });
      const method = options.method ?? "GET";
      const response = yield* client.execute(
        HttpClientRequest.make(method)(requestPath, {
          headers: {
            ...enterpriseRequestHeaders(grant, approval, options),
            ...options.headers,
            ...enterpriseSecurityHeaders(method, enterpriseRequestOrigin(options)),
          },
          ...(options.body === undefined ? {} : { body: HttpBody.jsonUnsafe(options.body) }),
        }),
      );

      if (response.status === 403) {
        const body = yield* response.json;
        const failure = Option.getOrUndefined(decodeGuardedDownloadFailure(body));

        if (failure) return yield* Effect.fail(failure);

        return Response.json(body, {
          status: response.status,
          headers: { ...response.headers },
        });
      }

      const web = Option.getOrUndefined(HttpClientResponse.toWeb(response));

      if (!web)
        return yield* Effect.fail(
          new EnterpriseBadRequest({ message: "The download transport returned no Web response" }),
        );

      return web;
    });

    return Effect.runPromise(effect.pipe(Effect.provide(options.transport ?? webHttpClientLayer)));
  }, options);

function endpoint<A, E>(
  call: (api: EnterpriseApiClient) => Effect.Effect<A, E, never>,
  options: EndpointStepUp = { stepUp: false },
): EndpointPromise<A, E | EnterpriseBadRequest> {
  return endpointWith(
    (headers, context) =>
      Effect.map(clientEffect(headers, context), (client) => ({
        ...client.EnterpriseApi,
        ...client.EnterpriseApplication,
        ...client.EnterpriseSoftwareCatalogue,
        ...client.EnterpriseGroup,
        ...client.EnterpriseDeviceView,
        ...client.EnterpriseDeviceHandover,
        ...client.EnterpriseWindows,
        ...client.EnterpriseOnboarding,
        ...client.EnterpriseApproval,
        ...client.EnterpriseScopeTag,
      })),
    call,
    options,
  );
}

function accountEndpoint<A, E>(
  call: (api: EnterpriseAccountClient) => Effect.Effect<A, E, never>,
  options: EndpointStepUp = { stepUp: false },
): EndpointPromise<A, E | EnterpriseBadRequest> {
  return endpointWith(
    (headers, context) =>
      Effect.map(clientEffect(headers, context), (client) => client.EnterpriseAccount),
    call,
    options,
  );
}

function adminEndpoint<A, E>(
  call: (api: EnterpriseAdminClient) => Effect.Effect<A, E, never>,
): EndpointPromise<A, E | EnterpriseBadRequest> {
  return endpointWith(
    (headers, context) =>
      Effect.map(clientEffect(headers, context), (client) => client.EnterpriseAdmin),
    call,
  );
}

function attributeEndpoint<A, E>(
  call: (api: EnterpriseAttributeClient) => Effect.Effect<A, E, never>,
  options: EndpointStepUp = { stepUp: false },
): EndpointPromise<A, E | EnterpriseBadRequest> {
  return endpointWith(
    (headers, context) =>
      Effect.map(clientEffect(headers, context), (client) => client.EnterpriseAttribute),
    call,
    options,
  );
}

function dashboardEndpoint<A, E>(
  call: (api: EnterpriseDashboardClient) => Effect.Effect<A, E, never>,
): EndpointPromise<A, E | EnterpriseBadRequest> {
  return endpointWith(
    (headers, context) =>
      Effect.map(clientEffect(headers, context), (client) => client.EnterpriseDashboard),
    call,
  );
}

function userEndpoint<A, E>(
  call: (api: EnterpriseUserClient) => Effect.Effect<A, E, never>,
  options: EndpointStepUp = { stepUp: false },
): EndpointPromise<A, E | EnterpriseBadRequest> {
  return endpointWith(
    (headers, context) =>
      Effect.map(clientEffect(headers, context), (client) => client.EnterpriseUser),
    call,
    options,
  );
}

function identityEndpoint<A, E>(
  call: (api: EnterpriseIdentityClient) => Effect.Effect<A, E, never>,
  options: EndpointStepUp = { stepUp: false },
): EndpointPromise<A, E | EnterpriseBadRequest> {
  return endpointWith(
    (headers, context) =>
      Effect.map(clientEffect(headers, context), (client) => client.EnterpriseIdentity),
    call,
    options,
  );
}

function softwareUpdateEndpoint<A, E>(
  call: (api: EnterpriseSoftwareUpdateClient) => Effect.Effect<A, E, never>,
): EndpointPromise<A, E | EnterpriseBadRequest> {
  return endpointWith(
    (headers, context) =>
      Effect.map(clientEffect(headers, context), (client) => client.EnterpriseSoftwareUpdate),
    call,
  );
}

function osPolicyEndpoint<A, E>(
  call: (api: EnterpriseOsPolicyClient) => Effect.Effect<A, E, never>,
  options: EndpointStepUp = { stepUp: false },
): EndpointPromise<A, E | EnterpriseBadRequest> {
  return endpointWith(
    (headers, context) =>
      Effect.map(clientEffect(headers, context), (client) => client.EnterpriseOsPolicy),
    call,
    options,
  );
}

function cutoverEndpoint<A, E>(
  call: (api: EnterpriseCutoverClient) => Effect.Effect<A, E, never>,
  options: EndpointStepUp = { stepUp: false },
): EndpointPromise<A, E | EnterpriseBadRequest> {
  return endpointWith(
    (headers, context) =>
      Effect.map(clientEffect(headers, context), (client) => client.EnterpriseCutover),
    call,
    options,
  );
}

function listEndpoint<A, E>(
  call: (api: EnterpriseListClient) => Effect.Effect<A, E, never>,
): EndpointPromise<A, E | EnterpriseBadRequest> {
  return endpointWith(
    (headers, context) =>
      Effect.map(clientEffect(headers, context), (client) => client.EnterpriseList),
    call,
  );
}

function windowsEndpoint<A, E>(
  call: (api: EnterpriseWindowsClient) => Effect.Effect<A, E, never>,
): EndpointPromise<A, E | EnterpriseBadRequest> {
  return endpointWith(
    (headers, context) =>
      Effect.map(clientEffect(headers, context), (client) => client.EnterpriseWindows),
    call,
  );
}

function migrationEndpoint<A, E>(
  call: (api: FleetMigrationApiClient) => Effect.Effect<A, E, never>,
  options: EndpointStepUp = { stepUp: false },
): EndpointPromise<A, E | EnterpriseBadRequest> {
  return endpointWith(
    (headers, context) =>
      Effect.map(migrationClientEffect(headers, context), (client) => client.FleetMigration),
    call,
    options,
  );
}

type RestrictedSoftwareApiClient = Effect.Success<
  ReturnType<typeof restrictedSoftwareClientEffect>
>["RestrictedSoftwareApi"];

function restrictedSoftwareEndpoint<A, E>(
  call: (api: RestrictedSoftwareApiClient) => Effect.Effect<A, E, never>,
  options: EndpointStepUp = { stepUp: false },
): EndpointPromise<A, E | EnterpriseBadRequest> {
  return endpointWith(
    (headers, context) =>
      Effect.map(
        restrictedSoftwareClientEffect(headers, context),
        (client) => client.RestrictedSoftwareApi,
      ),
    call,
    options,
  );
}

function scriptEndpoint<A, E>(
  call: (api: ScriptApiClient) => Effect.Effect<A, E, never>,
  options: EndpointStepUp = { stepUp: false },
): EndpointPromise<A, E | EnterpriseBadRequest> {
  return endpointWith(
    (headers, context) =>
      Effect.map(scriptClientEffect(headers, context), (client) => client.ScriptApi),
    call,
    options,
  );
}

type EndpointData<T> = T extends EndpointPromise<infer A, unknown> ? A : never;

type EndpointError<T> = T extends EndpointPromise<unknown, infer E> ? E : never;

const enterpriseQueryOptions = <
  A,
  E,
  T extends EndpointPromise<A, E>,
  TQueryKey extends readonly unknown[],
>(options: {
  queryKey: TQueryKey;
  queryFn: (context: QueryFunctionContext<TQueryKey>) => T;
  /** Best-effort cache hydration from a successful endpoint response. */
  onData?: (data: EndpointData<T>, client: QueryClient) => void;
  enabled?: boolean;
  /** Leave endpoint failures in state instead of throwing to the error boundary. */
  throwOnError?: boolean;
  suspense?: boolean;
  /** Override the cache's stale window for a query that must reflect a just-made change. */
  staleTime?: number;
  refetchOnMount?: boolean | "always";
}) =>
  queryOptions<EndpointData<T>, EndpointError<T>, EndpointData<T>, TQueryKey>({
    queryKey: options.queryKey,
    queryFn: async (context) => {
      // SAFETY: awaiting the endpoint promise removes its phantom error field;
      // its resolved value is exactly `EndpointData<T>`.
      const data = (await options.queryFn(context)) as EndpointData<T>;
      options.onData?.(data, context.client);

      return data;
    },
    throwOnError: options.throwOnError,
    ...(options.suspense === undefined ? {} : { suspense: options.suspense }),
    staleTime: options.staleTime,
    refetchOnMount: options.refetchOnMount,
    // The API Worker authenticates with the browser's cookie; a server render
    // has no reliable way to forward it through every endpoint. Keep all
    // endpoint queries idle during SSR and let hydration fetch them.
    enabled: !isServer && (options.enabled ?? true),
  });

export type ApplicationInstallerPayload = {
  id?: string;
  platform: "apple" | "win" | "android";
  source?: "manifest" | "store" | "upload";
  bundleId?: string | null;
  version?: string | null;
  manifestUrl?: string | null;
  storeId?: string | null;
  minOsVersion?: string | null;
  requiredCapability?: string | null;
  priority?: number;
};

export const enterprise = {
  /** Header/body-preserving application request for thin browser adapters. */
  request: (
    path: string,
    options: Omit<EnterpriseDownloadOptions, "stepUp" | "approvalAction"> = {},
  ) => download(path, { ...options, stepUp: false }),
  me: () => accountEndpoint((api) => api.me({})),
  /** Whether this account can be deleted, and the tenant the cascade would remove. */
  getAccountDeletion: () => accountEndpoint((api) => api.getAccountDeletion({})),
  /**
   * Delete the account and the solo tenant it owns. The server re-checks the
   * typed address and the ownership/membership rules, so the result is not
   * trusted from the preview alone.
   */
  deleteAccount: (payload: { confirmEmail: string }, context: EnterpriseRequestContext = {}) =>
    accountEndpoint((api) => api.deleteMe({ payload }), { ...context }),
  /** Account-level profile fields, including the default landing tenant. */
  updateMe: (payload: UpdateMeRequest, context: EnterpriseRequestContext = {}) =>
    accountEndpoint((api) => api.updateMe({ payload }), { ...context }),
  /** Platform operator catalogue; the API rejects non-superadmins. */
  listAdminAccounts: (query: AdminAccountsQuery = {}) =>
    adminEndpoint((api) => api.listAdminAccounts({ query })),
  patchAdminAccountSuperadmin: (accountId: RouteParam, superadmin: boolean) =>
    adminEndpoint((api) =>
      api.patchAdminAccountSuperadmin({
        params: { accountId: required(accountId, "accountId") },
        payload: { superadmin },
      }),
    ),
  getEnrollment: (id: RouteParam, code?: string) =>
    endpoint((api) => api.getEnrollment({ params: { id: required(id, "id") }, query: { code } })),
  listTenants: (context: EnterpriseRequestContext = {}) =>
    endpoint((api) => api.listTenants({}), { ...context }),
  createTenant: (payload: {
    name: string;
    slug: string;
    logo?: string | null;
    displayName?: string | null;
    supportEmail?: string | null;
    brandColor?: string | null;
    metadata?: Record<string, Schema.Json>;
  }) => endpoint((api) => api.createTenant({ payload })),
  /** Returns the versioned JSON bundle; callers turn it into a file download. */
  exportTenant: (tenantId: RouteParam, query: { includeAudit?: boolean } = {}) =>
    endpoint((api) =>
      api.exportTenant({
        params: { tenantId: required(tenantId, "tenantId") },
        query: query.includeAudit ? { includeAudit: "true" } : {},
      }),
    ),
  /** Header-preserving export; only the browser adapter turns it into a file. */
  exportTenantDownload: (tenantId: RouteParam, includeAudit = false) =>
    download(
      () =>
        `/api/v1/tenants/${encodeURIComponent(required(tenantId, "tenantId"))}/export${includeAudit ? "?includeAudit=true" : ""}`,
      { stepUp: false, approvalAction: "tenant.export" },
    ),
  /** Creates a new tenant owned by the caller from an exported bundle. */
  importTenant: (payload: TenantImportRequest) => endpoint((api) => api.importTenant({ payload })),
  /**
   * Encrypted archive with device identities, the SCEP CA and escrowed secrets.
   * Requires `cutover-export` step-up in addition to tenant.export.
   */
  exportTenantCutover: (tenantId: RouteParam, payload: CutoverExportRequest) =>
    cutoverEndpoint(
      (api) =>
        api.exportTenantCutover({
          params: { tenantId: required(tenantId, "tenantId") },
          payload,
        }),
      { stepUp: "cutover-export" },
    ),
  /** Verify an archive and list conflicts without writing anything. */
  previewTenantCutover: (payload: CutoverPreviewRequest) =>
    cutoverEndpoint((api) => api.previewTenantCutover({ payload })),
  /** Apply an archive. Requires `cutover-import` step-up. */
  importTenantCutover: (payload: CutoverImportRequest) =>
    cutoverEndpoint((api) => api.importTenantCutover({ payload }), { stepUp: "cutover-import" }),
  /** What a change of ORIGIN breaks, counted for this tenant. */
  getTenantCutoverPreflight: (tenantId: RouteParam, query: CutoverPreflightQuery = {}) =>
    cutoverEndpoint((api) =>
      api.getTenantCutoverPreflight({
        params: { tenantId: required(tenantId, "tenantId") },
        query,
      }),
    ),
  /** Runs a manual backup now and records the attempt. */
  runTenantBackup: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.runTenantBackup({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  /** Recent scheduled/manual backup runs, newest first. */
  listTenantBackups: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.listTenantBackups({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  /** Header-preserving backup download with shared step-up/approval retries. */
  downloadTenantBackup: (tenantId: RouteParam, id: RouteParam) =>
    download(
      () =>
        `/api/v1/tenants/${encodeURIComponent(required(tenantId, "tenantId"))}/backups/${encodeURIComponent(required(id, "id"))}/download`,
      { stepUp: "backup-download", approvalAction: "backup.download" },
    ),
  /** Exempt a run from age-based pruning. Requires step-up. */
  pinTenantBackup: (tenantId: RouteParam, id: RouteParam) =>
    endpoint(
      (api) =>
        api.pinTenantBackup({
          params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
        }),
      { stepUp: "backup-pin" },
    ),
  /** Return a pinned run to the normal retention window. Requires step-up. */
  unpinTenantBackup: (tenantId: RouteParam, id: RouteParam) =>
    endpoint(
      (api) =>
        api.unpinTenantBackup({
          params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
        }),
      { stepUp: "backup-pin" },
    ),
  /** Delete one run and its stored object. Requires step-up. */
  deleteTenantBackup: (tenantId: RouteParam, id: RouteParam) =>
    endpoint(
      (api) =>
        api.deleteTenantBackup({
          params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
        }),
      { stepUp: "backup-delete" },
    ),
  /** Restore a run into this tenant, after retyping its slug. Requires step-up. */
  restoreTenantBackup: (
    tenantId: RouteParam,
    id: RouteParam,
    confirm: string,
  ): Promise<BackupRestoreResponse> =>
    endpoint(
      (api) =>
        api.restoreTenantBackup({
          params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
          payload: { confirm },
        }),
      { stepUp: "backup-restore" },
    ),
  getTenant: (tenantId: RouteParam) =>
    endpoint((api) => api.getTenant({ params: { tenantId: required(tenantId, "tenantId") } })),
  getTenantOnboarding: (tenantId: RouteParam, context: EnterpriseRequestContext = {}) =>
    endpoint(
      (api) => api.getTenantOnboarding({ params: { tenantId: required(tenantId, "tenantId") } }),
      { ...context },
    ),
  patchTenantOnboarding: (
    tenantId: RouteParam,
    dismissed: boolean,
    context: EnterpriseRequestContext = {},
  ) =>
    endpoint(
      (api) =>
        api.patchTenantOnboarding({
          params: { tenantId: required(tenantId, "tenantId") },
          payload: { dismissed },
        }),
      { ...context },
    ),
  patchTenant: (
    tenantId: RouteParam,
    payload: Partial<{
      name: string;
      slug: string;
      logo: string | null;
      displayName: string | null;
      supportEmail: string | null;
      brandColor: string | null;
      metadata: Record<string, Schema.Json> | null;
      appStoreRegion: string | null;
      autoUnlinkUnavailableApplications: boolean;
    }>,
  ) =>
    endpoint((api) =>
      api.patchTenant({ params: { tenantId: required(tenantId, "tenantId") }, payload }),
    ),
  deleteTenant: (tenantId: RouteParam) =>
    endpoint((api) => api.deleteTenant({ params: { tenantId: required(tenantId, "tenantId") } }), {
      stepUp: "tenant-delete",
    }),
  list: <E extends Entity>(
    tenantId: RouteParam,
    entity: E,
    _group?: string,
    context: EnterpriseRequestContext = {},
  ) =>
    endpoint(
      (api) => {
        const params = { tenantId: required(tenantId, "tenantId") };

        if (entity === "device")
          // SAFETY: the `"device"` branch selects the device endpoint, so its rows
          // are exactly `RowFor<E>` for the caller's entity type parameter.
          return api.listDevices({ params }) as Effect.Effect<
            { rows: RowFor<E>[] },
            Effect.Error<ReturnType<typeof api.listDevices>>,
            never
          >;

        if (entity === "group")
          // SAFETY: the `"group"` branch selects the group endpoint, so its rows
          // are exactly `RowFor<E>` for the caller's entity type parameter.
          return api.listGroups({ params }) as Effect.Effect<
            { rows: RowFor<E>[] },
            Effect.Error<ReturnType<typeof api.listGroups>>,
            never
          >;

        // SAFETY: the remaining branch selects the policy endpoint, so its rows
        // are exactly `RowFor<E>` for the caller's entity type parameter.
        return api.listPolicies({ params }) as Effect.Effect<
          { rows: RowFor<E>[] },
          Effect.Error<ReturnType<typeof api.listPolicies>>,
          never
        >;
      },
      { ...context },
    ),
  /** Tenant-scoped device/group/policy search used by the command palette. */
  search: (tenantId: RouteParam, query: { q?: string; limit?: number } = {}) =>
    endpoint((api) => api.search({ params: { tenantId: required(tenantId, "tenantId") }, query })),
  searchDevices: (
    tenantId: RouteParam,
    query: DeviceSearchQuery = {},
    context: EnterpriseRequestContext = {},
  ) =>
    endpoint(
      (api) => api.searchDevices({ params: { tenantId: required(tenantId, "tenantId") }, query }),
      { ...context },
    ),
  /** Named device-list views visible to the caller, including their default. */
  listDeviceViews: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.listDeviceViews({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  createDeviceView: (
    tenantId: RouteParam,
    payload: {
      name: string;
      description?: string | null;
      visibility?: "private" | "tenant";
      query: DeviceViewQuery;
    },
  ) =>
    endpoint((api) =>
      api.createDeviceView({ params: { tenantId: required(tenantId, "tenantId") }, payload }),
    ),
  patchDeviceView: (
    tenantId: RouteParam,
    viewId: RouteParam,
    payload: {
      name?: string;
      description?: string | null;
      visibility?: "private" | "tenant";
      query?: DeviceViewQuery;
    },
  ) =>
    endpoint((api) =>
      api.patchDeviceView({
        params: {
          tenantId: required(tenantId, "tenantId"),
          viewId: required(viewId, "viewId"),
        },
        payload,
      }),
    ),
  deleteDeviceView: (tenantId: RouteParam, viewId: RouteParam) =>
    endpoint((api) =>
      api.deleteDeviceView({
        params: {
          tenantId: required(tenantId, "tenantId"),
          viewId: required(viewId, "viewId"),
        },
      }),
    ),
  setDefaultDeviceView: (tenantId: RouteParam, viewId: string | null) =>
    endpoint((api) =>
      api.setDefaultDeviceView({
        params: { tenantId: required(tenantId, "tenantId") },
        payload: { viewId },
      }),
    ),
  /** Server-paginated group list for the groups table. */
  searchGroups: (tenantId: RouteParam, query: GroupSearchQuery = {}) =>
    listEndpoint((api) =>
      api.searchGroups({ params: { tenantId: required(tenantId, "tenantId") }, query }),
    ),
  /** Server-paginated policy list for the policies table. */
  searchPolicies: (tenantId: RouteParam, query: PolicySearchQuery = {}) =>
    listEndpoint((api) =>
      api.searchPolicies({ params: { tenantId: required(tenantId, "tenantId") }, query }),
    ),
  /** Server-paginated application catalogue for the applications table. */
  searchApplications: (tenantId: RouteParam, query: ApplicationSearchQuery = {}) =>
    listEndpoint((api) =>
      api.searchApplications({ params: { tenantId: required(tenantId, "tenantId") }, query }),
    ),
  /** Server-paginated curated software catalogue. */
  searchSoftwareCatalogue: (tenantId: RouteParam, query: CatalogueSearchQuery = {}) =>
    endpoint((api) =>
      api.searchSoftwareCatalogue({ params: { tenantId: required(tenantId, "tenantId") }, query }),
    ),
  getSoftwareCatalogueTitle: (tenantId: RouteParam, titleId: RouteParam) =>
    endpoint((api) =>
      api.getSoftwareCatalogueTitle({
        params: { tenantId: required(tenantId, "tenantId"), titleId: required(titleId, "titleId") },
      }),
    ),
  /** Create one tenant application per selected catalogue deployment method. */
  addSoftwareCatalogueTitle: (
    tenantId: RouteParam,
    titleId: RouteParam,
    payload: AddCatalogueTitleRequest,
  ) =>
    endpoint((api) =>
      api.addSoftwareCatalogueTitle({
        params: { tenantId: required(tenantId, "tenantId"), titleId: required(titleId, "titleId") },
        payload,
      }),
    ),
  listMcpConnections: () => accountEndpoint((api) => api.listMcpConnections({})),
  revokeMcpConnection: (connectionId: RouteParam) =>
    accountEndpoint((api) =>
      api.revokeMcpConnection({
        params: { connectionId: required(connectionId, "connectionId") },
      }),
    ),
  listDashboards: (tenantId: RouteParam) =>
    endpoint((api) => api.listDashboards({ params: { tenantId: required(tenantId, "tenantId") } })),
  createDashboard: (
    tenantId: RouteParam,
    payload: { name: string; description?: string | null; template?: "overview" },
  ) =>
    endpoint((api) =>
      api.createDashboard({ params: { tenantId: required(tenantId, "tenantId") }, payload }),
    ),
  getDashboard: (tenantId: RouteParam, id: RouteParam) =>
    endpoint((api) =>
      api.getDashboard({
        params: {
          tenantId: required(tenantId, "tenantId"),
          dashboardId: required(id, "dashboardId"),
        },
      }),
    ),
  patchDashboard: (
    tenantId: RouteParam,
    id: RouteParam,
    payload: Partial<Pick<DashboardSummary, "name" | "description" | "isDefault">>,
  ) =>
    endpoint((api) =>
      api.patchDashboard({
        params: {
          tenantId: required(tenantId, "tenantId"),
          dashboardId: required(id, "dashboardId"),
        },
        payload,
      }),
    ),
  deleteDashboard: (tenantId: RouteParam, id: RouteParam) =>
    endpoint((api) =>
      api.deleteDashboard({
        params: {
          tenantId: required(tenantId, "tenantId"),
          dashboardId: required(id, "dashboardId"),
        },
      }),
    ),
  createDashboardWidget: (
    tenantId: RouteParam,
    dashboardId: RouteParam,
    payload: {
      type: DashboardWidgetType;
      title: string;
      config: unknown;
      x?: number;
      y?: number;
      w?: number;
      h?: number;
    },
  ) =>
    endpoint((api) =>
      api.createDashboardWidget({
        params: {
          tenantId: required(tenantId, "tenantId"),
          dashboardId: required(dashboardId, "dashboardId"),
        },
        payload,
      }),
    ),
  patchDashboardWidget: (
    tenantId: RouteParam,
    dashboardId: RouteParam,
    widgetId: RouteParam,
    payload: PatchDashboardWidgetRequest,
  ) =>
    endpoint((api) =>
      api.patchDashboardWidget({
        params: {
          tenantId: required(tenantId, "tenantId"),
          dashboardId: required(dashboardId, "dashboardId"),
          widgetId: required(widgetId, "widgetId"),
        },
        payload,
      }),
    ),
  deleteDashboardWidget: (tenantId: RouteParam, dashboardId: RouteParam, widgetId: RouteParam) =>
    endpoint((api) =>
      api.deleteDashboardWidget({
        params: {
          tenantId: required(tenantId, "tenantId"),
          dashboardId: required(dashboardId, "dashboardId"),
          widgetId: required(widgetId, "widgetId"),
        },
      }),
    ),
  patchDashboardLayout: (
    tenantId: RouteParam,
    dashboardId: RouteParam,
    widgets: ReadonlyArray<{ id: string; x?: number; y?: number; w?: number; h?: number }>,
  ) =>
    endpoint((api) =>
      api.patchDashboardLayout({
        params: {
          tenantId: required(tenantId, "tenantId"),
          dashboardId: required(dashboardId, "dashboardId"),
        },
        payload: { widgets },
      }),
    ),
  queryDashboard: (tenantId: RouteParam, payload: DashboardQueryRequest) =>
    endpoint((api) =>
      api.queryDashboard({ params: { tenantId: required(tenantId, "tenantId") }, payload }),
    ),
  queryDashboardBatch: (tenantId: RouteParam, queries: ReadonlyArray<DashboardQueryRequest>) =>
    dashboardEndpoint((api) =>
      api.queryDashboardBatch({
        params: { tenantId: required(tenantId, "tenantId") },
        payload: { queries: [...queries] },
      }),
    ),
  listDashboardReports: (tenantId: RouteParam, dashboardId: RouteParam) =>
    dashboardEndpoint((api) =>
      api.listDashboardReports({
        params: {
          tenantId: required(tenantId, "tenantId"),
          dashboardId: required(dashboardId, "dashboardId"),
        },
      }),
    ),
  createDashboardReport: (
    tenantId: RouteParam,
    dashboardId: RouteParam,
    payload: CreateDashboardReportRequest,
  ) =>
    dashboardEndpoint((api) =>
      api.createDashboardReport({
        params: {
          tenantId: required(tenantId, "tenantId"),
          dashboardId: required(dashboardId, "dashboardId"),
        },
        payload,
      }),
    ),
  patchDashboardReport: (
    tenantId: RouteParam,
    dashboardId: RouteParam,
    reportId: RouteParam,
    payload: PatchDashboardReportRequest,
  ) =>
    dashboardEndpoint((api) =>
      api.patchDashboardReport({
        params: {
          tenantId: required(tenantId, "tenantId"),
          dashboardId: required(dashboardId, "dashboardId"),
          reportId: required(reportId, "reportId"),
        },
        payload,
      }),
    ),
  deleteDashboardReport: (tenantId: RouteParam, dashboardId: RouteParam, reportId: RouteParam) =>
    dashboardEndpoint((api) =>
      api.deleteDashboardReport({
        params: {
          tenantId: required(tenantId, "tenantId"),
          dashboardId: required(dashboardId, "dashboardId"),
          reportId: required(reportId, "reportId"),
        },
      }),
    ),
  sendDashboardReport: (tenantId: RouteParam, dashboardId: RouteParam, reportId: RouteParam) =>
    dashboardEndpoint((api) =>
      api.sendDashboardReport({
        params: {
          tenantId: required(tenantId, "tenantId"),
          dashboardId: required(dashboardId, "dashboardId"),
          reportId: required(reportId, "reportId"),
        },
      }),
    ),
  listDashboardReportRuns: (tenantId: RouteParam, dashboardId: RouteParam, reportId: RouteParam) =>
    dashboardEndpoint((api) =>
      api.listDashboardReportRuns({
        params: {
          tenantId: required(tenantId, "tenantId"),
          dashboardId: required(dashboardId, "dashboardId"),
          reportId: required(reportId, "reportId"),
        },
      }),
    ),
  downloadDashboardReport: (
    tenantId: RouteParam,
    dashboardId: RouteParam,
    format: DashboardReportFormat = "csv",
  ) =>
    dashboardEndpoint((api) =>
      api.exportDashboardReport({
        params: {
          tenantId: required(tenantId, "tenantId"),
          dashboardId: required(dashboardId, "dashboardId"),
        },
        query: { format },
      }),
    ),
  /** Returns CSV text; callers turn it into a file download. */
  exportDevices: (tenantId: RouteParam, query: DeviceSearchQuery = {}) =>
    endpoint((api) =>
      api.exportDevices({ params: { tenantId: required(tenantId, "tenantId") }, query }),
    ),
  get: <E extends Entity>(tenantId: RouteParam, entity: E, id: RouteParam) =>
    endpoint((api) => {
      const params = { tenantId: required(tenantId, "tenantId"), id: required(id, "id") };

      if (entity === "device")
        // SAFETY: the `"device"` branch selects the device endpoint, so its row
        // is exactly `RowFor<E>` for the caller's entity type parameter.
        return api.getDevice({ params }) as Effect.Effect<
          RowFor<E> | GroupNode,
          Effect.Error<ReturnType<typeof api.getDevice>>,
          never
        >;

      if (entity === "group")
        // SAFETY: the `"group"` branch selects the group endpoint, so its row is
        // exactly `RowFor<E>` for the caller's entity type parameter.
        return api.getGroup({ params }) as Effect.Effect<
          RowFor<E> | GroupNode,
          Effect.Error<ReturnType<typeof api.getGroup>>,
          never
        >;

      // SAFETY: the remaining branch selects the policy endpoint, so its row is
      // exactly `RowFor<E>` for the caller's entity type parameter.
      return api.getPolicy({ params }) as Effect.Effect<
        RowFor<E> | GroupNode,
        Effect.Error<ReturnType<typeof api.getPolicy>>,
        never
      >;
    }),
  getDeviceEffectivePolicy: (tenantId: RouteParam, id: RouteParam) =>
    endpoint((api) =>
      api.getDeviceEffectivePolicy({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
      }),
    ),
  patchDevice: (
    tenantId: RouteParam,
    id: RouteParam,
    payload: Partial<Pick<DeviceRow, "name" | "notes" | "assetTag">> & {
      /** Opt into "Apply name to device with each sync". */
      applyNameToDevice?: boolean;
      /** Clear the per-device lock screen override so the policy default applies. */
      lockScreenMessage?: string | null;
      lockScreenIncludeAssetTag?: boolean | null;
    },
  ) =>
    endpoint((api) =>
      api.patchDevice({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
        payload,
      }),
    ),
  deleteDevices: (tenantId: RouteParam, ids: string[]) =>
    endpoint((api) =>
      api.deleteDevices({ params: { tenantId: required(tenantId, "tenantId") }, payload: ids }),
    ),
  /**
   * Presence-only check used by the delete dialogs. It never returns a secret
   * value, only which kinds deleting these devices would destroy.
   */
  deviceHandoverImpact: (tenantId: RouteParam, ids: string[]) =>
    endpoint((api) =>
      api.deviceHandoverImpact({
        params: { tenantId: required(tenantId, "tenantId") },
        payload: { ids },
      }),
    ),
  /** Seal every escrowed secret for these devices into a one-time archive. */
  createDeviceHandover: (tenantId: RouteParam, payload: DeviceHandoverRequest) =>
    endpoint(
      (api) =>
        api.createDeviceHandover({
          params: { tenantId: required(tenantId, "tenantId") },
          payload,
        }),
      { stepUp: "device-handover" },
    ),
  listAttributes: (tenantId: RouteParam) =>
    attributeEndpoint((api) =>
      api.listAttributes({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  createAttribute: (tenantId: RouteParam, payload: CreateAttributeRequest) =>
    attributeEndpoint((api) =>
      api.createAttribute({ params: { tenantId: required(tenantId, "tenantId") }, payload }),
    ),
  patchAttribute: (tenantId: RouteParam, attributeId: RouteParam, payload: PatchAttributeRequest) =>
    attributeEndpoint((api) =>
      api.patchAttribute({
        params: {
          tenantId: required(tenantId, "tenantId"),
          attributeId: required(attributeId, "attributeId"),
        },
        payload,
      }),
    ),
  deleteAttribute: (tenantId: RouteParam, attributeId: RouteParam) =>
    attributeEndpoint((api) =>
      api.deleteAttribute({
        params: {
          tenantId: required(tenantId, "tenantId"),
          attributeId: required(attributeId, "attributeId"),
        },
      }),
    ),
  setDeviceAttributes: (
    tenantId: RouteParam,
    id: RouteParam,
    payload: SetDeviceAttributesRequest,
  ) =>
    attributeEndpoint((api) =>
      api.setDeviceAttributes({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
        payload,
      }),
    ),
  importDeviceAttributes: (tenantId: RouteParam, csv: string) =>
    attributeEndpoint((api) =>
      api.importDeviceAttributes({
        params: { tenantId: required(tenantId, "tenantId") },
        payload: { csv },
      }),
    ),
  listDeviceAttributeCollection: (tenantId: RouteParam, id: RouteParam) =>
    attributeEndpoint((api) =>
      api.listDeviceAttributeCollection({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
      }),
    ),
  collectDeviceAttribute: (tenantId: RouteParam, id: RouteParam, attributeId: RouteParam) =>
    attributeEndpoint(
      (api) =>
        api.collectDeviceAttribute({
          params: {
            tenantId: required(tenantId, "tenantId"),
            id: required(id, "id"),
            attributeId: required(attributeId, "attributeId"),
          },
        }),
      { stepUp: "script-run" },
    ),
  listEnrollmentQuestions: (tenantId: RouteParam) =>
    attributeEndpoint((api) =>
      api.listEnrollmentQuestions({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  patchEnrollmentQuestions: (tenantId: RouteParam, payload: PatchEnrollmentQuestionsRequest) =>
    attributeEndpoint((api) =>
      api.patchEnrollmentQuestions({
        params: { tenantId: required(tenantId, "tenantId") },
        payload,
      }),
    ),
  getPolicyVariables: (tenantId: RouteParam) =>
    attributeEndpoint((api) =>
      api.getPolicyVariables({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  getPolicyScope: (tenantId: RouteParam, id: RouteParam) =>
    attributeEndpoint((api) =>
      api.getPolicyScope({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
      }),
    ),
  getGroupScope: (tenantId: RouteParam, id: RouteParam) =>
    attributeEndpoint((api) =>
      api.getGroupScope({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
      }),
    ),
  listDevicePreRegistrations: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.listDevicePreRegistrations({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  importDevicePreRegistrations: (
    tenantId: RouteParam,
    rows: DevicePreRegistrationImportRequest["rows"],
  ) =>
    endpoint((api) =>
      api.importDevicePreRegistrations({
        params: { tenantId: required(tenantId, "tenantId") },
        payload: { rows },
      }),
    ),
  deleteDevicePreRegistration: (tenantId: RouteParam, id: RouteParam) =>
    endpoint((api) =>
      api.deleteDevicePreRegistration({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
      }),
    ),
  deleteDevicePreRegistrations: (tenantId: RouteParam, ids: string[]) =>
    endpoint((api) =>
      api.deleteDevicePreRegistrations({
        params: { tenantId: required(tenantId, "tenantId") },
        payload: ids,
      }),
    ),
  listDeviceCommands: (tenantId: RouteParam, id: RouteParam) =>
    endpoint((api) =>
      api.listDeviceCommands({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
      }),
    ),
  listDeviceDeclarations: (tenantId: RouteParam, id: RouteParam) =>
    endpoint((api) =>
      api.listDeviceDeclarations({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
      }),
    ),
  deviceAction: (
    tenantId: RouteParam,
    id: RouteParam,
    payload: {
      action?:
        | "sync"
        | "lock"
        | "wipe"
        | "return-to-service"
        | "restart"
        | "shutdown"
        | "clear-passcode"
        | "install-app"
        | "collect-security-info"
        | "refresh-applications"
        | "start-lost-mode"
        | "stop-lost-mode"
        | "play-lost-mode-sound"
        | "refresh-local-accounts"
        | "rotate-local-admin-password"
        | "reset-password"
        | "clear-app-data"
        | "request-device-info"
        | "relinquish-ownership"
        | "schedule-os-update"
        | "set-device-name"
        | "set-lock-screen-message"
        | "fresh-start"
        | "collect-diagnostics"
        | "rotate-bitlocker-key";
      deviceName?: string;
      lockScreenMessage?: string;
      lockScreenIncludeAssetTag?: boolean;
      lostModeMessage?: string;
      lostModePhone?: string;
      lostModeFootnote?: string;
      manifestUrl?: string;
      iTunesStoreId?: number;
      osUpdateInstallAction?:
        | "Default"
        | "InstallASAP"
        | "InstallLater"
        | "NotifyOnly"
        | "InstallForceRestart";
      osUpdateProductKey?: string;
      osUpdateDeadline?: string;
      osUpdateMechanism?: "ddm-software-update";
      freshStartRetainUserData?: boolean;
    } = { action: "sync" },
  ) =>
    endpoint((api) =>
      api.deviceAction({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
        payload,
      }),
    ),
  deviceUnenroll: (tenantId: RouteParam, id: RouteParam) =>
    endpoint((api) =>
      api.deviceUnenroll({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
      }),
    ),
  listDeviceApplications: (tenantId: RouteParam, id: RouteParam) =>
    endpoint((api) =>
      api.listDeviceApplications({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
      }),
    ),
  getDeviceRecoveryKey: (tenantId: RouteParam, id: RouteParam) =>
    endpoint(
      (api) =>
        api.getDeviceRecoveryKey({
          params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
        }),
      { stepUp: "recovery-key-reveal" },
    ),
  getDeviceLocalAdmin: (tenantId: RouteParam, id: RouteParam) =>
    endpoint(
      (api) =>
        api.getDeviceLocalAdmin({
          params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
        }),
      { stepUp: "recovery-key-reveal" },
    ),
  getDeviceWindowsSecurity: (tenantId: RouteParam, id: RouteParam) =>
    endpoint((api) =>
      api.getDeviceWindowsSecurity({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
      }),
    ),
  getDeviceLapsPassword: (tenantId: RouteParam, id: RouteParam, reason: string) =>
    endpoint(
      (api) =>
        api.getDeviceLapsPassword({
          params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
          query: { reason },
        }),
      { stepUp: "recovery-key-reveal" },
    ),
  revealDeviceBitlockerKey: (tenantId: RouteParam, id: RouteParam, keyId: string, reason: string) =>
    endpoint(
      (api) =>
        api.revealDeviceBitlockerKey({
          params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id"), keyId },
          query: { reason },
        }),
      { stepUp: "recovery-key-reveal" },
    ),
  listDeviceDiagnostics: (tenantId: RouteParam, id: RouteParam) =>
    endpoint((api) =>
      api.listDeviceDiagnostics({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
      }),
    ),
  getDeviceActivationLockBypassCode: (tenantId: RouteParam, id: RouteParam) =>
    endpoint(
      (api) =>
        api.getDeviceActivationLockBypassCode({
          params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
        }),
      { stepUp: "recovery-key-reveal" },
    ),
  getAppleFdeEscrowKey: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.getAppleFdeEscrowKey({
        params: { tenantId: required(tenantId, "tenantId") },
      }),
    ),
  generateAppleFdeEscrowKey: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.generateAppleFdeEscrowKey({
        params: { tenantId: required(tenantId, "tenantId") },
      }),
    ),
  uploadAppleFdeEscrowKey: (
    tenantId: RouteParam,
    payload: { certificatePem: string; privateKeyPem: string },
  ) =>
    endpoint((api) =>
      api.uploadAppleFdeEscrowKey({
        params: { tenantId: required(tenantId, "tenantId") },
        payload,
      }),
    ),
  getApplicationInventory: (tenantId: RouteParam, query: ApplicationInventoryQuery = {}) =>
    endpoint((api) =>
      api.getApplicationInventory({
        params: { tenantId: required(tenantId, "tenantId") },
        query,
      }),
    ),
  getDeviceHealth: (tenantId: RouteParam, id: RouteParam) =>
    endpoint((api) =>
      api.getDeviceHealth({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
      }),
    ),
  getDeviceHealthSummary: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.getDeviceHealthSummary({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  getSoftwareUpdateSummary: (tenantId: RouteParam) =>
    softwareUpdateEndpoint((api) =>
      api.getSoftwareUpdateSummary({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  getTenantOsPolicy: (tenantId: RouteParam) =>
    osPolicyEndpoint((api) =>
      api.getTenantOsPolicy({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  patchTenantOsPolicy: (tenantId: RouteParam, payload: UpdateTenantOsPolicyRequest) =>
    osPolicyEndpoint(
      (api) =>
        api.patchTenantOsPolicy({
          params: { tenantId: required(tenantId, "tenantId") },
          payload,
        }),
      { stepUp: "device-command" },
    ),
  getOsFleet: (tenantId: RouteParam) =>
    osPolicyEndpoint((api) =>
      api.getOsFleet({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  getDevicePushHealth: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.getDevicePushHealth({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  listWindowsFailures: (
    tenantId: RouteParam,
    options: { deviceId?: string; limit?: number } = {},
  ) =>
    windowsEndpoint((api) =>
      api.listWindowsFailures({
        params: { tenantId: required(tenantId, "tenantId") },
        query: { deviceId: options.deviceId, limit: options.limit },
      }),
    ),
  getDeviceActivity: (
    tenantId: RouteParam,
    id: RouteParam,
    options: { limit?: number; cursor?: string } = {},
  ) =>
    endpoint((api) =>
      api.getDeviceActivity({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
        query: { limit: options.limit ?? 50, cursor: options.cursor },
      }),
    ),
  getCredentialHealth: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.getCredentialHealth({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  revokeDeviceIdentity: (tenantId: RouteParam, id: RouteParam) =>
    endpoint((api) =>
      api.revokeDeviceIdentity({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
      }),
    ),
  previewGroup: (tenantId: RouteParam, id: RouteParam) =>
    endpoint((api) =>
      api.previewGroup({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
      }),
    ),
  createGroup: (
    tenantId: RouteParam,
    payload: {
      name: string;
      notes?: string | null;
      kind?: DynamicGroupKind;
      rules?: DynamicGroupRules | null;
      directoryGroupId?: string | null;
      devices?: string[];
      policies?: string[];
    },
  ) =>
    endpoint((api) =>
      api.createGroup({ params: { tenantId: required(tenantId, "tenantId") }, payload }),
    ),
  patchGroup: (
    tenantId: RouteParam,
    id: RouteParam,
    payload: Partial<Pick<GroupRow, "name" | "notes" | "kind" | "rules" | "directoryGroupId">> & {
      /** The group's `updatedAt` when the editor loaded it; 412 on a mismatch. */
      expectedUpdatedAt?: string;
    },
  ) =>
    endpoint((api) =>
      api.patchGroup({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
        payload,
      }),
    ),
  patchGroupMembers: (
    tenantId: RouteParam,
    id: RouteParam,
    payload: {
      assign?: {
        devices?: string[];
        policies?: Array<string | { id: string; mode?: "include" | "exclude" }>;
        childGroups?: string[];
      };
      unassign?: {
        devices?: string[];
        policies?: Array<string | { id: string; mode?: "include" | "exclude" }>;
        childGroups?: string[];
      };
      exclude?: { devices?: string[]; users?: string[] };
      unexclude?: { devices?: string[]; users?: string[] };
    },
  ) =>
    endpoint((api) =>
      api.patchGroupMembers({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
        payload,
      }),
    ),
  deleteGroups: (tenantId: RouteParam, ids: string[]) =>
    endpoint((api) =>
      api.deleteGroups({ params: { tenantId: required(tenantId, "tenantId") }, payload: ids }),
    ),
  duplicateGroup: (tenantId: RouteParam, id: RouteParam, name?: string) =>
    endpoint((api) =>
      api.duplicateGroup({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
        payload: { name },
      }),
    ),
  syncGroups: (tenantId: RouteParam, ids: string[]) =>
    endpoint((api) =>
      api.syncGroups({ params: { tenantId: required(tenantId, "tenantId") }, payload: ids }),
    ),
  createPolicy: (
    tenantId: RouteParam,
    payload: {
      name: string;
      notes?: string | null;
      priority?: number;
      enabled?: boolean;
      /** Import writes the policy and its settings together. */
      configurations?: PolicyRow["configurations"];
      configurationScopes?: PolicyRow["configurationScopes"];
    },
  ) =>
    endpoint((api) =>
      api.createPolicy({ params: { tenantId: required(tenantId, "tenantId") }, payload }),
    ),
  patchPolicy: (
    tenantId: RouteParam,
    id: RouteParam,
    payload: Partial<
      Pick<
        PolicyRow,
        "name" | "notes" | "configurations" | "configurationScopes" | "priority" | "enabled"
      >
    > & {
      /** The policy's `updatedAt` when the editor loaded it; 412 on a mismatch. */
      expectedUpdatedAt?: string;
    },
  ) =>
    endpoint((api) =>
      api.patchPolicy({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
        payload,
      }),
    ),
  uploadPolicyApplication: (
    tenantId: RouteParam,
    id: RouteParam,
    payload: { fileName: string; contentType?: string; content: string },
  ) =>
    endpoint((api) =>
      api.uploadPolicyApplication({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
        payload,
      }),
    ),
  downloadPolicyApplication: (tenantId: RouteParam, id: RouteParam, sha256: string) =>
    endpoint((api) =>
      api.downloadPolicyApplication({
        params: {
          tenantId: required(tenantId, "tenantId"),
          id: required(id, "id"),
          sha256: required(sha256, "sha256"),
        },
      }),
    ),
  getPolicyAssignments: (tenantId: RouteParam, id: RouteParam) =>
    endpoint((api) =>
      api.getPolicyAssignments({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
      }),
    ),
  patchPolicyAssignments: (
    tenantId: RouteParam,
    id: RouteParam,
    payload: {
      assign?: Array<string | { id: string; mode?: "include" | "exclude" }>;
      unassign?: Array<string | { id: string; mode?: "include" | "exclude" }>;
      assignUsers?: Array<string | { id: string; mode?: "include" | "exclude" }>;
      unassignUsers?: Array<string | { id: string; mode?: "include" | "exclude" }>;
      assignUserGroups?: Array<string | { id: string; mode?: "include" | "exclude" }>;
      unassignUserGroups?: Array<string | { id: string; mode?: "include" | "exclude" }>;
    },
  ) =>
    endpoint((api) =>
      api.patchPolicyAssignments({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
        payload,
      }),
    ),
  listRestrictedSoftware: (tenantId: RouteParam) =>
    restrictedSoftwareEndpoint((api) =>
      api.listRestrictedSoftware({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  getRestrictedSoftware: (tenantId: RouteParam, id: RouteParam) =>
    restrictedSoftwareEndpoint((api) =>
      api.getRestrictedSoftware({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
      }),
    ),
  createRestrictedSoftware: (tenantId: RouteParam, payload: CreateRestrictedSoftwareRequest) =>
    restrictedSoftwareEndpoint(
      (api) =>
        api.createRestrictedSoftware({
          params: { tenantId: required(tenantId, "tenantId") },
          payload,
        }),
      { stepUp: "restricted-software-change" },
    ),
  patchRestrictedSoftware: (
    tenantId: RouteParam,
    id: RouteParam,
    payload: PatchRestrictedSoftwareRequest,
  ) =>
    restrictedSoftwareEndpoint(
      (api) =>
        api.patchRestrictedSoftware({
          params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
          payload,
        }),
      { stepUp: "restricted-software-change" },
    ),
  deleteRestrictedSoftware: (tenantId: RouteParam, id: RouteParam) =>
    restrictedSoftwareEndpoint(
      (api) =>
        api.deleteRestrictedSoftware({
          params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
        }),
      { stepUp: "restricted-software-change" },
    ),
  patchRestrictedSoftwareAssignments: (
    tenantId: RouteParam,
    id: RouteParam,
    payload: PatchRestrictedSoftwareAssignmentsRequest,
  ) =>
    restrictedSoftwareEndpoint(
      (api) =>
        api.patchRestrictedSoftwareAssignments({
          params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
          payload,
        }),
      { stepUp: "restricted-software-change" },
    ),
  listRestrictedSoftwareViolations: (
    tenantId: RouteParam,
    query: {
      status?: "open" | "resolved";
      platform?: "apple" | "win" | "android";
      ruleId?: string;
      limit?: number;
    } = {},
  ) =>
    restrictedSoftwareEndpoint((api) =>
      api.listRestrictedSoftwareViolations({
        params: { tenantId: required(tenantId, "tenantId") },
        query,
      }),
    ),
  getDeviceRestrictedSoftware: (tenantId: RouteParam, id: RouteParam) =>
    restrictedSoftwareEndpoint((api) =>
      api.getDeviceRestrictedSoftware({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
      }),
    ),
  listScripts: (tenantId: RouteParam) =>
    scriptEndpoint((api) =>
      api.listScripts({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  getScript: (tenantId: RouteParam, id: RouteParam) =>
    scriptEndpoint((api) =>
      api.getScript({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
      }),
    ),
  /**
   * Creating a script is additive, so it does not need a step-up. Editing,
   * assigning, renaming or deleting an existing script still does.
   */
  createScript: (tenantId: RouteParam, payload: CreateScriptRequest) =>
    scriptEndpoint((api) =>
      api.createScript({
        params: { tenantId: required(tenantId, "tenantId") },
        payload,
      }),
    ),
  patchScript: (tenantId: RouteParam, id: RouteParam, payload: PatchScriptRequest) =>
    scriptEndpoint(
      (api) =>
        api.patchScript({
          params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
          payload,
        }),
      { stepUp: "script-change" },
    ),
  deleteScript: (tenantId: RouteParam, id: RouteParam) =>
    scriptEndpoint(
      (api) =>
        api.deleteScript({
          params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
        }),
      { stepUp: "script-change" },
    ),
  getScriptAssignments: (tenantId: RouteParam, id: RouteParam) =>
    scriptEndpoint((api) =>
      api.getScriptAssignments({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
      }),
    ),
  patchScriptAssignments: (
    tenantId: RouteParam,
    id: RouteParam,
    payload: PatchScriptAssignmentsRequest,
  ) =>
    scriptEndpoint(
      (api) =>
        api.patchScriptAssignments({
          params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
          payload,
        }),
      { stepUp: "script-change" },
    ),
  runScript: (tenantId: RouteParam, id: RouteParam, payload: RunScriptRequest = {}) =>
    scriptEndpoint(
      (api) =>
        api.runScript({
          params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
          payload,
        }),
      { stepUp: "script-run" },
    ),
  listScriptExecutions: (tenantId: RouteParam, id: RouteParam, deviceId?: string) =>
    scriptEndpoint((api) =>
      api.listScriptExecutions({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
        query: { deviceId, limit: 100 },
      }),
    ),
  patchScriptSettings: (tenantId: RouteParam, payload: ScriptSettings) =>
    scriptEndpoint(
      (api) =>
        api.patchScriptSettings({
          params: { tenantId: required(tenantId, "tenantId") },
          payload,
        }),
      { stepUp: "script-change" },
    ),
  listFleetMigrations: (tenantId: RouteParam) =>
    migrationEndpoint((api) =>
      api.listFleetMigrations({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  getFleetMigration: (tenantId: RouteParam, migrationId: RouteParam) =>
    migrationEndpoint((api) =>
      api.getFleetMigration({
        params: {
          tenantId: required(tenantId, "tenantId"),
          migrationId: required(migrationId, "migrationId"),
        },
      }),
    ),
  createFleetMigration: (tenantId: RouteParam, payload: CreateFleetMigrationRequest) =>
    migrationEndpoint((api) =>
      api.createFleetMigration({
        params: { tenantId: required(tenantId, "tenantId") },
        payload,
      }),
    ),
  deleteFleetMigration: (tenantId: RouteParam, migrationId: RouteParam) =>
    migrationEndpoint((api) =>
      api.deleteFleetMigration({
        params: {
          tenantId: required(tenantId, "tenantId"),
          migrationId: required(migrationId, "migrationId"),
        },
      }),
    ),
  issueFleetMigrationUnenrol: (
    tenantId: RouteParam,
    migrationId: RouteParam,
    payload: IssueFleetMigrationUnenrolRequest,
  ) =>
    migrationEndpoint(
      (api) =>
        api.issueFleetMigrationUnenrol({
          params: {
            tenantId: required(tenantId, "tenantId"),
            migrationId: required(migrationId, "migrationId"),
          },
          payload,
        }),
      { stepUp: "device-command" },
    ),
  markFleetMigrationUnenrolled: (
    tenantId: RouteParam,
    migrationId: RouteParam,
    entryId: RouteParam,
  ) =>
    migrationEndpoint((api) =>
      api.markFleetMigrationUnenrolled({
        params: {
          tenantId: required(tenantId, "tenantId"),
          migrationId: required(migrationId, "migrationId"),
          entryId: required(entryId, "entryId"),
        },
      }),
    ),
  confirmFleetMigrationEntry: (
    tenantId: RouteParam,
    migrationId: RouteParam,
    entryId: RouteParam,
  ) =>
    migrationEndpoint((api) =>
      api.confirmFleetMigrationEntry({
        params: {
          tenantId: required(tenantId, "tenantId"),
          migrationId: required(migrationId, "migrationId"),
          entryId: required(entryId, "entryId"),
        },
      }),
    ),
  listApplications: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.listApplications({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  listDirectory: (tenantId: RouteParam) =>
    endpoint((api) => api.listDirectory({ params: { tenantId: required(tenantId, "tenantId") } })),
  /** Directory people in this tenant, with group and (permitted) device counts. */
  listUsers: (tenantId: RouteParam) =>
    userEndpoint((api) => api.listUsers({ params: { tenantId: required(tenantId, "tenantId") } })),
  /** One directory person, their groups, devices and policy assignments. */
  getUser: (tenantId: RouteParam, userId: RouteParam) =>
    userEndpoint((api) =>
      api.getUser({
        params: {
          tenantId: required(tenantId, "tenantId"),
          userId: required(userId, "userId"),
        },
      }),
    ),
  /** Directory people that likely duplicate this one. */
  listUserMergeCandidates: (tenantId: RouteParam, userId: RouteParam) =>
    userEndpoint((api) =>
      api.listUserMergeCandidates({
        params: {
          tenantId: required(tenantId, "tenantId"),
          userId: required(userId, "userId"),
        },
      }),
    ),
  /** What a merge would move, deduplicate and need confirmed. */
  previewDirectoryUserMerge: (
    tenantId: RouteParam,
    userId: RouteParam,
    sourceIds: ReadonlyArray<string>,
  ) =>
    userEndpoint((api) =>
      api.previewDirectoryUserMerge({
        params: {
          tenantId: required(tenantId, "tenantId"),
          userId: required(userId, "userId"),
        },
        payload: { sourceIds: [...sourceIds] },
      }),
    ),
  /** Fold duplicate directory people into this one. Directory people only. */
  mergeDirectoryUsers: (
    tenantId: RouteParam,
    userId: RouteParam,
    payload: { sourceIds: ReadonlyArray<string>; confirmExternalIdMismatch?: boolean },
  ) =>
    userEndpoint((api) =>
      api.mergeDirectoryUsers({
        params: {
          tenantId: required(tenantId, "tenantId"),
          userId: required(userId, "userId"),
        },
        payload: { ...payload, sourceIds: [...payload.sourceIds] },
      }),
    ),
  /** Add selected directory users to one directory (user) group. */
  addUserGroupMembers: (tenantId: RouteParam, groupId: RouteParam, userIds: string[]) =>
    attributeEndpoint((api) =>
      api.addUserGroupMembers({
        params: {
          tenantId: required(tenantId, "tenantId"),
          groupId: required(groupId, "groupId"),
        },
        payload: { userIds },
      }),
    ),
  getDeviceUsers: (tenantId: RouteParam, id: RouteParam) =>
    endpoint((api) =>
      api.getDeviceUsers({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
      }),
    ),
  setDeviceUsers: (tenantId: RouteParam, id: RouteParam, userIds: ReadonlyArray<string>) =>
    endpoint((api) =>
      api.setDeviceUsers({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
        payload: { userIds: [...userIds] },
      }),
    ),
  listDeviceAppleUsers: (tenantId: RouteParam, id: RouteParam) =>
    endpoint((api) =>
      api.listDeviceAppleUsers({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
      }),
    ),
  deviceAppleUserAction: (
    tenantId: RouteParam,
    id: RouteParam,
    userId: string,
    action: AppleUserActionName,
  ) =>
    endpoint((api) =>
      api.deviceAppleUserAction({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id"), userId: UserId.fromParam(userId) },
        payload: { action },
      }),
    ),
  bindAppleUserIdentity: (
    tenantId: RouteParam,
    id: RouteParam,
    platformUserId: string,
    userId: string,
  ) =>
    endpoint((api) =>
      api.bindAppleUserIdentity({
        params: {
          tenantId: required(tenantId, "tenantId"),
          id: required(id, "id"),
          userId: UserId.fromParam(platformUserId),
        },
        payload: { userId: UserId.fromParam(userId) },
      }),
    ),
  unbindAppleUserIdentity: (tenantId: RouteParam, id: RouteParam, platformUserId: string) =>
    endpoint((api) =>
      api.unbindAppleUserIdentity({
        params: {
          tenantId: required(tenantId, "tenantId"),
          id: required(id, "id"),
          userId: UserId.fromParam(platformUserId),
        },
      }),
    ),
  getApplication: (tenantId: RouteParam, id: RouteParam) =>
    endpoint((api) =>
      api.getApplication({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
      }),
    ),
  createApplication: (
    tenantId: RouteParam,
    payload: {
      name: string;
      platform?: "apple" | "win" | "android";
      bundleId?: string | null;
      version?: string | null;
      source?: "manifest" | "store" | "upload";
      manifestUrl?: string | null;
      storeId?: string | null;
      notes?: string | null;
      installers?: ApplicationInstallerPayload[];
    },
  ) =>
    endpoint((api) =>
      api.createApplication({
        params: { tenantId: required(tenantId, "tenantId") },
        payload,
      }),
    ),
  patchApplication: (
    tenantId: RouteParam,
    id: RouteParam,
    payload: {
      name?: string;
      bundleId?: string | null;
      version?: string | null;
      source?: "manifest" | "store" | "upload";
      manifestUrl?: string | null;
      storeId?: string | null;
      notes?: string | null;
      installers?: ApplicationInstallerPayload[];
      /** Remove the app from devices that lose their assignment. */
      removeOnUnassign?: boolean;
      /** The application's `updatedAt` when the editor loaded it; 412 on a mismatch. */
      expectedUpdatedAt?: string;
    },
  ) =>
    endpoint((api) =>
      api.patchApplication({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
        payload,
      }),
    ),
  deleteApplications: (tenantId: RouteParam, ids: string[]) =>
    endpoint((api) =>
      api.deleteApplications({
        params: { tenantId: required(tenantId, "tenantId") },
        payload: ids,
      }),
    ),
  patchApplicationAssignments: (
    tenantId: RouteParam,
    id: RouteParam,
    payload: {
      assign?: { groups?: string[]; userGroups?: string[]; devices?: string[] };
      unassign?: { groups?: string[]; userGroups?: string[]; devices?: string[] };
    },
  ) =>
    endpoint((api) =>
      api.patchApplicationAssignments({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
        payload,
      }),
    ),
  /** Replace the per-storefront App Store mapping for an application. */
  patchApplicationStorefronts: (
    tenantId: RouteParam,
    id: RouteParam,
    payload: {
      storefronts: Array<{
        region: string;
        storeId?: string | null;
        available?: boolean;
        name?: string | null;
        bundleId?: string | null;
        version?: string | null;
        reason?: string | null;
      }>;
    },
  ) =>
    endpoint((api) =>
      api.patchApplicationStorefronts({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
        payload,
      }),
    ),
  /** Ask the App Store whether the app still exists in its storefronts. */
  refreshApplicationStorefronts: (
    tenantId: RouteParam,
    id: RouteParam,
    payload: { regions?: string[] } = {},
  ) =>
    endpoint((api) =>
      api.refreshApplicationStorefronts({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
        payload,
      }),
    ),
  /** Remove every assignment but keep the catalogue row and install history. */
  unlinkApplicationAssignments: (
    tenantId: RouteParam,
    id: RouteParam,
    payload: { reason?: string } = {},
  ) =>
    endpoint((api) =>
      api.unlinkApplicationAssignments({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
        payload,
      }),
    ),
  installApplication: (tenantId: RouteParam, id: RouteParam) =>
    endpoint((api) =>
      api.installApplication({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
      }),
    ),
  /** Queue removal on devices Mattrax installed the app on. */
  uninstallApplication: (tenantId: RouteParam, id: RouteParam) =>
    endpoint((api) =>
      api.uninstallApplication({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
      }),
    ),
  uploadApplication: (
    tenantId: RouteParam,
    id: RouteParam,
    payload: { fileName: string; contentType?: string; content: string },
  ) =>
    endpoint((api) =>
      api.uploadApplication({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
        payload,
      }),
    ),
  uploadApplicationInstaller: (
    tenantId: RouteParam,
    id: RouteParam,
    installerId: string,
    payload: { fileName: string; contentType?: string; content: string },
  ) =>
    endpoint((api) =>
      api.uploadApplicationInstaller({
        params: {
          tenantId: required(tenantId, "tenantId"),
          id: required(id, "id"),
          installerId: InstallerId.fromParam(installerId),
        },
        payload,
      }),
    ),
  downloadApplicationInstaller: (
    tenantId: RouteParam,
    id: RouteParam,
    installerId: string,
    sha256: string,
  ) =>
    endpoint((api) =>
      api.downloadApplicationInstaller({
        params: {
          tenantId: required(tenantId, "tenantId"),
          id: required(id, "id"),
          installerId: InstallerId.fromParam(installerId),
          sha256: required(sha256, "sha256"),
        },
      }),
    ),
  downloadApplication: (tenantId: RouteParam, id: RouteParam, sha256: string) =>
    endpoint((api) =>
      api.downloadApplication({
        params: {
          tenantId: required(tenantId, "tenantId"),
          id: required(id, "id"),
          sha256: required(sha256, "sha256"),
        },
      }),
    ),
  getEntraDirectorySync: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.getEntraDirectorySync({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  patchEntraDirectorySync: (
    tenantId: RouteParam,
    payload: { enabled?: boolean; syncIntervalMinutes?: number },
  ) =>
    endpoint((api) =>
      api.patchEntraDirectorySync({
        params: { tenantId: required(tenantId, "tenantId") },
        payload,
      }),
    ),
  syncEntraDirectory: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.syncEntraDirectory({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  getGoogleDirectorySync: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.getGoogleDirectorySync({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  patchGoogleDirectorySync: (
    tenantId: RouteParam,
    payload: { enabled?: boolean; syncIntervalMinutes?: number },
  ) =>
    endpoint((api) =>
      api.patchGoogleDirectorySync({
        params: { tenantId: required(tenantId, "tenantId") },
        payload,
      }),
    ),
  putGoogleDirectoryCredentials: (
    tenantId: RouteParam,
    payload: { serviceAccountJson: string; adminEmail: string; customer?: string },
  ) =>
    endpoint((api) =>
      api.putGoogleDirectoryCredentials({
        params: { tenantId: required(tenantId, "tenantId") },
        payload,
      }),
    ),
  deleteGoogleDirectoryCredentials: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.deleteGoogleDirectoryCredentials({
        params: { tenantId: required(tenantId, "tenantId") },
      }),
    ),
  syncGoogleDirectory: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.syncGoogleDirectory({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  listEntraDomains: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.listEntraDomains({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  refreshEntraDomains: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.refreshEntraDomains({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  getAutopilotSettings: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.getAutopilotSettings({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  listAutopilotDevices: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.listAutopilotDevices({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  importAutopilotDevices: (tenantId: RouteParam, payload: AutopilotImportRequest) =>
    endpoint((api) =>
      api.importAutopilotDevices({
        params: { tenantId: required(tenantId, "tenantId") },
        payload,
      }),
    ),
  syncAutopilotDevices: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.syncAutopilotDevices({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  deleteAutopilotDevice: (tenantId: RouteParam, serial: string) =>
    endpoint((api) =>
      api.deleteAutopilotDevice({
        params: { tenantId: required(tenantId, "tenantId"), serial },
      }),
    ),
  listAutopilotProfiles: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.listAutopilotProfiles({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  createAutopilotProfile: (tenantId: RouteParam, payload: CreateAutopilotProfileRequest) =>
    endpoint((api) =>
      api.createAutopilotProfile({
        params: { tenantId: required(tenantId, "tenantId") },
        payload,
      }),
    ),
  updateAutopilotProfile: (
    tenantId: RouteParam,
    profileId: string,
    payload: UpdateAutopilotProfileRequest,
  ) =>
    endpoint((api) =>
      api.updateAutopilotProfile({
        params: { tenantId: required(tenantId, "tenantId"), profileId: ProfileId.fromParam(profileId) },
        payload,
      }),
    ),
  assignAutopilotProfile: (tenantId: RouteParam, profileId: string, groupId: string) =>
    endpoint((api) =>
      api.assignAutopilotProfile({
        params: { tenantId: required(tenantId, "tenantId"), profileId: ProfileId.fromParam(profileId) },
        payload: { groupId: GroupId.fromParam(groupId) },
      }),
    ),
  deletePolicies: (tenantId: RouteParam, ids: string[]) =>
    endpoint((api) =>
      api.deletePolicies({ params: { tenantId: required(tenantId, "tenantId") }, payload: ids }),
    ),
  duplicatePolicy: (tenantId: RouteParam, id: RouteParam, name?: string) =>
    endpoint((api) =>
      api.duplicatePolicy({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
        payload: { name },
      }),
    ),
  listPolicyDeployments: (tenantId: RouteParam, id: RouteParam) =>
    endpoint((api) =>
      api.listPolicyDeployments({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
      }),
    ),
  /** Per-device progress for one version; pass "latest" to follow new saves. */
  getPolicyDeploymentDevices: (
    tenantId: RouteParam,
    id: RouteParam,
    version: string | number,
    options: { limit?: number; offset?: number } = {},
  ) =>
    attributeEndpoint((api) =>
      api.getPolicyDeploymentDevices({
        params: {
          tenantId: required(tenantId, "tenantId"),
          id: required(id, "id"),
          version: String(version),
        },
        query: { limit: options.limit ?? 50, offset: options.offset ?? 0 },
      }),
    ),
  rollbackPolicy: (tenantId: RouteParam, id: RouteParam, deploymentId: string) =>
    endpoint((api) =>
      api.rollbackPolicy({
        params: {
          tenantId: required(tenantId, "tenantId"),
          id: required(id, "id"),
          deploymentId: DeploymentId.fromParam(deploymentId),
        },
      }),
    ),
  syncPolicies: (tenantId: RouteParam, ids: string[]) =>
    endpoint((api) =>
      api.syncPolicies({ params: { tenantId: required(tenantId, "tenantId") }, payload: ids }),
    ),
  previewMobileconfig: (mobileconfig: string) =>
    attributeEndpoint((api) => api.previewMobileconfig({ payload: { mobileconfig } })),
  extractMobileconfig: (mobileconfig: string) =>
    attributeEndpoint((api) => api.extractMobileconfig({ payload: { mobileconfig } })),
  getApns: (tenantId: RouteParam) =>
    endpoint((api) => api.getApns({ params: { tenantId: required(tenantId, "tenantId") } })),
  getAppleBusinessManager: (
    tenantId: RouteParam,
  ): EndpointPromise<AppleBusinessManagerInfo, unknown> =>
    endpoint((api) =>
      api.getAppleBusinessManager({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  uploadAppleBusinessManagerToken: (
    tenantId: RouteParam,
    payload: {
      content: string;
      encoding?: "text" | "base64";
      fileName?: string;
      clientId?: string;
      keyId?: string;
      teamId?: string;
      orgId?: string;
      orgName?: string;
      scope?: "business.api" | "school.api";
    },
  ): EndpointPromise<AppleBusinessManagerInfo, unknown> =>
    endpoint((api) =>
      api.uploadAppleBusinessManagerToken({
        params: { tenantId: required(tenantId, "tenantId") },
        payload,
      }),
    ),
  deleteAppleBusinessManagerToken: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.deleteAppleBusinessManagerToken({
        params: { tenantId: required(tenantId, "tenantId") },
      }),
    ),
  syncAppleBusinessManager: (
    tenantId: RouteParam,
  ): EndpointPromise<AppleBusinessManagerSyncResponse, unknown> =>
    endpoint((api) =>
      api.syncAppleBusinessManager({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  listAbmDevices: (tenantId: RouteParam): EndpointPromise<AbmDevicesResponse, unknown> =>
    endpoint((api) => api.listAbmDevices({ params: { tenantId: required(tenantId, "tenantId") } })),
  getAbmDevice: (
    tenantId: RouteParam,
    serial: RouteParam,
  ): EndpointPromise<AbmDeviceInfo, unknown> =>
    endpoint((api) =>
      api.getAbmDevice({
        params: { tenantId: required(tenantId, "tenantId"), serial: required(serial, "serial") },
      }),
    ),
  assignAbmDevice: (
    tenantId: RouteParam,
    serial: RouteParam,
  ): EndpointPromise<AbmAssignDeviceResponse, unknown> =>
    endpoint((api) =>
      api.assignAppleBusinessManagerDevice({
        params: { tenantId: required(tenantId, "tenantId"), serial: required(serial, "serial") },
      }),
    ),
  getAbmDeviceProfileUrl: (
    tenantId: RouteParam,
    serial: RouteParam,
  ): EndpointPromise<AbmProfileUrlResponse, unknown> =>
    endpoint((api) =>
      api.getAbmDeviceProfileUrl({
        params: { tenantId: required(tenantId, "tenantId"), serial: required(serial, "serial") },
      }),
    ),
  getVpp: (tenantId: RouteParam): EndpointPromise<VppInfo, unknown> =>
    endpoint((api) => api.getVpp({ params: { tenantId: required(tenantId, "tenantId") } })),
  uploadVppToken: (
    tenantId: RouteParam,
    payload: { content: string; encoding?: "text" | "base64"; fileName?: string },
  ): EndpointPromise<VppInfo, unknown> =>
    endpoint((api) =>
      api.uploadVppToken({
        params: { tenantId: required(tenantId, "tenantId") },
        payload,
      }),
    ),
  deleteVppToken: (tenantId: RouteParam) =>
    endpoint((api) => api.deleteVppToken({ params: { tenantId: required(tenantId, "tenantId") } })),
  syncVpp: (tenantId: RouteParam): EndpointPromise<VppSyncResponse, unknown> =>
    endpoint((api) => api.syncVpp({ params: { tenantId: required(tenantId, "tenantId") } })),
  listVppAssets: (tenantId: RouteParam): EndpointPromise<VppAssetsResponse, unknown> =>
    endpoint((api) => api.listVppAssets({ params: { tenantId: required(tenantId, "tenantId") } })),
  listVppAssignments: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.listVppAssignments({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  installVppAsset: (
    tenantId: RouteParam,
    adamId: string,
    payload: { devices?: string[]; groups?: string[] },
  ): EndpointPromise<VppInstallResponse, unknown> =>
    endpoint((api) =>
      api.installVppAsset({
        params: { tenantId: required(tenantId, "tenantId"), adamId },
        payload,
      }),
    ),
  releaseVppAsset: (
    tenantId: RouteParam,
    adamId: string,
    payload: { devices: string[] },
  ): EndpointPromise<VppReleaseResponse, unknown> =>
    endpoint((api) =>
      api.releaseVppAsset({
        params: { tenantId: required(tenantId, "tenantId"), adamId },
        payload,
      }),
    ),
  getTenantAndroid: (tenantId: RouteParam): EndpointPromise<AndroidEnterpriseInfo, unknown> =>
    endpoint((api) =>
      api.getTenantAndroid({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  patchTenantAndroid: (
    tenantId: RouteParam,
    payload: {
      enabled?: boolean;
      provisioningMode?: AndroidProvisioningMode;
      disconnect?: boolean;
    },
  ) =>
    endpoint((api) =>
      api.patchTenantAndroid({ params: { tenantId: required(tenantId, "tenantId") }, payload }),
    ),
  createAndroidSignup: (tenantId: RouteParam): EndpointPromise<AndroidSignupResponse, unknown> =>
    endpoint((api) =>
      api.createAndroidSignup({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  syncTenantAndroid: (tenantId: RouteParam): EndpointPromise<AndroidSyncResponse, unknown> =>
    endpoint((api) =>
      api.syncTenantAndroid({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  disconnectTenantAndroid: (tenantId: RouteParam) =>
    endpoint(
      (api) =>
        api.patchTenantAndroid({
          params: { tenantId: required(tenantId, "tenantId") },
          payload: { disconnect: true },
        }),
      { stepUp: "android-disconnect" },
    ),
  getTenantEnrollment: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.getTenantEnrollment({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  patchTenantEnrollment: (
    tenantId: RouteParam,
    payload: Partial<
      Pick<
        TenantEnrollmentInfo,
        | "code"
        | "enabledApple"
        | "enabledWindows"
        | "enabledAndroid"
        | "enabledAssetTag"
        | "maxDevices"
      >
    >,
  ) =>
    endpoint((api) =>
      api.patchTenantEnrollment({ params: { tenantId: required(tenantId, "tenantId") }, payload }),
    ),
  getAppleByodConfig: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.getAppleByodConfig({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  patchAppleByodConfig: (
    tenantId: RouteParam,
    payload: { enabled?: boolean; domain?: string | null; hardwareValidationRequired?: boolean },
  ) =>
    endpoint((api) =>
      api.patchAppleByodConfig({
        params: { tenantId: required(tenantId, "tenantId") },
        payload,
      }),
    ),
  testAppleByodConfig: (tenantId: RouteParam, domain: string | null) =>
    endpoint((api) =>
      api.testAppleByodConfig({
        params: { tenantId: required(tenantId, "tenantId") },
        payload: { domain },
      }),
    ),
  confirmAppleByodHardware: (tenantId: RouteParam, validated: boolean) =>
    endpoint((api) =>
      api.confirmAppleByodHardware({
        params: { tenantId: required(tenantId, "tenantId") },
        payload: { validated },
      }),
    ),
  resetTenantEnrollment: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.resetTenantEnrollment({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  getTenantScepCa: (tenantId: RouteParam): EndpointPromise<TenantScepCaInfo, unknown> =>
    endpoint((api) =>
      api.getTenantScepCa({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  rotateTenantScepCa: (tenantId: RouteParam): EndpointPromise<TenantScepCaInfo, unknown> =>
    endpoint((api) =>
      api.rotateTenantScepCa({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  importTenantScepCa: (
    tenantId: RouteParam,
    payload: { certificatePem: string; privateKeyPem: string },
  ): EndpointPromise<TenantScepCaInfo, unknown> =>
    endpoint((api) =>
      api.importTenantScepCa({
        params: { tenantId: required(tenantId, "tenantId") },
        payload,
      }),
    ),
  listEnrollmentAttempts: (tenantId: RouteParam, limit = 50) =>
    endpoint((api) =>
      api.listEnrollmentAttempts({
        params: { tenantId: required(tenantId, "tenantId") },
        query: { limit },
      }),
    ),
  uploadApns: (tenantId: RouteParam, payload: { email: string; cert: string }) =>
    endpoint((api) =>
      api.uploadApns({ params: { tenantId: required(tenantId, "tenantId") }, payload }),
    ),
  getApnsCsr: (tenantId: RouteParam) =>
    endpoint((api) => api.getApnsCsr({ params: { tenantId: required(tenantId, "tenantId") } })),
  exportAuditLogDownload: (tenantId: RouteParam, query: Record<string, string> = {}) => {
    const suffix = new URLSearchParams(query).toString();

    return download(
      () =>
        `/api/v1/tenants/${encodeURIComponent(required(tenantId, "tenantId"))}/audit/export${suffix ? "?" + suffix : ""}`,
      { stepUp: false },
    );
  },
  getTenantSecurity: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.getTenantSecurity({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  patchTenantSecurity: (tenantId: RouteParam, payload: { requireMfa: boolean }) =>
    endpoint(
      (api) =>
        api.patchTenantSecurity({
          params: { tenantId: required(tenantId, "tenantId") },
          payload,
        }),
      { stepUp: "tenant-mfa-policy" },
    ),
  approveAccountRecovery: (tenantId: RouteParam, token: string) =>
    endpoint(
      (api) =>
        api.approveAccountRecovery({
          params: { tenantId: required(tenantId, "tenantId") },
          payload: { token },
        }),
      { stepUp: "recovery-approve" },
    ),
  cancelEmailChange: (token: string) =>
    accountEndpoint((api) => api.cancelEmailChange({ payload: { token } })),
  requestAccountRecovery: (email: string) =>
    accountEndpoint((api) => api.requestAccountRecovery({ payload: { email } })),
  verifyAccountRecovery: (token: string) =>
    accountEndpoint((api) => api.verifyAccountRecovery({ payload: { token } })),
  listAccountSessions: () => accountEndpoint((api) => api.listAccountSessions()),
  revokeAccountSession: (sessionId: RouteParam) =>
    accountEndpoint((api) =>
      api.revokeAccountSession({ params: { sessionId: required(sessionId, "sessionId") } }),
    ),
  revokeAllAccountSessions: () =>
    accountEndpoint((api) => api.revokeAllAccountSessions(), { stepUp: "sessions-revoke-all" }),
  listLoginAttempts: () => accountEndpoint((api) => api.listLoginAttempts()),
  searchAccountAuditLog: (query: AuditSearchQuery = {}) =>
    accountEndpoint((api) => api.searchAccountAuditLog({ query })),
  exportAccountAuditLog: (query: AuditSearchQuery = {}) =>
    accountEndpoint((api) => api.exportAccountAuditLog({ query })),
  getSsoConfig: (tenantId: RouteParam) =>
    endpoint((api) => api.getSsoConfig({ params: { tenantId: required(tenantId, "tenantId") } })),
  patchSsoConfig: (
    tenantId: RouteParam,
    payload: {
      enabled?: boolean;
      azureTenantId?: string | null;
      autoProvision?: boolean;
      requireMfa?: boolean;
    },
  ) =>
    endpoint(
      (api) =>
        api.patchSsoConfig({ params: { tenantId: required(tenantId, "tenantId") }, payload }),
      { stepUp: "sso-policy" },
    ),
  linkDirectoryUserSso: (tenantId: RouteParam, directoryUserId: RouteParam) =>
    identityEndpoint(
      (api) =>
        api.linkDirectoryUserSso({
          params: {
            tenantId: required(tenantId, "tenantId"),
            id: required(directoryUserId, "id"),
          },
        }),
      { stepUp: "sso-policy" },
    ),
  listScimTokens: (tenantId: RouteParam) =>
    endpoint((api) => api.listScimTokens({ params: { tenantId: required(tenantId, "tenantId") } })),
  createScimToken: (tenantId: RouteParam, payload: { name: string; expiresAt?: string | null }) =>
    endpoint(
      (api) =>
        api.createScimToken({ params: { tenantId: required(tenantId, "tenantId") }, payload }),
      { stepUp: "scim-token-create" },
    ),
  revokeScimToken: (tenantId: RouteParam, tokenId: string) =>
    endpoint((api) =>
      api.revokeScimToken({
        params: { tenantId: required(tenantId, "tenantId"), tokenId: TokenId.fromParam(tokenId) },
      }),
    ),
  listWebhooks: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.listWebhookEndpoints({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  createWebhook: (
    tenantId: RouteParam,
    payload: {
      url: string;
      description?: string | null;
      events: WebhookEndpointInfo["events"];
      enabled?: boolean;
    },
  ) =>
    endpoint((api) =>
      api.createWebhookEndpoint({
        params: { tenantId: required(tenantId, "tenantId") },
        payload,
      }),
    ),
  patchWebhook: (
    tenantId: RouteParam,
    webhookId: RouteParam,
    payload: Partial<{
      url: string;
      description: string | null;
      events: WebhookEndpointInfo["events"];
      enabled: boolean;
    }>,
  ) =>
    endpoint((api) =>
      api.patchWebhookEndpoint({
        params: {
          tenantId: required(tenantId, "tenantId"),
          webhookId: required(webhookId, "webhookId"),
        },
        payload,
      }),
    ),
  deleteWebhook: (tenantId: RouteParam, webhookId: RouteParam) =>
    endpoint((api) =>
      api.deleteWebhookEndpoint({
        params: {
          tenantId: required(tenantId, "tenantId"),
          webhookId: required(webhookId, "webhookId"),
        },
      }),
    ),
  rotateWebhookSecret: (tenantId: RouteParam, webhookId: RouteParam) =>
    endpoint((api) =>
      api.rotateWebhookSecret({
        params: {
          tenantId: required(tenantId, "tenantId"),
          webhookId: required(webhookId, "webhookId"),
        },
      }),
    ),
  testWebhook: (tenantId: RouteParam, webhookId: RouteParam) =>
    endpoint((api) =>
      api.testWebhookEndpoint({
        params: {
          tenantId: required(tenantId, "tenantId"),
          webhookId: required(webhookId, "webhookId"),
        },
      }),
    ),
  listWebhookDeliveries: (
    tenantId: RouteParam,
    webhookId: RouteParam,
    query: WebhookDeliveryQuery = {},
  ) =>
    endpoint((api) =>
      api.listWebhookDeliveries({
        params: {
          tenantId: required(tenantId, "tenantId"),
          webhookId: required(webhookId, "webhookId"),
        },
        query,
      }),
    ),
  getWebhookDelivery: (tenantId: RouteParam, webhookId: RouteParam, deliveryId: RouteParam) =>
    endpoint((api) =>
      api.getWebhookDelivery({
        params: {
          tenantId: required(tenantId, "tenantId"),
          webhookId: required(webhookId, "webhookId"),
          deliveryId: required(deliveryId, "deliveryId"),
        },
      }),
    ),
  replayWebhookDelivery: (tenantId: RouteParam, webhookId: RouteParam, deliveryId: RouteParam) =>
    endpoint((api) =>
      api.replayWebhookDelivery({
        params: {
          tenantId: required(tenantId, "tenantId"),
          webhookId: required(webhookId, "webhookId"),
          deliveryId: required(deliveryId, "deliveryId"),
        },
      }),
    ),
  listAuditLog: (tenantId: RouteParam) =>
    endpoint((api) => api.listAuditLog({ params: { tenantId: required(tenantId, "tenantId") } })),
  searchAuditLog: (tenantId: RouteParam, query: AuditSearchQuery = {}) =>
    endpoint((api) =>
      api.searchAuditLog({ params: { tenantId: required(tenantId, "tenantId") }, query }),
    ),
  listAccounts: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.listTenantAccounts({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  inviteAccount: (
    tenantId: RouteParam,
    payload: {
      email: string;
      role?: string;
      roleId?: string | null;
      scopeTagIds?: ReadonlyArray<string>;
    },
  ) =>
    endpoint((api) =>
      api.inviteTenantAccount({ params: { tenantId: required(tenantId, "tenantId") }, payload }),
    ),
  listInvitations: (tenantId: RouteParam, query: ListTenantInvitationsQuery = {}) =>
    endpoint((api) =>
      api.listTenantInvitations({
        params: { tenantId: required(tenantId, "tenantId") },
        query,
      }),
    ),
  invitationOptions: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.getTenantInvitationOptions({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  resendInvitation: (tenantId: RouteParam, invitationId: RouteParam) =>
    endpoint((api) =>
      api.resendTenantInvitation({
        params: {
          tenantId: required(tenantId, "tenantId"),
          invitationId: required(invitationId, "invitationId"),
        },
      }),
    ),
  cancelInvitation: (tenantId: RouteParam, invitationId: RouteParam) =>
    endpoint((api) =>
      api.cancelTenantInvitation({
        params: {
          tenantId: required(tenantId, "tenantId"),
          invitationId: required(invitationId, "invitationId"),
        },
      }),
    ),
  /** Public preview of an invitation token; safe to call while signed out. */
  previewInvitation: (token: string) =>
    endpoint((api) => api.previewInvitation({ query: { token } })),
  /** Accept an invitation for the signed-in account. */
  acceptInvitation: (token: string) =>
    endpoint((api) => api.acceptInvitation({ payload: { token } })),
  getOwnershipTransfer: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.getTenantOwnershipTransfer({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  requestOwnershipTransfer: (tenantId: RouteParam, targetAccountId: string) =>
    endpoint((api) =>
      api.requestTenantOwnershipTransfer({
        params: { tenantId: required(tenantId, "tenantId") },
        payload: { targetAccountId },
      }),
    ),
  cancelOwnershipTransfer: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.cancelTenantOwnershipTransfer({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  /** Public preview of an ownership-transfer token; safe while signed out. */
  previewOwnershipTransfer: (token: string) =>
    endpoint((api) => api.previewTenantOwnershipTransfer({ query: { token } })),
  /** Accept an ownership transfer for the signed-in target account. */
  acceptOwnershipTransfer: (token: string) =>
    endpoint((api) => api.acceptTenantOwnershipTransfer({ payload: { token } })),
  patchAccount: (
    tenantId: RouteParam,
    accountId: RouteParam,
    payload: { role?: string; roleId?: string | null },
  ) =>
    endpoint((api) =>
      api.patchTenantAccount({
        params: {
          tenantId: required(tenantId, "tenantId"),
          accountId: required(accountId, "accountId"),
        },
        payload,
      }),
    ),
  /** Change several members to the same built-in or custom role. */
  patchAccountRoles: (
    tenantId: RouteParam,
    payload: { accountIds: string[]; role?: string; roleId?: string | null },
  ) =>
    attributeEndpoint((api) =>
      api.patchTenantAccountRoles({
        params: { tenantId: required(tenantId, "tenantId") },
        payload,
      }),
    ),
  listRoles: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.listTenantRoles({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  listScopeTags: (tenantId: RouteParam) =>
    endpoint((api) => api.listScopeTags({ params: { tenantId: required(tenantId, "tenantId") } })),
  createScopeTag: (tenantId: RouteParam, payload: { name: string; description?: string | null }) =>
    endpoint((api) =>
      api.createScopeTag({
        params: { tenantId: required(tenantId, "tenantId") },
        payload,
      }),
    ),
  patchScopeTag: (
    tenantId: RouteParam,
    tagId: RouteParam,
    payload: { name?: string; description?: string | null },
  ) =>
    endpoint((api) =>
      api.patchScopeTag({
        params: {
          tenantId: required(tenantId, "tenantId"),
          tagId: required(tagId, "tagId"),
        },
        payload,
      }),
    ),
  deleteScopeTag: (tenantId: RouteParam, tagId: RouteParam) =>
    endpoint((api) =>
      api.deleteScopeTag({
        params: {
          tenantId: required(tenantId, "tenantId"),
          tagId: required(tagId, "tagId"),
        },
      }),
    ),
  listScopeTagAssignments: (
    tenantId: RouteParam,
    resourceType: "device" | "group" | "policy" | "application" | "script" | "dashboard",
    resourceIds?: ReadonlyArray<string>,
  ) =>
    endpoint((api) =>
      api.listScopeTagAssignments({
        params: { tenantId: required(tenantId, "tenantId") },
        query: {
          resourceType,
          ...(resourceIds && resourceIds.length > 0 ? { resourceIds: resourceIds.join(",") } : {}),
        },
      }),
    ),
  setScopeTagAssignments: (
    tenantId: RouteParam,
    payload: {
      resourceType: "device" | "group" | "policy" | "application" | "script" | "dashboard";
      resourceIds: ReadonlyArray<string>;
      tagIds: ReadonlyArray<string>;
    },
  ) =>
    endpoint((api) =>
      api.setScopeTagAssignments({
        params: { tenantId: required(tenantId, "tenantId") },
        payload,
      }),
    ),
  setMemberScopeTags: (
    tenantId: RouteParam,
    accountId: RouteParam,
    tagIds: ReadonlyArray<string>,
  ) =>
    endpoint((api) =>
      api.setMemberScopeTags({
        params: {
          tenantId: required(tenantId, "tenantId"),
          accountId: required(accountId, "accountId"),
        },
        payload: { tagIds: [...tagIds] },
      }),
    ),
  listApprovalPolicies: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.listApprovalPolicies({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  createApprovalPolicy: (tenantId: RouteParam, payload: CreateApprovalPolicyRequest) =>
    endpoint((api) =>
      api.createApprovalPolicy({
        params: { tenantId: required(tenantId, "tenantId") },
        payload,
      }),
    ),
  patchApprovalPolicy: (
    tenantId: RouteParam,
    policyId: RouteParam,
    payload: PatchApprovalPolicyRequest,
  ) =>
    endpoint((api) =>
      api.patchApprovalPolicy({
        params: {
          tenantId: required(tenantId, "tenantId"),
          policyId: required(policyId, "policyId"),
        },
        payload,
      }),
    ),
  deleteApprovalPolicy: (tenantId: RouteParam, policyId: RouteParam) =>
    endpoint((api) =>
      api.deleteApprovalPolicy({
        params: {
          tenantId: required(tenantId, "tenantId"),
          policyId: required(policyId, "policyId"),
        },
      }),
    ),
  listApprovalRequests: (tenantId: RouteParam, query: ApprovalRequestQuery = {}) =>
    endpoint((api) =>
      api.listApprovalRequests({
        params: { tenantId: required(tenantId, "tenantId") },
        query,
      }),
    ),
  approveApprovalRequest: (tenantId: RouteParam, approvalId: RouteParam, note?: string) =>
    endpoint((api) =>
      api.approveApprovalRequest({
        params: {
          tenantId: required(tenantId, "tenantId"),
          approvalId: required(approvalId, "approvalId"),
        },
        payload: { note: note && note.trim().length > 0 ? note.trim() : null },
      }),
    ),
  rejectApprovalRequest: (tenantId: RouteParam, approvalId: RouteParam, note: string) =>
    endpoint((api) =>
      api.rejectApprovalRequest({
        params: {
          tenantId: required(tenantId, "tenantId"),
          approvalId: required(approvalId, "approvalId"),
        },
        payload: { note },
      }),
    ),
  cancelApprovalRequest: (tenantId: RouteParam, approvalId: RouteParam) =>
    endpoint((api) =>
      api.cancelApprovalRequest({
        params: {
          tenantId: required(tenantId, "tenantId"),
          approvalId: required(approvalId, "approvalId"),
        },
      }),
    ),
  createRole: (tenantId: RouteParam, payload: CreateTenantRoleRequest) =>
    endpoint((api) =>
      api.createTenantRole({ params: { tenantId: required(tenantId, "tenantId") }, payload }),
    ),
  patchRole: (tenantId: RouteParam, roleId: RouteParam, payload: PatchTenantRoleRequest) =>
    endpoint((api) =>
      api.patchTenantRole({
        params: {
          tenantId: required(tenantId, "tenantId"),
          roleId: required(roleId, "roleId"),
        },
        payload,
      }),
    ),
  deleteRole: (tenantId: RouteParam, roleId: RouteParam) =>
    endpoint((api) =>
      api.deleteTenantRole({
        params: {
          tenantId: required(tenantId, "tenantId"),
          roleId: required(roleId, "roleId"),
        },
      }),
    ),
  removeAccount: (tenantId: RouteParam, accountId: RouteParam) =>
    endpoint((api) =>
      api.removeTenantAccount({
        params: {
          tenantId: required(tenantId, "tenantId"),
          accountId: required(accountId, "accountId"),
        },
      }),
    ),
  storageUsage: (tenantId: RouteParam) =>
    endpoint((api) => api.storageUsage({ params: { tenantId: required(tenantId, "tenantId") } })),
  billing: (tenantId: RouteParam) =>
    endpoint((api) => api.billing({ params: { tenantId: required(tenantId, "tenantId") } })),
  billingPortal: (tenantId: RouteParam, returnUrl: string) =>
    endpoint(
      (api) =>
        api.billingPortal({
          params: { tenantId: required(tenantId, "tenantId") },
          payload: { returnUrl },
        }),
      { stepUp: "billing-portal" },
    ),
  billingCheckout: (tenantId: RouteParam, trialDays?: number) =>
    endpoint(
      (api) =>
        api.billingCheckout({
          params: { tenantId: required(tenantId, "tenantId") },
          payload: trialDays === undefined ? {} : { trialDays },
        }),
      { stepUp: "billing-portal" },
    ),
  billingInvoices: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.billingInvoices({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  stepUpMethods: () => accountEndpoint((api) => api.stepUpMethods({})),
  stepUpTotp: (payload: { code: string; action: StepUpAction }) =>
    accountEndpoint((api) => api.stepUpTotp({ payload })),
  beginStepUpPasskey: (payload: { action: StepUpAction }) =>
    accountEndpoint((api) => api.beginStepUpPasskey({ payload })),
  completeStepUpPasskey: (payload: { stepUpToken: string; response: string }) =>
    accountEndpoint((api) => api.completeStepUpPasskey({ payload })),
};

export const meQueryOptions = (userId?: string, enabled = true) =>
  buildMeQueryOptions({
    userId,
    enabled,
    fetchMe: () => enterprise.me(),
  });

export const enterpriseQueries = {
  me: (userId?: string) => meQueryOptions(userId),
  accountDeletion: () =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.accountDeletion(),
      queryFn: () => enterprise.getAccountDeletion(),
    }),
  adminAccounts: (query: AdminAccountsQuery = {}) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.adminAccounts(query),
      queryFn: () => enterprise.listAdminAccounts(query),
    }),
  tenants: () =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.tenants(),
      queryFn: () => enterprise.listTenants(),
    }),
  tenant: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.tenant(tenantId),
      queryFn: () => enterprise.getTenant(tenantId),
      enabled: Boolean(tenantId),
    }),
  backups: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.backups(tenantId),
      queryFn: () => enterprise.listTenantBackups(tenantId),
      enabled: Boolean(tenantId),
    }),
  attributes: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.attributes(tenantId),
      queryFn: () => enterprise.listAttributes(tenantId),
      enabled: Boolean(tenantId),
    }),
  approvalPolicies: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.approvalPolicies(tenantId),
      queryFn: () => enterprise.listApprovalPolicies(tenantId),
      enabled: Boolean(tenantId),
    }),
  approvalRequests: (tenantId: RouteParam, query: ApprovalRequestQuery = {}) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.approvalRequests(tenantId, query),
      queryFn: () => enterprise.listApprovalRequests(tenantId, query),
      enabled: Boolean(tenantId),
    }),
  enrollmentQuestions: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.enrollmentQuestions(tenantId),
      queryFn: () => enterprise.listEnrollmentQuestions(tenantId),
      enabled: Boolean(tenantId),
    }),
  policyVariables: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.policyVariables(tenantId),
      queryFn: () => enterprise.getPolicyVariables(tenantId),
      enabled: Boolean(tenantId),
    }),
  list: <E extends Entity>(
    tenantId: RouteParam,
    entity: E,
    group?: string,
    context: EnterpriseRequestContext = {},
  ) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.list(tenantId, entity, group),
      queryFn: () => enterprise.list(tenantId, entity, group, context),
      onData: (data, client) => cacheEntityRows(client, tenantId, entity, data.rows),
      enabled: Boolean(tenantId),
    }),
  deviceSearch: (
    tenantId: RouteParam,
    query: DeviceSearchQuery = {},
    context: EnterpriseRequestContext = {},
  ) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.deviceSearch(tenantId, query),
      queryFn: () => enterprise.searchDevices(tenantId, query, context),
      onData: (data, client) => cacheEntityRows(client, tenantId, "device", data.devices),
      enabled: Boolean(tenantId),
    }),
  mcpConnections: () =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.mcpConnections(),
      queryFn: () => enterprise.listMcpConnections(),
      enabled: !isServer,
    }),
  dashboards: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.dashboards(tenantId),
      queryFn: () => enterprise.listDashboards(tenantId),
      enabled: Boolean(tenantId) && !isServer,
    }),
  /**
   * The overview checklist. It is the overview's one extra request, and it is
   * kept fresh on every mount because the steps are derived from resources the
   * user may have just created on another page.
   */
  onboarding: (tenantId: RouteParam, context: EnterpriseRequestContext = {}) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.onboarding(tenantId),
      queryFn: () => enterprise.getTenantOnboarding(tenantId, context),
      enabled: Boolean(tenantId) && !isServer,
      staleTime: 0,
      refetchOnMount: "always",
    }),
  dashboard: (tenantId: RouteParam, id: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.dashboard(tenantId, id),
      queryFn: () => enterprise.getDashboard(tenantId, id),
      enabled: Boolean(tenantId && id) && !isServer,
    }),
  dashboardReports: (tenantId: RouteParam, dashboardId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.dashboardReports(tenantId, dashboardId),
      queryFn: () => enterprise.listDashboardReports(tenantId, dashboardId),
      enabled: Boolean(tenantId && dashboardId) && !isServer,
    }),
  dashboardReportRuns: (tenantId: RouteParam, dashboardId: RouteParam, reportId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.dashboardReportRuns(tenantId, dashboardId, reportId),
      queryFn: () => enterprise.listDashboardReportRuns(tenantId, dashboardId, reportId),
      enabled: Boolean(tenantId && dashboardId && reportId) && !isServer,
    }),
  item: <E extends Entity>(tenantId: RouteParam, entity: E, id: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.item(tenantId, entity, id),
      queryFn: () => enterprise.get(tenantId, entity, id),
      enabled: Boolean(tenantId && id),
    }),
  sso: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.sso(tenantId),
      queryFn: () => enterprise.getSsoConfig(tenantId),
      enabled: Boolean(tenantId),
    }),
  fleetMigrations: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.fleetMigrations(tenantId),
      queryFn: () => enterprise.listFleetMigrations(tenantId),
      enabled: Boolean(tenantId) && !isServer,
    }),
  fleetMigration: (tenantId: RouteParam, migrationId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.fleetMigration(tenantId, migrationId),
      queryFn: () => enterprise.getFleetMigration(tenantId, migrationId),
      enabled: Boolean(tenantId && migrationId) && !isServer,
    }),
  scripts: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.scripts(tenantId),
      queryFn: () => enterprise.listScripts(tenantId),
      enabled: Boolean(tenantId) && !isServer,
    }),
  restrictedSoftware: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.restrictedSoftware(tenantId),
      queryFn: () => enterprise.listRestrictedSoftware(tenantId),
      enabled: Boolean(tenantId) && !isServer,
    }),
  restrictedSoftwareRule: (tenantId: RouteParam, id: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.restrictedSoftwareRule(tenantId, id),
      queryFn: () => enterprise.getRestrictedSoftware(tenantId, id),
      enabled: Boolean(tenantId && id) && !isServer,
    }),
  restrictedSoftwareViolations: (
    tenantId: RouteParam,
    query: {
      status?: "open" | "resolved";
      platform?: "apple" | "win" | "android";
      ruleId?: string;
    } = {},
  ) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.restrictedSoftwareViolations(tenantId, query),
      queryFn: () => enterprise.listRestrictedSoftwareViolations(tenantId, query),
      enabled: Boolean(tenantId) && !isServer,
    }),
  deviceRestrictedSoftware: (tenantId: RouteParam, id: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.deviceRestrictedSoftware(tenantId, id),
      queryFn: () => enterprise.getDeviceRestrictedSoftware(tenantId, id),
      enabled: Boolean(tenantId && id) && !isServer,
    }),
  restrictedSoftwareTargets: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.restrictedSoftwareTargets(tenantId),
      queryFn: async () => {
        const [devices, groups] = await Promise.all([
          enterprise.list(tenantId, "device"),
          enterprise.list(tenantId, "group"),
        ]);

        return {
          devices: devices.rows.map((row) => ({ id: row.id, name: row.name })),
          groups: groups.rows.map((row) => ({ id: row.id, name: row.name })),
        };
      },
      enabled: Boolean(tenantId) && !isServer,
    }),
  script: (tenantId: RouteParam, id: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.script(tenantId, id),
      queryFn: () => enterprise.getScript(tenantId, id),
      enabled: Boolean(tenantId && id) && !isServer,
    }),
  scriptAssignments: (tenantId: RouteParam, id: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.scriptAssignments(tenantId, id),
      queryFn: () => enterprise.getScriptAssignments(tenantId, id),
      enabled: Boolean(tenantId && id) && !isServer,
    }),
  scriptExecutions: (tenantId: RouteParam, id: RouteParam, deviceId?: string) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.scriptExecutions(tenantId, id, deviceId),
      queryFn: () => enterprise.listScriptExecutions(tenantId, id, deviceId),
      enabled: Boolean(tenantId && id) && !isServer,
    }),
  applications: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.applications(tenantId),
      queryFn: () => enterprise.listApplications(tenantId),
      enabled: Boolean(tenantId) && !isServer,
    }),
  applicationInventory: (tenantId: RouteParam, query: ApplicationInventoryQuery = {}) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.applicationInventory(tenantId, query),
      queryFn: () => enterprise.getApplicationInventory(tenantId, query),
      enabled: Boolean(tenantId) && !isServer,
    }),
  deviceApplications: (tenantId: RouteParam, id: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.deviceApplications(tenantId, id),
      queryFn: () => enterprise.listDeviceApplications(tenantId, id),
      enabled: Boolean(tenantId && id) && !isServer,
    }),
  deviceRecoveryKey: (tenantId: RouteParam, id: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.deviceRecoveryKey(tenantId, id),
      queryFn: () => enterprise.getDeviceRecoveryKey(tenantId, id),
      enabled: false,
    }),
  application: (tenantId: RouteParam, id: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.application(tenantId, id),
      queryFn: () => enterprise.getApplication(tenantId, id),
      enabled: Boolean(tenantId && id) && !isServer,
    }),
  policyAssignments: (tenantId: RouteParam, id: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.policyAssignments(tenantId, id),
      queryFn: () => enterprise.getPolicyAssignments(tenantId, id),
      enabled: Boolean(tenantId && id) && !isServer,
    }),
  policyScope: (tenantId: RouteParam, id: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.policyScope(tenantId, id),
      queryFn: () => enterprise.getPolicyScope(tenantId, id),
      enabled: Boolean(tenantId && id) && !isServer,
    }),
  policyDeployment: (
    tenantId: RouteParam,
    id: RouteParam,
    version: string | number,
    options: { limit?: number; offset?: number } = {},
  ) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.policyDeployment(
        tenantId,
        id,
        version,
        options.limit ?? 50,
        options.offset ?? 0,
      ),
      queryFn: () => enterprise.getPolicyDeploymentDevices(tenantId, id, version, options),
      enabled: Boolean(tenantId && id) && !isServer,
    }),
  groupScope: (tenantId: RouteParam, id: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.groupScope(tenantId, id),
      queryFn: () => enterprise.getGroupScope(tenantId, id),
      enabled: Boolean(tenantId && id) && !isServer,
    }),
  deviceEffectivePolicy: (tenantId: RouteParam, id: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.deviceEffectivePolicy(tenantId, id),
      queryFn: () => enterprise.getDeviceEffectivePolicy(tenantId, id),
      enabled: Boolean(tenantId && id) && !isServer,
    }),
  directory: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.directory(tenantId),
      queryFn: () => enterprise.listDirectory(tenantId),
      enabled: Boolean(tenantId) && !isServer,
    }),
  users: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.users(tenantId),
      queryFn: () => enterprise.listUsers(tenantId),
      enabled: Boolean(tenantId) && !isServer,
    }),
  user: (tenantId: RouteParam, userId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.user(tenantId, userId),
      queryFn: () => enterprise.getUser(tenantId, userId),
      enabled: Boolean(tenantId && userId) && !isServer,
    }),
  userMergeCandidates: (tenantId: RouteParam, userId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.userMergeCandidates(tenantId, userId),
      queryFn: () => enterprise.listUserMergeCandidates(tenantId, userId),
      enabled: Boolean(tenantId && userId) && !isServer,
    }),
  userMergePreview: (tenantId: RouteParam, userId: RouteParam, sourceIds: ReadonlyArray<string>) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.userMergePreview(tenantId, userId, sourceIds),
      queryFn: () => enterprise.previewDirectoryUserMerge(tenantId, userId, sourceIds),
      enabled: Boolean(tenantId && userId) && sourceIds.length > 0 && !isServer,
    }),
  deviceUsers: (tenantId: RouteParam, id: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.deviceUsers(tenantId, id),
      queryFn: () => enterprise.getDeviceUsers(tenantId, id),
      enabled: Boolean(tenantId && id) && !isServer,
    }),
  deviceAppleUsers: (tenantId: RouteParam, id: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.deviceAppleUsers(tenantId, id),
      queryFn: () => enterprise.listDeviceAppleUsers(tenantId, id),
      enabled: Boolean(tenantId && id) && !isServer,
    }),
  directorySync: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.directorySync(tenantId),
      queryFn: () => enterprise.getEntraDirectorySync(tenantId),
      enabled: Boolean(tenantId) && !isServer,
    }),
  googleDirectorySync: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.googleDirectorySync(tenantId),
      queryFn: () => enterprise.getGoogleDirectorySync(tenantId),
      enabled: Boolean(tenantId) && !isServer,
    }),
  domains: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.domains(tenantId),
      queryFn: () => enterprise.listEntraDomains(tenantId),
      enabled: Boolean(tenantId) && !isServer,
    }),
  scim: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.scim(tenantId),
      queryFn: () => enterprise.listScimTokens(tenantId),
      enabled: Boolean(tenantId),
    }),
  webhooks: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.webhooks(tenantId),
      queryFn: () => enterprise.listWebhooks(tenantId),
      enabled: Boolean(tenantId) && !isServer,
    }),
  webhookDeliveries: (
    tenantId: RouteParam,
    webhookId: RouteParam,
    filters: Pick<WebhookDeliveryQuery, "event" | "status"> = {},
  ) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.webhookDeliveries(tenantId, webhookId, filters),
      queryFn: () => enterprise.listWebhookDeliveries(tenantId, webhookId, filters),
      enabled: Boolean(tenantId && webhookId) && !isServer,
    }),
  auditLog: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.auditLog(tenantId),
      queryFn: () => enterprise.listAuditLog(tenantId),
      enabled: Boolean(tenantId),
    }),
  /** Cursor-paged audit search shared by the settings page and its preload. */
  auditSearch: (tenantId: RouteParam, filters: AuditSearchQuery = {}) =>
    infiniteQueryOptions<
      AuditSearchResponse,
      Error,
      InfiniteData<AuditSearchResponse>,
      readonly unknown[],
      string | undefined
    >({
      queryKey: enterpriseKeys.auditSearch(tenantId, filters),
      queryFn: ({ pageParam }) =>
        enterprise.searchAuditLog(tenantId, { ...filters, cursor: pageParam }),
      initialPageParam: undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      enabled: Boolean(tenantId) && !isServer,
    }),
  /**
   * Server-paginated group list. Pages are offset-based and appended, so the
   * table can load more without re-reading the rows already on screen.
   */
  searchGroups: (tenantId: RouteParam, filters: GroupSearchQuery = {}) =>
    infiniteQueryOptions<
      GroupSearchResponse,
      Error,
      InfiniteData<GroupSearchResponse>,
      readonly unknown[],
      number
    >({
      queryKey: enterpriseKeys.entitySearch(tenantId, "group", filters),
      queryFn: async ({ client, pageParam }) => {
        const page = await enterprise.searchGroups(tenantId, { ...filters, offset: pageParam });
        cacheEntityRows(client, tenantId, "group", page.groups);

        return page;
      },
      initialPageParam: 0,
      getNextPageParam: (_last, pages) => {
        const loaded = pages.reduce((count, page) => count + page.groups.length, 0);
        const total = pages.at(-1)?.total ?? 0;

        return loaded < total ? loaded : undefined;
      },
      placeholderData: keepPreviousData,
      enabled: Boolean(tenantId) && !isServer,
    }),
  /** Server-paginated policy list; see `searchGroups` for the page contract. */
  searchPolicies: (tenantId: RouteParam, filters: PolicySearchQuery = {}) =>
    infiniteQueryOptions<
      PolicySearchResponse,
      Error,
      InfiniteData<PolicySearchResponse>,
      readonly unknown[],
      number
    >({
      queryKey: enterpriseKeys.entitySearch(tenantId, "policy", filters),
      queryFn: async ({ client, pageParam }) => {
        const page = await enterprise.searchPolicies(tenantId, { ...filters, offset: pageParam });
        cacheEntityRows(client, tenantId, "policy", page.policies);

        return page;
      },
      initialPageParam: 0,
      getNextPageParam: (_last, pages) => {
        const loaded = pages.reduce((count, page) => count + page.policies.length, 0);
        const total = pages.at(-1)?.total ?? 0;

        return loaded < total ? loaded : undefined;
      },
      placeholderData: keepPreviousData,
      enabled: Boolean(tenantId) && !isServer,
    }),
  /** Server-paginated application catalogue; see `searchGroups`. */
  searchApplications: (tenantId: RouteParam, filters: ApplicationSearchQuery = {}) =>
    infiniteQueryOptions<
      ApplicationSearchResponse,
      Error,
      InfiniteData<ApplicationSearchResponse>,
      readonly unknown[],
      number
    >({
      queryKey: enterpriseKeys.entitySearch(tenantId, "application", filters),
      queryFn: ({ pageParam }) =>
        enterprise.searchApplications(tenantId, { ...filters, offset: pageParam }),
      initialPageParam: 0,
      getNextPageParam: (_last, pages) => {
        const loaded = pages.reduce((count, page) => count + page.applications.length, 0);
        const total = pages.at(-1)?.total ?? 0;

        return loaded < total ? loaded : undefined;
      },
      // Keep the previous page visible while the new filter loads so the
      // table's "filters changed" notice describes what is on screen.
      placeholderData: keepPreviousData,
      enabled: Boolean(tenantId) && !isServer,
    }),
  /** Server-paginated curated software catalogue; see `searchGroups`. */
  searchSoftwareCatalogue: (tenantId: RouteParam, filters: CatalogueSearchQuery = {}) =>
    infiniteQueryOptions<
      CatalogueSearchResponse,
      Error,
      InfiniteData<CatalogueSearchResponse>,
      readonly unknown[],
      number
    >({
      queryKey: enterpriseKeys.softwareCatalogue(tenantId, filters),
      queryFn: ({ pageParam }) =>
        enterprise.searchSoftwareCatalogue(tenantId, { ...filters, offset: pageParam }),
      initialPageParam: 0,
      getNextPageParam: (_last, pages) => {
        const loaded = pages.reduce((count, page) => count + page.items.length, 0);
        const total = pages.at(-1)?.total ?? 0;

        return loaded < total ? loaded : undefined;
      },
      placeholderData: keepPreviousData,
      enabled: Boolean(tenantId) && !isServer,
    }),
  softwareCatalogueTitle: (tenantId: RouteParam, titleId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.softwareCatalogueTitle(tenantId, titleId),
      queryFn: () => enterprise.getSoftwareCatalogueTitle(tenantId, titleId),
      enabled: Boolean(tenantId && titleId) && !isServer,
    }),
  roles: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.roles(tenantId),
      queryFn: () => enterprise.listRoles(tenantId),
      enabled: Boolean(tenantId),
    }),
  scopeTags: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.scopeTags(tenantId),
      queryFn: () => enterprise.listScopeTags(tenantId),
      enabled: Boolean(tenantId),
    }),
  scopeTagAssignments: (
    tenantId: RouteParam,
    resourceType: "device" | "group" | "policy" | "application" | "script" | "dashboard",
    resourceIds?: ReadonlyArray<string>,
  ) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.scopeTagAssignments(tenantId, resourceType, resourceIds?.join(",")),
      queryFn: async () => {
        if (!resourceIds || resourceIds.length === 0)
          return enterprise.listScopeTagAssignments(tenantId, resourceType);

        // The endpoint bounds one query at 200 ids. Merge the chunks so a
        // select-all-matching editor sees every resource, not just the first
        // page.
        const byResource = new Map<string, Array<string>>();

        for (let index = 0; index < resourceIds.length; index += 200) {
          const page = await enterprise.listScopeTagAssignments(
            tenantId,
            resourceType,
            resourceIds.slice(index, index + 200),
          );

          for (const assignment of page.assignments) {
            const tags = byResource.get(assignment.resourceId) ?? [];

            for (const tagId of assignment.tagIds) if (!tags.includes(tagId)) tags.push(tagId);
            byResource.set(assignment.resourceId, tags);
          }
        }

        return {
          assignments: [...byResource.entries()].map(([resourceId, tagIds]) => ({
            resourceType,
            resourceId,
            tagIds,
          })),
        };
      },
      enabled: Boolean(tenantId),
    }),
  accounts: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.accounts(tenantId),
      queryFn: () => enterprise.listAccounts(tenantId),
      enabled: Boolean(tenantId),
    }),
  invitations: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.invitations(tenantId),
      queryFn: () => enterprise.listInvitations(tenantId),
      enabled: Boolean(tenantId),
    }),
  invitationOptions: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.invitationOptions(tenantId),
      queryFn: () => enterprise.invitationOptions(tenantId),
      enabled: Boolean(tenantId),
    }),
  ownershipTransfer: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.ownershipTransfer(tenantId),
      queryFn: () => enterprise.getOwnershipTransfer(tenantId),
      enabled: Boolean(tenantId),
    }),
  apns: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.apns(tenantId),
      queryFn: () => enterprise.getApns(tenantId),
      enabled: Boolean(tenantId),
    }),
  android: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.android(tenantId),
      queryFn: () => enterprise.getTenantAndroid(tenantId),
      enabled: Boolean(tenantId),
    }),
  abm: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.abm(tenantId),
      queryFn: () => enterprise.getAppleBusinessManager(tenantId),
      enabled: Boolean(tenantId),
    }),
  abmDevices: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.abmDevices(tenantId),
      queryFn: () => enterprise.listAbmDevices(tenantId),
      enabled: Boolean(tenantId),
    }),
  abmDevice: (tenantId: RouteParam, serial: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.abmDevice(tenantId, serial),
      queryFn: () => enterprise.getAbmDevice(tenantId, serial),
      enabled: Boolean(tenantId) && Boolean(serial),
      // A serial that has not been synced from ABM is an expected empty state,
      // not a page-level failure.
      throwOnError: false,
      suspense: false,
    }),
  vpp: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.vpp(tenantId),
      queryFn: () => enterprise.getVpp(tenantId),
      enabled: Boolean(tenantId),
    }),
  vppAssets: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.vppAssets(tenantId),
      queryFn: () => enterprise.listVppAssets(tenantId),
      enabled: Boolean(tenantId),
    }),
  vppAssignments: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.vppAssignments(tenantId),
      queryFn: () => enterprise.listVppAssignments(tenantId),
      enabled: Boolean(tenantId),
    }),
  storageUsage: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.storageUsage(tenantId),
      queryFn: () => enterprise.storageUsage(tenantId),
      enabled: Boolean(tenantId),
    }),
  billing: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.billing(tenantId),
      queryFn: () => enterprise.billing(tenantId),
      enabled: Boolean(tenantId),
    }),
  billingInvoices: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.billingInvoices(tenantId),
      queryFn: () => enterprise.billingInvoices(tenantId),
      enabled: Boolean(tenantId),
    }),
  enrollment: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.enrollment(tenantId),
      queryFn: () => enterprise.getTenantEnrollment(tenantId),
      enabled: Boolean(tenantId),
    }),
  appleByod: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.appleByod(tenantId),
      queryFn: () => enterprise.getAppleByodConfig(tenantId),
      enabled: Boolean(tenantId),
    }),
  enrollmentAttempts: (tenantId: RouteParam, limit = 20) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.enrollmentAttempts(tenantId, limit),
      queryFn: () => enterprise.listEnrollmentAttempts(tenantId, limit),
      enabled: Boolean(tenantId),
    }),
  devicePreRegistrations: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.devicePreRegistrations(tenantId),
      queryFn: () => enterprise.listDevicePreRegistrations(tenantId),
      enabled: Boolean(tenantId),
    }),
  scepCa: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.scepCa(tenantId),
      queryFn: () => enterprise.getTenantScepCa(tenantId),
      enabled: Boolean(tenantId),
    }),
  devicePushHealth: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.devicePushHealth(tenantId),
      queryFn: () => enterprise.getDevicePushHealth(tenantId),
      enabled: Boolean(tenantId),
    }),
  softwareUpdates: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.softwareUpdates(tenantId),
      queryFn: () => enterprise.getSoftwareUpdateSummary(tenantId),
      enabled: Boolean(tenantId),
    }),
  osPolicy: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.osPolicy(tenantId),
      queryFn: () => enterprise.getTenantOsPolicy(tenantId),
      enabled: Boolean(tenantId),
    }),
  osFleet: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.osFleet(tenantId),
      queryFn: () => enterprise.getOsFleet(tenantId),
      enabled: Boolean(tenantId),
    }),
  windowsFailures: (tenantId: RouteParam, limit = 5) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.windowsFailures(tenantId),
      queryFn: () => enterprise.listWindowsFailures(tenantId, { limit }),
      enabled: Boolean(tenantId),
    }),
  deviceWindowsFailures: (tenantId: RouteParam, deviceId: string | undefined, limit = 5) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.windowsFailures(tenantId, deviceId),
      queryFn: () => enterprise.listWindowsFailures(tenantId, { deviceId, limit }),
      enabled: Boolean(tenantId) && Boolean(deviceId),
    }),
  autopilot: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.autopilot(tenantId),
      queryFn: () => enterprise.getAutopilotSettings(tenantId),
      enabled: Boolean(tenantId),
    }),
  autopilotDevices: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.autopilotDevices(tenantId),
      queryFn: () => enterprise.listAutopilotDevices(tenantId),
      enabled: Boolean(tenantId),
    }),
  autopilotProfiles: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.autopilotProfiles(tenantId),
      queryFn: () => enterprise.listAutopilotProfiles(tenantId),
      enabled: Boolean(tenantId),
    }),
  tenantSecurity: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.tenantSecurity(tenantId),
      queryFn: () => enterprise.getTenantSecurity(tenantId),
      enabled: Boolean(tenantId),
    }),
  publicEnrollment: (id: RouteParam, code?: string) =>
    enterpriseQueryOptions({
      queryKey: ["enterprise", "public-enrollment", id ?? "", code ?? ""] as const,
      queryFn: () => enterprise.getEnrollment(id, code),
      enabled: Boolean(id),
    }),
};

export const enabledTenant = (tenantId: Accessor<string | undefined>) => () => Boolean(tenantId());

/**
 * Pick the tenant the UI should show. Tenant-scoped APIs always take the
 * tenant id, but a URL may carry either the id or the canonical slug; both
 * resolve to the same membership. The first membership is a fallback for
 * non-tenant routes (for example the tenant picker or account page).
 */
export function resolveActiveTenant(
  me: { tenants: readonly TenantInfo[] } | undefined,
  tenantKey?: string,
) {
  if (!me) return undefined;

  return resolveTenant(me.tenants, tenantKey, currentTenantDirectory());
}
