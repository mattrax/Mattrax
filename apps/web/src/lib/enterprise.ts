import { queryOptions } from "@tanstack/solid-query";
import type {
  AppleUserActionName,
  MeResponse,
  UpdateMeRequest,
} from "@mattrax/enterprise-domain/client";
import { Effect, Option, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import type { Accessor } from "solid-js";
import { errorTag, raisedFailure, stepUpFailure } from "~/lib/errors";
import { readMeCache, writeMeCache } from "~/lib/me-cache";
import { getPreloadedSession, readClientPreloadedMe } from "~/lib/session-store";
import { rememberTenants, resolveTenant, resolveTenantId } from "~/lib/tenant";
import {
  requestStepUp,
  stepUpGrant,
  StepUpActionSchema,
  StepUpMethodSchema,
  type StepUpAction,
} from "~/lib/step-up-bus";
import { getRequestEvent, isServer } from "@solidjs/web";
import {
  EnterpriseBadRequest,
  makeEnterpriseClient,
  scriptHttpApi,
  formatDeviceQueryText,
  parseDeviceQueryText,
  type AndroidEnterpriseInfo,
  type AndroidSignupResponse,
  type AndroidSyncResponse,
  type AbmAssignDeviceResponse,
  type AbmDeviceInfo,
  type AbmDevicesResponse,
  type AbmProfileUrlResponse,
  type AppleBusinessManagerInfo,
  type AppleBusinessManagerSyncResponse,
  type ApplicationInventoryQuery,
  type AuditSearchQuery,
  type AutopilotImportRequest,
  type CreateAttributeRequest,
  type PatchAttributeRequest,
  type PatchEnrollmentQuestionsRequest,
  type SetDeviceAttributesRequest,
  type CreateAutopilotProfileRequest,
  type DevicePreRegistrationImportRequest,
  type DeviceRow,
  type DeviceSearchQuery,
  type DashboardQueryRequest,
  type DashboardSummary,
  type PatchDashboardWidgetRequest,
  type DashboardWidgetType,
  type DynamicGroupKind,
  type DynamicGroupRules,
  type Entity,
  type GroupNode,
  type GroupRow,
  type PolicyRow,
  type RowFor,
  type TenantEnrollmentInfo,
  type TenantScepCaInfo,
  type TenantImportRequest,
  type TenantInfo,
  type BackupRestoreResponse,
  type CreateTenantRoleRequest,
  type ListTenantInvitationsQuery,
  type PatchTenantRoleRequest,
  type UpdateAutopilotProfileRequest,
  type VppAssetsResponse,
  type VppInfo,
  type VppInstallResponse,
  type VppReleaseResponse,
  type VppSyncResponse,
  type WebhookEndpointInfo,
  type WebhookDeliveryQuery,
  type CreateScriptRequest,
  type PatchScriptRequest,
  type PatchScriptAssignmentsRequest,
  type RunScriptRequest,
  type ScriptSettings,
} from "@mattrax/enterprise-domain/client";

export type {
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
  MeResponse,
  NodeResponse,
  PlatformEnrollment,
  PolicyApplicationObject,
  PolicyRow,
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
  TenantUser,
  UserInfo,
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

type EnterpriseApiClient = Effect.Success<ReturnType<typeof clientEffect>>["EnterpriseApi"];

type EnterpriseAccountClient = Effect.Success<ReturnType<typeof clientEffect>>["EnterpriseAccount"];

type EnterpriseAttributeClient = Effect.Success<
  ReturnType<typeof clientEffect>
>["EnterpriseAttribute"];

type ScriptApiClient = Effect.Success<ReturnType<typeof scriptClientEffect>>["ScriptApi"];

/**
 * Query keys must not change when a tenant URL moves between its canonical slug
 * and its id (the shell rewrites one to the other). Keying on the resolved id
 * keeps the cached data mounted, so the segment swap neither refetches nor
 * suspends the navigation.
 */
const keyTenant = (tenantId: RouteParam) =>
  tenantId ? (resolveTenantId(tenantId) ?? tenantId) : "";

export const enterpriseKeys = {
  me: () => ["enterprise", "me"] as const,
  tenants: () => ["enterprise", "tenants"] as const,
  tenant: (tenantId: RouteParam) => ["enterprise", "tenant", keyTenant(tenantId)] as const,
  backups: (tenantId: RouteParam) => ["enterprise", "backups", keyTenant(tenantId)] as const,
  list: (tenantId: RouteParam, entity: Entity, group?: string) =>
    ["enterprise", "list", keyTenant(tenantId), entity, group ?? ""] as const,
  deviceSearch: (tenantId: RouteParam, query: DeviceSearchQuery = {}) =>
    ["enterprise", "device-search", keyTenant(tenantId), query] as const,
  deviceHealth: (tenantId: RouteParam, id: RouteParam) =>
    ["enterprise", "device-health", keyTenant(tenantId), id ?? ""] as const,
  deviceHealthSummary: (tenantId: RouteParam) =>
    ["enterprise", "device-health-summary", keyTenant(tenantId)] as const,
  devicePushHealth: (tenantId: RouteParam) =>
    ["enterprise", "device-push-health", keyTenant(tenantId)] as const,
  deviceActivity: (tenantId: RouteParam, id: RouteParam) =>
    ["enterprise", "device-activity", keyTenant(tenantId), id ?? ""] as const,
  credentialHealth: (tenantId: RouteParam) =>
    ["enterprise", "credential-health", keyTenant(tenantId)] as const,
  item: (tenantId: RouteParam, entity: Entity, id: RouteParam) =>
    ["enterprise", "item", keyTenant(tenantId), entity, id ?? ""] as const,
  users: (tenantId: RouteParam) => ["enterprise", "tenant-users", keyTenant(tenantId)] as const,
  roles: (tenantId: RouteParam) => ["enterprise", "tenant-roles", keyTenant(tenantId)] as const,
  invitations: (tenantId: RouteParam) =>
    ["enterprise", "tenant-invitations", keyTenant(tenantId)] as const,
  invitationOptions: (tenantId: RouteParam) =>
    ["enterprise", "tenant-invitation-options", keyTenant(tenantId)] as const,
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
  billing: (tenantId: RouteParam) => ["enterprise", "billing", keyTenant(tenantId)] as const,
  billingInvoices: (tenantId: RouteParam) =>
    ["enterprise", "billing-invoices", keyTenant(tenantId)] as const,
  enrollment: (tenantId: RouteParam) => ["enterprise", "enrollment", keyTenant(tenantId)] as const,
  scepCa: (tenantId: RouteParam) => ["enterprise", "scep-ca", keyTenant(tenantId)] as const,
  enrollmentAttempts: (tenantId: RouteParam, limit = 50) =>
    ["enterprise", "enrollment-attempts", keyTenant(tenantId), limit] as const,
  devicePreRegistrations: (tenantId: RouteParam) =>
    ["enterprise", "device-pre-registrations", keyTenant(tenantId)] as const,
  attributes: (tenantId: RouteParam) => ["enterprise", "attributes", keyTenant(tenantId)] as const,
  enrollmentQuestions: (tenantId: RouteParam) =>
    ["enterprise", "enrollment-questions", keyTenant(tenantId)] as const,
  policyVariables: (tenantId: RouteParam) =>
    ["enterprise", "policy-variables", keyTenant(tenantId)] as const,
  search: (tenantId: RouteParam, term: string, limit = 30) =>
    ["enterprise", "search", keyTenant(tenantId), term, limit] as const,
  mcpConnections: () => ["enterprise", "mcp-connections"] as const,
  dashboards: (tenantId: RouteParam) => ["enterprise", "dashboards", keyTenant(tenantId)] as const,
  dashboard: (tenantId: RouteParam, id: RouteParam) =>
    ["enterprise", "dashboard", keyTenant(tenantId), id ?? ""] as const,
  dashboardQuery: (tenantId: RouteParam, request: DashboardQueryRequest) =>
    ["enterprise", "dashboard-query", keyTenant(tenantId), request] as const,
  auditLog: (tenantId: RouteParam) => ["enterprise", "audit-log", keyTenant(tenantId)] as const,
  accountActivity: (query: AuditSearchQuery = {}) =>
    ["enterprise", "account-activity", query] as const,
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
  applicationInventory: (tenantId: RouteParam, query: ApplicationInventoryQuery = {}) =>
    ["enterprise", "application-inventory", keyTenant(tenantId), query] as const,
  deviceApplications: (tenantId: RouteParam, id: RouteParam) =>
    ["enterprise", "device-applications", keyTenant(tenantId), id ?? ""] as const,
  deviceRecoveryKey: (tenantId: RouteParam, id: RouteParam) =>
    ["enterprise", "device-recovery-key", keyTenant(tenantId), id ?? ""] as const,
  application: (tenantId: RouteParam, id: RouteParam) =>
    ["enterprise", "application", keyTenant(tenantId), id ?? ""] as const,
  scripts: (tenantId: RouteParam) => ["enterprise", "scripts", keyTenant(tenantId)] as const,
  script: (tenantId: RouteParam, id: RouteParam) =>
    ["enterprise", "script", keyTenant(tenantId), id ?? ""] as const,
  scriptAssignments: (tenantId: RouteParam, id: RouteParam) =>
    ["enterprise", "script-assignments", keyTenant(tenantId), id ?? ""] as const,
  scriptExecutions: (tenantId: RouteParam, id: RouteParam, deviceId?: string) =>
    ["enterprise", "script-executions", keyTenant(tenantId), id ?? "", deviceId ?? ""] as const,
  policyAssignments: (tenantId: RouteParam, id: RouteParam) =>
    ["enterprise", "policy-assignments", keyTenant(tenantId), id ?? ""] as const,
  deviceEffectivePolicy: (tenantId: RouteParam, id: RouteParam) =>
    ["enterprise", "device-effective-policy", keyTenant(tenantId), id ?? ""] as const,
  directory: (tenantId: RouteParam) => ["enterprise", "directory", keyTenant(tenantId)] as const,
  deviceUsers: (tenantId: RouteParam, id: RouteParam) =>
    ["enterprise", "device-users", keyTenant(tenantId), id ?? ""] as const,
  deviceAppleUsers: (tenantId: RouteParam, id: RouteParam) =>
    ["enterprise", "device-apple-users", keyTenant(tenantId), id ?? ""] as const,
  directorySync: (tenantId: RouteParam) =>
    ["enterprise", "directory-sync", keyTenant(tenantId)] as const,
  domains: (tenantId: RouteParam) => ["enterprise", "domains", keyTenant(tenantId)] as const,
  autopilot: (tenantId: RouteParam) => ["enterprise", "autopilot", keyTenant(tenantId)] as const,
  autopilotDevices: (tenantId: RouteParam) =>
    ["enterprise", "autopilot-devices", keyTenant(tenantId)] as const,
  autopilotProfiles: (tenantId: RouteParam) =>
    ["enterprise", "autopilot-profiles", keyTenant(tenantId)] as const,
};

const required = (value: RouteParam, name: string) => {
  if (!value) throw new EnterpriseBadRequest({ message: `Missing ${name}` });

  // Tenant routes carry the canonical slug; the API addresses tenants by id.
  return name === "tenantId" ? (resolveTenantId(value) ?? value) : value;
};

const clientEffect = (headers: Readonly<Record<string, string>>) => {
  const event = isServer ? getRequestEvent() : undefined;
  const baseUrl = event ? new URL("/", event.request.url).toString() : "/";

  return makeEnterpriseClient({
    baseUrl,
    transformClient: (client) =>
      HttpClient.mapRequest((request) => HttpClientRequest.setHeaders(request, headers))(client),
  });
};

/**
 * Scripts are their own HttpApi so the main contract's generated client type
 * stays within TypeScript's declaration-size limit.
 */
const scriptClientEffect = (headers: Readonly<Record<string, string>>) => {
  const event = isServer ? getRequestEvent() : undefined;
  const baseUrl = event ? new URL("/", event.request.url).toString() : "/";

  return HttpApiClient.make(scriptHttpApi, {
    baseUrl,
    transformClient: (client) =>
      HttpClient.mapRequest((request) => HttpClientRequest.setHeaders(request, headers))(client),
  });
};

type EndpointStepUp =
  | {
      /** The action this endpoint requires a recent step-up for. */
      readonly stepUp: StepUpAction;
    }
  | {
      /** Step-up endpoints must not recurse into the prompt. */
      readonly stepUp: false;
    };

function endpointWith<Client, A, E>(
  makeClient: (
    headers: Readonly<Record<string, string>>,
  ) => Effect.Effect<Client, never, HttpClient.HttpClient>,
  call: (api: Client) => Effect.Effect<A, E, never>,
  options: EndpointStepUp = { stepUp: false },
): EndpointPromise<A, E | EnterpriseBadRequest> {
  const action = options.stepUp === false ? undefined : options.stepUp;

  const requestHeaders = (grant?: string) => {
    const event = isServer ? getRequestEvent() : undefined;
    const cookie = event?.request.headers.get("cookie");
    const headers: Record<string, string> = {};

    if (grant) headers["x-mattrax-step-up"] = grant;

    if (cookie) headers.cookie = cookie;

    return headers;
  };

  const attempt = (grant?: string) => {
    const effect = makeClient(requestHeaders(grant)).pipe(Effect.flatMap(call));

    // SAFETY: `Effect.runPromise` resolves with the effect's success value `A`;
    // the assertion restores the generic success type the client erases.
    return Effect.runPromise(effect.pipe(Effect.provide(FetchHttpClient.layer))) as Promise<A>;
  };

  const decodeAction = Schema.decodeUnknownOption(StepUpActionSchema);
  const decodeMethods = Schema.decodeUnknownOption(Schema.Array(StepUpMethodSchema));

  const run = async (): Promise<A> => {
    try {
      return await attempt(stepUpGrant(action));
    } catch (error) {
      const failure = raisedFailure(error);

      if (errorTag(failure) !== "StepUpRequired") throw error;

      const fields = stepUpFailure(failure);
      const required = Option.getOrUndefined(decodeAction(fields.action)) ?? action;

      if (!required) throw error;

      const methods = Option.getOrUndefined(decodeMethods(fields.methods));
      const grant = await requestStepUp(required, methods);

      return await attempt(grant);
    }
  };

  // SAFETY: `EndpointPromise` only adds the phantom `__error` field that carries
  // the endpoint error type; the runtime value is the plain promise from `run`.
  return run() as EndpointPromise<A, E | EnterpriseBadRequest>;
}

function endpoint<A, E>(
  call: (api: EnterpriseApiClient) => Effect.Effect<A, E, never>,
  options: EndpointStepUp = { stepUp: false },
): EndpointPromise<A, E | EnterpriseBadRequest> {
  return endpointWith(
    (headers) => Effect.map(clientEffect(headers), (client) => client.EnterpriseApi),
    call,
    options,
  );
}

function accountEndpoint<A, E>(
  call: (api: EnterpriseAccountClient) => Effect.Effect<A, E, never>,
  options: EndpointStepUp = { stepUp: false },
): EndpointPromise<A, E | EnterpriseBadRequest> {
  return endpointWith(
    (headers) => Effect.map(clientEffect(headers), (client) => client.EnterpriseAccount),
    call,
    options,
  );
}

function attributeEndpoint<A, E>(
  call: (api: EnterpriseAttributeClient) => Effect.Effect<A, E, never>,
  options: EndpointStepUp = { stepUp: false },
): EndpointPromise<A, E | EnterpriseBadRequest> {
  return endpointWith(
    (headers) => Effect.map(clientEffect(headers), (client) => client.EnterpriseAttribute),
    call,
    options,
  );
}

function scriptEndpoint<A, E>(
  call: (api: ScriptApiClient) => Effect.Effect<A, E, never>,
  options: EndpointStepUp = { stepUp: false },
): EndpointPromise<A, E | EnterpriseBadRequest> {
  return endpointWith(
    (headers) => Effect.map(scriptClientEffect(headers), (client) => client.ScriptApi),
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
  queryFn: () => T;
  enabled?: boolean;
  /** Leave endpoint failures in state instead of throwing to the error boundary. */
  throwOnError?: boolean;
  suspense?: boolean;
}) =>
  queryOptions<EndpointData<T>, EndpointError<T>, EndpointData<T>, TQueryKey>({
    // SAFETY: `T` is the endpoint promise for this key; its resolved value is
    // `EndpointData<T>` and the phantom `__error` field never exists at runtime.
    ...(options as {
      queryKey: TQueryKey;
      queryFn: () => Promise<EndpointData<T>>;
      enabled?: boolean;
      throwOnError?: boolean;
      suspense?: boolean;
    }),
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
  me: () => accountEndpoint((api) => api.me({})),
  /** Account-level profile fields, including the default landing tenant. */
  updateMe: (payload: UpdateMeRequest) => accountEndpoint((api) => api.updateMe({ payload })),
  getEnrollment: (id: RouteParam, code?: string) =>
    endpoint((api) => api.getEnrollment({ params: { id: required(id, "id") }, query: { code } })),
  listTenants: () => endpoint((api) => api.listTenants({})),
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
  /** Creates a new tenant owned by the caller from an exported bundle. */
  importTenant: (payload: TenantImportRequest) => endpoint((api) => api.importTenant({ payload })),
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
    }>,
  ) =>
    endpoint((api) =>
      api.patchTenant({ params: { tenantId: required(tenantId, "tenantId") }, payload }),
    ),
  deleteTenant: (tenantId: RouteParam) =>
    endpoint((api) => api.deleteTenant({ params: { tenantId: required(tenantId, "tenantId") } }), {
      stepUp: "tenant-delete",
    }),
  list: <E extends Entity>(tenantId: RouteParam, entity: E, _group?: string) =>
    endpoint((api) => {
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
    }),
  /** Tenant-scoped device/group/policy search used by the command palette. */
  search: (tenantId: RouteParam, query: { q?: string; limit?: number } = {}) =>
    endpoint((api) => api.search({ params: { tenantId: required(tenantId, "tenantId") }, query })),
  searchDevices: (tenantId: RouteParam, query: DeviceSearchQuery = {}) =>
    endpoint((api) =>
      api.searchDevices({ params: { tenantId: required(tenantId, "tenantId") }, query }),
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
    payload: Partial<Pick<DeviceRow, "name" | "notes" | "assetTag">>,
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
        | "refresh-applications";
      manifestUrl?: string;
      iTunesStoreId?: number;
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
  getDevicePushHealth: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.getDevicePushHealth({ params: { tenantId: required(tenantId, "tenantId") } }),
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
    payload: Partial<Pick<GroupRow, "name" | "notes" | "kind" | "rules">>,
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
      };
      unassign?: {
        devices?: string[];
        policies?: Array<string | { id: string; mode?: "include" | "exclude" }>;
      };
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
    payload: { name: string; notes?: string | null; priority?: number },
  ) =>
    endpoint((api) =>
      api.createPolicy({ params: { tenantId: required(tenantId, "tenantId") }, payload }),
    ),
  patchPolicy: (
    tenantId: RouteParam,
    id: RouteParam,
    payload: Partial<Pick<PolicyRow, "name" | "notes" | "configurations" | "priority">>,
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
  createScript: (tenantId: RouteParam, payload: CreateScriptRequest) =>
    scriptEndpoint(
      (api) =>
        api.createScript({
          params: { tenantId: required(tenantId, "tenantId") },
          payload,
        }),
      { stepUp: "script-change" },
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
  listApplications: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.listApplications({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  listDirectory: (tenantId: RouteParam) =>
    endpoint((api) => api.listDirectory({ params: { tenantId: required(tenantId, "tenantId") } })),
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
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id"), userId },
        payload: { action },
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
      assign?: { groups?: string[]; devices?: string[] };
      unassign?: { groups?: string[]; devices?: string[] };
    },
  ) =>
    endpoint((api) =>
      api.patchApplicationAssignments({
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
          installerId,
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
          installerId,
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
        params: { tenantId: required(tenantId, "tenantId"), profileId },
        payload,
      }),
    ),
  assignAutopilotProfile: (tenantId: RouteParam, profileId: string, groupId: string) =>
    endpoint((api) =>
      api.assignAutopilotProfile({
        params: { tenantId: required(tenantId, "tenantId"), profileId },
        payload: { groupId },
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
  rollbackPolicy: (tenantId: RouteParam, id: RouteParam, deploymentId: string) =>
    endpoint((api) =>
      api.rollbackPolicy({
        params: {
          tenantId: required(tenantId, "tenantId"),
          id: required(id, "id"),
          deploymentId,
        },
      }),
    ),
  syncPolicies: (tenantId: RouteParam, ids: string[]) =>
    endpoint((api) =>
      api.syncPolicies({ params: { tenantId: required(tenantId, "tenantId") }, payload: ids }),
    ),
  previewMobileconfig: (mobileconfig: string) =>
    endpoint((api) => api.previewMobileconfig({ payload: { mobileconfig } })),
  extractMobileconfig: (mobileconfig: string) =>
    endpoint((api) => api.extractMobileconfig({ payload: { mobileconfig } })),
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
  patchTenantAndroid: (tenantId: RouteParam, payload: { enabled?: boolean }) =>
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
  revokeAllAccountSessions: () =>
    accountEndpoint((api) => api.revokeAllAccountSessions(), { stepUp: "sessions-revoke-all" }),
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
        params: { tenantId: required(tenantId, "tenantId"), tokenId },
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
  listUsers: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.listTenantUsers({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  inviteUser: (
    tenantId: RouteParam,
    payload: { email: string; role?: string; roleId?: string | null },
  ) =>
    endpoint((api) =>
      api.inviteTenantUser({ params: { tenantId: required(tenantId, "tenantId") }, payload }),
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
  patchUser: (
    tenantId: RouteParam,
    memberId: RouteParam,
    payload: { role?: string; roleId?: string | null },
  ) =>
    endpoint((api) =>
      api.patchTenantUser({
        params: {
          tenantId: required(tenantId, "tenantId"),
          memberId: required(memberId, "memberId"),
        },
        payload,
      }),
    ),
  listRoles: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.listTenantRoles({ params: { tenantId: required(tenantId, "tenantId") } }),
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
  removeUser: (tenantId: RouteParam, memberId: RouteParam) =>
    endpoint((api) =>
      api.removeTenantUser({
        params: {
          tenantId: required(tenantId, "tenantId"),
          memberId: required(memberId, "memberId"),
        },
      }),
    ),
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

export const meQueryOptions = (userId?: string, enabled = true) => {
  const cached = readMeCache(userId);

  // The SSR preload carries the same `/me` payload, so the first paint can
  // render the tenant shell, guard and permission-aware navigation without a
  // second request. Only data for the signed-in account is accepted.
  const event = isServer ? getRequestEvent() : undefined;
  const preloaded = event ? getPreloadedSession(event.request)?.me : readClientPreloadedMe();

  const initialData: MeResponse | undefined =
    preloaded && (!userId || preloaded.user.id === userId) ? preloaded : undefined;

  // The router addresses tenants by slug while every API call needs the id;
  // keep the membership list available to that translation after SSR.
  rememberTenants(initialData?.tenants ?? cached?.data.tenants);

  // The SSR preload skips the queryFn, which is normally what refreshes the
  // local cache. Persist it here so the next cold load still paints instantly.
  if (!isServer && initialData) writeMeCache(initialData);

  const options = {
    queryKey: enterpriseKeys.me(),
    queryFn: async () => {
      const data = await enterprise.me();
      rememberTenants(data.tenants);
      writeMeCache(data);

      return data;
    },
    enabled: !isServer && enabled,
    // A cold load paints the last known shell immediately; the query still
    // refreshes in the background.
    placeholderData: initialData ?? cached?.data,
    // Paint from the SSR/cached shell immediately, but always revalidate on
    // mount: tenant creation, invitations and role changes must show up without
    // waiting for the five-minute SSR token to expire.
    staleTime: 0,
  };

  // TanStack renders this observer snapshot immediately without writing it into
  // the shared cache. On the server that is essential: the module-level query
  // client outlives a request, so `initialData` there could show one account's
  // shell to the next visitor. In the browser the client is per-tab and we also
  // seed the cache so the query is considered fresh.
  if (!isServer && initialData !== undefined) Object.assign(options, { initialData });

  return queryOptions(options);
};

export const enterpriseQueries = {
  me: (userId?: string) => meQueryOptions(userId),
  tenants: () =>
    enterpriseQueryOptions({ queryKey: enterpriseKeys.tenants(), queryFn: enterprise.listTenants }),
  tenant: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.tenant(tenantId),
      queryFn: () => enterprise.getTenant(tenantId),
      enabled: Boolean(tenantId),
    }),
  list: <E extends Entity>(tenantId: RouteParam, entity: E, group?: string) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.list(tenantId, entity, group),
      queryFn: () => enterprise.list(tenantId, entity, group),
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
  dashboard: (tenantId: RouteParam, id: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.dashboard(tenantId, id),
      queryFn: () => enterprise.getDashboard(tenantId, id),
      enabled: Boolean(tenantId && id) && !isServer,
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
  scripts: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.scripts(tenantId),
      queryFn: () => enterprise.listScripts(tenantId),
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
  roles: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.roles(tenantId),
      queryFn: () => enterprise.listRoles(tenantId),
      enabled: Boolean(tenantId),
    }),
  users: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.users(tenantId),
      queryFn: () => enterprise.listUsers(tenantId),
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

  rememberTenants(me.tenants);

  return resolveTenant(me.tenants, tenantKey);
}
