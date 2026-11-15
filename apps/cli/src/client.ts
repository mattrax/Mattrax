import { Effect, Option, Schema } from "effect";
import {
  CreateGroupRequest as CreateGroupRequestSchema,
  CreatePolicyRequest as CreatePolicyRequestSchema,
  DeviceActionRequest as DeviceActionRequestSchema,
  DeviceActionResponse as DeviceActionResponseSchema,
  DeviceHealthResponse as DeviceHealthResponseSchema,
  DeviceListResponse as DeviceListResponseSchema,
  DeviceRow as DeviceRowSchema,
  DeviceSearchQuery as DeviceSearchQuerySchema,
  DeviceSearchResponse as DeviceSearchResponseSchema,
  GroupListResponse as GroupListResponseSchema,
  GroupNode as GroupNodeSchema,
  IdResponse as IdResponseSchema,
  MeResponse as MeResponseSchema,
  PatchGroupMembersRequest as PatchGroupMembersRequestSchema,
  PatchGroupRequest as PatchGroupRequestSchema,
  PatchPolicyRequest as PatchPolicyRequestSchema,
  PolicyListResponse as PolicyListResponseSchema,
  PolicyRow as PolicyRowSchema,
  TenantEnrollmentInfo as TenantEnrollmentInfoSchema,
  TenantListResponse as TenantListResponseSchema,
} from "@mattrax/enterprise-domain/client";
import { CliFailure } from "./settings.ts";

type TenantList = typeof TenantListResponseSchema.Type;

type DeviceList = typeof DeviceListResponseSchema.Type;

type DeviceRow = typeof DeviceRowSchema.Type;

type DeviceSearchQuery = typeof DeviceSearchQuerySchema.Type;

type DeviceSearch = typeof DeviceSearchResponseSchema.Type;

type DeviceHealth = typeof DeviceHealthResponseSchema.Type;

type DeviceAction = typeof DeviceActionResponseSchema.Type;

type DeviceActionRequest = typeof DeviceActionRequestSchema.Type;

type GroupList = typeof GroupListResponseSchema.Type;

type GroupNode = typeof GroupNodeSchema.Type;

type GroupPayload = typeof CreateGroupRequestSchema.Type;

type PatchGroupPayload = typeof PatchGroupRequestSchema.Type;

type PatchGroupMembersPayload = typeof PatchGroupMembersRequestSchema.Type;

type PolicyList = typeof PolicyListResponseSchema.Type;

type PolicyRow = typeof PolicyRowSchema.Type;

type PolicyPayload = typeof CreatePolicyRequestSchema.Type;

type PatchPolicyPayload = typeof PatchPolicyRequestSchema.Type;

type IdResponse = typeof IdResponseSchema.Type;

type Me = typeof MeResponseSchema.Type;

type Enrollment = typeof TenantEnrollmentInfoSchema.Type;

const StatusOk = Schema.Struct({ status: Schema.Literal("ok") });

const ApiErrorBody = Schema.Struct({
  _tag: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
});

type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

interface ApiRequest {
  readonly method: HttpMethod;
  readonly path: string;
  readonly query?: Readonly<Record<string, string | number | undefined>>;
  /** Already serialized JSON, so the transport never needs an untyped body. */
  readonly body?: string;
}

