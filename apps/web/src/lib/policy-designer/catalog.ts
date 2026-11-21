import { Schema } from "effect";

export const PlatformId = Schema.Literals(["apple", "android", "windows"]);

export type PlatformId = typeof PlatformId.Type;

export const PropertyType = Schema.Literals([
  "string",
  "integer",
  "real",
  "boolean",
  "date",
  "data",
  "array",
  "dictionary",
  "enum",
  "unknown",
]);

export type PropertyType = typeof PropertyType.Type;

export const Property: Schema.Codec<Property, unknown> = Schema.Struct({
  key: Schema.String,
  name: Schema.String,
  type: PropertyType,
  description: Schema.String,
  defaultValue: Schema.optional(Schema.Json),
  required: Schema.optional(Schema.Boolean),
  enum: Schema.optional(
    Schema.Array(
      Schema.Struct({
        value: Schema.String,
        description: Schema.optional(Schema.String),
      }),
    ),
  ),
  deprecated: Schema.optional(Schema.Boolean),
  minOs: Schema.optional(Schema.String),
  introducedIn: Schema.optional(Schema.String),
  children: Schema.optional(Schema.Array(Schema.suspend(() => Property))),
  address: Schema.optional(Schema.String),
  /**
   * Storage key when the address is shared by several fields. ADMX-backed
   * policies deliver one XML payload per OMA-URI, so each element is stored
   * under its ADMX element id while the address stays the delivery target.
   */
  valueKey: Schema.optional(Schema.String),
  scope: Schema.optional(Schema.Literals(["device", "user", "system"])),
  category: Schema.optional(Schema.String),
  pattern: Schema.optional(Schema.String),
  min: Schema.optional(Schema.Number),
  max: Schema.optional(Schema.Number),
  source: Schema.optional(Schema.String),
});

export type Property = {
  readonly key: string;
  readonly name: string;
  readonly type: PropertyType;
  readonly description: string;
  readonly defaultValue?: Schema.Json;
  readonly required?: boolean;
  readonly enum?: ReadonlyArray<{ readonly value: string; readonly description?: string }>;
  readonly deprecated?: boolean;
  readonly minOs?: string;
  readonly introducedIn?: string;
  readonly children?: ReadonlyArray<Property>;
  readonly address?: string;
  readonly valueKey?: string;
  readonly scope?: "device" | "user" | "system";
  readonly category?: string;
  readonly pattern?: string;
  readonly min?: number;
  readonly max?: number;
  readonly source?: string;
};

export const Collection: Schema.Codec<Collection, unknown> = Schema.Struct({
  id: Schema.String,
  platform: PlatformId,
  kind: Schema.Literals(["profile", "declaration", "policy", "csp"]),
  surface: Schema.String,
  identifier: Schema.String,
  name: Schema.String,
  description: Schema.String,
  group: Schema.optional(Schema.String),
  deprecated: Schema.optional(Schema.Boolean),
  minOs: Schema.optional(Schema.String),
  osVersions: Schema.optional(Schema.Array(Schema.String)),
  properties: Schema.Array(Property),
  source: Schema.optional(Schema.String),
});

export type Collection = {
  readonly id: string;
  readonly platform: PlatformId;
  readonly kind: "profile" | "declaration" | "policy" | "csp";
  readonly surface: string;
  readonly identifier: string;
  readonly name: string;
  readonly description: string;
  readonly group?: string;
  readonly deprecated?: boolean;
  readonly minOs?: string;
  readonly osVersions?: ReadonlyArray<string>;
  readonly properties: ReadonlyArray<Property>;
  readonly source?: string;
};

export const CollectionSummary = Schema.Struct({
  id: Schema.String,
  platform: PlatformId,
  kind: Schema.Literals(["profile", "declaration", "policy", "csp"]),
  surface: Schema.String,
  identifier: Schema.String,
  name: Schema.String,
  group: Schema.optional(Schema.String),
  deprecated: Schema.optional(Schema.Boolean),
  minOs: Schema.optional(Schema.String),
  /** OS families the collection applies to (Apple publishes them per payload). */
  osVersions: Schema.optional(Schema.Array(Schema.String)),
  propertyCount: Schema.Number,
  /** File key when a platform ships one file per collection (Windows). */
  key: Schema.optional(Schema.String),
});

export type CollectionSummary = typeof CollectionSummary.Type;

