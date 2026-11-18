import { describe, expect, it } from "vitest";
import {
  formatEntityQuery,
  matchesEntityQuery,
  parseEntityQuery,
  splitEntityValues,
  type EntityCondition,
  type EntityField,
} from "./entity-query-engine";

type Row = {
  id: string;
  name: string;
  platform: string;
  devices: number;
};

const fields: ReadonlyArray<EntityField<Row>> = [
  { id: "name", label: "Name", kind: "text", get: (row) => row.name },
  {
    id: "platform",
    label: "Platform",
    kind: "select",
    options: [
      { value: "apple", label: "Apple" },
      { value: "win", label: "Windows" },
    ],
    get: (row) => row.platform,
  },
  { id: "devices", label: "Devices", kind: "number", get: (row) => row.devices },
];

const row = (overrides: Partial<Row> = {}): Row => ({
  id: "row-1",
  name: "Alpha",
  platform: "apple",
  devices: 3,
  ...overrides,
});

describe("splitEntityValues", () => {
  it("splits on commas and trims each value", () => {
    expect(splitEntityValues(" Alpha , Beta ,  Gamma ")).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("keeps commas inside quoted values", () => {
    expect(splitEntityValues('"ACME, Inc", Beta')).toEqual(["ACME, Inc", "Beta"]);
  });

  it("drops empty entries so a stray separator cannot widen a filter", () => {
    expect(splitEntityValues(" , Alpha, , ")).toEqual(["Alpha"]);
    expect(splitEntityValues("")).toEqual([]);
    expect(splitEntityValues('""')).toEqual([]);
  });
});

describe("parseEntityQuery with in", () => {
  it("parses a comma-separated operand", () => {
    expect(parseEntityQuery("name in Alpha, Beta", fields)).toEqual([
      { field: "name", op: "in", value: "Alpha, Beta" },
    ]);
  });

  it("accepts the operator case-insensitively and normalises whitespace", () => {
    expect(parseEntityQuery("  name   IN   Alpha ,  Beta ,, ", fields)).toEqual([
      { field: "name", op: "in", value: "Alpha, Beta" },
    ]);
  });

  it("round-trips values that contain commas", () => {
    const conditions = parseEntityQuery('name in "ACME, Inc", Beta', fields);

    expect(conditions).toEqual([{ field: "name", op: "in", value: '"ACME, Inc", Beta' }]);
    expect(formatEntityQuery(conditions)).toBe('name in "ACME, Inc", Beta');
  });

  it("keeps an empty in operand as a matches-nothing predicate", () => {
    // No operand at all is still not a clause; the grammar needs a value.
    expect(parseEntityQuery("name in", fields)).toEqual([]);

    for (const text of ["name in , ,", 'name in ""', "name in ,"])
      expect(parseEntityQuery(text, fields)).toEqual([{ field: "name", op: "in", value: "" }]);
  });

  it("round-trips through the text representation", () => {
    const conditions: EntityCondition[] = [
      { field: "name", op: "in", value: '"ACME, Inc", Beta' },
      { field: "platform", op: "in", value: "apple, win" },
      { field: "devices", op: "in", value: "3, 10" },
      { field: "name", op: "contains", value: "mac book" },
    ];

    expect(parseEntityQuery(formatEntityQuery(conditions), fields)).toEqual(conditions);
  });

  it("accepts in for numeric and enum fields", () => {
    expect(parseEntityQuery("devices in 1, 2", fields)).toEqual([
      { field: "devices", op: "in", value: "1, 2" },
    ]);
    expect(parseEntityQuery("platform in apple, win", fields)).toEqual([
      { field: "platform", op: "in", value: "apple, win" },
    ]);
  });
});

describe("formatEntityQuery with in", () => {
  it("canonicalises separators and quoting", () => {
    expect(formatEntityQuery([{ field: "name", op: "in", value: "Alpha,Beta" }])).toBe(
      "name in Alpha, Beta",
    );
    expect(formatEntityQuery([{ field: "name", op: "in", value: '"ACME, Inc", Beta' }])).toBe(
      'name in "ACME, Inc", Beta',
    );
  });

  it("formats an empty list as a quoted empty operand that round-trips", () => {
    const conditions: EntityCondition[] = [{ field: "name", op: "in", value: "" }];

    expect(formatEntityQuery(conditions)).toBe('name in ""');
    expect(parseEntityQuery(formatEntityQuery(conditions), fields)).toEqual(conditions);
  });

  it("leaves single-value formatting unchanged", () => {
    expect(formatEntityQuery([{ field: "name", op: "contains", value: "mac book" }])).toBe(
      'name contains "mac book"',
    );
  });

  it("joins conditions with and", () => {
    expect(
      formatEntityQuery([
        { field: "name", op: "in", value: "Alpha, Beta" },
        { field: "devices", op: "at least", value: "2" },
      ]),
    ).toBe("name in Alpha, Beta and devices at least 2");
  });
});

describe("matchesEntityQuery with in", () => {
  it("matches text values case-insensitively, like is", () => {
    const conditions: EntityCondition[] = [{ field: "name", op: "in", value: "alpha, GAMMA" }];

    expect(matchesEntityQuery(conditions, row({ name: "Alpha" }), fields)).toBe(true);
    expect(matchesEntityQuery(conditions, row({ name: "Gamma" }), fields)).toBe(true);
    expect(matchesEntityQuery(conditions, row({ name: "Beta" }), fields)).toBe(false);
  });

  it("requires a whole value, unlike contains", () => {
    const conditions: EntityCondition[] = [{ field: "name", op: "in", value: "Alp" }];

    expect(matchesEntityQuery(conditions, row({ name: "Alpha" }), fields)).toBe(false);
  });

  it("matches enum values case-insensitively", () => {
    const conditions: EntityCondition[] = [{ field: "platform", op: "in", value: "Apple, win" }];

    expect(matchesEntityQuery(conditions, row({ platform: "apple" }), fields)).toBe(true);
    expect(matchesEntityQuery(conditions, row({ platform: "win" }), fields)).toBe(true);
    expect(matchesEntityQuery(conditions, row({ platform: "android" }), fields)).toBe(false);
  });

  it("matches numeric fields with exactly semantics", () => {
    const conditions: EntityCondition[] = [{ field: "devices", op: "in", value: "3, 10" }];

    expect(matchesEntityQuery(conditions, row({ devices: 3 }), fields)).toBe(true);
    expect(matchesEntityQuery(conditions, row({ devices: 10 }), fields)).toBe(true);
    expect(matchesEntityQuery(conditions, row({ devices: 4 }), fields)).toBe(false);
    expect(matchesEntityQuery(conditions, row({ devices: 3.5 }), fields)).toBe(false);
  });

  it("ignores non-numeric entries rather than matching them", () => {
    const conditions: EntityCondition[] = [{ field: "devices", op: "in", value: "3, nope" }];

    expect(matchesEntityQuery(conditions, row({ devices: 3 }), fields)).toBe(true);
    expect(matchesEntityQuery(conditions, row({ devices: Number.NaN }), fields)).toBe(false);
  });

  it("matches nothing for an empty or whitespace-only operand", () => {
    for (const value of ["", " ", ", ,", '""']) {
      expect(
        matchesEntityQuery([{ field: "name", op: "in", value }], row({ name: "" }), fields),
      ).toBe(false);
      expect(
        matchesEntityQuery([{ field: "devices", op: "in", value }], row({ devices: 0 }), fields),
      ).toBe(false);
    }
  });

  it("combines with other conditions", () => {
    const conditions: EntityCondition[] = [
      { field: "platform", op: "in", value: "apple, win" },
      { field: "devices", op: "at least", value: "2" },
    ];

    expect(matchesEntityQuery(conditions, row(), fields)).toBe(true);
    expect(matchesEntityQuery(conditions, row({ devices: 1 }), fields)).toBe(false);
  });
});
