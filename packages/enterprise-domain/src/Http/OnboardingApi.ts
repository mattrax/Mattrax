import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { EnterpriseTenantReadErrors } from "../Errors.js";
import {
  PatchTenantOnboardingRequest,
  TenantOnboardingState,
} from "../onboarding.js";
import { TenantParam } from "./Params.js";

/**
 * The overview checklist's read and dismissal endpoints.
 *
 * The read returns aggregates so the overview adds one request instead of
 * calling the group, policy, device and member lists separately. Dismissal is a
 * member preference, so both endpoints sit behind the same tenant read grant
 * that opens the overview: a read-only member can dismiss their own card but
 * cannot change tenant data.
 */
export const enterpriseOnboardingApi = HttpApiGroup.make("EnterpriseOnboarding")
  .add(
    HttpApiEndpoint.get("getTenantOnboarding", "/v1/tenants/:tenantId/onboarding", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: TenantOnboardingState,
    }),
  )
  .add(
    HttpApiEndpoint.patch("patchTenantOnboarding", "/v1/tenants/:tenantId/onboarding", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      payload: PatchTenantOnboardingRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .prefix("/api");
