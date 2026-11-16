#!/usr/bin/env node
/**
 * Split the generated Windows policy catalogue into pieces the designer can
 * load on demand:
 *
 *   apps/web/public/catalog/windows/index.json     collection summaries (~130 KB)
 *   apps/web/public/catalog/windows/<key>.json     one full collection each
 *   apps/web/public/catalog/windows/search.json    lazily fetched property text
 *
 * The source catalogue stays outside `public/` so the browser never downloads
 * it; regenerate the split files with:
 *
 *   node scripts/split-policy-catalog.ts
 *
 * The output is deterministic: collections are sorted by id, properties keep
 * the source order and no timestamps are written. `--check` verifies that the
 * committed output is up to date without writing anything.
 */
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULT_SOURCE = path.join(ROOT, "data/catalog/windows.json");
export const DEFAULT_OUT = path.join(ROOT, "apps/web/public/catalog/windows");

/** One setting in a generated collection. */
interface CatalogueProperty {
  key: string;
  name?: string;
  address?: string;
  description?: string;
  children?: CatalogueProperty[];
}

/** One collection in the generated Windows catalogue. */
interface CatalogueCollection {
  id: string;
  kind: string;
  surface: string;
  identifier: string;
  name: string;
  description?: string;
  group?: string;
  deprecated?: boolean;
  minOs?: string;
  properties?: CatalogueProperty[];
}

interface CollectionSummary {
  key: string;
  id: string;
  kind: string;
  surface: string;
  identifier: string;
  name: string;
  propertyCount: number;
  group?: string;
  deprecated?: true;
  minOs?: string;
}

interface WindowsIndex {
  platform: "windows";
  stats: { collections: number; properties: number };
  collections: CollectionSummary[];
}

interface SearchIndex {
  platform: "windows";
  collections: Record<string, [string, string][]>;
}

interface SplitWindowsCatalogue {
  files: Map<string, string>;
  index: WindowsIndex;
  stats: WindowsIndex["stats"];
}

interface WriteSplitResult {
  files: Map<string, string>;
  stats: WindowsIndex["stats"];
  out: string;
}

export interface SplitOptions {
  source?: string;
  out?: string;
}

