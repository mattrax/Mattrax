import { AttributeDefinitionListResponse } from "../attributes.js";
import { AttributeDefinitionRow } from "../attributes.js";
import { CollectDeviceAttributeResponse } from "../attributes.js";
import { DeviceAttributeCollectionResponse } from "../attributes.js";
import { CreateAttributeRequest } from "../attributes.js";
import { DeviceAttributeImportResponse } from "../attributes.js";
import { EnrollmentQuestionListResponse } from "../attributes.js";
import { HttpApiEndpoint } from "effect/http-api";
import { HttpApiGroup } from "effect/http-api";
import { ImportDeviceAttributesRequest } from "../attributes.js";
import { PatchAttributeRequest } from "../attributes.js";
import { PatchEnrollmentQuestionsRequest } from "../attributes.js";
import { PolicyVariablesResponse } from "../policyVariables.js";
import { Schema } from "effect";
import { SetDeviceAttributesRequest } from "../attributes.js";
import { SubmitEnrollmentAnswersRequest } from "../attributes.js";
import { SubmitEnrollmentAnswersResponse } from "../attributes.js";
import { EnterpriseBadRequest, EnterpriseNoDomainErrors } from "../Errors.js";
import { EnterprisePublicEnrollmentProfileErrors } from "../Errors.js";
import { EnterpriseTenantReadErrors } from "../Errors.js";
import { EnterpriseApprovalRequired, EnterpriseStepUpRequired } from "../Errors.js";
import { EnterpriseTenantWriteErrors } from "../Errors.js";
import { HttpApiSchema } from "effect/http-api";
import { MobileconfigPreview } from "../Policy.js";
import { GroupScopeSummary, PolicyScopeSummary } from "../PolicyScope.js";
import { PolicyDeploymentProgressResponse } from "../PolicyDeployment.js";
import { IdParam } from "./Params.js";
import { TenantAttributeParam } from "./Params.js";
import { TenantDeviceAttributeParam } from "./Params.js";
import { TenantIdParam } from "./Params.js";
import { TenantParam } from "./Params.js";
import { BulkUpdateResult } from "../Common.js";
import { AddUserGroupMembersRequest } from "../Directory.js";
import { PatchTenantAccountRolesRequest } from "../Tenant.js";

const MobileconfigRequest = Schema.Struct({ mobileconfig: Schema.String });

const MobileconfigExtractResponse = Schema.Struct({ plist: Schema.String });

