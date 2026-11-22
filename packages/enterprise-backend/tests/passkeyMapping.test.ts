import { describe, expect, it } from "vitest";
import { passkeyRegistrationMapping } from "@mattrax/enterprise-core/schema";

/**
 * Password managers label passkey entries with the WebAuthn username, and
 * Hyperdrive can return MySQL BIGINT columns as strings. Both boundaries are
 * easy to regress because the passkey library treats them as opaque values.
 */
describe("passkey registration mapping", () => {
  it("uses the email as the WebAuthn username", () => {
    expect(
      passkeyRegistrationMapping.registration.describe({
        name: "Ada Lovelace",
        email: "ada@example.com",
      }),
    ).toEqual({ name: "ada@example.com", displayName: "Ada Lovelace" });
  });

  it("coerces MySQL BIGINT instants to numbers", () => {
    expect(passkeyRegistrationMapping.clock.decodeInstant("1795384204612")).toBe(
      1795384204612,
    );
  });
});
