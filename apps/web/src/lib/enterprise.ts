import { queryOptions } from "@tanstack/solid-query";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import type { Accessor } from "solid-js";
import { getRequestEvent, isServer } from "@solidjs/web";
import {
  EnterpriseBadRequest,
  enterpriseHttpApi,
  type DevicePreRegistrationImportRequest,
  type DeviceRow,
  type DeviceSearchQuery,
  type DeviceSearchRow,
  type Entity,
  type GroupNode,
  type GroupRow,
  type PolicyRow,
  type RowFor,
  type TenantEnrollmentInfo,
  type TenantInfo,
  type WindowsEnrollment,
} from "@mattrax/enterprise-domain";

export type {
  ApplicationNode,
  ApplicationRow,
  ApnsInfo,
  AuditLogEntry,
  BillingSummary,
  CredentialHealthResponse,
  CredentialInfo,
  CredentialLevel,
  DeviceActivityEntry,
  DeviceActivityKind,
  DeviceCertificateCounts,
  DeviceCertificateInfo,
  DeviceHealth,
  DeviceHealthCounts,
  DeviceHealthFilter,
  DeviceHealthReason,
  DeviceHealthResponse,
  DevicePreRegistrationImportRequest,
  DevicePreRegistrationImportResponse,
  DevicePreRegistrationImportResult,
  DevicePreRegistrationListResponse,
  DevicePreRegistrationRow,
  DevicePushErrorCode,
  DevicePushFailure,
  DevicePushHealthCounts,
  DevicePushHealthResponse,
  DevicePushInfo,
  DeviceRow,
  DeviceSearchQuery,
  DeviceSearchRow,
  DownloadPolicyApplicationResponse as PolicyApplicationDownload,
  EnrollmentAttempt,
  EnrollmentAttemptOutcome,
  EnrollmentAttemptPlatform,
  EnrollmentResponse,
  Entity,
  GroupNode,
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
  TenantEnrollmentInfo,
  TenantInfo,
  TenantInvitation,
  TenantUser,
  UserInfo,
  WindowsEnrollment,
} from "@mattrax/enterprise-domain";

type RouteParam = string | undefined;
type EndpointPromise<A, E> = Promise<A> & { readonly __error?: E };
type EndpointData<T> = T extends EndpointPromise<infer A, unknown> ? A : never;
type EndpointError<T> = T extends EndpointPromise<unknown, infer E> ? E : never;
type EnterpriseApiClient = Effect.Success<
  ReturnType<typeof clientEffect>
>["client"]["EnterpriseApi"];

