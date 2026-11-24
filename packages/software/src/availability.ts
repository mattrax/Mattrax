import { CATALOGUE_DEPLOYMENT_KIND_LABELS, CATALOGUE_PLATFORM_LABELS } from "./schema.js";
import type { CatalogueDeployment } from "./schema.js";

/**
 * What the current delivery pipeline can do with a catalogue method.
 *
 * This module depends only on the catalogue schema. Search and the add plan both
 * import it, so a deployment's availability is answered once instead of being
 * reimplemented (or creating a search ↔ plan cycle).
 */
export type CatalogueMethodAvailability =
  | { readonly status: "ready"; readonly label: string }
  | { readonly status: "needs-product-code"; readonly label: string }
  | { readonly status: "needs-upload"; readonly label: string }
  | { readonly status: "unsupported"; readonly label: string; readonly reason: string };

/**
 * Every vendor URL method reaches the device without a Mattrax-recorded digest.
 * The caveat is appended to the application notes and shown in the catalogue so
 * an administrator cannot mistake a direct URL for a hash-pinned upload.
 */
export const CATALOGUE_VENDOR_URL_CAVEAT =
  "Vendor URL: Mattrax does not hash-verify these bytes. The vendor controls the package and version; upload a signed package instead if your organisation requires hash pinning.";

const bareProductCodePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The ProductCode must be a bare GUID or a balanced `{GUID}`. A lone brace is
 * rejected rather than silently trimmed, so a typo cannot become a different
 * product identity.
 */
export const isCatalogueProductCode = (value: string): boolean => {
  const trimmed = value.trim();
  const opens = trimmed.startsWith("{");
  const closes = trimmed.endsWith("}");

  if (opens !== closes) return false;

  const bare = opens ? trimmed.slice(1, -1) : trimmed;

  return bareProductCodePattern.test(bare);
};

/** Normalise a validated ProductCode to the CSP's `{UPPERCASE-GUID}` form. */
export const normaliseCatalogueProductCode = (value: string): string => {
  const trimmed = value.trim();
  const bare = trimmed.startsWith("{") && trimmed.endsWith("}") ? trimmed.slice(1, -1) : trimmed;

  return "{" + bare.toUpperCase() + "}";
};

const methodName = (method: CatalogueDeployment) =>
  CATALOGUE_PLATFORM_LABELS[method.target] + " · " + CATALOGUE_DEPLOYMENT_KIND_LABELS[method.kind];

export { methodName };

/** Whether the existing pipeline can deliver this method, and what it needs. */
export const catalogueMethodAvailability = (
  method: CatalogueDeployment,
): CatalogueMethodAvailability => {
  switch (method.kind) {
    case "apple-app-store":
      return method.storeId && method.bundleId
        ? { status: "ready", label: "App Store install" }
        : {
            status: "unsupported",
            label: "App Store install",
            reason: "The catalogue entry is missing its App Store id or bundle identifier.",
          };
    case "apple-pkg":
      return method.url && method.bundleId
        ? { status: "ready", label: "Vendor PKG install" }
        : {
            status: "unsupported",
            label: "Vendor PKG install",
            reason: "The catalogue entry is missing its PKG URL or bundle identifier.",
          };
    case "apple-upload":
      return method.bundleId
        ? { status: "needs-upload", label: "Requires a signed package upload" }
        : {
            status: "unsupported",
            label: "Requires a signed package upload",
            reason: "The catalogue entry is missing its bundle identifier.",
          };
    case "windows-msi":
      if (!method.url)
        return {
          status: "unsupported",
          label: "MSI over OMA-DM",
          reason: "The catalogue entry has no stable MSI URL.",
        };

      return method.requiresProductCode
        ? { status: "needs-product-code", label: "MSI over OMA-DM" }
        : { status: "ready", label: "MSI over OMA-DM" };
    case "android-play":
      return method.packageName
        ? { status: "ready", label: "Managed Google Play" }
        : {
            status: "unsupported",
            label: "Managed Google Play",
            reason: "The catalogue entry is missing its package name.",
          };
    case "windows-store":
      return {
        status: "unsupported",
        label: CATALOGUE_DEPLOYMENT_KIND_LABELS[method.kind],
        reason:
          "Windows Store delivery is not wired into the Windows management backend yet (#568).",
      };
    case "windows-msix":
      return {
        status: "unsupported",
        label: CATALOGUE_DEPLOYMENT_KIND_LABELS[method.kind],
        reason: "MSIX delivery is not wired into the Windows management backend yet (#568).",
      };
    case "windows-exe":
      return {
        status: "unsupported",
        label: CATALOGUE_DEPLOYMENT_KIND_LABELS[method.kind],
        reason:
          "EXE and Win32 installers need the mattraxd app path (#568); OMA-DM only installs MSIs.",
      };
    case "vendor-download":
      return {
        status: "unsupported",
        label: CATALOGUE_DEPLOYMENT_KIND_LABELS[method.kind],
        reason:
          "This vendor download still needs packaging into a signed PKG or MSI before Mattrax can deploy it.",
      };
  }
};

/** A vendor URL method whose bytes are not hash-pinned by Mattrax. */
export const catalogueMethodUsesVendorUrl = (method: CatalogueDeployment): boolean =>
  method.kind === "apple-pkg" || method.kind === "windows-msi";
