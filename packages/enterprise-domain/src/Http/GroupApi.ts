import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import {
  BulkOperationResult,
  DuplicateRequest,
  IdResponse,
  IdsRequest,
} from "../Common.js";
import { EnterpriseTenantReadErrors, EnterpriseTenantWriteErrors } from "../Errors.js";
import {
  CreateGroupRequest,
  GroupNode,
  PatchGroupMembersRequest,
  PatchGroupRequest,
} from "../Group.js";
import { GroupListResponse, GroupPreviewResponse } from "../Search.js";
import { TenantIdParam, TenantParam } from "./Params.js";

/**
 * Device group endpoints.
 *
 * Declared as their own HTTP API group because the group schemas (rules,
 * nesting, exclusions, membership provenance) are large enough that folding
 * them into the main tenant group pushes declaration emit past the compiler's
 * size limit. The URL space is unchanged; only the internal group name differs.
 */
const GroupOkResponse = Schema.Struct({ status: Schema.Literal("ok") });

export const enterpriseGroupApi = HttpApiGroup.make("EnterpriseGroup")
  .add(
    HttpApiEndpoint.get("listGroups", "/v1/tenants/:tenantId/groups", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: GroupListResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getGroup", "/v1/tenants/:tenantId/groups/:id", {
      error: EnterpriseTenantReadErrors,
      params: TenantIdParam,
      success: GroupNode,
    }),
  )
  .add(
    HttpApiEndpoint.get("previewGroup", "/v1/tenants/:tenantId/groups/:id/preview", {
      error: EnterpriseTenantReadErrors,
      params: TenantIdParam,
      success: GroupPreviewResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("createGroup", "/v1/tenants/:tenantId/groups", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: CreateGroupRequest,
      success: IdResponse,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteGroups", "/v1/tenants/:tenantId/groups", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: IdsRequest,
      success: BulkOperationResult,
    }),
  )
  .add(
    HttpApiEndpoint.patch("patchGroup", "/v1/tenants/:tenantId/groups/:id", {
      error: EnterpriseTenantWriteErrors,
      params: TenantIdParam,
      payload: PatchGroupRequest,
      success: GroupOkResponse,
    }),
  )
  .add(
    HttpApiEndpoint.patch("patchGroupMembers", "/v1/tenants/:tenantId/groups/:id/members", {
      error: EnterpriseTenantWriteErrors,
      params: TenantIdParam,
      payload: PatchGroupMembersRequest,
      success: GroupOkResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("syncGroups", "/v1/tenants/:tenantId/groups/sync", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: IdsRequest,
      success: GroupOkResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("duplicateGroup", "/v1/tenants/:tenantId/groups/:id/duplicate", {
      error: EnterpriseTenantWriteErrors,
      params: TenantIdParam,
      payload: DuplicateRequest,
      success: IdResponse,
    }),
  );
