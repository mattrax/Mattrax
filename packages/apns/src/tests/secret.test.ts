import { describe, expect, it } from "vitest";
import { openSecret, sealSecret } from "@mattrax/crypto";

describe("secret sealing", () => {
  it("round-trips a JSON secret without storing plaintext", async () => {
    const secret = "auth-secret-for-tests";
    const plaintext = JSON.stringify({ kty: "RSA", n: "abc", e: "AQAB", d: "private" });
    const sealed = await sealSecret(secret, plaintext);

    expect(sealed).not.toContain("private");
    await expect(openSecret(secret, sealed)).resolves.toBe(plaintext);
  });

  it("produces different ciphertext for the same plaintext", async () => {
    const secret = "auth-secret-for-tests";
    const first = await sealSecret(secret, "hello");
    const second = await sealSecret(secret, "hello");
    expect(first).not.toBe(second);
  });

  it("fails to open with the wrong secret", async () => {
    const sealed = await sealSecret("correct", "hello");
    await expect(openSecret("incorrect", sealed)).rejects.toBeDefined();
  });

  it("rejects malformed payloads", async () => {
    await expect(openSecret("secret", "bm90LWEtcmVhbC1wYXlsb2Fk")).rejects.toThrow();
  });
});
