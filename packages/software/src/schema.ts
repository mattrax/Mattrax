import { Schema } from "effect";

/**
 * The curated software catalogue's data contract.
 *
 * A title is vendor software an administrator may want on a managed fleet. It
 * carries only facts we can cite: vendor, identifiers, store ids and vendor
 * download pages. Installer versions and hashes are deliberately absent — a
 * vendor "latest" URL has neither, and inventing them would make the catalogue
 * look more certain than it is. Version pinning and released-package hashes
 * arrive with the catalogue feed in #589.
 */

export const CATALOGUE_PLATFORMS = [
  "macos",
  "windows",
  "ios",
  "ipados",
  "android",
  "tvos",
  "visionos",
  "web",
] as const;

export const CataloguePlatform = Schema.Literals(CATALOGUE_PLATFORMS);

export type CataloguePlatform = typeof CataloguePlatform.Type;

export const CATALOGUE_PLATFORM_LABELS: Readonly<Record<CataloguePlatform, string>> = {
  macos: "macOS",
  windows: "Windows",
  ios: "iOS",
  ipados: "iPadOS",
  android: "Android",
  tvos: "tvOS",
  visionos: "visionOS",
  web: "Web",
};

export const CATALOGUE_CATEGORIES = [
  "browsers",
  "communication",
  "productivity",
  "developer",
  "security",
  "media",
  "utilities",
  "education",
  "business",
  "remote-support",
] as const;

export const CatalogueCategory = Schema.Literals(CATALOGUE_CATEGORIES);

export type CatalogueCategory = typeof CatalogueCategory.Type;

export const CATALOGUE_CATEGORY_LABELS: Readonly<Record<CatalogueCategory, string>> = {
  browsers: "Browsers",
  communication: "Communication",
  productivity: "Productivity",
  developer: "Developer",
  security: "Security",
  media: "Media and design",
  utilities: "Utilities",
  education: "Education",
  business: "Business",
  "remote-support": "Remote support",
};

/** The MDM protocol that ultimately carries a deployment. */
export const CatalogueMdmPlatform = Schema.Literals(["apple", "win", "android"]);

export type CatalogueMdmPlatform = typeof CatalogueMdmPlatform.Type;

export const CATALOGUE_MDM_PLATFORM_LABELS: Readonly<Record<CatalogueMdmPlatform, string>> = {
  apple: "Apple",
  win: "Windows",
  android: "Android",
};

/**
 * How a title reaches a device.
 *
 * The kinds map onto the existing delivery pipeline rather than a parallel
 * installer:
 *
 * - `apple-app-store` → catalogue source `store` (VPP when configured)
 * - `apple-pkg` → a vendor PKG installed with `InstallEnterpriseApplication`
 * - `apple-upload` → an admin-supplied, signed PKG/IPA uploaded to the entry
 * - `windows-msi` → `EnterpriseDesktopAppManagement` over OMA-DM
 * - `android-play` → Managed Google Play application policy
 * - store/MSIX/EXE and DMG kinds are catalogued but have no delivery path yet
 */
export const CATALOGUE_DEPLOYMENT_KINDS = [
  "apple-app-store",
  "apple-pkg",
  "apple-upload",
  "windows-msi",
  "windows-store",
  "windows-msix",
  "windows-exe",
  "android-play",
  "vendor-download",
] as const;

export const CatalogueDeploymentKind = Schema.Literals(CATALOGUE_DEPLOYMENT_KINDS);

export type CatalogueDeploymentKind = typeof CatalogueDeploymentKind.Type;

export const CATALOGUE_DEPLOYMENT_KIND_LABELS: Readonly<Record<CatalogueDeploymentKind, string>> = {
  "apple-app-store": "Apple App Store",
  "apple-pkg": "Vendor PKG",
  "apple-upload": "Upload a signed package",
  "windows-msi": "MSI over OMA-DM",
  "windows-store": "Microsoft Store",
  "windows-msix": "MSIX package",
  "windows-exe": "Vendor EXE",
  "android-play": "Managed Google Play",
  "vendor-download": "Vendor download",
};

export const CatalogueDeployment = Schema.Struct({
  /** Stable within the title; a tenant application records this for provenance. */
  id: Schema.String,
  /** The MDM platform that delivers the method. */
  platform: CatalogueMdmPlatform,
  /** The operating system the method installs on. */
  target: CataloguePlatform,
  kind: CatalogueDeploymentKind,
  /** Vendor PKG/MSI/EXE/DMG URL or the vendor download page. */
  url: Schema.optional(Schema.String),
  /** Numeric Apple App Store id (Apple's `trackId`). */
  storeId: Schema.optional(Schema.String),
  /** Microsoft Store product id (for example `9N0DX20HK701`). */
  microsoftStoreId: Schema.optional(Schema.String),
  /** Apple bundle identifier used to reconcile inventory. */
  bundleId: Schema.optional(Schema.String),
  /** Managed Google Play package name. */
  packageName: Schema.optional(Schema.String),
  /** A vendor-published ProductCode, when one exists and is stable. */
  productCode: Schema.optional(Schema.String),
  /**
   * The vendor MSI does not publish a stable ProductCode, so the administrator
   * must read it from the MSI and supply it when adding the title.
   */
  requiresProductCode: Schema.optional(Schema.Boolean),
  /** Human-readable limits, packaging steps or channel caveats. */
  note: Schema.optional(Schema.String),
});

export type CatalogueDeployment = typeof CatalogueDeployment.Type;

export const CatalogueTitle = Schema.Struct({
  /** Stable slug. Tenant provenance stores this, so never rename it casually. */
  id: Schema.String,
  name: Schema.String,
  vendor: Schema.String,
  description: Schema.String,
  category: CatalogueCategory,
  /** Alternate names and common abbreviations used by search. */
  aliases: Schema.Array(Schema.String),
  website: Schema.String,
  /** Every platform the vendor publishes the app for. */
  platforms: Schema.Array(CataloguePlatform),
  deployments: Schema.Array(CatalogueDeployment),
  /** Cross-platform limits that do not belong to one method. */
  notes: Schema.optional(Schema.String),
  /** Editorial default-ordering weight; higher sorts first on an empty query. */
  popularity: Schema.Number,
});

export type CatalogueTitle = typeof CatalogueTitle.Type;

export const CATALOGUE_VERSION = 1;

/** Last time the catalogue data was checked against the vendor/store sources. */
export const CATALOGUE_VERIFIED_AT = "2026-11-24";

export const CATALOGUE_PROVENANCE =
  "Vendor download pages, Apple's public iTunes lookup API and Microsoft Store listings, checked on " +
  CATALOGUE_VERIFIED_AT +
  ". Store ids are global where the vendor publishes one record; availability still varies by storefront.";
