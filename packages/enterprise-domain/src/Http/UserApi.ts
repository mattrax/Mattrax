import { HttpApiEndpoint } from "effect/http-api";
import { HttpApiGroup } from "effect/http-api";
import {
  EnterpriseTenantReadErrors,
  EnterpriseTenantValidatedReadErrors,
  EnterpriseTenantWriteErrors,
} from "../Errors.js";
import {
  DirectoryUserMergeCandidatesResponse,
  DirectoryUserMergePreview,
  DirectoryUserMergeResult,
  MergeDirectoryUsersRequest,
  PreviewDirectoryUserMergeRequest,
  UserDetail,
  UserListResponse,
} from "../User.js";
import { TenantParam } from "./Params.js";
import { TenantUserParam } from "./Params.js";

/**
 * Directory-user views and the merge repair.
 *
 * A separate group keeps `EnterpriseApi` (already at the declaration-size
 * limit) unchanged. Users are imported by directory sync, not created here;
 * the only mutation is folding duplicate records of one person into a single
 * directory user.
 */
export const enterpriseUserApi = HttpApiGroup.make("EnterpriseUser")
  .add(
    HttpApiEndpoint.get("listUsers", "/v1/tenants/:tenantId/users", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: UserListResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getUser", "/v1/tenants/:tenantId/users/:userId", {
      error: EnterpriseTenantReadErrors,
      params: TenantUserParam,
      success: UserDetail,
    }),
  )
  .add(
    HttpApiEndpoint.get(
      "listUserMergeCandidates",
      "/v1/tenants/:tenantId/users/:userId/merge-candidates",
      {
        error: EnterpriseTenantReadErrors,
        params: TenantUserParam,
        success: DirectoryUserMergeCandidatesResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "previewDirectoryUserMerge",
      "/v1/tenants/:tenantId/users/:userId/merge-preview",
      {
        // A dry run validates the same ids the merge will, so an unknown
        // source or a self-merge is a 400 rather than a 500.
        error: EnterpriseTenantValidatedReadErrors,
        params: TenantUserParam,
        payload: PreviewDirectoryUserMergeRequest,
        success: DirectoryUserMergePreview,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post("mergeDirectoryUsers", "/v1/tenants/:tenantId/users/:userId/merge", {
      error: EnterpriseTenantWriteErrors,
      params: TenantUserParam,
      payload: MergeDirectoryUsersRequest,
      success: DirectoryUserMergeResult,
    }),
  )
  .prefix("/api");
