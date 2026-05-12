import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";

const IdParam = { id: Schema.String };
const EntityParam = { entity: Schema.Literals(["device", "group", "policy"]), id: Schema.String };

export const NullableString = Schema.NullOr(Schema.String);
export const JsonRecord = Schema.Record(Schema.String, Schema.Unknown);

export const UserInfo = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  emailVerified: Schema.Boolean,
  image: Schema.optional(NullableString),
});

export const OrganizationInfo = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  role: Schema.String,
});

export const BillingSummary = Schema.Struct({
  plan: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  billableDevices: Schema.Number,
  subscriptionId: Schema.optional(NullableString),
});

export const MeResponse = Schema.Struct({
  user: UserInfo,
  organization: Schema.optional(OrganizationInfo),
  billing: Schema.optional(BillingSummary),
});

export const UpdateMeRequest = Schema.Struct({
  name: Schema.optional(Schema.String),
  image: Schema.optional(NullableString),
});

export const DeviceProtocol = Schema.Literals(["apple", "win", "android"]);
export const DeviceStatus = Schema.Literals(["enrolling", "enrolled", "unenrolling", "unenrolled"]);

export const DeviceRow = Schema.Struct({
  id: Schema.String,
  proto: DeviceProtocol,
  name: Schema.String,
  model: Schema.optional(NullableString),
  modelIdentifier: Schema.optional(NullableString),
  serial: Schema.optional(NullableString),
  status: DeviceStatus,
  enrolledAt: Schema.String,
  lastSeenAt: Schema.String,
  assetTag: Schema.optional(NullableString),
  notes: Schema.optional(NullableString),
  physicalName: Schema.optional(NullableString),
  vendor: Schema.optional(NullableString),
  osEdition: Schema.optional(NullableString),
  osVersion: Schema.optional(NullableString),
  osBuild: Schema.optional(NullableString),
  diskTotal: Schema.optional(NullableString),
  diskUsed: Schema.optional(NullableString),
});

export const PatchDeviceRequest = Schema.Struct({
  name: Schema.optional(Schema.String),
  notes: Schema.optional(NullableString),
  assetTag: Schema.optional(NullableString),
});

export const GroupRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  notes: Schema.optional(NullableString),
  devicesCount: Schema.optional(Schema.Number),
  policiesCount: Schema.optional(Schema.Number),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export const GroupRelation = Schema.Struct({ id: Schema.String, name: Schema.String });
export const GroupNode = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  notes: Schema.optional(NullableString),
  devicesCount: Schema.optional(Schema.Number),
  policiesCount: Schema.optional(Schema.Number),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  devices: Schema.optional(Schema.Array(GroupRelation)),
  policies: Schema.optional(Schema.Array(GroupRelation)),
});

export const CreateGroupRequest = Schema.Struct({
  name: Schema.String,
  notes: Schema.optional(NullableString),
  devices: Schema.optional(Schema.Array(Schema.String)),
  policies: Schema.optional(Schema.Array(Schema.String)),
});

export const PatchGroupRequest = Schema.Struct({
  name: Schema.optional(Schema.String),
  notes: Schema.optional(NullableString),
});

export const PatchGroupMembersRequest = Schema.Struct({
  assign: Schema.optional(Schema.Struct({
    devices: Schema.optional(Schema.Array(Schema.String)),
    policies: Schema.optional(Schema.Array(Schema.String)),
  })),
  unassign: Schema.optional(Schema.Struct({
    devices: Schema.optional(Schema.Array(Schema.String)),
    policies: Schema.optional(Schema.Array(Schema.String)),
  })),
});

export const PolicyRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  notes: Schema.optional(NullableString),
  configurations: Schema.optional(JsonRecord),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export const CreatePolicyRequest = Schema.Struct({
  name: Schema.String,
  notes: Schema.optional(NullableString),
});

export const PatchPolicyRequest = Schema.Struct({
  name: Schema.optional(Schema.String),
  notes: Schema.optional(NullableString),
  configurations: Schema.optional(JsonRecord),
});

export const DuplicateRequest = Schema.Struct({ name: Schema.optional(Schema.String) });
export const IdsRequest = Schema.Array(Schema.String);
export const IdResponse = Schema.Struct({ id: Schema.String });
export const NoContent = Schema.Void;

export const BulkOperationResult = Schema.Struct({
  deleted: Schema.Array(Schema.String),
  failed: Schema.Array(Schema.Struct({ id: Schema.String, reason: Schema.String })),
});

export const SearchQuery = {
  type: Schema.Literals(["device", "group", "policy"]),
  "in[group]": Schema.optional(Schema.String),
};

export const SearchResult = Schema.Struct({
  rows: Schema.Array(Schema.Union([DeviceRow, GroupRow, PolicyRow])),
});

export const NodeResponse = Schema.Union([DeviceRow, GroupNode, PolicyRow]);

export const PlatformEnrollment = Schema.Union([
  Schema.Struct({ error: Schema.String }),
  Schema.Struct({ profile: Schema.String }),
  Schema.Literal("available"),
]);

export const EnrollmentResponse = Schema.Union([
  Schema.Struct({ name: Schema.String, authenticated: Schema.Literal(false) }),
  Schema.Struct({
    name: Schema.String,
    authenticated: Schema.Literal(true),
    apple: PlatformEnrollment,
    windows: PlatformEnrollment,
    android: PlatformEnrollment,
    assetTag: Schema.Boolean,
  }),
]);

