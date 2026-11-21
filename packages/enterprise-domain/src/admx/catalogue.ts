import type { AdmxCatalogueEntry, AdmxCatalogueIndex, AdmxCatalogueMatch } from "./types.js";

/**
 * Matching imported ADMX policies against the Windows settings catalogue.
 *
 * Microsoft exposes its in-box administrative templates through the Policy CSP
 * as `.../Config/ADMX_<area>/<PolicyName>`. The area name is Microsoft's own
 * (it is not present in the ADMX file), so matching is by policy name and
 * machine/user class, with the template namespace used to break ties.
 *
 * The catalogue is 17 MB, so the split script writes a compact lookup
 * (`windows/admx.json`) instead of making the browser download every
 * administrative-template collection just to import one file.
 */

const ADMX_OMA_URI = /^\.\/(Device|User)\/Vendor\/MSFT\/Policy\/Config\/([^/]+)\/([^/]+)$/i;

/** Bumped if the generated lookup shape changes incompatibly. */
export const ADMX_CATALOGUE_INDEX_VERSION = 1;

export type AdmxCatalogueCollection = {
  readonly id: string;
  /** The catalogue group; `Administrative Templates` marks ADMX-backed settings. */
  readonly group?: string;
  readonly properties?: ReadonlyArray<{
    readonly address?: string;
  }>;
};

/**
 * Extract ADMX-backed Policy CSP addresses.
 *
 * `ADMX_*` areas are the bulk of Microsoft's administrative templates, but
 * Windows also exposes some templates under their own area (`DeviceInstallation`,
 * `InternetExplorer`). The catalogue groups those under
 * `Administrative Templates`, which distinguishes them from ordinary CSP
 * settings whose names might collide with an ADMX policy.
 */
export const buildAdmxCatalogueIndex = (
  collections: readonly AdmxCatalogueCollection[],
): AdmxCatalogueIndex => {
  const seen = new Set<string>();
  const byPolicy = new Map<string, AdmxCatalogueEntry[]>();

  for (const collection of collections)
    for (const property of collection.properties ?? []) {
      const address = property.address;

      if (!address || /[{}]/.test(address)) continue;

      const match = ADMX_OMA_URI.exec(address);

      if (!match) continue;

      const area = match[2];

      if (!/^ADMX_/i.test(area) && collection.group !== "Administrative Templates") continue;

      const normalised = address.toLowerCase();

      if (seen.has(normalised)) continue;
      seen.add(normalised);

      const entry: AdmxCatalogueEntry = {
        area,
        scope: match[1].toLowerCase() === "user" ? "user" : "device",
        collectionId: collection.id,
        policyName: match[3],
      };

      const key = entry.policyName.toLowerCase();
      const entries = byPolicy.get(key) ?? [];

      entries.push(entry);
      byPolicy.set(key, entries);
    }

  // Deterministic output: the split script checks the committed file byte for
  // byte, and tests compare the map without relying on insertion order.
  const policies: Record<string, AdmxCatalogueEntry[]> = {};

  for (const key of [...byPolicy.keys()].sort()) {
    const entries = byPolicy.get(key)!;

    entries.sort(
      (left, right) =>
        left.scope.localeCompare(right.scope) ||
        left.area.localeCompare(right.area) ||
        left.collectionId.localeCompare(right.collectionId),
    );
    policies[key] = entries;
  }

  return { version: ADMX_CATALOGUE_INDEX_VERSION, policies };
};

const scopeForClass = (className: "user" | "machine" | "both") =>
  className === "user" ? "user" : "device";

const hintsFor = (policy: {
  readonly namespace?: string;
  readonly prefix?: string;
  readonly fileName?: string;
}) => {
  const hints = new Set<string>();
  const namespace = policy.namespace?.split(".").filter(Boolean).pop();
  const normalize = (value: string) => value.toLowerCase().replaceAll(/[^a-z0-9]/g, "");

  if (namespace) hints.add(normalize(namespace));

  if (policy.prefix) hints.add(normalize(policy.prefix));

  if (policy.fileName) hints.add(normalize(policy.fileName.replace(/\.admx$/i, "")));

  return hints;
};

/**
 * Find the catalogue entry for an in-box policy.
 *
 * A name can appear in several areas (for example user and machine variants).
 * The policy class picks the scope, and the namespace/prefix pick the area when
 * they are still ambiguous. Anything left ambiguous is reported instead of
 * guessing an OMA-URI.
 */
export const matchAdmxCataloguePolicy = (
  policy: {
    readonly name: string;
    readonly className: "user" | "machine" | "both";
    readonly namespace?: string;
    readonly prefix?: string;
    readonly fileName?: string;
  },
  index: AdmxCatalogueIndex | undefined,
): AdmxCatalogueMatch => {
  if (!index)
    return {
      status: "unmatched",
      reason: "The in-box ADMX lookup could not be loaded, so this policy cannot be matched.",
    };

  const candidates = index.policies[policy.name.toLowerCase()] ?? [];

  if (candidates.length === 0)
    return {
      status: "unmatched",
      reason:
        "This Microsoft policy is not exposed by the Windows settings catalogue, and in-box templates cannot be ingested.",
    };

  const scope = scopeForClass(policy.className);
  const scoped = candidates.filter((entry) => entry.scope === scope);

  if (scoped.length === 0)
    return {
      status: "unmatched",
      reason: `The catalogue exposes this policy as ${candidates.map((entry) => entry.scope).join("/")} scope, but the template is ${scope} scope.`,
    };

  if (scoped.length === 1) return { status: "matched", entry: scoped[0] };

  const hints = hintsFor(policy);

  const preferred = scoped.filter((entry) => {
    const area = entry.area
      .toLowerCase()
      .replace(/^admx_/, "")
      .replaceAll(/[^a-z0-9]/g, "");

    return [...hints].some((hint) => hint !== "" && (area === hint || area.includes(hint)));
  });

  if (preferred.length === 1) return { status: "matched", entry: preferred[0] };

  return {
    status: "unmatched",
    reason: `The policy name matches ${scoped.length} catalogue areas (${scoped
      .map((entry) => entry.area)
      .join(", ")}); the template namespace does not identify one.`,
  };
};
