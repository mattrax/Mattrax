import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { Schema } from "effect";
import { EnterpriseTenantReadErrors, EnterpriseTenantWriteErrors } from "../Errors.js";
import { TenantParam } from "./Params.js";
import {
  AddCatalogueTitleRequest,
  AddCatalogueTitleResponse,
  CatalogueSearchQuery,
  CatalogueSearchResponse,
  CatalogueTitleResponse,
} from "../SoftwareCatalogue.js";

/**
 * Curated software catalogue.
 *
 * Kept in its own group for the same reason as the paginated lists: adding
 * endpoints to `EnterpriseApi` pushes its generated declaration past the
 * compiler's emit limit. Search is tenant-scoped because it reports the titles
 * the tenant has already added.
 */
export const enterpriseSoftwareCatalogueApi = HttpApiGroup.make("EnterpriseSoftwareCatalogue")
  .add(
    HttpApiEndpoint.get("searchSoftwareCatalogue", "/v1/tenants/:tenantId/software/catalogue", {
      error: EnterpriseTenantReadErrors,
      params: TenantParam,
      query: CatalogueSearchQuery,
      success: CatalogueSearchResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get(
      "getSoftwareCatalogueTitle",
      "/v1/tenants/:tenantId/software/catalogue/:titleId",
      {
        error: EnterpriseTenantReadErrors,
        params: Schema.Struct({ tenantId: Schema.String, titleId: Schema.String }),
        success: CatalogueTitleResponse,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "addSoftwareCatalogueTitle",
      "/v1/tenants/:tenantId/software/catalogue/:titleId/add",
      {
        error: EnterpriseTenantWriteErrors,
        params: Schema.Struct({ tenantId: Schema.String, titleId: Schema.String }),
        payload: AddCatalogueTitleRequest,
        success: AddCatalogueTitleResponse,
      },
    ),
  )
  .prefix("/api");
