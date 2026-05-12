import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";

const IdParam = { id: Schema.String };
const TenantParam = { tenantId: Schema.String };
const TenantIdParam = { tenantId: Schema.String, id: Schema.String };
const TenantEntityParam = { tenantId: Schema.String, entity: Schema.Literals(["device", "group", "policy"]), id: Schema.String };
const TenantInvitationParam = { tenantId: Schema.String, invitationId: Schema.String };
const TenantMemberParam = { tenantId: Schema.String, memberId: Schema.String };

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

export const TenantInfo = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  role: Schema.String,
  logo: Schema.optional(NullableString),
});

export const TenantDetail = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  role: Schema.String,
  logo: Schema.optional(NullableString),
  metadata: Schema.optional(NullableString),
  createdAt: Schema.String,
});

export const BillingSummary = Schema.Struct({
  plan: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  billableDevices: Schema.Number,
  subscriptionId: Schema.optional(NullableString),
});

export const MeResponse = Schema.Struct({
  user: UserInfo,
  activeTenant: Schema.optional(TenantInfo),
  tenants: Schema.Array(TenantInfo),
  billing: Schema.optional(BillingSummary),
});

export const CreateTenantRequest = Schema.Struct({
  name: Schema.String,
  slug: Schema.String,
  logo: Schema.optional(NullableString),
  metadata: Schema.optional(JsonRecord),
});

export const PatchTenantRequest = Schema.Struct({
  name: Schema.optional(Schema.String),
  slug: Schema.optional(Schema.String),
  logo: Schema.optional(NullableString),
  metadata: Schema.optional(Schema.NullOr(JsonRecord)),
});

export const TenantListResponse = Schema.Struct({ tenants: Schema.Array(TenantInfo) });

export const TenantUser = Schema.Struct({
  memberId: Schema.String,
  userId: Schema.String,
  name: Schema.String,
  email: Schema.String,
  role: Schema.String,
  createdAt: Schema.String,
});

export const TenantUsersResponse = Schema.Struct({ users: Schema.Array(TenantUser) });

export const InviteTenantUserRequest = Schema.Struct({
  email: Schema.String,
  role: Schema.optional(Schema.String),
  resend: Schema.optional(Schema.Boolean),
});

export const TenantInvitation = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  role: Schema.optional(NullableString),
  status: Schema.String,
  expiresAt: Schema.String,
  createdAt: Schema.String,
});

export const TenantInvitationsResponse = Schema.Struct({ invitations: Schema.Array(TenantInvitation) });

export const PatchTenantUserRequest = Schema.Struct({ role: Schema.String });

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

