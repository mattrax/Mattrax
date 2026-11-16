import { describe, expect, it } from "vitest";
import type { AttributeDefinition } from "../src/attributes.js";
import {
  attributeCsvCells,
  attributeCsvHeaders,
  attributeValuesProblem,
  definitionInputProblem,
  mergeAttributeValues,
  parseAttributeCsv,
} from "../src/attributes.js";
import { normalizeDeviceSearchQuery } from "../src/deviceSearch.js";

const definition = (overrides: Partial<AttributeDefinition> = {}): AttributeDefinition => ({
  id: "attr-1",
  organizationId: "tenant-1",
  key: "cost_centre",
  label: "Cost centre",
  type: "select",
  options: ["EMEA", "AMER"],
  required: false,
  visibility: "visible",
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
