import { describe, expect, it } from "vitest";
import { DateTime, Effect, Schema } from "effect";
import { Sessions, Totp } from "@yielded/auth";
import { authenticationRequirement, TOTP_POLICY } from "./auth.ts";

const at = DateTime.makeUnsafe(Date.now());

const evidence = (
  proofs: ReadonlyArray<{
    credentialId: string;
    method: string;
    factors: ReadonlyArray<"knowledge" | "possession" | "inherence">;
    userVerified?: boolean;
    phishingResistant?: boolean;
  }>,
) => ({
  revision: {
    subjectId: "subject-1",
    securityRevision: "revision-1",
    credentials: proofs.map((proof) => ({ credentialId: proof.credentialId, revision: "1" })),
  },
  flowId: "flow-1",
  bindingDigest: "digest-1",
  proofs: proofs.map((proof) => ({
    method: proof.method,
    credentialId: proof.credentialId,
    factors: [...proof.factors],
    userVerified: proof.userVerified ?? false,
    phishingResistant: proof.phishingResistant ?? false,
    verifiedAt: at,
  })),
});

const assess = (proofs: Parameters<typeof evidence>[0], mfa: boolean) =>
  Effect.runPromise(
    Sessions.assessAuthentication(evidence(proofs) as any, authenticationRequirement(mfa)),
  );

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
    expect(requirement.alternatives).toHaveLength(2);
    const [passwordAlternative, passkeyAlternative] = requirement.alternatives;
    expect(passwordAlternative!.factors).toEqual(
      expect.arrayContaining(["knowledge", "possession"]),
    );
    expect(passwordAlternative!.minimumCredentials).toBe(2);
    expect(passwordAlternative!.phishingResistant).toBe(false);
    expect(passkeyAlternative).toMatchObject({
      factors: ["possession"],
      minimumCredentials: 1,
      userVerified: true,
      phishingResistant: true,
    });
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

const password = {
  credentialId: "password-1",
  method: "password",
  factors: ["knowledge"] as const,
};

const totp = {
  credentialId: "totp-1",
  method: "totp",
  factors: ["possession"] as const,
};

const passkey = {
  credentialId: "passkey-1",
  method: "passkey",
  factors: ["possession"] as const,
  userVerified: true,
  phishingResistant: true,
};

const emailCode = {
  credentialId: "email-1",
  method: "email",
  factors: ["possession"] as const,
};

describe("MFA assessment", () => {
  it("accepts password plus authenticator code", async () => {
    const result = await assess([password, totp], true);
    expect(result.satisfied).toBe(true);
  });

  it("accepts a user-verified phishing-resistant passkey on its own", async () => {
    const result = await assess([passkey], true);
    expect(result.satisfied).toBe(true);
    expect(result.assurance.factors).toEqual(["possession"]);
  });

  it("does not accept a password, authenticator code or email code alone", async () => {
    expect((await assess([password], true)).satisfied).toBe(false);
    expect((await assess([totp], true)).satisfied).toBe(false);
    // Possession without user verification is not a phishing-resistant passkey.
    expect((await assess([emailCode], true)).satisfied).toBe(false);
  });

  it("keeps single-factor sign-in for accounts without MFA", async () => {
    expect((await assess([password], false)).satisfied).toBe(true);
    expect((await assess([emailCode], false)).satisfied).toBe(true);
    expect((await assess([passkey], false)).satisfied).toBe(true);
  });

  it("accepts a passkey for a passwordless account that requires MFA", async () => {
    // `passkeyEnabled` alone puts the account on the MFA requirement; a
    // passwordless account therefore signs in with its passkey.
    expect((await assess([passkey], true)).satisfied).toBe(true);
  });
});