export const TenantEnrollmentInfo = Schema.Struct({
  id: Schema.String,
  code: Schema.optional(NullableString),
  enabledApple: Schema.Boolean,
  enabledWindows: Schema.Boolean,
  enabledAndroid: Schema.Boolean,
  enabledAssetTag: Schema.Boolean,
  maxDevices: Schema.Number,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export const PatchTenantEnrollmentRequest = Schema.Struct({
  code: Schema.optional(NullableString),
  enabledApple: Schema.optional(Schema.Boolean),
  enabledWindows: Schema.optional(Schema.Boolean),
  enabledAndroid: Schema.optional(Schema.Boolean),
  enabledAssetTag: Schema.optional(Schema.Boolean),
  maxDevices: Schema.optional(Schema.Number),
});

export const ApnsInfo = Schema.Struct({
  configured: Schema.Boolean,
  email: Schema.optional(NullableString),
  topic: Schema.optional(NullableString),
});

export const UploadApnsRequest = Schema.Struct({ email: Schema.String, cert: Schema.String });
export const BillingPortalRequest = Schema.Struct({ returnUrl: Schema.String });
export const BillingPortalResponse = Schema.Struct({ url: Schema.String });

export const enterpriseApi = HttpApiGroup.make("EnterpriseApi")
  .add(HttpApiEndpoint.get("me", "/v1/me", { success: MeResponse }))
  .add(HttpApiEndpoint.patch("updateMe", "/v1/me", { payload: UpdateMeRequest, success: Schema.Struct({ status: Schema.Literal("ok") }) }))
  .add(HttpApiEndpoint.delete("deleteMe", "/v1/me", { success: Schema.Struct({ error: Schema.String }) }))
  .add(HttpApiEndpoint.get("listTenants", "/v1/tenants", { success: TenantListResponse }))
  .add(HttpApiEndpoint.post("createTenant", "/v1/tenants", { payload: CreateTenantRequest, success: IdResponse }))
  .add(HttpApiEndpoint.get("getTenant", "/v1/tenants/:tenantId", { params: TenantParam, success: TenantDetail }))
  .add(HttpApiEndpoint.patch("patchTenant", "/v1/tenants/:tenantId", { params: TenantParam, payload: PatchTenantRequest, success: Schema.Struct({ status: Schema.Literal("ok") }) }))
  .add(HttpApiEndpoint.delete("deleteTenant", "/v1/tenants/:tenantId", { params: TenantParam, success: Schema.Struct({ status: Schema.Literal("ok") }) }))
  .add(HttpApiEndpoint.get("listTenantUsers", "/v1/tenants/:tenantId/users", { params: TenantParam, success: TenantUsersResponse }))
  .add(HttpApiEndpoint.post("inviteTenantUser", "/v1/tenants/:tenantId/invitations", { params: TenantParam, payload: InviteTenantUserRequest, success: IdResponse }))
  .add(HttpApiEndpoint.get("listTenantInvitations", "/v1/tenants/:tenantId/invitations", { params: TenantParam, success: TenantInvitationsResponse }))
  .add(HttpApiEndpoint.delete("cancelTenantInvitation", "/v1/tenants/:tenantId/invitations/:invitationId", { params: TenantInvitationParam, success: Schema.Struct({ status: Schema.Literal("ok") }) }))
  .add(HttpApiEndpoint.patch("patchTenantUser", "/v1/tenants/:tenantId/users/:memberId", { params: TenantMemberParam, payload: PatchTenantUserRequest, success: Schema.Struct({ status: Schema.Literal("ok") }) }))
  .add(HttpApiEndpoint.delete("removeTenantUser", "/v1/tenants/:tenantId/users/:memberId", { params: TenantMemberParam, success: Schema.Struct({ status: Schema.Literal("ok") }) }))
  .add(HttpApiEndpoint.get("getEnrollment", "/v1/enrollment/:id", { params: IdParam, query: EnrollmentQuery, success: EnrollmentResponse }))
  .add(HttpApiEndpoint.get("getTenantEnrollment", "/v1/tenants/:tenantId/enrollment", { params: TenantParam, success: TenantEnrollmentInfo }))
  .add(HttpApiEndpoint.patch("patchTenantEnrollment", "/v1/tenants/:tenantId/enrollment", { params: TenantParam, payload: PatchTenantEnrollmentRequest, success: Schema.Struct({ status: Schema.Literal("ok") }) }))
  .add(HttpApiEndpoint.post("resetTenantEnrollment", "/v1/tenants/:tenantId/enrollment/reset", { params: TenantParam, success: IdResponse }))
  .add(HttpApiEndpoint.get("getApns", "/v1/tenants/:tenantId/apns", { params: TenantParam, success: ApnsInfo }))
  .add(HttpApiEndpoint.post("uploadApns", "/v1/tenants/:tenantId/apns", { params: TenantParam, payload: UploadApnsRequest, success: Schema.Struct({ status: Schema.Literal("ok") }) }))
  .add(HttpApiEndpoint.delete("deleteDevices", "/v1/tenants/:tenantId/devices", { params: TenantParam, payload: IdsRequest, success: Schema.Struct({ status: Schema.Literal("ok") }) }))
  .add(HttpApiEndpoint.patch("patchDevice", "/v1/tenants/:tenantId/devices/:id", { params: TenantIdParam, payload: PatchDeviceRequest, success: Schema.Struct({ status: Schema.Literal("ok") }) }))
  .add(HttpApiEndpoint.post("deviceAction", "/v1/tenants/:tenantId/devices/:id/action", { params: TenantIdParam, success: Schema.Struct({ status: Schema.Literal("ok") }) }))
  .add(HttpApiEndpoint.post("deviceUnenroll", "/v1/tenants/:tenantId/devices/:id/unenroll", { params: TenantIdParam, success: Schema.Struct({ status: Schema.Literal("ok") }) }))
  .add(HttpApiEndpoint.post("createGroup", "/v1/tenants/:tenantId/groups", { params: TenantParam, payload: CreateGroupRequest, success: IdResponse }))
  .add(HttpApiEndpoint.delete("deleteGroups", "/v1/tenants/:tenantId/groups", { params: TenantParam, payload: IdsRequest, success: BulkOperationResult }))
  .add(HttpApiEndpoint.patch("patchGroup", "/v1/tenants/:tenantId/groups/:id", { params: TenantIdParam, payload: PatchGroupRequest, success: Schema.Struct({ status: Schema.Literal("ok") }) }))
  .add(HttpApiEndpoint.patch("patchGroupMembers", "/v1/tenants/:tenantId/groups/:id/members", { params: TenantIdParam, payload: PatchGroupMembersRequest, success: Schema.Struct({ status: Schema.Literal("ok") }) }))
  .add(HttpApiEndpoint.post("syncGroups", "/v1/tenants/:tenantId/groups/sync", { params: TenantParam, payload: IdsRequest, success: Schema.Struct({ status: Schema.Literal("ok") }) }))
  .add(HttpApiEndpoint.post("duplicateGroup", "/v1/tenants/:tenantId/groups/:id/duplicate", { params: TenantIdParam, payload: DuplicateRequest, success: IdResponse }))
  .add(HttpApiEndpoint.post("createPolicy", "/v1/tenants/:tenantId/policies", { params: TenantParam, payload: CreatePolicyRequest, success: IdResponse }))
  .add(HttpApiEndpoint.delete("deletePolicies", "/v1/tenants/:tenantId/policies", { params: TenantParam, payload: IdsRequest, success: BulkOperationResult }))
  .add(HttpApiEndpoint.patch("patchPolicy", "/v1/tenants/:tenantId/policies/:id", { params: TenantIdParam, payload: PatchPolicyRequest, success: Schema.Struct({ status: Schema.Literal("ok") }) }))
  .add(HttpApiEndpoint.post("syncPolicies", "/v1/tenants/:tenantId/policies/sync", { params: TenantParam, payload: IdsRequest, success: Schema.Struct({ status: Schema.Literal("ok") }) }))
  .add(HttpApiEndpoint.post("duplicatePolicy", "/v1/tenants/:tenantId/policies/:id/duplicate", { params: TenantIdParam, payload: DuplicateRequest, success: IdResponse }))
  .add(HttpApiEndpoint.post("previewMobileconfig", "/v1/policy/preview-mobileconfig", { payload: Schema.Struct({ mobileconfig: Schema.String }), success: JsonRecord }))
  .add(HttpApiEndpoint.get("search", "/v1/tenants/:tenantId/search", { params: TenantParam, query: SearchQuery, success: SearchResult }))
  .add(HttpApiEndpoint.get("node", "/v1/tenants/:tenantId/node/:entity/:id", { params: TenantEntityParam, success: NodeResponse }))
  .add(HttpApiEndpoint.get("billing", "/v1/tenants/:tenantId/billing", { params: TenantParam, success: BillingSummary }))
  .add(HttpApiEndpoint.post("billingPortal", "/v1/tenants/:tenantId/billing/portal", { params: TenantParam, payload: BillingPortalRequest, success: BillingPortalResponse }))
  .prefix("/api")
  .annotateMerge(OpenApi.annotations({ title: "Mattrax Enterprise API", description: "Organization-scoped Mattrax management API." }));
