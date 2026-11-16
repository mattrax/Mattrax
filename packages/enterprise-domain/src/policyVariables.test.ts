import { describe, expect, it } from "vitest";
import {
  containsPolicyVariables,
  extractPolicyVariables,
  policyConfigurationVariableProblem,
  policyVariableInfo,
  policyVariableProblem,
  substitutePolicyVariables,
  substitutePolicyVariablesInString,
} from "./policyVariables.ts";

describe("policy variable validation", () => {
  it("accepts built-in and registered attribute variables", () => {
    expect(policyVariableProblem("${device.name}", ["cost_centre"])).toBeNull();
    expect(policyVariableProblem("${device.serial}-${device.model}", [])).toBeNull();
    expect(policyVariableProblem("${tenant.name}", [])).toBeNull();
    expect(policyVariableProblem("${attribute.cost_centre}", ["cost_centre"])).toBeNull();
  });

  it("rejects unknown variables with the offending name", () => {
    expect(policyVariableProblem("${attribute.unknown}", ["cost_centre"])).toMatch(
      /attribute\.unknown/,
    );
    expect(policyVariableProblem("${device.recoveryKey}", [])).toMatch(/Unknown policy variable/);
    expect(policyVariableProblem("${secret.apiKey}", [])).toMatch(/Unknown policy variable/);
    expect(policyVariableProblem("${attribute.cost_centre}", [])).toMatch(
      /Unknown policy variable/,
    );
  });

  it("rejects malformed variables", () => {
    expect(policyVariableProblem("${device.name", [])).toMatch(/closing brace/);
    expect(policyVariableProblem("${}", [])).toMatch(/empty name/);
    expect(policyVariableProblem("${${device.name}}", [])).toBeTruthy();
  });

  it("treats $${...} as an escape, not a reference", () => {
    expect(policyVariableProblem("$${device.name}", [])).toBeNull();
    expect(extractPolicyVariables("$${device.name}")).toEqual([]);
    expect(extractPolicyVariables("${device.name} $${tenant.name}")).toEqual(["device.name"]);
  });

  it("finds problems inside nested configuration payloads with a path", () => {
    const problem = policyConfigurationVariableProblem(
      { "Wi-Fi": { SSID_STR: "${attribute.wifi}" } },
      [],
    );

    expect(problem).toContain("Configuration.Wi-Fi.SSID_STR");
    expect(problem).toContain("Unknown policy variable");
  });
});

describe("policy variable substitution", () => {
  const context = {
    device: { name: "Alice's MacBook", serial: "C02XYZ", model: "Mac14,2" },
    tenant: { name: "Acme Ltd" },
    attributes: { cost_centre: "EMEA", warranty_end: null },
  };

  it("resolves the supported contexts", () => {
    expect(
      substitutePolicyVariablesInString(
        "${tenant.name}/${device.name}/${device.serial}/${device.model}/${attribute.cost_centre}",
        context,
      ),
    ).toBe("Acme Ltd/Alice's MacBook/C02XYZ/Mac14,2/EMEA");
  });

  it("resolves a missing attribute value to an empty string, never literal text", () => {
    expect(substitutePolicyVariablesInString("x${attribute.warranty_end}", context)).toBe("x");
    expect(substitutePolicyVariablesInString("x${attribute.unknown}", context)).toBe("x");
  });

  it("renders escapes without resolving their contents", () => {
    expect(substitutePolicyVariablesInString("$${device.name}", context)).toBe("${device.name}");
    expect(substitutePolicyVariablesInString("$${tenant.name} for ${tenant.name}", context)).toBe(
      "${tenant.name} for Acme Ltd",
    );
  });

  it("walks arrays and objects but leaves keys untouched", () => {
    expect(
      substitutePolicyVariables(
        {
          "${device.name}": "${device.name}",
          list: ["${attribute.cost_centre}", 42, true, null],
          nested: { value: "$${device.serial}" },
        },
        context,
      ),
    ).toEqual({
      "${device.name}": "Alice's MacBook",
      list: ["EMEA", 42, true, null],
      nested: { value: "${device.serial}" },
    });
  });

  it("detects whether a payload needs resolving", () => {
    expect(containsPolicyVariables({ value: "plain" })).toBe(false);
    expect(containsPolicyVariables({ value: "${device.name}" })).toBe(true);
    expect(containsPolicyVariables({ value: "$${device.name}" })).toBe(true);
  });
});

describe("policy variable hints", () => {
  it("lists built-ins and registered attributes with labels", () => {
    const info = policyVariableInfo(
      ["cost_centre"],
      [{ key: "cost_centre", label: "Cost centre" }],
    );

    expect(info.map((entry) => entry.name)).toContain("${device.name}");
    expect(info.map((entry) => entry.name)).toContain("${attribute.cost_centre}");
    expect(info.find((entry) => entry.name === "${attribute.cost_centre}")?.description).toContain(
      "Cost centre",
    );
  });
});