export const EnrollmentQuery = { code: Schema.optional(Schema.String) };

export const ApnsInfo = Schema.Struct({
  configured: Schema.Boolean,
  email: Schema.optional(NullableString),
  topic: Schema.optional(NullableString),
});

export const UploadApnsRequest = Schema.Struct({ email: Schema.String, cert: Schema.String });
export const BillingPortalRequest = Schema.Struct({ returnUrl: Schema.String });
export const BillingPortalResponse = Schema.Struct({ url: Schema.String });

export const enterpriseApi = HttpApiGroup.make("EnterpriseApi")
  .add(HttpApiEndpoint.get("status", "/status", { success: Schema.Struct({ status: Schema.Literal("ok") }) }))
  .add(HttpApiEndpoint.get("me", "/v1/me", { success: MeResponse }))
  .add(HttpApiEndpoint.patch("updateMe", "/v1/me", { payload: UpdateMeRequest, success: Schema.Struct({ status: Schema.Literal("ok") }) }))
  .add(HttpApiEndpoint.delete("deleteMe", "/v1/me", { success: Schema.Struct({ error: Schema.String }) }))
  .add(HttpApiEndpoint.get("getEnrollment", "/v1/enrollment/:id", { params: IdParam, query: EnrollmentQuery, success: EnrollmentResponse }))
  .add(HttpApiEndpoint.delete("deleteTenant", "/v1/tenant", { success: Schema.Struct({ error: Schema.String }) }))
  .add(HttpApiEndpoint.get("getApns", "/v1/apns", { success: ApnsInfo }))
  .add(HttpApiEndpoint.post("uploadApns", "/v1/apns", { payload: UploadApnsRequest, success: Schema.Struct({ status: Schema.Literal("ok") }) }))
  .add(HttpApiEndpoint.delete("deleteDevices", "/v1/devices", { payload: IdsRequest, success: Schema.Struct({ status: Schema.Literal("ok") }) }))
  .add(HttpApiEndpoint.patch("patchDevice", "/v1/device/:id", { params: IdParam, payload: PatchDeviceRequest, success: Schema.Struct({ status: Schema.Literal("ok") }) }))
  .add(HttpApiEndpoint.post("deviceAction", "/v1/device/:id/action", { params: IdParam, success: Schema.Struct({ status: Schema.Literal("ok") }) }))
  .add(HttpApiEndpoint.post("deviceUnenroll", "/v1/device/:id/unenroll", { params: IdParam, success: Schema.Struct({ status: Schema.Literal("ok") }) }))
  .add(HttpApiEndpoint.post("createGroup", "/v1/groups", { payload: CreateGroupRequest, success: IdResponse }))
  .add(HttpApiEndpoint.delete("deleteGroups", "/v1/groups", { payload: IdsRequest, success: BulkOperationResult }))
  .add(HttpApiEndpoint.patch("patchGroup", "/v1/group/:id", { params: IdParam, payload: PatchGroupRequest, success: Schema.Struct({ status: Schema.Literal("ok") }) }))
  .add(HttpApiEndpoint.patch("patchGroupMembers", "/v1/group/:id/members", { params: IdParam, payload: PatchGroupMembersRequest, success: Schema.Struct({ status: Schema.Literal("ok") }) }))
  .add(HttpApiEndpoint.post("syncGroups", "/v1/groups/sync", { payload: IdsRequest, success: Schema.Struct({ status: Schema.Literal("ok") }) }))
  .add(HttpApiEndpoint.post("duplicateGroup", "/v1/group/:id/duplicate", { params: IdParam, payload: DuplicateRequest, success: IdResponse }))
  .add(HttpApiEndpoint.post("createPolicy", "/v1/policies", { payload: CreatePolicyRequest, success: IdResponse }))
  .add(HttpApiEndpoint.delete("deletePolicies", "/v1/policies", { payload: IdsRequest, success: BulkOperationResult }))
  .add(HttpApiEndpoint.patch("patchPolicy", "/v1/policy/:id", { params: IdParam, payload: PatchPolicyRequest, success: Schema.Struct({ status: Schema.Literal("ok") }) }))
  .add(HttpApiEndpoint.post("syncPolicies", "/v1/policies/sync", { payload: IdsRequest, success: Schema.Struct({ status: Schema.Literal("ok") }) }))
  .add(HttpApiEndpoint.post("duplicatePolicy", "/v1/policy/:id/duplicate", { params: IdParam, payload: DuplicateRequest, success: IdResponse }))
  .add(HttpApiEndpoint.post("previewMobileconfig", "/v1/policy/preview-mobileconfig", { payload: Schema.Struct({ mobileconfig: Schema.String }), success: JsonRecord }))
  .add(HttpApiEndpoint.get("search", "/v1/search", { query: SearchQuery, success: SearchResult }))
  .add(HttpApiEndpoint.get("node", "/v1/node/:entity/:id", { params: EntityParam, success: NodeResponse }))
  .add(HttpApiEndpoint.get("billing", "/v1/billing", { success: BillingSummary }))
  .add(HttpApiEndpoint.post("billingPortal", "/v1/billing/portal", { payload: BillingPortalRequest, success: BillingPortalResponse }))
  .prefix("/api")
  .annotateMerge(OpenApi.annotations({ title: "Mattrax Enterprise API", description: "Organization-scoped Mattrax management API." }));