interface CliOptions {
  source: string;
  out: string;
  check: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Stable, URL-safe file name for a collection id. `windows/settings/above-lock`
 * becomes `windows--settings--above-lock.json`; ids never contain `--`, so the
 * mapping is reversible.
 */
export const collectionFileKey = (id: string): string => {
  if (!/^[A-Za-z0-9._/-]+$/.test(id))
    throw new Error(`Collection id ${JSON.stringify(id)} cannot be used as a file name`);

  return id.replaceAll("/", "--");
};

/**
 * The raw catalogue repeats Windows properties that differ only by vector
 * placeholders (`{0}`), which cannot be applied as literal OMA-URIs, and it
 * repeats identical keys in a few CSPs. Mirrors `collectionProperties` in
 * `apps/web/src/lib/policy-designer/catalog.ts` so the search index only covers
 * settings the designer can actually render.
 */
const usableProperties = (collection: CatalogueCollection): CatalogueProperty[] => {
  const seen = new Set<string>();

  return (collection.properties ?? []).filter((property) => {
    if (property.address && /[{}]/.test(property.address)) return false;
    const identity = property.address ?? property.key;

    if (seen.has(identity)) return false;
    seen.add(identity);

    return true;
  });
};

/** Lowercased, whitespace-collapsed text the browser matches query tokens against. */
const searchableText = (property: CatalogueProperty): string =>
  `${property.name ?? ""} ${property.key ?? ""} ${property.address ?? ""} ${
    property.description ?? ""
  }`
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const summarize = (collection: CatalogueCollection): CollectionSummary => {
  const summary: CollectionSummary = {
    key: collectionFileKey(collection.id),
    id: collection.id,
    kind: collection.kind,
    surface: collection.surface,
    identifier: collection.identifier,
    name: collection.name,
    propertyCount: usableProperties(collection).length,
  };

  // Optional fields are omitted rather than written as null so the index stays
  // small and diff-friendly. Collection descriptions stay in the per-collection
  // payload: browse never needs them.
  if (collection.group) summary.group = collection.group;

  if (collection.deprecated) summary.deprecated = true;

  if (collection.minOs) summary.minOs = collection.minOs;

  return summary;
};

/**
 * Build every output file in memory. Returns a map of file name to contents so
 * tests can inspect the split without touching the served assets.
 */
export const splitWindowsCatalog = (catalogue: unknown): SplitWindowsCatalogue => {
  if (!isRecord(catalogue))
    throw new Error("Expected a Windows platform catalogue with a collections array");

  // The source file identifies the platform as `id`; older exports use `platform`.
  if ((catalogue.platform ?? catalogue.id) !== "windows" || !Array.isArray(catalogue.collections))
    throw new Error("Expected a Windows platform catalogue with a collections array");

  // Collections are written by `catalog-sync` and match the `Collection` schema
  // the web app decodes; the checks above are the parse-boundary guard.
  // SAFETY: the collections array check above establishes the entry container;
  // each entry is the generated `Collection` payload.
  const collections = [...(catalogue.collections as CatalogueCollection[])].sort((a, b) =>
    a.id.localeCompare(b.id),
  );

  const seen = new Set<string>();

  for (const collection of collections) {
    if (seen.has(collection.id))
      throw new Error(`Duplicate collection id ${JSON.stringify(collection.id)}`);
    seen.add(collection.id);
  }

  const files = new Map<string, string>();
  const search: SearchIndex = { platform: "windows", collections: {} };
  let propertyCount = 0;

  for (const collection of collections) {
    const key = collectionFileKey(collection.id);
    files.set(`${key}.json`, `${JSON.stringify(collection)}\n`);

    const properties = usableProperties(collection).map((property): [string, string] => [
      property.address ?? property.key,
      searchableText(property),
    ]);

    search.collections[collection.id] = properties;
    propertyCount += properties.length;
  }

  const index: WindowsIndex = {
    platform: "windows",
    stats: { collections: collections.length, properties: propertyCount },
    collections: collections.map(summarize),
  };

  files.set("index.json", `${JSON.stringify(index)}\n`);
  files.set("search.json", `${JSON.stringify(search)}\n`);

  return { files, index, stats: index.stats };
};

/** Read the catalogue; `splitWindowsCatalog` validates the parsed shape. */
const readCatalogue = async (source: string): Promise<unknown> =>
  JSON.parse(await readFile(source, "utf8"));

/** Write the split, removing stale collection files from a previous run. */
export const writeSplit = async ({
  source = DEFAULT_SOURCE,
  out = DEFAULT_OUT,
}: SplitOptions = {}): Promise<WriteSplitResult> => {
  const catalogue = await readCatalogue(source);
  const { files, stats } = splitWindowsCatalog(catalogue);

  await mkdir(out, { recursive: true });
  const existing = await readdir(out);

  for (const name of existing) {
    if (name.endsWith(".json") && !files.has(name)) await rm(path.join(out, name));
  }

  for (const [name, contents] of files) await writeFile(path.join(out, name), contents);

  return { files, stats, out };
};

/** Exit non-zero when the committed split differs from a fresh build. */
export const checkSplit = async ({
  source = DEFAULT_SOURCE,
  out = DEFAULT_OUT,
}: SplitOptions = {}): Promise<string[]> => {
  const catalogue = await readCatalogue(source);
  const { files } = splitWindowsCatalog(catalogue);
  const existing = new Set((await readdir(out)).filter((name) => name.endsWith(".json")));
  const problems: string[] = [];

  for (const [name, contents] of files) {
    if (!existing.has(name)) {
      problems.push(`missing ${name}`);
      continue;
    }

    const current = await readFile(path.join(out, name), "utf8");

    if (current !== contents) problems.push(`stale ${name}`);
  }

  for (const name of existing) if (!files.has(name)) problems.push(`unexpected ${name}`);

  return problems;
};

const formatBytes = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(2)} MB`
    : `${(bytes / 1024).toFixed(1)} KB`;

const parseArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = { source: DEFAULT_SOURCE, out: DEFAULT_OUT, check: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--check") options.check = true;
    else if (arg === "--source") options.source = path.resolve(argv[++index]);
    else if (arg === "--out") options.out = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument ${arg}`);
  }

  return options;
};

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));

  if (options.check) {
    const problems = await checkSplit(options);

    if (problems.length > 0) {
      console.error(`The split Windows catalogue is out of date:\n  ${problems.join("\n  ")}`);
      process.exit(1);
    }

    console.log("The split Windows catalogue is up to date.");

    return;
  }

  const { files, stats } = await writeSplit(options);

  const sizes = [...files.entries()].map(([name, contents]): [string, number] => [
    name,
    Buffer.byteLength(contents),
  ]);

  const total = sizes.reduce((sum, [, bytes]) => sum + bytes, 0);
  const indexBytes = sizes.find(([name]) => name === "index.json")?.[1] ?? 0;
  const searchBytes = sizes.find(([name]) => name === "search.json")?.[1] ?? 0;

  console.log(
    `Wrote ${stats.collections} collections (${stats.properties} searchable settings) to ${path.relative(ROOT, options.out)}`,
  );
  console.log(`  index.json  ${formatBytes(indexBytes)}`);
  console.log(`  search.json ${formatBytes(searchBytes)} (loaded only when searching)`);
  console.log(`  collections ${formatBytes(total - indexBytes - searchBytes)} total`);
};

const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