/** The subset of the API the CLI uses. Tests provide a fake implementation. */
export interface MattraxApi {
  readonly me: () => Effect.Effect<Me, CliFailure>;
  readonly listTenants: () => Effect.Effect<TenantList, CliFailure>;
  readonly searchDevices: (
    tenantId: string,
    query: DeviceSearchQuery,
  ) => Effect.Effect<DeviceSearch, CliFailure>;
  readonly listDevices: (tenantId: string) => Effect.Effect<DeviceList, CliFailure>;
  readonly getDevice: (tenantId: string, deviceId: string) => Effect.Effect<DeviceRow, CliFailure>;
  readonly getDeviceHealth: (
    tenantId: string,
    deviceId: string,
  ) => Effect.Effect<DeviceHealth, CliFailure>;
  readonly deviceAction: (
    tenantId: string,
    deviceId: string,
    payload: DeviceActionRequest,
  ) => Effect.Effect<DeviceAction, CliFailure>;
  readonly deviceUnenroll: (tenantId: string, deviceId: string) => Effect.Effect<void, CliFailure>;
  readonly listGroups: (tenantId: string) => Effect.Effect<GroupList, CliFailure>;
  readonly getGroup: (tenantId: string, groupId: string) => Effect.Effect<GroupNode, CliFailure>;
  readonly createGroup: (
    tenantId: string,
    payload: GroupPayload,
  ) => Effect.Effect<IdResponse, CliFailure>;
  readonly patchGroup: (
    tenantId: string,
    groupId: string,
    payload: PatchGroupPayload,
  ) => Effect.Effect<void, CliFailure>;
  readonly patchGroupMembers: (
    tenantId: string,
    groupId: string,
    payload: PatchGroupMembersPayload,
  ) => Effect.Effect<void, CliFailure>;
  readonly listPolicies: (tenantId: string) => Effect.Effect<PolicyList, CliFailure>;
  readonly getPolicy: (tenantId: string, policyId: string) => Effect.Effect<PolicyRow, CliFailure>;
  readonly createPolicy: (
    tenantId: string,
    payload: PolicyPayload,
  ) => Effect.Effect<IdResponse, CliFailure>;
  readonly patchPolicy: (
    tenantId: string,
    policyId: string,
    payload: PatchPolicyPayload,
  ) => Effect.Effect<void, CliFailure>;
  readonly getEnrollment: (tenantId: string) => Effect.Effect<Enrollment, CliFailure>;
}

const apiUrl = (origin: string, path: string): string => `${origin}/api/v1${path}`;

const decodeErrorBody = (body: string): Option.Option<typeof ApiErrorBody.Type> => {
  try {
    return Schema.decodeUnknownOption(ApiErrorBody)(JSON.parse(body));
  } catch {
    return Option.none();
  }
};

const errorFromResponse = (
  status: number,
  statusText: string,
  body: string,
  requestId: string | null,
): CliFailure => {
  const parsed = decodeErrorBody(body);

  const rawDetail = Option.isSome(parsed)
    ? (parsed.value.message ?? "Request failed")
    : body.trim().slice(0, 500) || statusText || "Request failed";

  const detail = rawDetail.slice(0, 500);

  const tag = Option.isSome(parsed) && parsed.value._tag ? ` (${parsed.value._tag})` : "";
  const correlation = requestId ? ` [request ${requestId}]` : "";

  return new CliFailure({
    message: `API request failed with HTTP ${status}${tag}: ${detail}${correlation}`,
  });
};

/**
 * A small fetch-based client for the versioned Enterprise API. Every response
 * is decoded with the shared `@mattrax/enterprise-domain` schema so a server
 * change fails loudly instead of producing partial output.
 */