export const enterpriseKeys = {
  me: () => ["enterprise", "me"] as const,
  tenants: () => ["enterprise", "tenants"] as const,
  tenant: (tenantId: RouteParam) => ["enterprise", "tenant", tenantId ?? ""] as const,
  list: (tenantId: RouteParam, entity: Entity, group?: string) =>
    ["enterprise", "list", tenantId ?? "", entity, group ?? ""] as const,
  deviceSearch: (tenantId: RouteParam, query: DeviceSearchQuery = {}) =>
    ["enterprise", "device-search", tenantId ?? "", query] as const,
  deviceHealth: (tenantId: RouteParam, id: RouteParam) =>
    ["enterprise", "device-health", tenantId ?? "", id ?? ""] as const,
  deviceHealthSummary: (tenantId: RouteParam) =>
    ["enterprise", "device-health-summary", tenantId ?? ""] as const,
  devicePushHealth: (tenantId: RouteParam) =>
    ["enterprise", "device-push-health", tenantId ?? ""] as const,
  deviceActivity: (tenantId: RouteParam, id: RouteParam, limit = 50) =>
    ["enterprise", "device-activity", tenantId ?? "", id ?? "", limit] as const,
  credentialHealth: (tenantId: RouteParam) =>
    ["enterprise", "credential-health", tenantId ?? ""] as const,
  item: (tenantId: RouteParam, entity: Entity, id: RouteParam) =>
    ["enterprise", "item", tenantId ?? "", entity, id ?? ""] as const,
  users: (tenantId: RouteParam) => ["enterprise", "tenant-users", tenantId ?? ""] as const,
  invitations: (tenantId: RouteParam) =>
    ["enterprise", "tenant-invitations", tenantId ?? ""] as const,
  apns: (tenantId: RouteParam) => ["enterprise", "apns", tenantId ?? ""] as const,
  billing: (tenantId: RouteParam) => ["enterprise", "billing", tenantId ?? ""] as const,
  enrollment: (tenantId: RouteParam) => ["enterprise", "enrollment", tenantId ?? ""] as const,
  enrollmentAttempts: (tenantId: RouteParam, limit = 50) =>
    ["enterprise", "enrollment-attempts", tenantId ?? "", limit] as const,
  devicePreRegistrations: (tenantId: RouteParam) =>
    ["enterprise", "device-pre-registrations", tenantId ?? ""] as const,
  search: (tenantId: RouteParam, term: string, limit = 30) =>
    ["enterprise", "search", tenantId ?? "", term, limit] as const,
  auditLog: (tenantId: RouteParam) => ["enterprise", "audit-log", tenantId ?? ""] as const,
  scim: (tenantId: RouteParam) => ["enterprise", "scim", tenantId ?? ""] as const,
  sso: (tenantId: RouteParam) => ["enterprise", "sso", tenantId ?? ""] as const,
  applications: (tenantId: RouteParam) => ["enterprise", "applications", tenantId ?? ""] as const,
  application: (tenantId: RouteParam, id: RouteParam) =>
    ["enterprise", "application", tenantId ?? "", id ?? ""] as const,
  policyAssignments: (tenantId: RouteParam, id: RouteParam) =>
    ["enterprise", "policy-assignments", tenantId ?? "", id ?? ""] as const,
  directorySync: (tenantId: RouteParam) =>
    ["enterprise", "directory-sync", tenantId ?? ""] as const,
  domains: (tenantId: RouteParam) => ["enterprise", "domains", tenantId ?? ""] as const,
};

const required = (value: RouteParam, name: string) => {
  if (!value) throw new EnterpriseBadRequest({ message: `Missing ${name}` });
  return value;
};

const clientEffect = () => {
  const event = isServer ? getRequestEvent() : undefined;
  const baseUrl = event ? new URL("/", event.request.url).toString() : "/";
  return HttpApiClient.make(enterpriseHttpApi, { baseUrl }).pipe(
    Effect.map((client) => ({ client, event })),
  );
};

function endpoint<A, E>(
  call: (api: EnterpriseApiClient) => Effect.Effect<A, E, never>,
): EndpointPromise<A, E | EnterpriseBadRequest> {
  const effect = clientEffect().pipe(
    Effect.flatMap(({ client, event }) => {
      const cookie = event?.request.headers.get("cookie");
      const api = client.EnterpriseApi;
      if (!cookie) return call(api);
      return call(
        new Proxy(api, {
          get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver);
            if (typeof value !== "function") return value;
            return (options: Record<string, unknown> = {}) =>
              value({
                ...options,
                headers: { ...(options.headers as object | undefined), cookie },
              });
          },
        }) as EnterpriseApiClient,
      );
    }),
  );
  return Effect.runPromise(effect.pipe(Effect.provide(FetchHttpClient.layer))) as EndpointPromise<
    A,
    E | EnterpriseBadRequest
  >;
}

const enterpriseQueryOptions = <
  A,
  E,
  T extends EndpointPromise<A, E>,
  TQueryKey extends readonly unknown[],
>(options: {
  queryKey: TQueryKey;
  queryFn: () => T;
  enabled?: boolean;
}) =>
  queryOptions<EndpointData<T>, EndpointError<T>, EndpointData<T>, TQueryKey>(
    options as {
      queryKey: TQueryKey;
      queryFn: () => Promise<EndpointData<T>>;
      enabled?: boolean;
    },
  );