export const CatalogManifest = Schema.Struct({
  generatedAt: Schema.String,
  sources: Schema.Array(
    Schema.Struct({
      platform: PlatformId,
      name: Schema.String,
      url: Schema.String,
      license: Schema.optional(Schema.String),
      revision: Schema.optional(Schema.String),
    }),
  ),
  platforms: Schema.Array(
    Schema.Struct({
      id: PlatformId,
      name: Schema.String,
      short: Schema.String,
      description: Schema.String,
      docUrl: Schema.String,
    }),
  ),
  stats: Schema.Record(
    Schema.Literals(["apple", "android", "windows"]),
    Schema.Struct({ collections: Schema.Number, properties: Schema.Number }),
  ),
  collections: Schema.Array(CollectionSummary),
});

export type CatalogManifest = typeof CatalogManifest.Type;

export const PlatformData: Schema.Codec<PlatformData, unknown> = Schema.Struct({
  id: PlatformId,
  collections: Schema.Array(Collection),
});

export type PlatformData = {
  readonly id: PlatformId;
  readonly collections: ReadonlyArray<Collection>;
};

/**
 * Everything browse and collection-name search need for a platform. Windows
 * serves this as `/catalog/windows/index.json`; Apple and Android derive it from
 * their single-file catalogues so both paths behave the same.
 */
export const PlatformIndex = Schema.Struct({
  platform: PlatformId,
  stats: Schema.Struct({ collections: Schema.Number, properties: Schema.Number }),
  collections: Schema.Array(CollectionSummary),
});

export type PlatformIndex = typeof PlatformIndex.Type;

/**
 * Per-property search text, keyed by collection id and then by the value key the
 * designer stores (`address` for Windows, `key` elsewhere). Windows fetches this
 * on the first query; other platforms build it from the loaded catalogue.
 */
export const SearchIndex = Schema.Struct({
  platform: PlatformId,
  collections: Schema.Record(
    Schema.String,
    Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
  ),
});

export type SearchIndex = typeof SearchIndex.Type;

const fetchJson = async <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  url: string,
  label: string,
): Promise<S["Type"]> => {
  const response = await fetch(url);

  if (!response.ok) throw new Error(`Could not load ${label} (${response.status})`);

  return Schema.decodeUnknownSync(schema)(await response.json());
};

/**
 * Apple's published `supportedOS` data, keyed by payload/declaration type. The
 * designer uses it to show the same OS range policy delivery enforces; a label
 * it cannot derive is left off rather than guessed.
 */
export const AppleOsSupportEntry = Schema.Struct({
  iOS: Schema.optional(Schema.Struct({ introduced: Schema.String })),
  iPadOS: Schema.optional(Schema.Struct({ introduced: Schema.String })),
  macOS: Schema.optional(Schema.Struct({ introduced: Schema.String })),
  tvOS: Schema.optional(Schema.Struct({ introduced: Schema.String })),
  visionOS: Schema.optional(Schema.Struct({ introduced: Schema.String })),
  watchOS: Schema.optional(Schema.Struct({ introduced: Schema.String })),
});

export const AppleOsSupportManifest = Schema.Struct({
  supportedOs: Schema.Record(Schema.String, AppleOsSupportEntry),
});

export type AppleOsSupportManifest = typeof AppleOsSupportManifest.Type;

let osSupportPromise: Promise<AppleOsSupportManifest> | undefined;

export const loadAppleOsSupport = () => {
  osSupportPromise ??= fetchJson(
    AppleOsSupportManifest,
    "/catalog/apple-supported-os.json",
    "Apple OS support metadata",
  ).catch((error: unknown) => {
    osSupportPromise = undefined;
    throw error;
  });

  return osSupportPromise;
};

const OS_LABEL_ORDER = ["macOS", "iOS", "tvOS", "watchOS", "visionOS"] as const;

/**
 * The OS range a collection applies to, for example `macOS 14+ · iOS 17+`.
 *
 * Falls back to the catalogue's earliest minimum when Apple publishes no
 * `supportedOS` block (custom payloads), and returns null when neither is
 * known — no label is better than one delivery does not honour.
 */
export const appleOsRangeLabel = (
  collection: Pick<Collection, "identifier" | "minOs">,
  support: AppleOsSupportManifest | undefined,
): string | null => {
  const entry = support?.supportedOs[collection.identifier];

  if (entry) {
    const parts: string[] = [];

    for (const family of OS_LABEL_ORDER) {
      const introduced =
        entry[family]?.introduced ?? (family === "iOS" ? entry.iPadOS?.introduced : undefined);

      if (introduced) parts.push(`${family} ${introduced}+`);
    }

    if (parts.length > 0) return parts.join(" · ");
  }

  return collection.minOs ? `${collection.minOs}+` : null;
};

