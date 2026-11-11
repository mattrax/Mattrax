import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { Totp } from "@yielded/auth";
import { authenticationRequirement, TOTP_POLICY } from "./auth.ts";

describe("sign-in assurance", () => {
  it("keeps single-factor sign-in for accounts without an authenticator", () => {
    const requirement = authenticationRequirement(false);
    expect(
      requirement.alternatives.some(
        (item) => item.minimumCredentials === 1 && item.factors.includes("knowledge"),
      ),
    ).toBe(true);
    expect(
      requirement.alternatives.some(
        (item) => item.minimumCredentials === 1 && item.factors.includes("possession"),
      ),
    ).toBe(true);
  });

  it("requires password and authenticator together when MFA is enabled", () => {
    const requirement = authenticationRequirement(true);
    expect(requirement.alternatives).toHaveLength(1);
    const [alternative] = requirement.alternatives;
    expect(alternative!.factors).toEqual(expect.arrayContaining(["knowledge", "possession"]));
    expect(alternative!.minimumCredentials).toBe(2);
  });
});

describe("TOTP policy", () => {
  it("stays inside the library's reveal and evidence bounds", async () => {
    const policy = await Effect.runPromise(Schema.decodeEffect(Totp.TotpPolicy)(TOTP_POLICY));
    expect(policy.revealLifetimeMillis).toBeLessThanOrEqual(300_000);
    expect(policy.maximumEvidenceAgeMillis).toBeLessThanOrEqual(300_000);
    expect(policy.requireImmediateInvalidation).toBe(true);
    expect(policy.allowRecoveryCodeForPending).toBe(true);
  });
});
