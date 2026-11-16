import { describe, expect, it } from "vitest";
import {
  attributeKeyProblem,
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
