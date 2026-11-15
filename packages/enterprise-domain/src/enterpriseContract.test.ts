import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { EnterpriseInternal, UpdateMeRequest, enterpriseApi } from "./enterprise.ts";
import { Registration } from "./auth.ts";

describe("enterprise API error contract", () => {
  it("gives every endpoint a serializable internal fallback", () => {
    const internal = new EnterpriseInternal({
      message: "Something went wrong on our side. Try again shortly.",
    });

    for (const [identifier, endpoint] of Object.entries(enterpriseApi.endpoints)) {
      const schemas = [...endpoint.error];
      expect(schemas.length, `${identifier} declares no errors`).toBeGreaterThan(0);
      const union = Schema.Union(schemas);
      expect(
        Schema.is(union)(internal),
        `${identifier} does not declare EnterpriseInternal as an error`,
      ).toBe(true);
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

describe("account profile contract", () => {
  const decodeUpdateMe = Schema.decodeUnknownSync(UpdateMeRequest);
  const decodeRegistration = Schema.decodeUnknownSync(Registration);
  const atLimit = "a".repeat(120);
  const overLimit = "a".repeat(121);

  it("caps the display name at the registration limit", () => {
    expect(decodeUpdateMe({ name: atLimit }).name).toBe(atLimit);
    expect(() => decodeUpdateMe({ name: overLimit })).toThrow();

    // Keep the two account-name schemas in lockstep.
    expect(decodeRegistration({ name: atLimit, email: "user@example.com" }).name).toBe(atLimit);
    expect(() => decodeRegistration({ name: overLimit, email: "user@example.com" })).toThrow();
  });

  it("still allows omitting the name or changing only the image", () => {
    expect(decodeUpdateMe({})).toEqual({});
    expect(decodeUpdateMe({ image: null })).toEqual({ image: null });
  });
});
