import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import {
  CreateScopeTagRequest,
  ListScopeTagAssignmentsQuery,
  PatchScopeTagRequest,
  ScopeTagAssignmentsResponse,
  ScopeTagsResponse,
  SetMemberScopeTagsRequest,
  SetScopeTagAssignmentsRequest,
  SetScopeTagAssignmentsResponse,
} from "../ScopeTag.js";
import { EnterpriseTenantReadErrors, EnterpriseTenantWriteErrors } from "../Errors.js";
import { TenantParam } from "./Params.js";

/**
 * Scope tags for delegated administration.
 *
 * Reading tags needs `scope_tags.read`; creating, renaming, deleting and
 * attaching them needs `scope_tags.write`. Attaching a tag to a resource also
 * needs the write permission for that resource kind, which the handler checks
 * because the HTTP method only carries one ambient permission.
 */
export const enterpriseScopeTagApi = HttpApiGroup.make("EnterpriseScopeTag")
  .add(
    HttpApiEndpoint.get("listScopeTags", "/v1/tenants/:tenantId/scope-tags", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: ScopeTagsResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("createScopeTag", "/v1/tenants/:tenantId/scope-tags", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: CreateScopeTagRequest,
      success: Schema.Struct({ id: Schema.String }),
    }),
  )
  .add(
    HttpApiEndpoint.patch("patchScopeTag", "/v1/tenants/:tenantId/scope-tags/:tagId", {
      error: EnterpriseTenantWriteErrors,
      params: { tenantId: Schema.String, tagId: Schema.String },
      payload: PatchScopeTagRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteScopeTag", "/v1/tenants/:tenantId/scope-tags/:tagId", {
      error: EnterpriseTenantWriteErrors,
      params: { tenantId: Schema.String, tagId: Schema.String },
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.put(
      "setMemberScopeTags",
      "/v1/tenants/:tenantId/scope-tags/members/:accountId",
      {
        error: EnterpriseTenantWriteErrors,
        params: { tenantId: Schema.String, accountId: Schema.String },
        payload: SetMemberScopeTagsRequest,
        success: Schema.Struct({ status: Schema.Literal("ok") }),
      },
    ),
  )
  .add(
    HttpApiEndpoint.get("listScopeTagAssignments", "/v1/tenants/:tenantId/scope-tags/assignments", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      query: ListScopeTagAssignmentsQuery,
      success: ScopeTagAssignmentsResponse,
    }),
  )
  .add(
    HttpApiEndpoint.put("setScopeTagAssignments", "/v1/tenants/:tenantId/scope-tags/assignments", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: SetScopeTagAssignmentsRequest,
      success: SetScopeTagAssignmentsResponse,
    }),
  )
  .prefix("/api");
