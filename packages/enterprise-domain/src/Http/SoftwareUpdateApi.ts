import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { EnterpriseTenantReadErrors } from "../Errors.js";
import { SoftwareUpdateSummaryResponse } from "../softwareUpdates.js";
import { TenantParam } from "./Params.js";

/**
 * macOS update status lives in its own API group.
 *
 * `EnterpriseApi` is already at the compiler's declaration-size limit (see the
 * shared `OkResponse` schema); adding another endpoint there makes the
 * generated client type unnameable. A separate group keeps the contract small
 * and is composed into the same HTTP API in `./index.ts`.
 */
export const enterpriseSoftwareUpdateApi = HttpApiGroup.make("EnterpriseSoftwareUpdate")
  .add(
    HttpApiEndpoint.get("getSoftwareUpdateSummary", "/v1/tenants/:tenantId/software-updates", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: SoftwareUpdateSummaryResponse,
    }),
  )
  .prefix("/api");
