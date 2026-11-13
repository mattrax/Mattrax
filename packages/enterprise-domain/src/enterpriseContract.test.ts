import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { EnterpriseInternal, enterpriseApi } from "./enterprise.ts";

describe("enterprise API error contract", () => {
  it("gives every endpoint a serializable internal fallback", () => {
    const internal = new EnterpriseInternal({
      message: "Something went wrong on our side. Try again shortly.",
    });

    for (const [identifier, endpoint] of Object.entries(enterpriseApi.endpoints)) {
      const schemas = [...endpoint.error];
      expect(schemas.length, `${identifier} declares no errors`).toBeGreaterThan(0);
      const union = Schema.Union(schemas as any);
      expect(
        () => Schema.encodeUnknownSync(union as any)(internal),
        `${identifier} cannot encode EnterpriseInternal`,
      ).not.toThrow();
    }
  });

  it("keeps successful identifiers stable and unique", () => {
    const names = Object.keys(enterpriseApi.endpoints);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("searchDevices");
    expect(names).toContain("createPolicy");
    expect(names).not.toContain("deleteMeAccount");
  });
});
