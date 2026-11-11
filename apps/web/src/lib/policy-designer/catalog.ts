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
  /** File key when a platform ships one file per collection (Windows). */
  key?: string;
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

/**
 * Everything browse and collection-name search need for a platform. Windows
 * serves this as `/catalog/windows/index.json`; Apple and Android derive it from
 * their single-file catalogues so both paths behave the same.
 */
export type PlatformIndex = {
  platform: PlatformId;
  stats: { collections: number; properties: number };
  collections: CollectionSummary[];
};

/**
 * Per-property search text, keyed by collection id and then by the value key the
 * designer stores (`address` for Windows, `key` elsewhere). Windows fetches this
 * on the first query; other platforms build it from the loaded catalogue.
 */
export type SearchIndex = {
  platform: PlatformId;
  collections: Record<string, Array<[key: string, text: string]>>;
};

const fetchJson = <T>(url: string, label: string): Promise<T> =>
  fetch(url).then((response) => {
    if (!response.ok) throw new Error(`Could not load ${label} (${response.status})`);
    return response.json() as Promise<T>;
  });

let manifestPromise: Promise<CatalogManifest> | undefined;
const platformPromises = new Map<PlatformId, Promise<PlatformData>>();
const indexPromises = new Map<PlatformId, Promise<PlatformIndex>>();
const searchIndexPromises = new Map<PlatformId, Promise<SearchIndex>>();
const collectionPromises = new Map<string, Promise<Collection>>();

export const loadManifest = () => {
  manifestPromise ??= fetchJson<CatalogManifest>(
    "/catalog/manifest.json",
    "the settings catalogue",
  ).catch((error) => {
    manifestPromise = undefined;
    throw error;
  });
  return manifestPromise;
};

/**
 * Load a whole platform catalogue. Apple and Android still ship one file; the
 * Windows catalogue is split, so callers there use `loadPlatformIndex` and
 * `loadCollection` instead.
 */
export const loadPlatform = (platform: PlatformId) => {
  if (platform === "windows")
    return Promise.reject(
      new Error("Windows settings load incrementally; use loadPlatformIndex and loadCollection."),
    );
  let promise = platformPromises.get(platform);
  if (!promise) {
    promise = fetchJson<PlatformData>(`/catalog/${platform}.json`, `${platform} settings`).catch(
      (error) => {
        platformPromises.delete(platform);
        throw error;
      },
    );
    platformPromises.set(platform, promise);
  }
  return promise;
};

const summarizePlatform = (data: PlatformData): PlatformIndex => ({
  platform: data.id,
  stats: {
    collections: data.collections.length,
    properties: data.collections.reduce((total, item) => total + item.properties.length, 0),
  },
  collections: data.collections.map((collection) => ({
    id: collection.id,
    platform: collection.platform,
    kind: collection.kind,
    surface: collection.surface,
    identifier: collection.identifier,
    name: collection.name,
    group: collection.group,
    deprecated: collection.deprecated,
    minOs: collection.minOs,
    propertyCount: collection.properties.length,
  })),
});

export const loadPlatformIndex = (platform: PlatformId) => {
  let promise = indexPromises.get(platform);
  if (!promise) {
    promise = (
      platform === "windows"
        ? fetchJson<Omit<PlatformIndex, "platform">>(
            "/catalog/windows/index.json",
            "the Windows settings index",
          ).then((file) => ({
            platform,
            stats: file.stats,
            collections: file.collections.map((collection) => ({ ...collection, platform })),
          }))
        : loadPlatform(platform).then(summarizePlatform)
    ).catch((error) => {
      indexPromises.delete(platform);
      throw error;
    });
    indexPromises.set(platform, promise);
  }
  return promise;
};

/** Stable file name used by the split Windows catalogue. Mirrors the build script. */
export const collectionFileKey = (collectionId: string) => {
  if (!/^[A-Za-z0-9._/-]+$/.test(collectionId))
    throw new Error(`Invalid collection id ${JSON.stringify(collectionId)}`);
  return collectionId.replaceAll("/", "--");
};

export const loadCollection = (platform: PlatformId, collectionId: string) => {
  const cacheKey = `${platform}:${collectionId}`;
  let promise = collectionPromises.get(cacheKey);
  if (!promise) {
    promise = (
      platform === "windows"
        ? fetchJson<Collection>(
            `/catalog/windows/${collectionFileKey(collectionId)}.json`,
            `${collectionId} settings`,
          )
        : loadPlatform(platform).then((data) => {
            const collection = data.collections.find((item) => item.id === collectionId);
            if (!collection) throw new Error(`The catalogue does not include ${collectionId}`);
            return collection;
          })
    ).catch((error) => {
      collectionPromises.delete(cacheKey);
      throw error;
    });
    collectionPromises.set(cacheKey, promise);
  }
  return promise;
};

/** The identity a selection stores for a property; mirrors `valueKey` in `build.ts`. */
const searchValueKey = (property: Property, platform: PlatformId) =>
  platform === "windows" ? (property.address ?? property.key) : property.key;

const buildSearchIndex = (data: PlatformData): SearchIndex => ({
  platform: data.id,
  collections: Object.fromEntries(
    data.collections.map((collection) => [
      collection.id,
      collectionProperties(collection).map((property) => [
        searchValueKey(property, data.id),
        searchableText(property),
      ]),
    ]),
  ),
});

export const loadSearchIndex = (platform: PlatformId) => {
  let promise = searchIndexPromises.get(platform);
  if (!promise) {
    promise = (
      platform === "windows"
        ? fetchJson<SearchIndex>("/catalog/windows/search.json", "the settings search index")
        : loadPlatform(platform).then(buildSearchIndex)
    ).catch((error) => {
      searchIndexPromises.delete(platform);
      throw error;
    });
    searchIndexPromises.set(platform, promise);
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

/**
 * Property-level matches from the lazily loaded search index, without any of the
 * collection payloads. Keys are collection ids; values are the value keys that
 * matched every query token.
 */
export const searchIndexProperties = (index: SearchIndex, query: string) => {
  const term = query.trim().toLowerCase();
  const results = new Map<string, Set<string>>();
  if (!term) return results;
  const tokens = term.split(/\s+/).filter(Boolean);
  for (const [collectionId, properties] of Object.entries(index.collections)) {
    const matches = new Set<string>();
    for (const [key, text] of properties) {
      if (tokens.every((token) => text.includes(token))) matches.add(key);
    }
    if (matches.size > 0) results.set(collectionId, matches);
  }
  return results;
};

export const resetPlatformCache = (platform: PlatformId) => {
  platformPromises.delete(platform);
  indexPromises.delete(platform);
  searchIndexPromises.delete(platform);
  for (const key of collectionPromises.keys())
    if (key.startsWith(`${platform}:`)) collectionPromises.delete(key);
};

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

/** Lowercased, whitespace-collapsed text that property search matches against. */
export const searchableText = (property: Property) =>
  `${property.name} ${property.key} ${property.address ?? ""} ${property.description ?? ""}`
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export const searchProperties = (collection: Collection, query: string): Property[] => {
  const term = query.trim().toLowerCase();
  const properties = collectionProperties(collection);
  if (!term) return properties;
  return properties.filter((property) => searchableText(property).includes(term));
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
