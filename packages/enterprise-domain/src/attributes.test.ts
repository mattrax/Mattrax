import { describe, expect, it } from "vitest";
import {
  attributeKeyProblem,
  parseScriptAttributeOutput,
  reservedAttributeKeyProblem,
  validateAttributeValue,
} from "./attributes.ts";

const definition = (overrides: Partial<Parameters<typeof validateAttributeValue>[0]> = {}) => ({
  key: "cost_centre",
  label: "Cost centre",
  type: "text" as const,
  required: false,
  options: null,
  ...overrides,
});

describe("attribute keys", () => {
  it("accepts lowercase variable-safe keys", () => {
    expect(attributeKeyProblem("cost_centre")).toBeNull();
    expect(attributeKeyProblem("warranty_end_2")).toBeNull();
  });

  it("rejects keys that would break policy variables or CSV headers", () => {
    expect(attributeKeyProblem("")).toMatch(/required/);
    expect(attributeKeyProblem("Cost Centre")).toMatch(/lowercase/);
    expect(attributeKeyProblem("1cost")).toMatch(/lowercase/);
    expect(attributeKeyProblem("cost-centre")).toMatch(/lowercase/);
  });

  it("reserves namespace words", () => {
    expect(reservedAttributeKeyProblem("device")).toMatch(/reserved/);
    expect(reservedAttributeKeyProblem("cost_centre")).toBeNull();
  });
});

describe("attribute value validation", () => {
  it("trims text and treats an empty optional value as a clear", () => {
    expect(validateAttributeValue(definition(), "  EMEA  ")).toEqual({ ok: true, value: "EMEA" });
    expect(validateAttributeValue(definition(), "   ")).toEqual({ ok: true, value: "" });
    expect(validateAttributeValue(definition(), null)).toEqual({ ok: true, value: "" });
  });

  it("requires a value for required attributes", () => {
    const result = validateAttributeValue(definition({ required: true }), "");

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toMatch(/required/);
  });

  it("canonicalises numbers and rejects non-numeric input", () => {
    expect(validateAttributeValue(definition({ type: "number" }), " 42.5 ")).toEqual({
      ok: true,
      value: "42.5",
    });
    expect(validateAttributeValue(definition({ type: "number" }), "forty-two").ok).toBe(false);
  });

  it("accepts common boolean spellings and stores true/false", () => {
    for (const raw of ["true", "yes", "1", "on"])
      expect(validateAttributeValue(definition({ type: "boolean" }), raw)).toEqual({
        ok: true,
        value: "true",
      });

    for (const raw of ["false", "no", "0", "off"])
      expect(validateAttributeValue(definition({ type: "boolean" }), raw)).toEqual({
        ok: true,
        value: "false",
      });

    expect(validateAttributeValue(definition({ type: "boolean" }), "maybe").ok).toBe(false);
  });

  it("accepts real ISO dates only", () => {
    expect(validateAttributeValue(definition({ type: "date" }), "2027-01-31")).toEqual({
      ok: true,
      value: "2027-01-31",
    });
    expect(validateAttributeValue(definition({ type: "date" }), "2027-02-30").ok).toBe(false);
    expect(validateAttributeValue(definition({ type: "date" }), "31/01/2027").ok).toBe(false);
    expect(validateAttributeValue(definition({ type: "date" }), "2027-1-3").ok).toBe(false);
  });

  it("restricts select values to the configured options", () => {
    const select = definition({ type: "select", options: ["EMEA", "AMER"] });

    expect(validateAttributeValue(select, "EMEA")).toEqual({ ok: true, value: "EMEA" });
    expect(validateAttributeValue(select, "APAC").ok).toBe(false);
    expect(validateAttributeValue(select, "emea").ok).toBe(false);
  });

  it("bounds long values", () => {
    expect(validateAttributeValue(definition(), "x".repeat(4096)).ok).toBe(true);
    expect(validateAttributeValue(definition(), "x".repeat(4097)).ok).toBe(false);
  });
});

