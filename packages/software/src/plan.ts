import { CATALOGUE_DEPLOYMENT_KIND_LABELS, CATALOGUE_PLATFORM_LABELS } from "./schema.js";
import type { CatalogueDeployment, CatalogueTitle } from "./schema.js";
import {
  CATALOGUE_VENDOR_URL_CAVEAT,
  catalogueMethodAvailability,
  catalogueMethodUsesVendorUrl,
  isCatalogueProductCode,
  methodName,
  normaliseCatalogueProductCode,
} from "./availability.js";
import { catalogueTitleById } from "./search.js";
import { CATALOGUE_TITLES } from "./titles.js";

/**
 * Turning a catalogue title into tenant application rows.
 *
 * This module is deliberately unaware of Effect and the HTTP contract: it is a
 * pure plan the API validates and writes, and the tests can exercise without a
 * database. It must never claim a deployment the existing delivery pipeline
 * cannot perform.
 */

export type CatalogueMethodSelection = {
  readonly methodId: string;
  /** Required when the method reports `needs-product-code`. */
  readonly productCode?: string;
  /** Optional installer version, particularly for a Windows MSI. */
  readonly version?: string;
};

export type PlannedCatalogueApplication = {
  readonly methodId: string;
  readonly platform: "apple" | "win" | "android";
  readonly target: string;
  readonly kind: string;
  readonly name: string;
  readonly source: "manifest" | "store" | "upload";
  readonly bundleId: string;
  readonly manifestUrl: string | null;
  readonly storeId: string | null;
  readonly version: string | null;
  readonly notes: string;
};

export type CataloguePlan =
  | { readonly ok: true; readonly applications: ReadonlyArray<PlannedCatalogueApplication> }
  | { readonly ok: false; readonly problem: string };

/**
 * Names must stay distinguishable when two methods share an OS target, for
 * example Slack's macOS App Store listing and macOS upload method. The target
 * alone was not enough; the kind disambiguates.
 */
const applicationName = (title: CatalogueTitle, method: CatalogueDeployment) => {
  const sameTarget = title.deployments.filter(
    (deployment) => deployment.target === method.target,
  ).length;
  const targetLabel = CATALOGUE_PLATFORM_LABELS[method.target];

  if (sameTarget > 1)
    return (
      title.name + " (" + targetLabel + " · " + CATALOGUE_DEPLOYMENT_KIND_LABELS[method.kind] + ")"
    );

  const targets = new Set(title.deployments.map((deployment) => deployment.target));

  return targets.size > 1 ? title.name + " (" + targetLabel + ")" : title.name;
};

const provenanceNotes = (title: CatalogueTitle, method: CatalogueDeployment) =>
  [
    "From the Mattrax software catalogue: " + title.name + " (" + title.id + "/" + method.id + ").",
    title.notes,
    method.note,
    catalogueMethodUsesVendorUrl(method) ? CATALOGUE_VENDOR_URL_CAVEAT : undefined,
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 2400);

/**
 * Validate a set of selected methods and produce the application rows to write.
 *
 * A method that needs an upload is allowed: the application row is created with
 * `source: upload` and the detail page asks for the signed package. A method
 * that the pipeline cannot deliver at all is rejected, not silently queued.
 */
export const planCatalogueAddition = (input: {
  readonly titleId: string;
  readonly methods: ReadonlyArray<CatalogueMethodSelection>;
  readonly titles?: ReadonlyArray<CatalogueTitle>;
}): CataloguePlan => {
  const title =
    (input.titles ?? CATALOGUE_TITLES).find((candidate) => candidate.id === input.titleId) ??
    (input.titles ? undefined : catalogueTitleById(input.titleId));

  if (!title) return { ok: false, problem: "Software catalogue title not found" };

  if (input.methods.length === 0)
    return { ok: false, problem: "Choose at least one deployment method" };

  const seen = new Set<string>();
  const applications: PlannedCatalogueApplication[] = [];

  for (const selection of input.methods) {
    if (seen.has(selection.methodId))
      return { ok: false, problem: "Each deployment method can only be chosen once" };

    seen.add(selection.methodId);

    const method = title.deployments.find((candidate) => candidate.id === selection.methodId);

    if (!method)
      return {
        ok: false,
        problem: '"' + title.name + '" has no deployment method "' + selection.methodId + '"',
      };

    const availability = catalogueMethodAvailability(method);

    if (availability.status === "unsupported")
      return { ok: false, problem: methodName(method) + ": " + availability.reason };

    let productCode: string | null = null;

    if (availability.status === "needs-product-code") {
      const supplied = selection.productCode?.trim() ?? "";

      if (!supplied)
        return {
          ok: false,
          problem: methodName(method) + ": enter the MSI ProductCode from the vendor package",
        };

      if (!isCatalogueProductCode(supplied))
        return {
          ok: false,
          problem:
            "The MSI ProductCode must be a balanced GUID, for example {00000000-0000-0000-0000-000000000000}",
        };

      productCode = normaliseCatalogueProductCode(supplied);
    }

    const version = selection.version?.trim().slice(0, 100) || null;

    switch (method.kind) {
      case "apple-app-store":
        applications.push({
          methodId: method.id,
          kind: method.kind,
          platform: "apple",
          target: method.target,
          name: applicationName(title, method),
          source: "store",
          bundleId: method.bundleId!,
          manifestUrl: null,
          storeId: method.storeId!,
          version,
          notes: provenanceNotes(title, method),
        });
        break;
      case "apple-pkg":
        applications.push({
          methodId: method.id,
          kind: method.kind,
          platform: "apple",
          target: method.target,
          name: applicationName(title, method),
          source: "manifest",
          bundleId: method.bundleId!,
          manifestUrl: method.url!,
          storeId: null,
          version,
          notes: provenanceNotes(title, method),
        });
        break;
      case "apple-upload":
        applications.push({
          methodId: method.id,
          kind: method.kind,
          platform: "apple",
          target: method.target,
          name: applicationName(title, method),
          source: "upload",
          bundleId: method.bundleId!,
          manifestUrl: null,
          storeId: null,
          version,
          notes: provenanceNotes(title, method),
        });
        break;
      case "windows-msi":
        applications.push({
          methodId: method.id,
          kind: method.kind,
          platform: "win",
          target: method.target,
          name: applicationName(title, method),
          source: "manifest",
          bundleId: productCode ?? method.productCode ?? "",
          manifestUrl: method.url!,
          storeId: null,
          version: version ?? "1.0.0",
          notes: provenanceNotes(title, method),
        });
        break;
      case "android-play":
        applications.push({
          methodId: method.id,
          kind: method.kind,
          platform: "android",
          target: method.target,
          name: applicationName(title, method),
          source: "store",
          bundleId: method.packageName!,
          manifestUrl: null,
          storeId: null,
          version,
          notes: provenanceNotes(title, method),
        });
        break;
      default:
        return {
          ok: false,
          problem: methodName(method) + " cannot be deployed by Mattrax yet",
        };
    }
  }

  return { ok: true, applications };
};
