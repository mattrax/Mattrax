import { describe, expect, it } from "vitest";
import { DateTime, Effect, Schema } from "effect";
import { Sessions, Totp } from "@yielded/auth";
import { authenticationRequirement, Registration, TOTP_POLICY } from "./auth.ts";

const at = DateTime.makeUnsafe(Date.now());

const evidence = (
  proofs: ReadonlyArray<{
    credentialId: string;
    method: string;
    factors: ReadonlyArray<"knowledge" | "possession" | "inherence">;
    userVerified?: boolean;
    phishingResistant?: boolean;
  }>,
): Sessions.AuthenticationEvidence =>
  Schema.decodeUnknownSync(Sessions.AuthenticationEvidence)({
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
      verifiedAt: DateTime.toEpochMillis(at),
    })),
  });

const assess = (proofs: Parameters<typeof evidence>[0], totp: boolean) =>
  Effect.runPromise(
    Sessions.assessAuthentication(evidence(proofs), authenticationRequirement(totp)),
  );

describe("registration contract", () => {
  it("requires a non-empty mailbox grant", async () => {
    await expect(
      Effect.runPromise(
        Schema.decodeUnknownEffect(Registration)({
          name: "Ada Lovelace",
          email: "ada@example.com",
        }),
      ),
    ).rejects.toBeDefined();
    await expect(
      Effect.runPromise(
        Schema.decodeUnknownEffect(Registration)({
          name: "Ada Lovelace",
          email: "ada@example.com",
          grant: "",
        }),
      ),
    ).rejects.toBeDefined();
  });

  it("normalizes the email while preserving the grant", async () => {
    const registration = await Effect.runPromise(
      Schema.decodeUnknownEffect(Registration)({
        name: "Ada Lovelace",
        email: "  ADA@Example.COM ",
        grant: "mailbox-proof",
      }),
    );

    expect(registration).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
      grant: "mailbox-proof",
    });
  });
});

describe("sign-in assurance", () => {
  it("requires a user-verified phishing-resistant passkey", () => {
    const requirement = authenticationRequirement(false);

    expect(
      requirement.alternatives.some(
        (item) =>
          item.minimumCredentials === 1 &&
          item.factors.length === 1 &&
          item.factors[0] === "possession" &&
          item.userVerified &&
          item.phishingResistant,
      ),
    ).toBe(true);
    expect(requirement.alternatives.some((item) => item.factors.includes("knowledge"))).toBe(false);
  });

  it("adds an authenticator code as a second credential", () => {
    const requirement = authenticationRequirement(true);

    expect(requirement.alternatives).toHaveLength(2);
    expect(requirement.alternatives[0]).toMatchObject({
      factors: ["possession"],
      minimumCredentials: 2,
      userVerified: true,
      phishingResistant: true,
    });
    expect(requirement.alternatives[1]).toMatchObject({
      factors: ["possession"],
      minimumCredentials: 2,
      userVerified: true,
      phishingResistant: false,
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

const sso = {
  credentialId: "sso-1",
  method: "sso-oidc",
  factors: ["possession"] as const,
  userVerified: true,
  phishingResistant: false,
};

describe("MFA assessment", () => {
  it("accepts a user-verified phishing-resistant passkey on its own", async () => {
    const result = await assess([passkey], false);
    expect(result.satisfied).toBe(true);
    expect(result.assurance.factors).toEqual(["possession"]);
  });

  it("does not accept an authenticator code alone", async () => {
    expect((await assess([totp], false)).satisfied).toBe(false);
    expect((await assess([totp], true)).satisfied).toBe(false);
  });

  it("requires the authenticator code when TOTP is enabled", async () => {
    expect((await assess([passkey], true)).satisfied).toBe(false);
    expect((await assess([passkey, totp], true)).satisfied).toBe(true);
  });

  it("keeps SSO as an enterprise alternative", async () => {
    expect((await assess([sso], false)).satisfied).toBe(true);
    expect((await assess([sso], true)).satisfied).toBe(false);
    expect((await assess([sso, totp], true)).satisfied).toBe(true);
  });
});
