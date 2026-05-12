import { Context, Effect } from "effect";
import type { HttpServerRequest } from "effect/unstable/http/HttpServerRequest";

export interface EnterpriseServiceShape {
  readonly status: () => Effect.Effect<{ status: "ok" }, unknown>;
  readonly me: (request: HttpServerRequest) => Effect.Effect<unknown, unknown>;
  readonly updateMe: (request: HttpServerRequest, payload: unknown) => Effect.Effect<{ status: "ok" }, unknown>;
  readonly deleteMe: (request: HttpServerRequest) => Effect.Effect<{ error: string }, unknown>;
  readonly getEnrollment: (id: string, code?: string) => Effect.Effect<unknown, unknown>;
  readonly deleteTenant: (request: HttpServerRequest) => Effect.Effect<{ error: string }, unknown>;
  readonly getApns: (request: HttpServerRequest) => Effect.Effect<unknown, unknown>;
  readonly uploadApns: (request: HttpServerRequest, payload: unknown) => Effect.Effect<{ status: "ok" }, unknown>;
  readonly deleteDevices: (request: HttpServerRequest, ids: ReadonlyArray<string>) => Effect.Effect<{ status: "ok" }, unknown>;
  readonly patchDevice: (request: HttpServerRequest, id: string, payload: unknown) => Effect.Effect<{ status: "ok" }, unknown>;
  readonly deviceAction: (request: HttpServerRequest, id: string) => Effect.Effect<{ status: "ok" }, unknown>;
  readonly deviceUnenroll: (request: HttpServerRequest, id: string) => Effect.Effect<{ status: "ok" }, unknown>;
  readonly createGroup: (request: HttpServerRequest, payload: unknown) => Effect.Effect<{ id: string }, unknown>;
  readonly deleteGroups: (request: HttpServerRequest, ids: ReadonlyArray<string>) => Effect.Effect<unknown, unknown>;
  readonly patchGroup: (request: HttpServerRequest, id: string, payload: unknown) => Effect.Effect<{ status: "ok" }, unknown>;
  readonly patchGroupMembers: (request: HttpServerRequest, id: string, payload: unknown) => Effect.Effect<{ status: "ok" }, unknown>;
  readonly syncGroups: (request: HttpServerRequest, ids: ReadonlyArray<string>) => Effect.Effect<{ status: "ok" }, unknown>;
  readonly duplicateGroup: (request: HttpServerRequest, id: string, payload: unknown) => Effect.Effect<{ id: string }, unknown>;
  readonly createPolicy: (request: HttpServerRequest, payload: unknown) => Effect.Effect<{ id: string }, unknown>;
  readonly deletePolicies: (request: HttpServerRequest, ids: ReadonlyArray<string>) => Effect.Effect<unknown, unknown>;
  readonly patchPolicy: (request: HttpServerRequest, id: string, payload: unknown) => Effect.Effect<{ status: "ok" }, unknown>;
  readonly syncPolicies: (request: HttpServerRequest, ids: ReadonlyArray<string>) => Effect.Effect<{ status: "ok" }, unknown>;
  readonly duplicatePolicy: (request: HttpServerRequest, id: string, payload: unknown) => Effect.Effect<{ id: string }, unknown>;
  readonly previewMobileconfig: (payload: unknown) => Effect.Effect<unknown, unknown>;
  readonly search: (request: HttpServerRequest, query: { readonly type: "device" | "group" | "policy"; readonly "in[group]"?: string }) => Effect.Effect<unknown, unknown>;
  readonly node: (request: HttpServerRequest, entity: "device" | "group" | "policy", id: string) => Effect.Effect<unknown, unknown>;
  readonly billing: (request: HttpServerRequest) => Effect.Effect<unknown, unknown>;
  readonly billingPortal: (request: HttpServerRequest, payload: unknown) => Effect.Effect<unknown, unknown>;
}

export class EnterpriseService extends Context.Service<EnterpriseService, EnterpriseServiceShape>()("@mattrax/EnterpriseService") {}
