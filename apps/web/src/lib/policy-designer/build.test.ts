import { describe, expect, it } from "vitest";
import {
  artifactToConfigurations,
  buildWindowsNodes,
  catalogDefault,
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
