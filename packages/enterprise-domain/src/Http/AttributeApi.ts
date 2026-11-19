import { AttributeDefinitionListResponse } from "../attributes.js";
import { AttributeDefinitionRow } from "../attributes.js";
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
import { EnterpriseTenantWriteErrors } from "../Errors.js";
import { HttpApiSchema } from "effect/http-api";
import { MobileconfigPreview } from "../Policy.js";
import { IdParam } from "./Params.js";
import { TenantAttributeParam } from "./Params.js";
import { TenantIdParam } from "./Params.js";
import { TenantParam } from "./Params.js";

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
  .prefix("/api");

/**
 * Script management contract.
 *
 * A separate group keeps the browser contract's generated types manageable and
 * reflects that scripts are an independent resource. `scriptHttpApi` is the
 * client the dashboard uses; `enterpriseHttpApi` deliberately excludes it.
 */
