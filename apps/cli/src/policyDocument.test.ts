import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { PolicyRow } from "@mattrax/enterprise-domain/client";
import {
  exportPolicyDocument,
  parsePolicyDocument,
  serializePolicyDocument,
  stableJson,
  validatePolicyDocuments,
} from "./policyDocument.ts";

const row = (overrides: Partial<PolicyRow> = {}): PolicyRow => ({
  id: "p1",
  name: "Baseline",
  notes: null,
  priority: 10,
  configurations: { passcode: { required: true } },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("parsePolicyDocument", () => {
  it("parses YAML and JSON documents", async () => {
    const yaml = [
      "version: 1",
      "policies:",
      "  - name: Baseline",
      "    priority: 10",
      "    configurations:",
      "      passcode:",
      "        required: true",
    ].join("\n");

    const parsed = await Effect.runPromise(parsePolicyDocument(yaml, "baseline.yaml"));

    expect(parsed.version).toBe(1);
    expect(parsed.policies[0]?.name).toBe("Baseline");
    expect(parsed.policies[0]?.configurations?.passcode).toEqual({ required: true });

    const json = JSON.stringify(parsed);
    expect(await Effect.runPromise(parsePolicyDocument(json, "baseline.json"))).toEqual(parsed);
  });

  it("rejects an unknown version and reports the source", async () => {
    const error = await Effect.runPromise(
      Effect.flip(parsePolicyDocument("version: 2\npolicies: []\n", "future.yaml")),
    );

    expect(error.message).toContain("future.yaml");
    expect(error.message).toContain("portable Mattrax policy document");
  });

  it("rejects invalid YAML", async () => {
    const error = await Effect.runPromise(
      Effect.flip(parsePolicyDocument("version: [", "broken.yaml")),
    );

    expect(error.message).toContain("broken.yaml");
    expect(error.message).toContain("not valid YAML");
  });
});

describe("validatePolicyDocuments", () => {
  it("reports duplicate names within and across files", async () => {
    const first = await Effect.runPromise(
      parsePolicyDocument(
        "version: 1\npolicies:\n  - name: Baseline\n  - name: Baseline\n",
        "first.yaml",
      ),
    );

    const second = await Effect.runPromise(
      parsePolicyDocument("version: 1\npolicies:\n  - name: Baseline\n", "second.yaml"),
    );

    const issues = validatePolicyDocuments([
      { source: "first.yaml", document: first },
      { source: "second.yaml", document: second },
    ]);

    expect(issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        'Duplicate policy name "Baseline".',
        'Policy "Baseline" is also defined in first.yaml.',
      ]),
    );
  });

  it("rejects non-integer priorities and empty names", async () => {
    const document = await Effect.runPromise(
      parsePolicyDocument(
        "version: 1\npolicies:\n  - name: '  '\n    priority: 1.5\n",
        "invalid.yaml",
      ),
    );

    const issues = validatePolicyDocuments([{ source: "invalid.yaml", document }]);

    expect(issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        "Policy name must not be empty.",
        "Policy priority must be a whole number.",
      ]),
    );
  });
});

describe("exportPolicyDocument", () => {
  it("is deterministic and omits ids unless asked", () => {
    const document = exportPolicyDocument(
      [row({ id: "b", name: "Zulu" }), row({ id: "a", name: "Alpha" })],
      { includeIds: false },
    );

    expect(document.policies.map((policy) => policy.name)).toEqual(["Alpha", "Zulu"]);
    expect(document.policies[0]?.id).toBeUndefined();

    const withIds = exportPolicyDocument([row()], { includeIds: true });
    expect(withIds.policies[0]?.id).toBe("p1");
  });

  it("round trips through YAML and JSON", () => {
    const document = exportPolicyDocument([row()], { includeIds: true });
    const yaml = serializePolicyDocument(document, "yaml");
    const json = serializePolicyDocument(document, "json");

    expect(yaml).toContain("version: 1");
    expect(JSON.parse(json).policies).toEqual(document.policies);
  });

  it("keeps the user channel and a disabled state for the dashboard import", async () => {
    const document = exportPolicyDocument(
      [
        row({
          enabled: false,
          configurationScopes: { "mttx.apple.custom.wifi": "user" },
        }),
      ],
      { includeIds: false },
    );

    const json = serializePolicyDocument(document, "json");
    const parsed = await Effect.runPromise(parsePolicyDocument(json, "exported.json"));

    expect(parsed.policies[0]?.enabled).toBe(false);
    expect(parsed.policies[0]?.configurationScopes).toEqual({
      "mttx.apple.custom.wifi": "user",
    });
  });
});

describe("stableJson", () => {
  it("ignores object key order", () => {
    expect(stableJson({ b: 1, a: { d: 2, c: 3 } })).toBe(stableJson({ a: { c: 3, d: 2 }, b: 1 }));
    expect(stableJson({ a: [2, 1] })).not.toBe(stableJson({ a: [1, 2] }));
  });
});
