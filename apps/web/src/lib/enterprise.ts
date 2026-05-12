import type { Accessor } from "solid-js";
import { getRequestEvent, isServer } from "solid-js/web";

export type TenantInfo = { id: string; name: string; slug: string; role: string; logo?: string | null };
export type UserInfo = { id: string; name: string; email: string; emailVerified: boolean; image?: string | null };
export type BillingSummary = { plan?: string; status?: string; billableDevices: number; subscriptionId?: string | null };
export type MeResponse = { user: UserInfo; activeTenant?: TenantInfo; tenants: TenantInfo[]; billing?: BillingSummary };
export type TenantDetail = TenantInfo & { metadata?: string | null; createdAt: string };
export type Entity = "device" | "group" | "policy";
export type DeviceRow = {
  id: string; proto: "apple" | "win" | "android"; name: string; model?: string | null; modelIdentifier?: string | null;
  serial?: string | null; status: "enrolling" | "enrolled" | "unenrolling" | "unenrolled"; enrolledAt: string; lastSeenAt: string;
  assetTag?: string | null; notes?: string | null; physicalName?: string | null; vendor?: string | null; osEdition?: string | null;
  osVersion?: string | null; osBuild?: string | null; diskTotal?: string | null; diskUsed?: string | null;
};
export type GroupRow = { id: string; name: string; notes?: string | null; devicesCount?: number; policiesCount?: number; createdAt: string; updatedAt: string };
export type PolicyRow = { id: string; name: string; notes?: string | null; configurations?: Record<string, unknown>; createdAt: string; updatedAt: string };
export type GroupNode = GroupRow & { devices?: Array<{ id: string; name: string }>; policies?: Array<{ id: string; name: string }> };
export type NodeResponse = DeviceRow | GroupNode | PolicyRow;
export type RowFor<E extends Entity> = E extends "device" ? DeviceRow : E extends "group" ? GroupRow : PolicyRow;
export type TenantUser = { memberId: string; userId: string; name: string; email: string; role: string; createdAt: string };
export type TenantInvitation = { id: string; email: string; role?: string | null; status: string; expiresAt: string; createdAt: string };
export type ApnsInfo = { configured: boolean; email?: string | null; topic?: string | null };
export type TenantEnrollmentInfo = { id: string; code?: string | null; enabledApple: boolean; enabledWindows: boolean; enabledAndroid: boolean; enabledAssetTag: boolean; maxDevices: number; createdAt: string; updatedAt: string };
type RouteParam = string | undefined;

export const enterpriseKeys = {
  me: () => ["enterprise", "me"] as const,
  tenants: () => ["enterprise", "tenants"] as const,
  tenant: (tenantId: RouteParam) => ["enterprise", "tenant", tenantId ?? ""] as const,
  search: (tenantId: RouteParam, entity: Entity, group?: string) => ["enterprise", "search", tenantId ?? "", entity, group ?? ""] as const,
  node: (tenantId: RouteParam, entity: Entity, id: RouteParam) => ["enterprise", "node", tenantId ?? "", entity, id ?? ""] as const,
  users: (tenantId: RouteParam) => ["enterprise", "tenant-users", tenantId ?? ""] as const,
  invitations: (tenantId: RouteParam) => ["enterprise", "tenant-invitations", tenantId ?? ""] as const,
  apns: (tenantId: RouteParam) => ["enterprise", "apns", tenantId ?? ""] as const,
  billing: (tenantId: RouteParam) => ["enterprise", "billing", tenantId ?? ""] as const,
  enrollment: (tenantId: RouteParam) => ["enterprise", "enrollment", tenantId ?? ""] as const,
};

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

