import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { buildCisAssets, compileSources } from "../../../scripts/generate-cis-templates";
import {
  CisTemplateError,
  CisTemplateIndex,
  CompiledCisTemplate,
  applyCisTemplateToSelections,
  cisRequiredCollections,
  compileCisTemplate,
  type CisCatalogues,
} from "./cis";
import { PlatformData, type Collection, type PlatformId, type Property } from "./catalog";
import type { Selection } from "./build";

const here = path.dirname(fileURLToPath(import.meta.url));

const webRoot = path.resolve(here, "../../..");

const repoRoot = path.resolve(webRoot, "../..");

const sourceDir = path.join(repoRoot, "data/cis");

const assetDir = path.join(webRoot, "public/catalog/cis");

const property = (overrides: Partial<Property> & Pick<Property, "key">): Property => ({
  name: overrides.key,
  type: "string",
  description: "",
  ...overrides,
});

const collection = (
  id: string,
  properties: Property[],
  platform: PlatformId = "windows",
  kind: Collection["kind"] = "csp",
): Collection => ({
  id,
  platform,
  kind,
  surface: "settings",
  identifier: id,
  name: id,
  description: "",
  properties,
});

const catalogues = (entries: Collection[]): CisCatalogues => {
  const byPlatform: Record<PlatformId, Map<string, Collection>> = {
    apple: new Map(),
    windows: new Map(),
    android: new Map(),
  };

  for (const entry of entries) byPlatform[entry.platform].set(entry.id, entry);

  return {
    apple: { platform: "apple", collections: byPlatform.apple },
    windows: { platform: "windows", collections: byPlatform.windows },
    android: { platform: "android", collections: byPlatform.android },
  };
};

const source = (controls: Schema.Json[], overrides: Record<string, Schema.Json> = {}) => ({
  format: 1,
  id: "test-template",
  platform: "windows",
  benchmark: {
    name: "Test benchmark",
    version: "1.0.0",
    source: "https://example.test/benchmark",
  },
  description: "A test template.",
  controls,
  ...overrides,
});

const control = (id: string, mappings: Schema.Json[]) => ({
  id,
  title: `Control ${id}`,
  description: "Test control.",
  mappings,
});

const mapping = (setting: string, value: Schema.Json, extra: Record<string, Schema.Json> = {}) => ({
  collection: "windows/settings/test",
  setting,
  value,
  ...extra,
});

const problemsOf = (fn: () => void): string[] => {
  try {
    fn();
  } catch (error) {
    if (error instanceof CisTemplateError) return [...error.problems];
    throw error;
  }

  return [];
};

const testCatalogue = () =>
  catalogues([
    collection("windows/settings/test", [
      property({ key: "enabled", name: "Enabled", type: "boolean" }),
      property({ key: "count", name: "Count", type: "integer", min: 0, max: 24 }),
      property({
        key: "mode",
        name: "Mode",
        type: "enum",
        enum: [{ value: "0" }, { value: "1" }],
      }),
      property({ key: "values", name: "Values", type: "array" }),
      property({
        key: "features",
        name: "Features",
        type: "array",
        enum: [{ value: "CAMERA" }, { value: "NOTIFICATIONS" }],
      }),
    ]),
    collection("windows/settings/other", [
      property({ key: "flag", name: "Flag", type: "boolean", defaultValue: false }),
    ]),
    collection("windows/settings/user", [
      property({
        key: "flag",
        name: "Flag",
        type: "boolean",
        address: "./User/Vendor/MSFT/Policy/Config/Test/Flag",
      }),
    ]),
    collection(
      "apple/profiles/test",
      [property({ key: "enabled", name: "Enabled", type: "boolean" })],
      "apple",
      "profile",
    ),
    collection(
      "apple/ddm/test",
      [property({ key: "enabled", name: "Enabled", type: "boolean" })],
      "apple",
      "declaration",
    ),
  ]);

const selection = (overrides: Partial<Selection> = {}): Selection => ({
  collectionId: "windows/settings/test#windows/settings/test",
  identifier: "windows/settings/test",
  kind: "csp",
  surface: "settings",
  name: "windows/settings/test",
  properties: [property({ key: "enabled", type: "boolean" })],
  values: {},
  ...overrides,
});

