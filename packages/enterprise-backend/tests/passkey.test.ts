import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { Passkey } from "@yielded/auth";
import * as PasskeyServer from "@yielded/auth-simplewebauthn/Server";
import { authRequirementForSubject, hasMfaFactor } from "@mattrax/enterprise-core";
import { passkeyProfile } from "../src/auth.js";

const buildVerifier = (profile: ReturnType<typeof passkeyProfile>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* Passkey.PasskeyProtocol;
    }).pipe(
      Effect.provide(PasskeyServer.layer.pipe(Layer.provide(Passkey.PasskeyConfig.layer(profile)))),
    ),
  );

describe("passkey relying party", () => {
  it("uses the deployment origin as the RP id", () => {
    const profile = passkeyProfile("https://mattrax.example.com");
    expect(profile).toMatchObject({
      id: "mattrax.example.com",
      origins: ["https://mattrax.example.com"],
      developmentLocalhost: false,
    });
  });

  it("allows localhost over HTTP in development", () => {
    const profile = passkeyProfile("http://localhost:9050");
    expect(profile).toMatchObject({
      id: "localhost",
      origins: ["http://localhost:9050"],
      developmentLocalhost: true,
    });
  });

  it("adds same-site trusted origins and drops anything that would widen the RP", () => {
    const profile = passkeyProfile("https://mattrax.example.com", [
      "https://app.mattrax.example.com",
      "https://mattrax.example.com",
      "https://evil.example.net",
      "http://mattrax.example.com",
      "not a url",
    ]);

    expect([...profile.origins].sort()).toEqual([
      "https://app.mattrax.example.com",
      "https://mattrax.example.com",
    ]);
  });

  it("fails closed when the origin cannot host WebAuthn", () => {
    expect(passkeyProfile(undefined).id).toBe("passkeys.invalid");
    expect(passkeyProfile("http://192.168.1.10:9050").id).toBe("passkeys.invalid");
    expect(passkeyProfile("http://mattrax.example.com").id).toBe("passkeys.invalid");
    expect(passkeyProfile("not a url").id).toBe("passkeys.invalid");
  });

  it("is accepted by the maintained WebAuthn verifier", async () => {
    await expect(buildVerifier(passkeyProfile("http://localhost:9050"))).resolves.toBeDefined();
    await expect(
      buildVerifier(passkeyProfile("https://mattrax.example.com")),
    ).resolves.toBeDefined();
  });
});

describe("passkey as an MFA factor", () => {
  it("treats either factor as MFA being enabled", () => {
    expect(hasMfaFactor({ totpEnabled: true, passkeyEnabled: false })).toBe(true);
    expect(hasMfaFactor({ totpEnabled: false, passkeyEnabled: true })).toBe(true);
    expect(hasMfaFactor({ totpEnabled: false, passkeyEnabled: false })).toBe(false);
    expect(hasMfaFactor({})).toBe(false);
  });

  it("keeps passkey-only accounts on the single passkey requirement", () => {
    const requirement = authRequirementForSubject({
      totpEnabled: false,
      passkeyEnabled: true,
    });

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
  });

  it("requires a second credential once TOTP is enabled", () => {
    const requirement = authRequirementForSubject({
      totpEnabled: true,
      passkeyEnabled: true,
    });

    expect(
      requirement.alternatives.some(
        (item) =>
          item.minimumCredentials === 2 &&
          item.factors.length === 1 &&
          item.factors[0] === "possession" &&
          item.userVerified &&
          item.phishingResistant,
      ),
    ).toBe(true);
  });
});
