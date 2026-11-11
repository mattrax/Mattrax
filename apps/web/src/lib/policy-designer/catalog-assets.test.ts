import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  collectionFileKey,
  collectionProperties,
  type Collection,
  type CollectionSummary,
  type PlatformIndex,
  type SearchIndex,
} from "./catalog";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "../../..");
const repoRoot = path.resolve(webRoot, "../..");
const catalogDir = path.join(webRoot, "public/catalog/windows");

const readJson = <T>(name: string) =>
  JSON.parse(readFileSync(path.join(catalogDir, name), "utf8")) as T;

const index = readJson<PlatformIndex>("index.json");
const search = readJson<SearchIndex>("search.json");
const summaries = index.collections as Array<CollectionSummary & { key: string }>;

const collectionFile = (summary: CollectionSummary & { key: string }) =>
  readJson<Collection>(`${summary.key}.json`);

describe("split Windows policy catalogue", () => {
  it("keeps the 17 MB source out of the served assets", () => {
    expect(existsSync(path.join(webRoot, "public/catalog/windows.json"))).toBe(false);
    expect(existsSync(path.join(repoRoot, "data/catalog/windows.json"))).toBe(true);
  });

  it("describes every collection in the index", () => {
    expect(index.platform).toBe("windows");
    expect(index.stats.collections).toBe(summaries.length);
    expect(summaries.length).toBeGreaterThan(500);

    const ids = new Set<string>();
    const keys = new Set<string>();
    for (const summary of summaries) {
      expect(summary.id).toBeTruthy();
      expect(summary.name).toBeTruthy();
      expect(summary.identifier).toBeTruthy();
      expect(summary.kind).toBe("csp");
      expect(summary.surface).toBe("settings");
      expect(summary.propertyCount).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(summary.propertyCount)).toBe(true);
      expect(summary.key).toBe(collectionFileKey(summary.id));
      expect(ids.has(summary.id)).toBe(false);
      expect(keys.has(summary.key)).toBe(false);
      ids.add(summary.id);
      keys.add(summary.key);
    }

    // Sorted by id so regenerating the catalogue produces identical bytes.
    expect([...ids]).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });

  it("ships one file per collection with matching properties", () => {
    let properties = 0;
    for (const summary of summaries) {
      const collection = collectionFile(summary);
      expect(collection.id).toBe(summary.id);
      expect(collection.name).toBe(summary.name);
      const usable = collectionProperties(collection);
      expect(usable).toHaveLength(summary.propertyCount);
      // Vector placeholders cannot be applied as OMA-URIs, so they are neither
      // counted nor searchable.
      expect(usable.every((property) => !property.address || !/[{}]/.test(property.address))).toBe(
        true,
      );
      properties += usable.length;
    }
    expect(properties).toBe(index.stats.properties);
  });

  it("indexes exactly the searchable settings without duplicates", () => {
    expect(Object.keys(search.collections).sort()).toEqual(
      summaries.map((summary) => summary.id).sort(),
    );

    for (const summary of summaries) {
      const entries = search.collections[summary.id] ?? [];
      const collection = collectionFile(summary);
      const expected = new Set(
        collectionProperties(collection).map((property) => property.address ?? property.key),
      );
      expect(new Set(entries.map(([key]) => key))).toEqual(expected);
      for (const [, text] of entries) {
        expect(text).toBe(text.toLowerCase());
        expect(text).not.toMatch(/\s{2}/);
      }
    }
  });

  it("keeps the always-loaded index small and the lazy search file reasonable", () => {
    const size = (name: string) => statSync(path.join(catalogDir, name)).size;
    expect(size("index.json")).toBeLessThan(512 * 1024);
    expect(size("search.json")).toBeLessThan(12 * 1024 * 1024);

    const collections = readdirSync(catalogDir).filter(
      (name) => name.endsWith(".json") && !["index.json", "search.json"].includes(name),
    );
    expect(collections).toHaveLength(summaries.length);
    // The old single file was ~17 MB; the split must not grow the payload.
    const total = collections.reduce((sum, name) => sum + size(name), 0);
    expect(total).toBeLessThan(16 * 1024 * 1024);
  });

  it("regenerates byte-for-byte identical output", () => {
    const script = path.join(repoRoot, "scripts/split-policy-catalog.mjs");
    expect(() =>
      execFileSync(process.execPath, [script, "--check"], {
        cwd: repoRoot,
        timeout: 120_000,
        stdio: "pipe",
      }),
    ).not.toThrow();
  });
});
