import { queryOptions } from "@tanstack/solid-query";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import type { Accessor } from "solid-js";
import { getRequestEvent, isServer } from "solid-js/web";
import {
  EnterpriseBadRequest,
  enterpriseHttpApi,
  type DeviceRow,
  type Entity,
  type GroupNode,
  type GroupRow,
  type PolicyRow,
  type RowFor,
  type TenantEnrollmentInfo,
} from "@mattrax/enterprise-domain";

export type {
  ApnsInfo,
  BillingSummary,
  DeviceRow,
  DownloadPolicyApplicationResponse as PolicyApplicationDownload,
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
  TenantDetail,
  TenantEnrollmentInfo,
  TenantInfo,
  TenantInvitation,
  TenantUser,
  UserInfo,
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
  item: (tenantId: RouteParam, entity: Entity, id: RouteParam) =>
    ["enterprise", "item", tenantId ?? "", entity, id ?? ""] as const,
  users: (tenantId: RouteParam) => ["enterprise", "tenant-users", tenantId ?? ""] as const,
  invitations: (tenantId: RouteParam) =>
    ["enterprise", "tenant-invitations", tenantId ?? ""] as const,
  apns: (tenantId: RouteParam) => ["enterprise", "apns", tenantId ?? ""] as const,
  billing: (tenantId: RouteParam) => ["enterprise", "billing", tenantId ?? ""] as const,
  enrollment: (tenantId: RouteParam) => ["enterprise", "enrollment", tenantId ?? ""] as const,
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
  deviceAction: (tenantId: RouteParam, id: RouteParam) =>
    endpoint((api) =>
      api.deviceAction({
        params: { tenantId: required(tenantId, "tenantId"), id: required(id, "id") },
      }),
    ),
  deviceUnenroll: (tenantId: RouteParam, id: RouteParam) =>
    endpoint((api) =>
      api.deviceUnenroll({
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
  uploadApns: (tenantId: RouteParam, payload: { email: string; cert: string }) =>
    endpoint((api) =>
      api.uploadApns({ params: { tenantId: required(tenantId, "tenantId") }, payload }),
    ),
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