const required = (value: RouteParam, name: string) => {
  if (!value) throw new ApiError(`Missing ${name}`, 400);
  return value;
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = `/api/v1${path}`;
  const event = isServer ? getRequestEvent() : undefined;
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  if (event) {
    const cookie = event.request.headers.get("cookie");
    if (cookie) headers.set("cookie", cookie);
  }
  const response = await fetch(event ? new URL(url, event.request.url) : url, {
    ...init,
    credentials: "include",
    headers,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new ApiError(text || `Request failed with ${response.status}`, response.status);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return text ? JSON.parse(text) as T : undefined as T;
}

const body = (value: unknown) => JSON.stringify(value);
const q = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const value = search.toString();
  return value ? `?${value}` : "";
};

export const enterprise = {
  me: () => request<MeResponse>("/me"),
  listTenants: () => request<{ tenants: TenantInfo[] }>("/tenants"),
  createTenant: (payload: { name: string; slug: string; logo?: string | null; metadata?: Record<string, unknown> }) => request<{ id: string }>("/tenants", { method: "POST", body: body(payload) }),
  getTenant: (tenantId: RouteParam) => request<TenantDetail>(`/tenants/${required(tenantId, "tenantId")}`),
  patchTenant: (tenantId: RouteParam, payload: Partial<{ name: string; slug: string; logo: string | null; metadata: Record<string, unknown> | null }>) => request<{ status: "ok" }>(`/tenants/${required(tenantId, "tenantId")}`, { method: "PATCH", body: body(payload) }),
  deleteTenant: (tenantId: RouteParam) => request<{ status: "ok" }>(`/tenants/${required(tenantId, "tenantId")}`, { method: "DELETE" }),
  search: <E extends Entity>(tenantId: RouteParam, entity: E, group?: string) => request<{ rows: RowFor<E>[] }>(`/tenants/${required(tenantId, "tenantId")}/search${q({ type: entity, "in[group]": group })}`),
  node: <E extends Entity>(tenantId: RouteParam, entity: E, id: RouteParam) => request<RowFor<E> | GroupNode>(`/tenants/${required(tenantId, "tenantId")}/node/${entity}/${required(id, "id")}`),
  patchDevice: (tenantId: RouteParam, id: RouteParam, payload: Partial<Pick<DeviceRow, "name" | "notes" | "assetTag">>) => request<{ status: "ok" }>(`/tenants/${required(tenantId, "tenantId")}/devices/${required(id, "id")}`, { method: "PATCH", body: body(payload) }),
  deleteDevices: (tenantId: RouteParam, ids: string[]) => request<{ status: "ok" }>(`/tenants/${required(tenantId, "tenantId")}/devices`, { method: "DELETE", body: body(ids) }),
  deviceAction: (tenantId: RouteParam, id: RouteParam) => request<{ status: "ok" }>(`/tenants/${required(tenantId, "tenantId")}/devices/${required(id, "id")}/action`, { method: "POST" }),
  deviceUnenroll: (tenantId: RouteParam, id: RouteParam) => request<{ status: "ok" }>(`/tenants/${required(tenantId, "tenantId")}/devices/${required(id, "id")}/unenroll`, { method: "POST" }),
  createGroup: (tenantId: RouteParam, payload: { name: string; notes?: string | null; devices?: string[]; policies?: string[] }) => request<{ id: string }>(`/tenants/${required(tenantId, "tenantId")}/groups`, { method: "POST", body: body(payload) }),
  patchGroup: (tenantId: RouteParam, id: RouteParam, payload: Partial<Pick<GroupRow, "name" | "notes">>) => request<{ status: "ok" }>(`/tenants/${required(tenantId, "tenantId")}/groups/${required(id, "id")}`, { method: "PATCH", body: body(payload) }),
  patchGroupMembers: (tenantId: RouteParam, id: RouteParam, payload: { assign?: { devices?: string[]; policies?: string[] }; unassign?: { devices?: string[]; policies?: string[] } }) => request<{ status: "ok" }>(`/tenants/${required(tenantId, "tenantId")}/groups/${required(id, "id")}/members`, { method: "PATCH", body: body(payload) }),
  deleteGroups: (tenantId: RouteParam, ids: string[]) => request<{ deleted: string[]; failed: Array<{ id: string; reason: string }> }>(`/tenants/${required(tenantId, "tenantId")}/groups`, { method: "DELETE", body: body(ids) }),
  duplicateGroup: (tenantId: RouteParam, id: RouteParam, name?: string) => request<{ id: string }>(`/tenants/${required(tenantId, "tenantId")}/groups/${required(id, "id")}/duplicate`, { method: "POST", body: body({ name }) }),
  syncGroups: (tenantId: RouteParam, ids: string[]) => request<{ status: "ok" }>(`/tenants/${required(tenantId, "tenantId")}/groups/sync`, { method: "POST", body: body(ids) }),
  createPolicy: (tenantId: RouteParam, payload: { name: string; notes?: string | null }) => request<{ id: string }>(`/tenants/${required(tenantId, "tenantId")}/policies`, { method: "POST", body: body(payload) }),
  patchPolicy: (tenantId: RouteParam, id: RouteParam, payload: Partial<Pick<PolicyRow, "name" | "notes" | "configurations">>) => request<{ status: "ok" }>(`/tenants/${required(tenantId, "tenantId")}/policies/${required(id, "id")}`, { method: "PATCH", body: body(payload) }),
  deletePolicies: (tenantId: RouteParam, ids: string[]) => request<{ deleted: string[]; failed: Array<{ id: string; reason: string }> }>(`/tenants/${required(tenantId, "tenantId")}/policies`, { method: "DELETE", body: body(ids) }),
  duplicatePolicy: (tenantId: RouteParam, id: RouteParam, name?: string) => request<{ id: string }>(`/tenants/${required(tenantId, "tenantId")}/policies/${required(id, "id")}/duplicate`, { method: "POST", body: body({ name }) }),
  syncPolicies: (tenantId: RouteParam, ids: string[]) => request<{ status: "ok" }>(`/tenants/${required(tenantId, "tenantId")}/policies/sync`, { method: "POST", body: body(ids) }),
  previewMobileconfig: (mobileconfig: string) => request<Record<string, unknown>>("/policy/preview-mobileconfig", { method: "POST", body: body({ mobileconfig }) }),
  getApns: (tenantId: RouteParam) => request<ApnsInfo>(`/tenants/${required(tenantId, "tenantId")}/apns`),
  getTenantEnrollment: (tenantId: RouteParam) => request<TenantEnrollmentInfo>(`/tenants/${required(tenantId, "tenantId")}/enrollment`),
  patchTenantEnrollment: (tenantId: RouteParam, payload: Partial<Pick<TenantEnrollmentInfo, "code" | "enabledApple" | "enabledWindows" | "enabledAndroid" | "enabledAssetTag" | "maxDevices">>) => request<{ status: "ok" }>(`/tenants/${required(tenantId, "tenantId")}/enrollment`, { method: "PATCH", body: body(payload) }),
  resetTenantEnrollment: (tenantId: RouteParam) => request<{ id: string }>(`/tenants/${required(tenantId, "tenantId")}/enrollment/reset`, { method: "POST" }),
  uploadApns: (tenantId: RouteParam, payload: { email: string; cert: string }) => request<{ status: "ok" }>(`/tenants/${required(tenantId, "tenantId")}/apns`, { method: "POST", body: body(payload) }),
  listUsers: (tenantId: RouteParam) => request<{ users: TenantUser[] }>(`/tenants/${required(tenantId, "tenantId")}/users`),
  inviteUser: (tenantId: RouteParam, payload: { email: string; role?: string; resend?: boolean }) => request<{ id: string }>(`/tenants/${required(tenantId, "tenantId")}/invitations`, { method: "POST", body: body(payload) }),
  listInvitations: (tenantId: RouteParam) => request<{ invitations: TenantInvitation[] }>(`/tenants/${required(tenantId, "tenantId")}/invitations`),
  cancelInvitation: (tenantId: RouteParam, invitationId: RouteParam) => request<{ status: "ok" }>(`/tenants/${required(tenantId, "tenantId")}/invitations/${required(invitationId, "invitationId")}`, { method: "DELETE" }),
  patchUser: (tenantId: RouteParam, memberId: RouteParam, role: string) => request<{ status: "ok" }>(`/tenants/${required(tenantId, "tenantId")}/users/${required(memberId, "memberId")}`, { method: "PATCH", body: body({ role }) }),
  removeUser: (tenantId: RouteParam, memberId: RouteParam) => request<{ status: "ok" }>(`/tenants/${required(tenantId, "tenantId")}/users/${required(memberId, "memberId")}`, { method: "DELETE" }),
  billing: (tenantId: RouteParam) => request<BillingSummary>(`/tenants/${required(tenantId, "tenantId")}/billing`),
  billingPortal: (tenantId: RouteParam, returnUrl: string) => request<{ url: string }>(`/tenants/${required(tenantId, "tenantId")}/billing/portal`, { method: "POST", body: body({ returnUrl }) }),
};

export const enabledTenant = (tenantId: Accessor<string | undefined>) => () => Boolean(tenantId());