export const enterprise = {
  me: () => endpoint((api) => api.me({})),
  getEnrollment: (id: RouteParam, code?: string) =>
    endpoint((api) => api.getEnrollment({ params: { id: required(id, "id") }, query: { code } })),
  listTenants: () => endpoint((api) => api.listTenants({})),
  createTenant: (payload: {
    name: string;
    slug: string;
    logo?: string | null;
    metadata?: Record<string, unknown>;
  }) => endpoint((api) => api.createTenant({ payload })),
  getTenant: (tenantId: RouteParam) =>
    endpoint((api) => api.getTenant({ params: { tenantId: required(tenantId, "tenantId") } })),
  patchTenant: (
    tenantId: RouteParam,
    payload: Partial<{
      name: string;
      slug: string;
      logo: string | null;
      metadata: Record<string, unknown> | null;
    }>,
  ) =>
    endpoint((api) =>
      api.patchTenant({ params: { tenantId: required(tenantId, "tenantId") }, payload }),
    ),
  deleteTenant: (tenantId: RouteParam) =>
    endpoint((api) => api.deleteTenant({ params: { tenantId: required(tenantId, "tenantId") } })),
  list: <E extends Entity>(tenantId: RouteParam, entity: E, _group?: string) =>
    endpoint((api) => {
      const params = { tenantId: required(tenantId, "tenantId") };
      if (entity === "device")
        return api.listDevices({ params }) as Effect.Effect<
          { rows: RowFor<E>[] },
          Effect.Error<ReturnType<typeof api.listDevices>>,
          never
        >;
      if (entity === "group")
        return api.listGroups({ params }) as Effect.Effect<
          { rows: RowFor<E>[] },
          Effect.Error<ReturnType<typeof api.listGroups>>,
          never
        >;
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
  /** Returns CSV text; callers turn it into a file download. */
  exportDevices: (tenantId: RouteParam, query: DeviceSearchQuery = {}) =>
    endpoint((api) =>
      api.exportDevices({ params: { tenantId: required(tenantId, "tenantId") }, query }),
    ),
  get: <E extends Entity>(tenantId: RouteParam, entity: E, id: RouteParam) =>
    endpoint((api) => {
      const params = { tenantId: required(tenantId, "tenantId"), id: required(id, "id") };
      if (entity === "device")
        return api.getDevice({ params }) as Effect.Effect<
          RowFor<E> | GroupNode,
          Effect.Error<ReturnType<typeof api.getDevice>>,
          never
        >;
      if (entity === "group")
        return api.getGroup({ params }) as Effect.Effect<
          RowFor<E> | GroupNode,
          Effect.Error<ReturnType<typeof api.getGroup>>,
          never
        >;
      return api.getPolicy({ params }) as Effect.Effect<
        RowFor<E> | GroupNode,
        Effect.Error<ReturnType<typeof api.getPolicy>>,
        never
      >;
    }),
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
      action?: "sync" | "lock" | "wipe" | "restart" | "shutdown" | "clear-passcode" | "install-app";
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
  getDeviceActivity: (tenantId: RouteParam, id: RouteParam, limit = 50) =>
    endpoint((api) =>
      api.getDeviceActivity({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
        query: { limit },
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
  createGroup: (
    tenantId: RouteParam,
    payload: { name: string; notes?: string | null; devices?: string[]; policies?: string[] },
  ) =>
    endpoint((api) =>
      api.createGroup({ params: { tenantId: required(tenantId, "tenantId") }, payload }),
    ),
  patchGroup: (
    tenantId: RouteParam,
    id: RouteParam,
    payload: Partial<Pick<GroupRow, "name" | "notes">>,
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
      assign?: { devices?: string[]; policies?: string[] };
      unassign?: { devices?: string[]; policies?: string[] };
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
  createPolicy: (tenantId: RouteParam, payload: { name: string; notes?: string | null }) =>
    endpoint((api) =>
      api.createPolicy({ params: { tenantId: required(tenantId, "tenantId") }, payload }),
    ),
  patchPolicy: (
    tenantId: RouteParam,
    id: RouteParam,
    payload: Partial<Pick<PolicyRow, "name" | "notes" | "configurations">>,
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
    payload: { assign?: string[]; unassign?: string[] },
  ) =>
    endpoint((api) =>
      api.patchPolicyAssignments({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
        payload,
      }),
    ),
  listApplications: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.listApplications({ params: { tenantId: required(tenantId, "tenantId") } }),
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
      platform: "apple" | "win" | "android";
      bundleId?: string | null;
      version?: string | null;
      source?: "manifest" | "store" | "upload";
      manifestUrl?: string | null;
      storeId?: string | null;
      notes?: string | null;
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
  patchEntraDirectorySync: (tenantId: RouteParam, payload: { enabled?: boolean }) =>
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
  getApns: (tenantId: RouteParam) =>
    endpoint((api) => api.getApns({ params: { tenantId: required(tenantId, "tenantId") } })),
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
  getSsoConfig: (tenantId: RouteParam) =>
    endpoint((api) => api.getSsoConfig({ params: { tenantId: required(tenantId, "tenantId") } })),
  patchSsoConfig: (
    tenantId: RouteParam,
    payload: { enabled?: boolean; azureTenantId?: string | null; autoProvision?: boolean },
  ) =>
    endpoint((api) =>
      api.patchSsoConfig({ params: { tenantId: required(tenantId, "tenantId") }, payload }),
    ),
  listScimTokens: (tenantId: RouteParam) =>
    endpoint((api) => api.listScimTokens({ params: { tenantId: required(tenantId, "tenantId") } })),
  createScimToken: (tenantId: RouteParam, payload: { name: string }) =>
    endpoint((api) =>
      api.createScimToken({ params: { tenantId: required(tenantId, "tenantId") }, payload }),
    ),
  revokeScimToken: (tenantId: RouteParam, tokenId: string) =>
    endpoint((api) =>
      api.revokeScimToken({
        params: { tenantId: required(tenantId, "tenantId"), tokenId },
      }),
    ),
  listAuditLog: (tenantId: RouteParam) =>
    endpoint((api) => api.listAuditLog({ params: { tenantId: required(tenantId, "tenantId") } })),
  listUsers: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.listTenantUsers({ params: { tenantId: required(tenantId, "tenantId") } }),
    ),
  inviteUser: (tenantId: RouteParam, payload: { email: string; role?: string; resend?: boolean }) =>
    endpoint((api) =>
      api.inviteTenantUser({ params: { tenantId: required(tenantId, "tenantId") }, payload }),
    ),
  listInvitations: (tenantId: RouteParam) =>
    endpoint((api) =>
      api.listTenantInvitations({ params: { tenantId: required(tenantId, "tenantId") } }),
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
  patchUser: (tenantId: RouteParam, memberId: RouteParam, role: string) =>
    endpoint((api) =>
      api.patchTenantUser({
        params: {
          tenantId: required(tenantId, "tenantId"),
          memberId: required(memberId, "memberId"),
        },
        payload: { role },
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
    endpoint((api) =>
      api.billingPortal({
        params: { tenantId: required(tenantId, "tenantId") },
        payload: { returnUrl },
      }),
    ),
};

export const enterpriseQueries = {
  me: () => enterpriseQueryOptions({ queryKey: enterpriseKeys.me(), queryFn: enterprise.me }),
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
  applications: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.applications(tenantId),
      queryFn: () => enterprise.listApplications(tenantId),
      enabled: Boolean(tenantId) && !isServer,
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
  auditLog: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.auditLog(tenantId),
      queryFn: () => enterprise.listAuditLog(tenantId),
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
  apns: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.apns(tenantId),
      queryFn: () => enterprise.getApns(tenantId),
      enabled: Boolean(tenantId),
    }),
  billing: (tenantId: RouteParam) =>
    enterpriseQueryOptions({
      queryKey: enterpriseKeys.billing(tenantId),
      queryFn: () => enterprise.billing(tenantId),
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
 * tenant id from the URL; the first membership is only a fallback for
 * non-tenant routes (for example the workspace picker or account page).
 */
export function resolveActiveTenant(
  me: { tenants: readonly TenantInfo[] } | undefined,
  tenantId?: string,
) {
  if (!me) return undefined;
  return me.tenants.find((tenant) => tenant.id === tenantId) ?? me.tenants[0];
}