export const createHttpApi = (origin: string, token: string): MattraxApi => {
  const call = <A>(
    schema: Schema.ConstraintDecoder<A, never>,
    request: ApiRequest,
  ): Effect.Effect<A, CliFailure> =>
    Effect.gen(function* () {
      const url = new URL(apiUrl(origin, request.path));

      for (const [key, value] of Object.entries(request.query ?? {}))
        if (value !== undefined) url.searchParams.set(key, String(value));

      const headers = new Headers({
        authorization: `Bearer ${token}`,
        accept: "application/json",
      });

      if (request.body) headers.set("content-type", "application/json");

      const response = yield* Effect.tryPromise({
        try: (signal) =>
          fetch(url, {
            method: request.method,
            headers,
            body: request.body,
            signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
          }),
        catch: (cause) =>
          new CliFailure({
            message: `Could not reach ${origin}: ${
              cause instanceof Error ? cause.message : "network error"
            }`,
          }),
      });

      const text = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: () => new CliFailure({ message: `Could not read the response from ${origin}.` }),
      });

      if (!response.ok)
        return yield* Effect.fail(
          errorFromResponse(
            response.status,
            response.statusText,
            text,
            response.headers.get("x-request-id"),
          ),
        );

      const parsed = yield* Effect.try({
        try: () => JSON.parse(text),
        catch: () =>
          new CliFailure({
            message: `${request.method} ${request.path} returned invalid JSON.`,
            hint: "Check whether a reverse proxy in front of the API rewrites responses.",
          }),
      });

      return yield* Schema.decodeUnknownEffect(schema)(parsed).pipe(
        Effect.mapError(
          (error) =>
            new CliFailure({
              message: `${request.method} ${request.path} returned an unexpected response: ${error.message}`,
            }),
        ),
      );
    });

  const sendVoid = (
    method: HttpMethod,
    path: string,
    body?: string,
  ): Effect.Effect<void, CliFailure> => call(StatusOk, { method, path, body }).pipe(Effect.asVoid);

  return {
    me: () => call(MeResponseSchema, { method: "GET", path: "/me" }),
    listTenants: () => call(TenantListResponseSchema, { method: "GET", path: "/tenants" }),
    searchDevices: (tenantId, query) =>
      call(DeviceSearchResponseSchema, {
        method: "GET",
        path: `/tenants/${encodeURIComponent(tenantId)}/devices/search`,
        query: {
          q: query.q,
          status: query.status,
          proto: query.proto,
          groupId: query.groupId,
          health: query.health,
          limit: query.limit,
          offset: query.offset,
          sort: query.sort,
          direction: query.direction,
        },
      }),
    listDevices: (tenantId) =>
      call(DeviceListResponseSchema, {
        method: "GET",
        path: `/tenants/${encodeURIComponent(tenantId)}/devices`,
      }),
    getDevice: (tenantId, deviceId) =>
      call(DeviceRowSchema, {
        method: "GET",
        path: `/tenants/${encodeURIComponent(tenantId)}/devices/${encodeURIComponent(deviceId)}`,
      }),
    getDeviceHealth: (tenantId, deviceId) =>
      call(DeviceHealthResponseSchema, {
        method: "GET",
        path: `/tenants/${encodeURIComponent(tenantId)}/devices/${encodeURIComponent(deviceId)}/health`,
      }),
    deviceAction: (tenantId, deviceId, payload) =>
      call(DeviceActionResponseSchema, {
        method: "POST",
        path: `/tenants/${encodeURIComponent(tenantId)}/devices/${encodeURIComponent(deviceId)}/action`,
        body: JSON.stringify(payload),
      }),
    deviceUnenroll: (tenantId, deviceId) =>
      sendVoid(
        "POST",
        `/tenants/${encodeURIComponent(tenantId)}/devices/${encodeURIComponent(deviceId)}/unenroll`,
      ),
    listGroups: (tenantId) =>
      call(GroupListResponseSchema, {
        method: "GET",
        path: `/tenants/${encodeURIComponent(tenantId)}/groups`,
      }),
    getGroup: (tenantId, groupId) =>
      call(GroupNodeSchema, {
        method: "GET",
        path: `/tenants/${encodeURIComponent(tenantId)}/groups/${encodeURIComponent(groupId)}`,
      }),
    createGroup: (tenantId, payload) =>
      call(IdResponseSchema, {
        method: "POST",
        path: `/tenants/${encodeURIComponent(tenantId)}/groups`,
        body: JSON.stringify(payload),
      }),
    patchGroup: (tenantId, groupId, payload) =>
      sendVoid(
        "PATCH",
        `/tenants/${encodeURIComponent(tenantId)}/groups/${encodeURIComponent(groupId)}`,
        JSON.stringify(payload),
      ),
    patchGroupMembers: (tenantId, groupId, payload) =>
      sendVoid(
        "PATCH",
        `/tenants/${encodeURIComponent(tenantId)}/groups/${encodeURIComponent(groupId)}/members`,
        JSON.stringify(payload),
      ),
    listPolicies: (tenantId) =>
      call(PolicyListResponseSchema, {
        method: "GET",
        path: `/tenants/${encodeURIComponent(tenantId)}/policies`,
      }),
    getPolicy: (tenantId, policyId) =>
      call(PolicyRowSchema, {
        method: "GET",
        path: `/tenants/${encodeURIComponent(tenantId)}/policies/${encodeURIComponent(policyId)}`,
      }),
    createPolicy: (tenantId, payload) =>
      call(IdResponseSchema, {
        method: "POST",
        path: `/tenants/${encodeURIComponent(tenantId)}/policies`,
        body: JSON.stringify(payload),
      }),
    patchPolicy: (tenantId, policyId, payload) =>
      sendVoid(
        "PATCH",
        `/tenants/${encodeURIComponent(tenantId)}/policies/${encodeURIComponent(policyId)}`,
        JSON.stringify(payload),
      ),
    getEnrollment: (tenantId) =>
      call(TenantEnrollmentInfoSchema, {
        method: "GET",
        path: `/tenants/${encodeURIComponent(tenantId)}/enrollment`,
      }),
  };
};