export const enterpriseAttributeApi = HttpApiGroup.make("EnterpriseAttribute")
  .add(
    HttpApiEndpoint.get("listAttributes", "/v1/tenants/:tenantId/attributes", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: AttributeDefinitionListResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("createAttribute", "/v1/tenants/:tenantId/attributes", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: CreateAttributeRequest,
      success: AttributeDefinitionRow,
    }),
  )
  .add(
    HttpApiEndpoint.patch("patchAttribute", "/v1/tenants/:tenantId/attributes/:attributeId", {
      error: EnterpriseTenantWriteErrors,
      params: TenantAttributeParam,
      payload: PatchAttributeRequest,
      success: AttributeDefinitionRow,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteAttribute", "/v1/tenants/:tenantId/attributes/:attributeId", {
      error: EnterpriseTenantWriteErrors,
      params: TenantAttributeParam,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.get("listEnrollmentQuestions", "/v1/tenants/:tenantId/enrollment/questions", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: EnrollmentQuestionListResponse,
    }),
  )
  .add(
    HttpApiEndpoint.put("patchEnrollmentQuestions", "/v1/tenants/:tenantId/enrollment/questions", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: PatchEnrollmentQuestionsRequest,
      success: EnrollmentQuestionListResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getPolicyVariables", "/v1/tenants/:tenantId/policy-variables", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      success: PolicyVariablesResponse,
    }),
  )
  .add(
    // Computed policy/group scope. These live here rather than in
    // `EnterpriseApi` because that group's generated declaration is already at
    // the compiler's size limit; this group already serves traffic.
    HttpApiEndpoint.get("getPolicyScope", "/v1/tenants/:tenantId/policies/:id/scope", {
      error: EnterpriseTenantReadErrors,
      params: TenantIdParam,
      success: PolicyScopeSummary,
    }),
  )
  .add(
    // Per-device progress for one saved policy version. This lives here rather
    // than in `EnterpriseApi` for the same compiler-size reason as the scope
    // endpoints above. `:version` accepts a number or "latest"; the handler
    // resolves "latest" to the newest row so the dashboard needs one request.
    HttpApiEndpoint.get(
      "getPolicyDeploymentDevices",
      "/v1/tenants/:tenantId/policies/:id/deployments/:version/devices",
      {
        error: EnterpriseTenantReadErrors,
        params: { tenantId: Schema.String, id: Schema.String, version: Schema.String },
        query: Schema.Struct({
          limit: Schema.optional(Schema.Number),
          offset: Schema.optional(Schema.Number),
        }),
        success: PolicyDeploymentProgressResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get("getGroupScope", "/v1/tenants/:tenantId/groups/:id/scope", {
      error: EnterpriseTenantReadErrors,
      params: TenantIdParam,
      success: GroupScopeSummary,
    }),
  )
  .add(
    // Mobileconfig utilities live in this group rather than `EnterpriseApi`:
    // that group's generated declaration is already at the compiler's size
    // limit, and these endpoints are stateless policy helpers.
    HttpApiEndpoint.post("extractMobileconfig", "/v1/policy/extract-mobileconfig", {
      error: [...EnterpriseNoDomainErrors, EnterpriseBadRequest.pipe(HttpApiSchema.status(400))],
      payload: MobileconfigRequest,
      success: MobileconfigExtractResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("previewMobileconfig", "/v1/policy/preview-mobileconfig", {
      error: [...EnterpriseNoDomainErrors, EnterpriseBadRequest.pipe(HttpApiSchema.status(400))],
      payload: MobileconfigRequest,
      success: MobileconfigPreview,
    }),
  )
  .add(
    HttpApiEndpoint.post("submitEnrollmentAnswers", "/v1/enrollment/:id/answers", {
      error: EnterprisePublicEnrollmentProfileErrors,
      params: IdParam,
      payload: SubmitEnrollmentAnswersRequest,
      success: SubmitEnrollmentAnswersResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "importDeviceAttributes",
      "/v1/tenants/:tenantId/devices/attributes/import",
      {
        error: EnterpriseTenantWriteErrors,
        params: TenantParam,
        payload: ImportDeviceAttributesRequest,
        success: DeviceAttributeImportResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.put("setDeviceAttributes", "/v1/tenants/:tenantId/devices/:id/attributes", {
      error: EnterpriseTenantWriteErrors,
      params: TenantIdParam,
      payload: SetDeviceAttributesRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    // Collection state is its own read rather than another field on the device
    // payload: it is only needed by the Attributes panel, and `EnterpriseApi`
    // is already at the compiler's declaration-size limit.
    HttpApiEndpoint.get(
      "listDeviceAttributeCollection",
      "/v1/tenants/:tenantId/devices/:id/attributes/collection",
      {
        error: EnterpriseTenantReadErrors,
        params: TenantIdParam,
        success: DeviceAttributeCollectionResponse,
      },
    ),
  )
  .add(
    // "Collect now" queues the attribute's bound script for this device through
    // the normal manual-run path, so expiry, deduplication and output caps are
    // the ones already tested there rather than a second scheduler.
    HttpApiEndpoint.post(
      "collectDeviceAttribute",
      "/v1/tenants/:tenantId/devices/:id/attributes/:attributeId/collect",
      {
        error: [
          ...EnterpriseTenantWriteErrors,
          ...EnterpriseStepUpRequired,
          ...EnterpriseApprovalRequired,
        ],
        params: TenantDeviceAttributeParam,
        success: CollectDeviceAttributeResponse,
      },
    ),
  )
  .add(
    // Bulk member operations live here rather than in `EnterpriseApi`: that
    // group's generated declaration is already at the compiler's size limit.
    HttpApiEndpoint.post("patchTenantAccountRoles", "/v1/tenants/:tenantId/accounts/roles", {
      error: EnterpriseTenantWriteErrors,
      params: TenantParam,
      payload: PatchTenantAccountRolesRequest,
      success: BulkUpdateResult,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "addUserGroupMembers",
      "/v1/tenants/:tenantId/directory/groups/:groupId/members",
      {
        error: EnterpriseTenantWriteErrors,
        params: { tenantId: Schema.String, groupId: Schema.String },
        payload: AddUserGroupMembersRequest,
        success: BulkUpdateResult,
      },
    ),
  )
  .prefix("/api");

/**
 * Script management contract.
 *
 * A separate group keeps the browser contract's generated types manageable and
 * reflects that scripts are an independent resource. `scriptHttpApi` is the
 * client the dashboard uses; `enterpriseHttpApi` deliberately excludes it.
 */
