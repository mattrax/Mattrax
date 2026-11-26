import { Effect } from "effect";
import type { VerifyEmailTokenInput } from "email-verification-api";
import { describe, expect, it } from "vitest";
import {
  newRegistrationNonce,
  readRegistrationNonce,
  registrationNonceCookie,
} from "@mattrax/enterprise-domain";
import {
  proveRegistrationEmail,
  RegistrationTokenVerifier,
  registrationAudience,
  registrationTokenAttempted,
} from "../src/registrationVerification.js";

const proof = (overrides: Partial<Parameters<typeof registrationTokenAttempted>[0]> = {}) => ({
  email: "ada@example.com",
  audience: "https://mattrax.test",
  token: "evt-token",
  nonce: "expected-nonce",
  sessionNonce: "expected-nonce",
  ...overrides,
});

describe("registration nonce lifecycle", () => {
  it("issues a fresh random nonce each form render", () => {
    const first = newRegistrationNonce();
    const second = newRegistrationNonce();

    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).not.toBe(first);
  });

  it("round-trips the cookie with origin, path and lifetime flags", () => {
    const nonce = newRegistrationNonce();
    const cookie = registrationNonceCookie(nonce, true);

    expect(cookie).toContain("mattrax_register_nonce=" + nonce);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(readRegistrationNonce(cookie.split(";")[0])).toBe(nonce);
  });

  it("omits Secure on a local HTTP origin", () => {
    expect(registrationNonceCookie("nonce", false)).not.toContain("Secure");
  });

  it("rejects a nonce from another session", () => {
    const foreign = newRegistrationNonce();
    const mine = newRegistrationNonce();

    // The browser that received `foreign` presents it, but the submitted form
    // carries `mine`; neither can borrow the other's binding.
    expect(registrationTokenAttempted(proof({ nonce: mine, sessionNonce: foreign }))).toBe(false);
    expect(registrationTokenAttempted(proof({ nonce: mine, sessionNonce: undefined }))).toBe(false);
    expect(registrationTokenAttempted(proof({ token: undefined }))).toBe(false);
    expect(registrationTokenAttempted(proof({ nonce: undefined }))).toBe(false);
    expect(registrationTokenAttempted(proof())).toBe(true);
  });

  it("does not accept a missing, foreign or malformed cookie", () => {
    expect(readRegistrationNonce(undefined)).toBeUndefined();
    expect(readRegistrationNonce("other=value")).toBeUndefined();
    expect(readRegistrationNonce("mattrax_register_nonce=")).toBeUndefined();
    expect(readRegistrationNonce("mattrax_register_nonce=%E0%A4%A")).toBeUndefined();
  });
});

describe("registration audience", () => {
  it("uses the public origin the web Worker forwarded", () => {
    expect(registrationAudience("https://mattrax.test", "https://tenant.example.com")).toBe(
      "https://tenant.example.com",
    );
  });

  it("uses the API request URL when no proxy header was forwarded", () => {
    expect(
      registrationAudience(
        "https://mattrax.test",
        undefined,
        "https://tenant.example.com/api/v1/register/verification",
      ),
    ).toBe("https://tenant.example.com");
  });

  it("falls back to the configured origin for an unusable header", () => {
    expect(registrationAudience("https://mattrax.test", "not a url")).toBe("https://mattrax.test");
    expect(registrationAudience("https://mattrax.test", "http://tenant.example.com")).toBe(
      "https://mattrax.test",
    );
    expect(
      registrationAudience("https://mattrax.test", "not a url", "http://loopback:8787/api"),
    ).toBe("https://mattrax.test");
  });
});

const verifierFake = (outcome: "ok" | "invalid" | "throws") => {
  const calls: Array<VerifyEmailTokenInput> = [];
  const service = RegistrationTokenVerifier.of({
    verify: (input) => {
      calls.push(input);

      return outcome === "throws"
        ? Promise.reject(new Error("issuer unreachable"))
        : Promise.resolve({ ok: outcome === "ok" });
    },
  });

  return { calls, service };
};

const verifyWith = <A>(effect: Effect.Effect<A>, service: RegistrationTokenVerifier.Service) =>
  Effect.runPromise(effect.pipe(Effect.provideService(RegistrationTokenVerifier, service)));

describe("registration email token proof", () => {
  it("verifies when the token and this session's nonce are present", async () => {
    const { calls, service } = verifierFake("ok");

    await expect(verifyWith(proveRegistrationEmail(proof()), service)).resolves.toBe(true);
    expect(calls).toEqual([
      expect.objectContaining({
        email: "ada@example.com",
        token: "evt-token",
        nonce: "expected-nonce",
        audience: "https://mattrax.test",
      }),
    ]);
  });

  it("is absent without a token and never calls the verifier", async () => {
    const { calls, service } = verifierFake("ok");

    await expect(
      verifyWith(proveRegistrationEmail(proof({ token: undefined })), service),
    ).resolves.toBe(false);
    expect(calls).toEqual([]);
  });

  it("is invalid when the issuer rejects the token", async () => {
    const { service } = verifierFake("invalid");

    await expect(verifyWith(proveRegistrationEmail(proof()), service)).resolves.toBe(false);
  });

  it("is invalid when verification throws", async () => {
    const { service } = verifierFake("throws");

    await expect(verifyWith(proveRegistrationEmail(proof()), service)).resolves.toBe(false);
  });

  it("never calls the verifier for a nonce from another session", async () => {
    const { calls, service } = verifierFake("ok");

    await expect(
      verifyWith(proveRegistrationEmail(proof({ sessionNonce: newRegistrationNonce() })), service),
    ).resolves.toBe(false);
    expect(calls).toEqual([]);
  });
});
