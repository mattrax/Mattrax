import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { EnterpriseStepUpRequired, EnterpriseTenantWriteErrors } from "../Errors.js";
import { TenantIdParam } from "./Params.js";

/**
 * Identity operations that do not fit in `EnterpriseApi`.
 *
 * That group is already at the size the declaration emitter can serialise, so
 * linking an SSO identity lives in its own group, like attributes, scripts and
 * dashboard queries.
 */
export const enterpriseIdentityApi = HttpApiGroup.make("EnterpriseIdentity")
  .add(
    HttpApiEndpoint.post(
      "linkDirectoryUserSso",
      "/v1/tenants/:tenantId/identity/directory/:id/sso-link",
      {
        error: [...EnterpriseTenantWriteErrors, ...EnterpriseStepUpRequired],
        params: TenantIdParam,
        success: Schema.Struct({ status: Schema.Literal("ok") }),
      },
    ),
  )
  .prefix("/api");
