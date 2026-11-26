import { Schema } from "effect";
import { CatalogueCategory, CataloguePlatform, CatalogueTitle } from "@mattrax/software";
import { ApplicationPlatform, ApplicationSource } from "./Application.js";
import { NullableString } from "./Errors.js";

export type { CatalogueDeployment, CatalogueTitle } from "@mattrax/software";

/**
 * The tenant-facing surface over the curated software catalogue.
 *
 * The catalogue itself lives in `@mattrax/software` and is shared by the API,
 * tests and documentation. These types are the HTTP contract only: they add
 * pagination, facet counts and the tenant's existing additions to a title.
 */

export const CatalogueSearchQuery = Schema.Struct({
  /** Free text over title, vendor, alias, category, description and identifiers. */
  q: Schema.optional(Schema.String),
  category: Schema.optional(CatalogueCategory),
  /** Titles that publish for this device platform (macOS, Windows, iOS…). */
  platform: Schema.optional(CataloguePlatform),
  /** Titles with at least one deployment carried by this MDM platform. */
  mdmPlatform: Schema.optional(ApplicationPlatform),
  limit: Schema.optional(Schema.Number),
  offset: Schema.optional(Schema.Number),
});

export type CatalogueSearchQuery = typeof CatalogueSearchQuery.Type;

export const CatalogueCategoryFacet = Schema.Struct({
  value: CatalogueCategory,
  label: Schema.String,
  count: Schema.Number,
});

export const CataloguePlatformFacet = Schema.Struct({
  value: CataloguePlatform,
  label: Schema.String,
  count: Schema.Number,
});

export type CataloguePlatformFacet = typeof CataloguePlatformFacet.Type;

/**
 * One catalogue method already added to this tenant.
 *
 * `pending` is set only by the dashboard's optimistic update; the API never
 * writes it.
 */
export const CatalogueAddition = Schema.Struct({
  titleId: Schema.String,
  methodId: Schema.String,
  applicationId: Schema.String,
  name: Schema.String,
  platform: ApplicationPlatform,
  source: ApplicationSource,
  createdAt: Schema.String,
  pending: Schema.optional(Schema.Boolean),
});

export type CatalogueAddition = typeof CatalogueAddition.Type;

export const CatalogueSearchResponse = Schema.Struct({
  items: Schema.Array(CatalogueTitle),
  total: Schema.Number,
  limit: Schema.Number,
  offset: Schema.Number,
  facets: Schema.Struct({
    categories: Schema.Array(CatalogueCategoryFacet),
    platforms: Schema.Array(CataloguePlatformFacet),
  }),
  additions: Schema.Array(CatalogueAddition),
  /** When the bundled catalogue data was last checked against vendors. */
  verifiedAt: Schema.String,
});

export type CatalogueSearchResponse = typeof CatalogueSearchResponse.Type;

export const CatalogueTitleResponse = Schema.Struct({
  title: CatalogueTitle,
  additions: Schema.Array(CatalogueAddition),
  verifiedAt: Schema.String,
});

export type CatalogueTitleResponse = typeof CatalogueTitleResponse.Type;

export const AddCatalogueTitleRequest = Schema.Struct({
  methods: Schema.Array(
    Schema.Struct({
      methodId: Schema.String,
      /** Required for a Windows MSI whose ProductCode the vendor rotates. */
      productCode: Schema.optional(NullableString),
      /** Optional installer version; Windows MSI defaults to 1.0.0. */
      version: Schema.optional(NullableString),
    }),
  ),
});

export type AddCatalogueTitleRequest = typeof AddCatalogueTitleRequest.Type;

export const AddedCatalogueApplication = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  platform: ApplicationPlatform,
  methodId: Schema.String,
  /** The catalogue OS target, for example `macos` or `windows`. */
  target: Schema.String,
  /** False when the tenant already had this title/method. */
  created: Schema.Boolean,
});

export type AddedCatalogueApplication = typeof AddedCatalogueApplication.Type;

export const AddCatalogueTitleResponse = Schema.Struct({
  applications: Schema.Array(AddedCatalogueApplication),
});

export type AddCatalogueTitleResponse = typeof AddCatalogueTitleResponse.Type;
