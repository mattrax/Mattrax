import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import { Schema } from "effect";
import {
  AdminAccountResponse,
  AdminAccountsQuery,
  AdminAccountsResponse,
  PatchAdminAccountSuperadminRequest,
} from "../Admin.js";
import {
  EnterpriseAuthRequiredErrors,
  EnterpriseBadRequest,
  EnterpriseConflict,
  EnterpriseDbErrors,
  EnterpriseForbidden,
  EnterpriseNotFound,
} from "../Errors.js";

/**
 * Platform-operator endpoints. They are deliberately outside the tenant
 * contract: no path carries a tenant id, and the handler proves superadmin
 * from the account row or the deployment allowlist rather than a membership.
 *
 * A non-superadmin gets a 403 with no account data. The list is cross-tenant,
 * so the failure must not reveal whether a search matched anything.
 */
export const enterpriseAdminApi = HttpApiGroup.make("EnterpriseAdmin")
  .add(
    HttpApiEndpoint.get("listAdminAccounts", "/v1/admin/accounts", {
      error: [
        ...EnterpriseAuthRequiredErrors,
        ...EnterpriseDbErrors,
        EnterpriseBadRequest.pipe(HttpApiSchema.status(400)),
        EnterpriseForbidden.pipe(HttpApiSchema.status(403)),
      ],
      query: AdminAccountsQuery,
      success: AdminAccountsResponse,
    }),
  )
  .add(
    HttpApiEndpoint.patch(
      "patchAdminAccountSuperadmin",
      "/v1/admin/accounts/:accountId/superadmin",
      {
        error: [
          ...EnterpriseAuthRequiredErrors,
          ...EnterpriseDbErrors,
          EnterpriseBadRequest.pipe(HttpApiSchema.status(400)),
          EnterpriseForbidden.pipe(HttpApiSchema.status(403)),
          EnterpriseNotFound.pipe(HttpApiSchema.status(404)),
          EnterpriseConflict.pipe(HttpApiSchema.status(409)),
        ],
        params: { accountId: Schema.String },
        payload: PatchAdminAccountSuperadminRequest,
        success: AdminAccountResponse,
      },
    ),
  )
  .prefix("/api");
