import { describe, expect, it } from "vitest";
import type { AttributeDefinition } from "../src/Policy/attributes.ts";
import {
  attributeCsvCells,
  attributeCsvHeaders,
  attributeValuesProblem,
  collectScriptAttributeValues,
  definitionInputProblem,
  mergeAttributeValues,
  parseAttributeCsv,
} from "../src/Policy/attributes.ts";
import { normalizeDeviceSearchQuery } from "../src/Device/deviceSearch.ts";
import { makeDb, runEffect } from "./helpers.js";

const definition = (overrides: Partial<AttributeDefinition> = {}): AttributeDefinition => ({
  id: "attr-1",
  organizationId: "tenant-1",
  key: "cost_centre",
  label: "Cost centre",
  type: "select",
  options: ["EMEA", "AMER"],
  required: false,
  visibility: "visible",
  source: "manual",
  scriptId: null,
  scriptOutputKey: null,
  sortOrder: 0,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

describe("attribute definitions", () => {
  it("requires select options and rejects options elsewhere", () => {
    expect(
      definitionInputProblem({ key: "cost_centre", label: "Cost centre", type: "select" }),
    ).toMatch(/at least one option/);

    expect(
      definitionInputProblem({
        key: "cost_centre",
        label: "Cost centre",
        type: "text",
        options: ["EMEA"],
      }),
    ).toMatch(/Only select attributes/);

    expect(
      definitionInputProblem({
        key: "cost_centre",
        label: "Cost centre",
        type: "select",
        options: ["EMEA", "AMER"],
      }),
    ).toBeNull();
  });

  it("rejects duplicate and reserved keys", () => {
    expect(definitionInputProblem({ key: "tenant", label: "Tenant", type: "text" })).toMatch(
      /reserved/,
    );

    expect(definitionInputProblem({ key: "Bad Key", label: "Bad", type: "text" })).toMatch(
      /lowercase/,
    );
  });
});

describe("device attribute values", () => {
  const definitions = [
    definition(),
    definition({ id: "attr-2", key: "warranty_end", label: "Warranty end", type: "date" }),
    definition({
      id: "attr-3",
      key: "loaner",
      label: "Loaner",
      type: "boolean",
      options: null,
    }),
  ];

  it("rejects unknown keys so a typo cannot be dropped silently", () => {
    expect(attributeValuesProblem(definitions, { cost_center: "EMEA" })).toEqual({
      key: "cost_center",
      message: '"cost_center" is not a registered attribute in this tenant.',
    });
  });

  it("validates each value against its definition", () => {
    expect(attributeValuesProblem(definitions, { cost_centre: "APAC" })?.message).toContain(
      "EMEA, AMER",
    );
    expect(attributeValuesProblem(definitions, { warranty_end: "31/01/2027" })?.message).toContain(
      "YYYY-MM-DD",
    );
    expect(attributeValuesProblem(definitions, { loaner: "yes" })).toBeNull();
  });

  it("treats null as a clear request", () => {
    expect(attributeValuesProblem(definitions, { cost_centre: null })).toBeNull();
  });
});

describe("attribute CSV", () => {
  const definitions = [
    definition(),
    definition({ id: "attr-2", key: "warranty_end", label: "Warranty end", type: "date" }),
    definition({
      id: "attr-3",
      key: "internal_note",
      label: "Internal note",
      type: "text",
      visibility: "hidden",
    }),
  ];

  it("round-trips headers and cells, skipping hidden attributes", () => {
    const headers = attributeCsvHeaders(definitions);
    const cells = attributeCsvCells(definitions, { cost_centre: "EMEA", internal_note: "secret" });

    expect(headers).toEqual(["attribute:cost_centre", "attribute:warranty_end"]);
    expect(cells).toEqual(["EMEA", ""]);

    const csv = [
      ["serial", ...headers],
      ["C02XYZ", ...cells],
    ]
      .map((row) => row.join(","))
      .join("\r\n");

    const parsed = parseAttributeCsv(definitions, csv);

    expect(parsed.issues).toEqual([]);
    expect(parsed.rows).toEqual([
      { row: 1, serial: "C02XYZ", values: { cost_centre: "EMEA", warranty_end: null } },
    ]);
  });

  it("accepts labels and bare keys as column headers", () => {
    const parsed = parseAttributeCsv(
      definitions,
      "Serial,Warranty end,cost_centre\r\nC02XYZ,2027-01-31,AMER\r\n",
    );

    expect(parsed.issues).toEqual([]);
    expect(parsed.rows[0]?.values).toEqual({ warranty_end: "2027-01-31", cost_centre: "AMER" });
  });

  it("reports unknown columns, duplicate serials and invalid values per row", () => {
    const parsed = parseAttributeCsv(
      definitions,
      [
        "serial,attribute:unknown,cost_centre",
        "C02XYZ,value,APAC",
        "C02XYZ,value,EMEA",
        ",value,EMEA",
      ].join("\r\n"),
    );

    expect(
      parsed.issues.some((issue) => issue.row === 0 && /not a registered/.test(issue.message)),
    ).toBe(true);
    expect(parsed.issues.some((issue) => /more than once/.test(issue.message))).toBe(true);
    expect(parsed.issues.some((issue) => /serial is required/.test(issue.message))).toBe(true);
    expect(parsed.rows[0]?.values.cost_centre).toBeUndefined();
  });

  it("rejects clearing a required attribute in a CSV row", () => {
    const parsed = parseAttributeCsv(
      [definition({ required: true })],
      "serial,attribute:cost_centre\r\nC02XYZ,\r\n",
    );

    expect(parsed.issues[0]?.message).toContain("required");
    expect(parsed.rows[0]?.values.cost_centre).toBeUndefined();
  });

  it("requires a serial column and at least one attribute column", () => {
    expect(parseAttributeCsv(definitions, "name\r\nMac\r\n").issues[0]?.message).toContain(
      '"serial"',
    );
    expect(parseAttributeCsv(definitions, "serial\r\nC02XYZ\r\n").issues[0]?.message).toContain(
      "at least one attribute column",
    );
  });

  it("rejects an import with duplicate attribute columns", () => {
    const parsed = parseAttributeCsv(
      definitions,
      "serial,attribute:cost_centre,cost_centre\r\nC02XYZ,EMEA,AMER\r\n",
    );

    expect(parsed.issues[0]?.message).toContain("appears twice");
  });
});

describe("device attribute merge semantics", () => {
  const definitions = [{ key: "cost_centre" }, { key: "warranty_end" }, { key: "loaner" }];

  it("writes listed keys and leaves the rest untouched", () => {
    expect(
      mergeAttributeValues({
        existing: { cost_centre: "EMEA", loaner: "true" },
        values: { warranty_end: "2027-01-31" },
        definitions,
      }),
    ).toEqual({ cost_centre: "EMEA", loaner: "true", warranty_end: "2027-01-31" });
  });

  it("clears a key with null or an empty string", () => {
    expect(
      mergeAttributeValues({
        existing: { cost_centre: "EMEA", loaner: "true" },
        values: { cost_centre: null, loaner: "" },
        definitions,
      }),
    ).toEqual({ cost_centre: null, loaner: null });
  });

  it("clears every unlisted key when replace is set", () => {
    expect(
      mergeAttributeValues({
        existing: { cost_centre: "EMEA", loaner: "true", warranty_end: "2027-01-31" },
        values: { cost_centre: "AMER" },
        definitions,
        replace: true,
      }),
    ).toEqual({ cost_centre: "AMER", loaner: null, warranty_end: null });
  });
});

describe("device attribute filters", () => {
  it("parses the JSON attribute filter into an exact-match map", () => {
    const filters = normalizeDeviceSearchQuery({
      attributes: JSON.stringify({ cost_centre: "EMEA", loaner: "true" }),
    });

    expect(filters.attributes).toEqual({ cost_centre: "EMEA", loaner: "true" });
  });

  it("rejects a filter that is not a string map", () => {
    expect(() => normalizeDeviceSearchQuery({ attributes: JSON.stringify({ cost: 1 }) })).toThrow(
      /key\/value strings/,
    );
  });
});

describe("attribute sources and script bindings", () => {
  it("requires a script for a script-sourced attribute", () => {
    expect(
      definitionInputProblem({
        key: "antivirus",
        label: "Antivirus",
        type: "text",
        source: "script",
      }),
    ).toMatch(/Choose the script/);

    expect(
      definitionInputProblem({
        key: "antivirus",
        label: "Antivirus",
        type: "text",
        source: "script",
        scriptId: "script-1",
        scriptOutputKey: "product",
      }),
    ).toBeNull();
  });

  it("rejects a binding or output key on another source", () => {
    expect(
      definitionInputProblem({
        key: "antivirus",
        label: "Antivirus",
        type: "text",
        source: "manual",
        scriptId: "script-1",
      }),
    ).toMatch(/Only script-sourced/);

    expect(
      definitionInputProblem({
        key: "antivirus",
        label: "Antivirus",
        type: "text",
        source: "directory",
        scriptOutputKey: "product",
      }),
    ).toMatch(/output key/);
  });

  it("refuses manual writes to a script-sourced attribute", () => {
    const definitions = [
      definition(),
      definition({
        id: "attr-2",
        key: "antivirus",
        label: "Antivirus",
        type: "text",
        source: "script",
        scriptId: "script-1",
      }),
    ];

    expect(attributeValuesProblem(definitions, { antivirus: "CrowdStrike" })).toEqual({
      key: "antivirus",
      message: '"Antivirus" is collected from a script and cannot be edited manually.',
    });

    // The manual attribute in the same request is unaffected.
    expect(attributeValuesProblem(definitions, { cost_centre: "EMEA" })).toBeNull();
  });

  it("exports script values but never imports them", () => {
    const definitions = [
      definition({
        id: "attr-2",
        key: "antivirus",
        label: "Antivirus",
        type: "text",
        source: "script",
        scriptId: "script-1",
      }),
      definition({ id: "attr-3", key: "notes", label: "Notes", type: "text" }),
    ];

    expect(attributeCsvHeaders(definitions)).toEqual(["attribute:antivirus", "attribute:notes"]);
    expect(attributeCsvCells(definitions, { antivirus: "CrowdStrike" })).toEqual([
      "CrowdStrike",
      "",
    ]);

    // A re-import of an export keeps the script's value: the column is ignored
    // rather than treated as a write or a clear.
    const imported = parseAttributeCsv(
      definitions,
      "serial,attribute:antivirus,attribute:notes\r\nC02XYZ,CrowdStrike,hello\r\n",
    );

    expect(imported.issues).toEqual([]);
    expect(imported.rows[0]?.values).toEqual({ notes: "hello" });
  });

  it("keeps script values when a replace clears the manual fields", () => {
    expect(
      mergeAttributeValues({
        existing: { cost_centre: "EMEA", antivirus: "CrowdStrike" },
        values: { cost_centre: "AMER" },
        definitions: [
          { key: "cost_centre", source: "manual" },
          { key: "warranty_end", source: "manual" },
          { key: "antivirus", source: "script" },
        ],
        replace: true,
      }),
    ).toEqual({ cost_centre: "AMER", warranty_end: null, antivirus: "CrowdStrike" });
  });
});

describe("script attribute collection", () => {
  const now = new Date("2026-11-20T10:00:00Z");

  const script = { id: "script-1", name: "Security inventory" };

  const seed = (definitions: AttributeDefinition[], extra: Record<string, unknown[]> = {}) =>
    makeDb({
      attribute_definition: definitions,
      device_attribute: [],
      attribute_collection: [],
      audit_log: [],
      ...extra,
    });

  const definitions = [
    definition({
      id: "attr-antivirus",
      key: "antivirus",
      label: "Antivirus",
      type: "text",
      options: null,
      source: "script",
      scriptId: script.id,
      sortOrder: 0,
    }),
    definition({
      id: "attr-version",
      key: "agent_version",
      label: "Agent version",
      type: "number",
      options: null,
      source: "script",
      scriptId: script.id,
      sortOrder: 1,
    }),
  ];

  const collect = (db: any, stdout: string, failure?: string) =>
    runEffect(
      collectScriptAttributeValues(db, {
        organizationId: "tenant-1",
        deviceId: "device-1",
        script,
        executionId: "execution-1",
        stdout,
        failure: failure ?? null,
        now,
      }),
    );

  it("writes only the declared attributes and records their state", async () => {
    const db = seed(definitions);

    const result = await collect(
      db,
      JSON.stringify({ antivirus: "CrowdStrike", agent_version: 7.12, rogue: "ignored" }),
    );

    expect(result.written).toEqual(["antivirus", "agent_version"]);
    expect(result.errors).toEqual([]);
    expect(db.store.device_attribute).toEqual([
      expect.objectContaining({ attributeId: "attr-antivirus", value: "CrowdStrike" }),
      expect.objectContaining({ attributeId: "attr-version", value: "7.12" }),
    ]);
    expect(db.store.attribute_collection).toHaveLength(2);
    expect(db.store.attribute_collection[0]).toMatchObject({
      attributeId: "attr-antivirus",
      source: "script",
      scriptId: script.id,
      lastCollectedAt: now,
      lastError: null,
    });
  });

  it("records a per-attribute error and does not write the invalid value", async () => {
    const db = seed(definitions, {
      device_attribute: [
        {
          deviceId: "device-1",
          attributeId: "attr-version",
          organizationId: "tenant-1",
          value: "7.11",
          updatedByAccountId: null,
          updatedAt: now,
        },
      ],
    });

    const result = await collect(
      db,
      JSON.stringify({ antivirus: "CrowdStrike", agent_version: "seven" }),
    );

    expect(result.written).toEqual(["antivirus"]);
    expect(result.errors[0]).toMatchObject({ key: "agent_version" });
    expect(result.errors[0]?.message).toMatch(/must be a number/);

    // The previous value is untouched, and the failure is on the state row.
    expect(
      db.store.device_attribute.find((row: any) => row.attributeId === "attr-version"),
    ).toMatchObject({ value: "7.11" });
    expect(
      db.store.attribute_collection.find((row: any) => row.attributeId === "attr-version"),
    ).toMatchObject({
      lastError: expect.stringContaining("must be a number"),
      lastCollectedAt: null,
    });
  });

  it("audits the change with the script and run id", async () => {
    const db = seed(definitions);

    await collect(db, "CrowdStrike\n7.12");

    expect(db.store.audit_log).toHaveLength(1);
    expect(db.store.audit_log[0]).toMatchObject({
      action: "device.attributes_updated",
      targetType: "device",
      targetId: "device-1",
      metadata: {
        source: "script",
        scriptId: script.id,
        scriptName: script.name,
        executionId: "execution-1",
        written: ["agent_version", "antivirus"],
      },
    });
  });

  it("records a failed run without touching values", async () => {
    const db = seed(definitions);

    const result = await collect(
      db,
      "",
      "The script exited with code 2, so no attribute values were collected.",
    );

    expect(result.written).toEqual([]);
    expect(result.errors).toHaveLength(2);
    expect(db.store.device_attribute).toEqual([]);
    expect(db.store.attribute_collection[0]).toMatchObject({
      lastError: expect.stringContaining("exited with code 2"),
      lastCollectedAt: null,
    });
    expect(db.store.audit_log).toEqual([]);
  });

  it("orders line-mode values by sort order then label, like the settings list", async () => {
    const db = seed([
      definition({
        id: "attr-z",
        key: "z_key",
        label: "Alpha",
        type: "text",
        options: null,
        source: "script",
        scriptId: script.id,
        sortOrder: 5,
      }),
      definition({
        id: "attr-a",
        key: "a_key",
        label: "Zulu",
        type: "text",
        options: null,
        source: "script",
        scriptId: script.id,
        sortOrder: 5,
      }),
    ]);

    const result = await collect(db, "first\nsecond");

    expect(result.written).toEqual(["z_key", "a_key"]);
    expect(db.store.device_attribute).toEqual([
      expect.objectContaining({ attributeId: "attr-z", value: "first" }),
      expect.objectContaining({ attributeId: "attr-a", value: "second" }),
    ]);
  });

  it("does not rewrite or audit a value that did not change", async () => {
    const db = seed([definitions[0]], {
      device_attribute: [
        {
          deviceId: "device-1",
          attributeId: "attr-antivirus",
          organizationId: "tenant-1",
          value: "CrowdStrike",
          updatedByAccountId: null,
          updatedAt: new Date("2026-11-01T00:00:00Z"),
        },
      ],
    });

    const result = await collect(db, JSON.stringify({ antivirus: "CrowdStrike" }));

    expect(result.written).toEqual([]);
    expect(db.store.device_attribute[0]?.updatedAt).toEqual(new Date("2026-11-01T00:00:00Z"));
    expect(db.store.audit_log).toEqual([]);
    // The collection still refreshes, so the dashboard shows a fresh check.
    expect(db.store.attribute_collection[0]).toMatchObject({ lastCollectedAt: now });
  });

  it("does nothing when the script has no bound attributes", async () => {
    const db = seed([definition()]);

    const result = await collect(db, "CrowdStrike");

    expect(result).toEqual({ written: [], errors: [] });
    expect(db.store.attribute_collection).toEqual([]);
  });
});
