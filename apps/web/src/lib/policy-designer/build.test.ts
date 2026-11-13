import { describe, expect, it } from "vitest";
import {
  artifactToConfigurations,
  buildPolicyBundle,
  buildWindowsNodes,
  catalogDefault,
  parsePolicyDraft,
  policyToConfigurations,
  validateDraft,
  type Draft,
  type Selection,
} from "./build";
import type { Property } from "./catalog";

const property = (overrides: Partial<Property>): Property => ({
  key: "setting",
  name: "Setting",
  type: "string",
  description: "",
  ...overrides,
});

const selection = (properties: Property[], values: Record<string, unknown>): Selection => ({
  collectionId: "test#Test",
  identifier: "test",
  kind: "csp",
  surface: "settings",
  name: "Test",
  properties,
  values,
});

const draft = (platform: Draft["platform"], selections: Selection[]): Draft => ({
  version: 1,
  platform,
  name: "Test policy",
  selections,
});

describe("catalogDefault", () => {
  it("normalises boolean and numeric enum defaults to the stored type", () => {
    expect(
      catalogDefault(
        property({
          type: "boolean",
          enum: [{ value: "true" }, { value: "false" }],
          defaultValue: "true",
        }),
      ),
    ).toBe(true);
    expect(
      catalogDefault(
        property({
          type: "integer",
          enum: [{ value: "0" }, { value: "1" }, { value: "2" }],
          defaultValue: "2",
        }),
      ),
    ).toBe(2);
  });
});

describe("validateDraft", () => {
  it("does not treat a catalogue default below min as user error", () => {
    const propertyWithInvalidDefault = property({
      key: "minimumKeySize",
      name: "Minimum key size",
      type: "integer",
      defaultValue: 0,
      min: 1,
    });
    const issues = validateDraft(
      draft("windows", [selection([propertyWithInvalidDefault], { minimumKeySize: 0 })]),
    );
    expect(issues.filter((issue) => issue.severity === "error")).toHaveLength(0);
  });

  it("still rejects an edited value below min", () => {
    const propertyWithMin = property({
      key: "minimumKeySize",
      name: "Minimum key size",
      type: "integer",
      defaultValue: 16,
      min: 1,
    });
    const issues = validateDraft(
      draft("windows", [selection([propertyWithMin], { minimumKeySize: -2 })]),
    );
    expect(issues.some((issue) => issue.severity === "error")).toBe(true);
  });

  it("rejects a string where an array is expected", () => {
    const issues = validateDraft(
      draft("apple", [
        selection([property({ key: "list", type: "array" })], { list: "[not json" }),
      ]),
    );
    expect(issues.some((issue) => issue.severity === "error")).toBe(true);
  });

  it("rejects a Windows collection with no applicable OMA-URI", () => {
    const issues = validateDraft(
      draft("windows", [
        selection([property({ key: "ignored", address: "./Vendor/MSFT/{bad}" })], { ignored: "x" }),
      ]),
    );
    expect(issues.some((issue) => issue.severity === "error")).toBe(true);
  });
});

describe("Windows SyncML", () => {
  it("keeps enum defaults typed consistently whether stored as strings or booleans", () => {
    const booleanEnum = property({
      key: "enabled",
      type: "boolean",
      address: "./Vendor/MSFT/Policy/Config/Test/Enabled",
      enum: [{ value: "true" }, { value: "false" }],
      defaultValue: "true",
    });
    const stringDraft = buildWindowsNodes(
      draft("windows", [
        selection([booleanEnum], { "./Vendor/MSFT/Policy/Config/Test/Enabled": "true" }),
      ]),
    );
    const booleanDraft = buildWindowsNodes(
      draft("windows", [
        selection([booleanEnum], { "./Vendor/MSFT/Policy/Config/Test/Enabled": true }),
      ]),
    );
    expect(stringDraft).toEqual(booleanDraft);
    expect(stringDraft[0]).toMatchObject({ value: true, format: "int" });
  });
});

describe("artifactToConfigurations", () => {
  it("keys Apple declarations by identifier, not array position", () => {
    const first = selection([], {});
    const second = {
      ...selection([], {}),
      collectionId: "second#Second",
      identifier: "second",
      kind: "declaration" as const,
      name: "Second",
    };
    const forward = Object.keys(artifactToConfigurations(draft("apple", [first, second]))).sort();
    const reversed = Object.keys(artifactToConfigurations(draft("apple", [second, first]))).sort();
    expect(forward).toEqual(reversed);
  });
});

describe("multi-platform policy drafts", () => {
  const appleSelection = {
    ...selection([], {}),
    collectionId: "apple/profiles/com.apple.universalaccess#Accessibility",
    identifier: "com.apple.universalaccess",
    kind: "profile" as const,
    surface: "profiles",
    name: "Accessibility",
  };
  const windowsSelection = {
    ...selection([], {}),
    collectionId: "windows/settings/bitlocker#BitLocker",
    identifier: "bitlocker",
    kind: "csp" as const,
    surface: "settings",
    name: "BitLocker",
  };
  const policy = {
    version: 2 as const,
    name: "Cross platform",
    platforms: { apple: [appleSelection], windows: [windowsSelection] },
  };

  it("upgrades a v1 draft without losing its selections", () => {
    const parsed = parsePolicyDraft(draft("apple", [appleSelection]));
    expect(parsed?.version).toBe(2);
    expect(parsed?.platforms.apple).toEqual([appleSelection]);
  });

  it("builds one configuration per platform and keeps the full draft", () => {
    const configurations = policyToConfigurations(policy);
    expect(Object.keys(configurations).sort()).toEqual([
      "mttx.apple.custom.designer",
      "mttx.windows.custom.designer",
    ]);
    for (const value of Object.values(configurations)) {
      expect(parsePolicyDraft((value as { draft?: unknown }).draft)).toMatchObject({
        version: 2,
        platforms: { apple: [appleSelection], windows: [windowsSelection] },
      });
    }
  });

  it("bundles multiple artifacts into a zip", () => {
    const bundle = buildPolicyBundle(policy);
    expect(bundle?.contentType).toBe("application/zip");
    expect(bundle?.artifactCount).toBe(2);
    const text = new TextDecoder().decode(bundle!.content as Uint8Array);
    expect(text).toContain("Cross-platform.mobileconfig");
    expect(text).toContain("Cross-platform.syncml.xml");
    // A store-only ZIP starts with two local file headers.
    expect(bundle?.content).toBeInstanceOf(Uint8Array);
  });
});
