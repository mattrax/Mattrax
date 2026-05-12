import { Context, Effect } from "effect";
import type { HttpServerRequest } from "effect/unstable/http/HttpServerRequest";

type ServiceEffect<A = any> = Effect.Effect<A>;

export interface EnterpriseServiceShape {
  readonly status: () => ServiceEffect;
  readonly me: (request: HttpServerRequest) => ServiceEffect;
  readonly updateMe: (request: HttpServerRequest, payload: unknown) => ServiceEffect;
  readonly deleteMe: (request: HttpServerRequest) => ServiceEffect;
  readonly getEnrollment: (id: string, code?: string) => ServiceEffect;
  readonly deleteTenant: (request: HttpServerRequest) => ServiceEffect;
  readonly getApns: (request: HttpServerRequest) => ServiceEffect;
  readonly uploadApns: (request: HttpServerRequest, payload: unknown) => ServiceEffect;
  readonly deleteDevices: (request: HttpServerRequest, ids: ReadonlyArray<string>) => ServiceEffect;
  readonly patchDevice: (request: HttpServerRequest, id: string, payload: unknown) => ServiceEffect;
  readonly deviceAction: (request: HttpServerRequest, id: string) => ServiceEffect;
  readonly deviceUnenroll: (request: HttpServerRequest, id: string) => ServiceEffect;
  readonly createGroup: (request: HttpServerRequest, payload: unknown) => ServiceEffect;
  readonly deleteGroups: (request: HttpServerRequest, ids: ReadonlyArray<string>) => ServiceEffect;
  readonly patchGroup: (request: HttpServerRequest, id: string, payload: unknown) => ServiceEffect;
  readonly patchGroupMembers: (request: HttpServerRequest, id: string, payload: unknown) => ServiceEffect;
  readonly syncGroups: (request: HttpServerRequest, ids: ReadonlyArray<string>) => ServiceEffect;
  readonly duplicateGroup: (request: HttpServerRequest, id: string, payload: unknown) => ServiceEffect;
  readonly createPolicy: (request: HttpServerRequest, payload: unknown) => ServiceEffect;
  readonly deletePolicies: (request: HttpServerRequest, ids: ReadonlyArray<string>) => ServiceEffect;
  readonly patchPolicy: (request: HttpServerRequest, id: string, payload: unknown) => ServiceEffect;
  readonly syncPolicies: (request: HttpServerRequest, ids: ReadonlyArray<string>) => ServiceEffect;
  readonly duplicatePolicy: (request: HttpServerRequest, id: string, payload: unknown) => ServiceEffect;
  readonly previewMobileconfig: (payload: unknown) => ServiceEffect;
  readonly search: (request: HttpServerRequest, query: { readonly type: "device" | "group" | "policy"; readonly "in[group]"?: string }) => ServiceEffect;
  readonly node: (request: HttpServerRequest, entity: "device" | "group" | "policy", id: string) => ServiceEffect;
  readonly billing: (request: HttpServerRequest) => ServiceEffect;
  readonly billingPortal: (request: HttpServerRequest, payload: unknown) => ServiceEffect;
}

export class EnterpriseService extends Context.Service<EnterpriseService, EnterpriseServiceShape>()("@mattrax/EnterpriseService") {}