/**
 * Apple OS families Mattrax manages devices on. A payload that only supports
 * watchOS/tvOS/visionOS would never be delivered to a Mac or iPhone, so the
 * designer blocks it instead of letting it look configured.
 */
export const appleCollectionManaged = (osVersions: ReadonlyArray<string> | undefined) =>
  osVersions === undefined ||
  osVersions.length === 0 ||
  osVersions.some((family) => /^(macos|ios|ipados)$/i.test(family));

let manifestPromise: Promise<CatalogManifest> | undefined;

const platformPromises = new Map<PlatformId, Promise<PlatformData>>();

const indexPromises = new Map<PlatformId, Promise<PlatformIndex>>();

const searchIndexPromises = new Map<PlatformId, Promise<SearchIndex>>();

const collectionPromises = new Map<string, Promise<Collection>>();

export const loadManifest = () => {
  manifestPromise ??= fetchJson(
    CatalogManifest,
    "/catalog/manifest.json",
    "the settings catalogue",
  ).catch((error: unknown) => {
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
    promise = fetchJson(PlatformData, `/catalog/${platform}.json`, `${platform} settings`).catch(
      (error: unknown) => {
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
    osVersions: collection.osVersions,
    propertyCount: collection.properties.length,
  })),
});

export const WindowsCollectionSummary = Schema.Struct({
  id: Schema.String,
  platform: Schema.optional(PlatformId),
  kind: Schema.Literals(["profile", "declaration", "policy", "csp"]),
  surface: Schema.String,
  identifier: Schema.String,
  name: Schema.String,
  group: Schema.optional(Schema.String),
  deprecated: Schema.optional(Schema.Boolean),
  minOs: Schema.optional(Schema.String),
  propertyCount: Schema.Number,
  key: Schema.optional(Schema.String),
});

export const WindowsPlatformIndex = Schema.Struct({
  platform: PlatformId,
  stats: Schema.Struct({ collections: Schema.Number, properties: Schema.Number }),
  collections: Schema.Array(WindowsCollectionSummary),
});

export const loadPlatformIndex = (platform: PlatformId) => {
  let promise = indexPromises.get(platform);

  if (!promise) {
    promise = (
      platform === "windows"
        ? fetchJson(
            WindowsPlatformIndex,
            "/catalog/windows/index.json",
            "the Windows settings index",
          ).then((file) => ({
            platform,
            stats: file.stats,
            collections: file.collections.map((collection) => ({ ...collection, platform })),
          }))
        : loadPlatform(platform).then(summarizePlatform)
    ).catch((error: unknown) => {
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
        ? fetchJson(
            Collection,
            `/catalog/windows/${collectionFileKey(collectionId)}.json`,
            `${collectionId} settings`,
          )
        : loadPlatform(platform).then((data) => {
            const collection = data.collections.find((item) => item.id === collectionId);

            if (!collection) throw new Error(`The catalogue does not include ${collectionId}`);

            return collection;
          })
    ).catch((error: unknown) => {
      collectionPromises.delete(cacheKey);
      throw error;
    });
    collectionPromises.set(cacheKey, promise);
  }

  return promise;
};

/** The identity a selection stores for a property; mirrors `valueKey` in `build.ts`. */
const searchValueKey = (property: Property, platform: PlatformId) =>
  property.valueKey ?? (platform === "windows" ? (property.address ?? property.key) : property.key);

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
        ? fetchJson(SearchIndex, "/catalog/windows/search.json", "the settings search index")
        : loadPlatform(platform).then(buildSearchIndex)
    ).catch((error: unknown) => {
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
    .flatMap((collection) => {
      const text =
        `${collection.name} ${collection.identifier} ${collection.group ?? ""}`.toLowerCase();

      let score = 0;

      for (const token of tokens) {
        const index = text.indexOf(token);

        if (index === -1) return [];
        score += index === 0 ? 3 : 1;
      }

      return [{ collection, score }];
    })
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
export const collectionProperties = (collection: {
  properties: ReadonlyArray<Property>;
}): Property[] => {
  const seen = new Set<string>();

  return collection.properties.filter((property) => {
    if (property.address && /[{}]/.test(property.address)) return false;
    const identity = property.valueKey ?? property.address ?? property.key;

    if (seen.has(identity)) return false;
    seen.add(identity);

    return true;
  });
};

/** Lowercased, whitespace-collapsed text that property search matches against. */
export const searchableText = (property: Property) =>
  `${property.name} ${property.key} ${property.address ?? ""} ${property.description ?? ""}`
    .toLowerCase()
    .replaceAll(/\s+/g, " ")
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
