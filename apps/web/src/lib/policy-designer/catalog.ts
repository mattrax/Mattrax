export type PlatformId = "apple" | "android" | "windows";
export type PropertyType =
  | "string"
  | "integer"
  | "real"
  | "boolean"
  | "date"
  | "data"
  | "array"
  | "dictionary"
  | "enum"
  | "unknown";

export type Property = {
  key: string;
  name: string;
  type: PropertyType;
  description: string;
  defaultValue?: unknown;
  required?: boolean;
  enum?: Array<{ value: string; description?: string }>;
  deprecated?: boolean;
  minOs?: string;
  introducedIn?: string;
  children?: Property[];
  address?: string;
  scope?: "device" | "user" | "system";
  category?: string;
  pattern?: string;
  min?: number;
  max?: number;
  source?: string;
};

export type Collection = {
  id: string;
  platform: PlatformId;
  kind: "profile" | "declaration" | "policy" | "csp";
  surface: string;
  identifier: string;
  name: string;
  description: string;
  group?: string;
  deprecated?: boolean;
  minOs?: string;
  osVersions?: string[];
  properties: Property[];
  source?: string;
};

export type CollectionSummary = {
  id: string;
  platform: PlatformId;
  kind: Collection["kind"];
  surface: string;
  identifier: string;
  name: string;
  group?: string;
  deprecated?: boolean;
  minOs?: string;
  propertyCount: number;
};

export type CatalogManifest = {
  generatedAt: string;
  sources: Array<{
    platform: PlatformId;
    name: string;
    url: string;
    license?: string;
    revision?: string;
  }>;
  platforms: Array<{
    id: PlatformId;
    name: string;
    short: string;
    description: string;
    docUrl: string;
  }>;
  stats: Record<PlatformId, { collections: number; properties: number }>;
  collections: CollectionSummary[];
};

export type PlatformData = { id: PlatformId; collections: Collection[] };

let manifestPromise: Promise<CatalogManifest> | undefined;
const platformPromises = new Map<PlatformId, Promise<PlatformData>>();

export const loadManifest = () => {
  manifestPromise ??= fetch("/catalog/manifest.json")
    .then((response) => {
      if (!response.ok)
        throw new Error(`Could not load the settings catalogue (${response.status})`);
      return response.json() as Promise<CatalogManifest>;
    })
    .catch((error) => {
      manifestPromise = undefined;
      throw error;
    });
  return manifestPromise;
};

export const loadPlatform = (platform: PlatformId) => {
  let promise = platformPromises.get(platform);
  if (!promise) {
    promise = fetch(`/catalog/${platform}.json`)
      .then((response) => {
        if (!response.ok)
          throw new Error(`Could not load ${platform} settings (${response.status})`);
        return response.json() as Promise<PlatformData>;
      })
      .catch((error) => {
        platformPromises.delete(platform);
        throw error;
      });
    platformPromises.set(platform, promise);
  }
  return promise;
};

export const searchCollections = (
  collections: CollectionSummary[],
  query: string,
): CollectionSummary[] => {
  const term = query.trim().toLowerCase();
  if (!term) return collections;
  const tokens = term.split(/\s+/).filter(Boolean);
  return collections
    .map((collection) => {
      const text =
        `${collection.name} ${collection.identifier} ${collection.group ?? ""}`.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        const index = text.indexOf(token);
        if (index === -1) return null;
        score += index === 0 ? 3 : 1;
      }
      return { collection, score };
    })
    .filter((value): value is { collection: CollectionSummary; score: number } => Boolean(value))
    .sort((a, b) => b.score - a.score || a.collection.name.localeCompare(b.collection.name))
    .map((value) => value.collection);
};

export const resetPlatformCache = (platform: PlatformId) => platformPromises.delete(platform);

/**
 * The raw catalogue repeats Windows properties that differ only by vector
 * placeholders (`{0}`), which cannot be applied as literal OMA-URIs, and it
 * repeats identical keys in a few CSPs. Keep one usable property per address or
 * key so a value maps to one SyncML command.
 */
export const collectionProperties = (collection: { properties: Property[] }): Property[] => {
  const seen = new Set<string>();
  return collection.properties.filter((property) => {
    if (property.address && /[{}]/.test(property.address)) return false;
    const identity = property.address ?? property.key;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
};

export const searchProperties = (collection: Collection, query: string): Property[] => {
  const term = query.trim().toLowerCase();
  const properties = collectionProperties(collection);
  if (!term) return properties;
  return properties.filter((property) =>
    `${property.name} ${property.key} ${property.address ?? ""} ${property.description}`
      .toLowerCase()
      .includes(term),
  );
};

export const typeLabel = (type: PropertyType) =>
  ({
    string: "String",
    integer: "Integer",
    real: "Number",
    boolean: "Boolean",
    date: "Date",
    data: "Data",
    array: "Array",
    dictionary: "Dictionary",
    enum: "Enum",
    unknown: "Value",
  })[type];
