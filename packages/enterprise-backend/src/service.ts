import { Context, Effect } from "effect";
import type { HttpServerRequest } from "effect/unstable/http/HttpServerRequest";

type ServiceEffect<A = any> = Effect.Effect<A>;

export interface EnterpriseServiceShape {
  readonly me: (request: HttpServerRequest) => ServiceEffect;
  readonly updateMe: (request: HttpServerRequest, payload: unknown) => ServiceEffect;
  readonly deleteMe: (request: HttpServerRequest) => ServiceEffect;
  readonly listTenants: (request: HttpServerRequest) => ServiceEffect;
  readonly createTenant: (request: HttpServerRequest, payload: unknown) => ServiceEffect;
  readonly getTenant: (request: HttpServerRequest, tenantId: string) => ServiceEffect;
  readonly patchTenant: (request: HttpServerRequest, tenantId: string, payload: unknown) => ServiceEffect;
  readonly deleteTenant: (request: HttpServerRequest, tenantId: string) => ServiceEffect;
  readonly listTenantUsers: (request: HttpServerRequest, tenantId: string) => ServiceEffect;
  readonly inviteTenantUser: (request: HttpServerRequest, tenantId: string, payload: unknown) => ServiceEffect;
  readonly listTenantInvitations: (request: HttpServerRequest, tenantId: string) => ServiceEffect;
  readonly cancelTenantInvitation: (request: HttpServerRequest, tenantId: string, invitationId: string) => ServiceEffect;
  readonly patchTenantUser: (request: HttpServerRequest, tenantId: string, memberId: string, payload: unknown) => ServiceEffect;
  readonly removeTenantUser: (request: HttpServerRequest, tenantId: string, memberId: string) => ServiceEffect;
  readonly getEnrollment: (id: string, code?: string) => ServiceEffect;
  readonly getTenantEnrollment: (request: HttpServerRequest, tenantId: string) => ServiceEffect;
  readonly patchTenantEnrollment: (request: HttpServerRequest, tenantId: string, payload: unknown) => ServiceEffect;
  readonly resetTenantEnrollment: (request: HttpServerRequest, tenantId: string) => ServiceEffect;
  readonly getApns: (request: HttpServerRequest, tenantId: string) => ServiceEffect;
  readonly uploadApns: (request: HttpServerRequest, tenantId: string, payload: unknown) => ServiceEffect;
  readonly listDevices: (request: HttpServerRequest, tenantId: string) => ServiceEffect;
  readonly getDevice: (request: HttpServerRequest, tenantId: string, id: string) => ServiceEffect;
  readonly deleteDevices: (request: HttpServerRequest, tenantId: string, ids: ReadonlyArray<string>) => ServiceEffect;
  readonly patchDevice: (request: HttpServerRequest, tenantId: string, id: string, payload: unknown) => ServiceEffect;
  readonly deviceAction: (request: HttpServerRequest, tenantId: string, id: string) => ServiceEffect;
  readonly deviceUnenroll: (request: HttpServerRequest, tenantId: string, id: string) => ServiceEffect;
  readonly listGroups: (request: HttpServerRequest, tenantId: string) => ServiceEffect;
  readonly getGroup: (request: HttpServerRequest, tenantId: string, id: string) => ServiceEffect;
  readonly createGroup: (request: HttpServerRequest, tenantId: string, payload: unknown) => ServiceEffect;
  readonly deleteGroups: (request: HttpServerRequest, tenantId: string, ids: ReadonlyArray<string>) => ServiceEffect;
  readonly patchGroup: (request: HttpServerRequest, tenantId: string, id: string, payload: unknown) => ServiceEffect;
  readonly patchGroupMembers: (request: HttpServerRequest, tenantId: string, id: string, payload: unknown) => ServiceEffect;
  readonly syncGroups: (request: HttpServerRequest, tenantId: string, ids: ReadonlyArray<string>) => ServiceEffect;
  readonly duplicateGroup: (request: HttpServerRequest, tenantId: string, id: string, payload: unknown) => ServiceEffect;
  readonly listPolicies: (request: HttpServerRequest, tenantId: string) => ServiceEffect;
  readonly getPolicy: (request: HttpServerRequest, tenantId: string, id: string) => ServiceEffect;
  readonly createPolicy: (request: HttpServerRequest, tenantId: string, payload: unknown) => ServiceEffect;
  readonly deletePolicies: (request: HttpServerRequest, tenantId: string, ids: ReadonlyArray<string>) => ServiceEffect;
  readonly patchPolicy: (request: HttpServerRequest, tenantId: string, id: string, payload: unknown) => ServiceEffect;
  readonly syncPolicies: (request: HttpServerRequest, tenantId: string, ids: ReadonlyArray<string>) => ServiceEffect;
  readonly duplicatePolicy: (request: HttpServerRequest, tenantId: string, id: string, payload: unknown) => ServiceEffect;
  readonly previewMobileconfig: (payload: unknown) => ServiceEffect;
  readonly billing: (request: HttpServerRequest, tenantId: string) => ServiceEffect;
  readonly billingPortal: (request: HttpServerRequest, tenantId: string, payload: unknown) => ServiceEffect;
}

export class EnterpriseService extends Context.Service<EnterpriseService, EnterpriseServiceShape>()("@mattrax/EnterpriseService") {}