describe("script attribute output", () => {
  const bindings = [
    {
      key: "antivirus",
      label: "Antivirus",
      type: "text" as const,
      line: 1,
    },
    {
      key: "agent_version",
      label: "Agent version",
      type: "number" as const,
      line: 2,
    },
    {
      key: "compliant",
      label: "Compliant",
      type: "boolean" as const,
      line: 3,
    },
  ];

  it("reads a JSON object keyed by attribute key", () => {
    expect(
      parseScriptAttributeOutput(
        bindings,
        JSON.stringify({ antivirus: "CrowdStrike", agent_version: 7.12, compliant: true }),
      ),
    ).toEqual([
      { key: "antivirus", ok: true, value: "CrowdStrike" },
      { key: "agent_version", ok: true, value: "7.12" },
      { key: "compliant", ok: true, value: "true" },
    ]);
  });

  it("uses the configured output key when one is set", () => {
    const result = parseScriptAttributeOutput(
      [{ ...bindings[0], outputKey: "product" }],
      JSON.stringify({ product: "CrowdStrike" }),
    );

    expect(result).toEqual([{ key: "antivirus", ok: true, value: "CrowdStrike" }]);
  });

  it("reads one value per line in binding order", () => {
    const outOfOrder = [bindings[2], bindings[0], bindings[1]];

    expect(parseScriptAttributeOutput(outOfOrder, "CrowdStrike\n7.12\ntrue")).toEqual([
      { key: "antivirus", ok: true, value: "CrowdStrike" },
      { key: "agent_version", ok: true, value: "7.12" },
      { key: "compliant", ok: true, value: "true" },
    ]);
  });

  it("reports a missing JSON key and a short line list per attribute", () => {
    const json = parseScriptAttributeOutput(bindings, JSON.stringify({ antivirus: "Acme" }));

    expect(json[0]).toEqual({ key: "antivirus", ok: true, value: "Acme" });
    expect(json[1]).toMatchObject({ key: "agent_version", ok: false });
    expect(json[1].ok ? "" : json[1].error).toMatch(/no "agent_version" key/);

    const lines = parseScriptAttributeOutput(bindings, "Acme");

    expect(lines[2]).toMatchObject({ key: "compliant", ok: false });
    expect(lines[2].ok ? "" : lines[2].error).toMatch(/line 3/);
  });

  it("rejects values the definition cannot hold and keeps the rest", () => {
    const readings = parseScriptAttributeOutput(
      bindings,
      JSON.stringify({ antivirus: "Acme", agent_version: "seven", compliant: "maybe" }),
    );

    expect(readings[0]).toMatchObject({ key: "antivirus", ok: true });
    expect(readings[1].ok ? "" : readings[1].error).toMatch(/must be a number/);
    expect(readings[2].ok ? "" : readings[2].error).toMatch(/true or false/);
  });

  it("treats an empty value as a collection error, not a clear", () => {
    const readings = parseScriptAttributeOutput(bindings, "Acme\n\ntrue");

    expect(readings[1]).toMatchObject({ key: "agent_version", ok: false });
    expect(readings[1].ok ? "" : readings[1].error).toMatch(/empty/);
  });

  it("keeps a leading blank line in place instead of shifting values", () => {
    const readings = parseScriptAttributeOutput(bindings, "\nCrowdStrike\n7.12\ntrue");

    // The blank first line belongs to the first binding, so "CrowdStrike" is
    // validated as the number attribute instead of being accepted as antivirus.
    expect(readings[0].ok ? "" : readings[0].error).toMatch(/empty/);
    expect(readings[1].ok ? "" : readings[1].error).toMatch(/must be a number/);
    expect(readings[2].ok ? "" : readings[2].error).toMatch(/true or false/);
  });

  it("rejects nested JSON values, unparseable JSON and empty output", () => {
    const nested = parseScriptAttributeOutput(bindings.slice(0, 1), '{"antivirus":{"name":"x"}}');

    expect(nested[0].ok ? "" : nested[0].error).toMatch(/string, number or boolean/);

    const broken = parseScriptAttributeOutput(bindings.slice(0, 1), "{not json");

    expect(broken[0].ok ? "" : broken[0].error).toMatch(/could not be parsed/);

    const empty = parseScriptAttributeOutput(bindings, "  \n ");

    expect(empty.every((reading) => !reading.ok)).toBe(true);
  });

  it("returns nothing when no attributes are bound", () => {
    expect(parseScriptAttributeOutput([], "CrowdStrike")).toEqual([]);
  });
});
