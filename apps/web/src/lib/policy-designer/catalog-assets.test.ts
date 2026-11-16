import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  collectionFileKey,
  collectionProperties,
  Collection,
  SearchIndex,
  WindowsPlatformIndex,
  type CollectionSummary,
} from "./catalog";

const here = path.dirname(fileURLToPath(import.meta.url));

const webRoot = path.resolve(here, "../../..");

const repoRoot = path.resolve(webRoot, "../..");

const catalogDir = path.join(webRoot, "public/catalog/windows");

const readJson = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, name: string): S["Type"] =>
  Schema.decodeUnknownSync(schema)(JSON.parse(readFileSync(path.join(catalogDir, name), "utf8")));

const index = readJson(WindowsPlatformIndex, "index.json");

const search = readJson(SearchIndex, "search.json");

const summaries = index.collections.flatMap((summary) => {
  if (summary.key === undefined) throw new Error(`Missing file key for ${summary.id}`);

  return [{ ...summary, platform: summary.platform ?? "windows", key: summary.key }];
});

const collectionFile = (summary: CollectionSummary & { key: string }) =>
  readJson(Collection, `${summary.key}.json`);

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
    const script = path.join(repoRoot, "scripts/split-policy-catalog.ts");
    expect(() =>
      execFileSync(path.join(repoRoot, "node_modules/.bin/tsx"), [script, "--check"], {
        cwd: repoRoot,
        timeout: 120_000,
        stdio: "pipe",
      }),
    ).not.toThrow();
  });
});