describe("CIS template validation", () => {
  it("compiles a valid template and counts coverage", () => {
    const compiled = compileCisTemplate(
      source([
        control("1.1", [mapping("enabled", true)]),
        control("1.2", []),
        control("1.3", [mapping("count", 24)]),
      ]),
      testCatalogue(),
    );

    expect(compiled.stats).toEqual({ controls: 3, mapped: 2, settings: 2 });
    expect(compiled.controls[0]!.mapped).toBe(true);
    expect(compiled.controls[1]!.mapped).toBe(false);
    expect(compiled.controls[0]!.settings[0]).toMatchObject({
      collection: "windows/settings/test",
      setting: "enabled",
      settingName: "Enabled",
      valueKey: "enabled",
      value: true,
      displayValue: "On",
    });
  });

  it("rejects an unknown catalogue setting", () => {
    const problems = problemsOf(() =>
      compileCisTemplate(source([control("1.1", [mapping("missing", true)])]), testCatalogue()),
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("Unknown setting");
    expect(problems[0]).toContain("missing");
  });

  it("rejects an out-of-range integer", () => {
    const problems = problemsOf(() =>
      compileCisTemplate(source([control("1.1", [mapping("count", 25)])]), testCatalogue()),
    );

    expect(problems[0]).toContain("must be at most 24");
  });

  it("rejects an enum value the catalogue does not define", () => {
    const problems = problemsOf(() =>
      compileCisTemplate(source([control("1.1", [mapping("mode", "4")])]), testCatalogue()),
    );

    expect(problems[0]).toContain("must be one of");
  });

  it("validates a list of enum values item by item", () => {
    const compiled = compileCisTemplate(
      source([control("1.1", [mapping("features", ["CAMERA"])])]),
      testCatalogue(),
    );

    expect(compiled.controls[0]!.settings[0]!.value).toEqual(["CAMERA"]);

    expect(
      problemsOf(() =>
        compileCisTemplate(
          source([control("1.1", [mapping("features", ["CAMERA", "MICROPHONE"])])]),
          testCatalogue(),
        ),
      )[0],
    ).toContain("may only contain");
  });

  it("rejects a duplicate control reference", () => {
    const problems = problemsOf(() =>
      compileCisTemplate(
        source([control("1.1", [mapping("enabled", true)]), control("1.1", [])]),
        testCatalogue(),
      ),
    );

    expect(problems[0]).toContain("Duplicate control id");
  });

  it("rejects an unsupported platform", () => {
    const problems = problemsOf(() =>
      compileCisTemplate(source([], { platform: "linux" }), testCatalogue()),
    );

    expect(problems[0]).toContain("Unsupported platform");
  });

  it("requires an address when a Windows property key repeats", () => {
    const repeated = catalogues([
      collection("windows/settings/test", [
        property({
          key: "enabled",
          type: "boolean",
          address: "./Device/one",
        }),
        property({
          key: "enabled",
          type: "boolean",
          address: "./Device/two",
        }),
      ]),
    ]);

    expect(
      problemsOf(() =>
        compileCisTemplate(source([control("1.1", [mapping("enabled", true)])]), repeated),
      )[0],
    ).toContain("ambiguous");

    const compiled = compileCisTemplate(
      source([control("1.1", [mapping("enabled", true, { address: "./Device/two" })])]),
      repeated,
    );

    expect(compiled.controls[0]!.settings[0]!.address).toBe("./Device/two");
    expect(compiled.controls[0]!.settings[0]!.valueKey).toBe("./Device/two");
  });

  it("rejects an Apple template that mixes profiles and declarations", () => {
    const problems = problemsOf(() =>
      compileCisTemplate(
        source(
          [
            control("1.1", [
              { collection: "apple/profiles/test", setting: "enabled", value: true },
              { collection: "apple/ddm/test", setting: "enabled", value: true },
            ]),
          ],
          { platform: "apple" },
        ),
        testCatalogue(),
      ),
    );

    expect(problems[0]).toContain("cannot mix profile");
  });

  it("rejects a user-scoped Windows setting", () => {
    const problems = problemsOf(() =>
      compileCisTemplate(
        source([
          control("1.1", [
            { collection: "windows/settings/user", setting: "flag", value: true },
          ]),
        ]),
        testCatalogue(),
      ),
    );

    expect(problems[0]).toContain("user-scoped");
  });

  it("rejects a collection from another platform", () => {
    const problems = problemsOf(() =>
      compileCisTemplate(
        source([control("1.1", [{ collection: "apple/profiles/test", setting: "enabled", value: true }])]),
        testCatalogue(),
      ),
    );

    expect(problems[0]).toContain("unknown collection");
  });
});

describe("CIS template application", () => {
  const compile = (controls: Schema.Json[]) =>
    compileCisTemplate(source(controls), testCatalogue());

  it("merges mapped values without clobbering unrelated settings", () => {
    const template = compile([control("1.1", [mapping("count", 12)])]);

    const existing = selection({
      values: { enabled: true, count: 4, handTuned: "keep me" },
    });

    const result = applyCisTemplateToSelections({
      template,
      controlIds: ["1.1"],
      selections: [existing],
      collections: testCatalogue().windows.collections,
    });

    expect(result.appliedControls).toBe(1);
    expect(result.appliedSettings).toBe(1);
    expect(result.selections).toHaveLength(1);
    expect(result.selections[0]!.values).toEqual({
      enabled: true,
      count: 12,
      handTuned: "keep me",
    });
    // The input selection is not mutated.
    expect(existing.values.count).toBe(4);
  });

  it("adds a collection the policy does not have yet without seeding its defaults", () => {
    const template = compile([
      control("1.1", [
        {
          collection: "windows/settings/other",
          setting: "flag",
          value: true,
        },
      ]),
    ]);

    const result = applyCisTemplateToSelections({
      template,
      controlIds: ["1.1"],
      selections: [selection()],
      collections: testCatalogue().windows.collections,
    });

    expect(result.selections).toHaveLength(2);
    const added = result.selections.find((item) => item.collectionId.startsWith("windows/settings/other"));
    expect(added?.values).toEqual({ flag: true });
    expect(result.collections.map((item) => item.id)).toEqual(["windows/settings/other"]);
  });

  it("applies only the selected controls", () => {
    const template = compile([
      control("1.1", [mapping("enabled", true)]),
      control("1.2", [mapping("count", 24)]),
    ]);

    const result = applyCisTemplateToSelections({
      template,
      controlIds: ["1.2"],
      selections: [],
      collections: testCatalogue().windows.collections,
    });

    expect(result.controlIds).toEqual(["1.2"]);
    expect(result.selections[0]!.values).toEqual({ count: 24 });
  });

  it("returns the required collection ids for a control selection", () => {
    const template = compile([
      control("1.1", [mapping("enabled", true)]),
      control("1.2", [
        {
          collection: "windows/settings/other",
          setting: "flag",
          value: true,
        },
      ]),
    ]);

    expect(cisRequiredCollections(template, ["1.1", "1.2"])).toEqual([
      "windows/settings/other",
      "windows/settings/test",
    ]);
  });

  it("refuses to mix Apple profiles and declarations", () => {
    const appleTemplate = compileCisTemplate(
      source(
        [control("1.1", [{ collection: "apple/profiles/test", setting: "enabled", value: true }])],
        { platform: "apple" },
      ),
      testCatalogue(),
    );

    expect(() =>
      applyCisTemplateToSelections({
        template: appleTemplate,
        controlIds: ["1.1"],
        selections: [
          selection({
            collectionId: "apple/ddm/test#apple/ddm/test",
            identifier: "apple/ddm/test",
            kind: "declaration",
            surface: "declaration",
            name: "apple/ddm/test",
            properties: [],
          }),
        ],
        collections: testCatalogue().apple.collections,
      }),
    ).toThrow(/mixes Apple profiles and declarations/);
  });
});

describe("committed CIS assets", () => {
  const readCatalogue = (file: string) =>
    Schema.decodeUnknownSync(PlatformData)(JSON.parse(readFileSync(file, "utf8")));

  const cataloguesFromFiles = (): CisCatalogues => {
    const apple = readCatalogue(path.join(webRoot, "public/catalog/apple.json"));
    const android = readCatalogue(path.join(webRoot, "public/catalog/android.json"));
    const windows = readCatalogue(path.join(repoRoot, "data/catalog/windows.json"));

    return {
      apple: { platform: "apple", collections: new Map(apple.collections.map((item) => [item.id, item])) },
      android: {
        platform: "android",
        collections: new Map(android.collections.map((item) => [item.id, item])),
      },
      windows: {
        platform: "windows",
        collections: new Map(windows.collections.map((item) => [item.id, item])),
      },
    };
  };

  it("matches a fresh compile of the committed sources", async () => {
    const sources = readdirSync(sourceDir)
      .filter((name) => name.endsWith(".json"))
      .sort((left, right) => left.localeCompare(right))
      .map((name) =>
        Schema.decodeUnknownSync(Schema.Json)(JSON.parse(readFileSync(path.join(sourceDir, name), "utf8"))),
      );

    const templates = await compileSources(sources, cataloguesFromFiles());
    const generated = buildCisAssets(templates);
    const committed = new Set(readdirSync(assetDir).filter((name) => name.endsWith(".json")));

    expect([...committed].sort()).toEqual([...generated.files.keys()].sort());

    for (const [name, contents] of generated.files)
      expect(readFileSync(path.join(assetDir, name), "utf8")).toBe(contents);
  });

  it("ships a valid, internally consistent index and templates", () => {
    const index = Schema.decodeUnknownSync(CisTemplateIndex)(
      JSON.parse(readFileSync(path.join(assetDir, "index.json"), "utf8")),
    );

    expect(index.templates.length).toBeGreaterThanOrEqual(3);

    for (const summary of index.templates) {
      const template = Schema.decodeUnknownSync(CompiledCisTemplate)(
        JSON.parse(readFileSync(path.join(assetDir, summary.file), "utf8")),
      );

      expect(template.id).toBe(summary.id);
      expect(template.platform).toBe(summary.platform);
      expect(template.stats).toEqual({
        controls: template.controls.length,
        mapped: template.controls.filter((control) => control.mapped).length,
        settings: template.controls.reduce(
          (total, control) => total + control.settings.length,
          0,
        ),
      });
      expect(new Set(template.controls.map((control) => control.id)).size).toBe(
        template.controls.length,
      );
      expect(template.controls.every((control) => control.mapped === control.settings.length > 0)).toBe(
        true,
      );
    }
  });
});
