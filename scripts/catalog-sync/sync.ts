#!/usr/bin/env node
/**
 * Regenerate the policy catalogue from the vendors' published sources.
 *
 *   pnpm catalog:sync
 *
 * Apple and Android are written as one JSON file each; Windows is written to
 * `data/catalog/windows.json` and then split into the files the designer loads.
 * The output only changes when an upstream source changes (plus `generatedAt`).
 *
 * See `docs/reference/catalogue-sources.md` for the sources and licensing.
 */
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadAndroid } from "./android.ts";
import { loadApple } from "./apple.ts";
import { countProperties, PLATFORMS, type Collection, type PlatformId } from "./catalog.ts";
import { fetchJson, writeJson } from "./util.ts";
import { loadWindows } from "./windows.ts";
import { writeSplit } from "../split-policy-catalog.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const CATALOG_DIR = path.join(ROOT, "apps/web/public/catalog");

const WINDOWS_SOURCE = path.join(ROOT, "data/catalog/windows.json");

const WINDOWS_SPLIT = path.join(CATALOG_DIR, "windows");

interface SourceRecord {
  platform: PlatformId;
  name: string;
  url: string;
  license: string;
  revision: string | undefined;
}

interface CollectionSummary {
  id: string;
  platform: PlatformId;
  kind: Collection["kind"];
  surface: string;
  identifier: string;
  name: string;
  group?: string;
  deprecated?: boolean;
  minOs?: string;
  osVersions?: string[];
  propertyCount: number;
}

const summarize = (collections: readonly Collection[]): CollectionSummary[] =>
  collections.map((collection) => ({
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
    propertyCount: countProperties(collection.properties),
  }));

const windowsRevision = async (): Promise<string | undefined> => {
  try {
    const data = await fetchJson(
      "https://github.com/royklo/IntuneSettingsCatalogData/releases/download/latest/last-updated.json",
      "windows/last-updated.json",
    );

    return typeof data === "object" &&
      data !== null &&
      "updatedAt" in data &&
      typeof data.updatedAt === "string"
      ? data.updatedAt
      : undefined;
  } catch {
    // The revision is provenance only; a missing marker must not fail a sync.
    return undefined;
  }
};

const main = async (): Promise<void> => {
  console.log("Fetching Apple device-management schemas…");
  const apple = await loadApple();

  console.log("Fetching Android Management API discovery document…");
  const android = await loadAndroid();

  console.log("Fetching Windows Intune Settings Catalog…");
  const windows = await loadWindows();

  const sources: SourceRecord[] = [
    {
      platform: "apple",
      name: "Apple device-management",
      url: "https://github.com/apple/device-management",
      license: "MIT",
      revision: "release",
    },
    {
      platform: "android",
      name: "Android Management API (Google Discovery)",
      url: "https://androidmanagement.googleapis.com/$discovery/rest?version=v1",
      license: "Google APIs Terms of Service",
      revision: android.revision,
    },
    {
      platform: "windows",
      name: "Microsoft Intune Settings Catalog (Microsoft Graph)",
      url: "https://github.com/royklo/IntuneSettingsCatalogData",
      license: "Microsoft Graph data",
      revision: await windowsRevision(),
    },
  ];

  const platforms: [PlatformId, Collection[]][] = [
    ["apple", apple],
    ["android", android.collections],
    ["windows", windows],
  ];

  const stats: Record<string, { collections: number; properties: number }> = {};

  for (const [id, entries] of platforms) {
    const properties = entries.reduce(
      (total, collection) => total + countProperties(collection.properties),
      0,
    );

    stats[id] = { collections: entries.length, properties };
  }

  const collections = platforms.flatMap(([, entries]) => summarize(entries));

  const manifest = {
    generatedAt: new Date().toISOString(),
    sources,
    platforms: PLATFORMS,
    stats,
    collections,
  };

  await writeJson(path.join(CATALOG_DIR, "manifest.json"), manifest);
  await writeJson(path.join(CATALOG_DIR, "apple.json"), { id: "apple", collections: apple });
  await writeJson(path.join(CATALOG_DIR, "android.json"), {
    id: "android",
    collections: android.collections,
  });
  await writeJson(WINDOWS_SOURCE, { id: "windows", collections: windows });

  const { stats: splitStats } = await writeSplit({
    source: WINDOWS_SOURCE,
    out: WINDOWS_SPLIT,
  });

  for (const [id, entries] of platforms) {
    console.log(`${id}: ${entries.length} collections, ${stats[id].properties} properties`);
  }

  console.log(
    `windows split: ${splitStats.collections} collections, ${splitStats.properties} searchable settings`,
  );
  console.log(`Wrote catalogue to ${path.relative(ROOT, CATALOG_DIR)}`);
};

const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
