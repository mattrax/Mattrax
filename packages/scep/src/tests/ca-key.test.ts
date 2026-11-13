import { describe, expect, it } from "vitest";
import { exportPrivateKeyJwk, generateCaKeyPair } from "@mattrax/crypto";
import {
  ScepCaKeyError,
  isPrivateRsaJwk,
  isSealedCaPrivateKey,
  openCaPrivateKey,
  sealCaPrivateKey,
} from "../ca-key.js";

const secret = "scep-ca-test-secret";

const makeJwk = async () => {
  const keyPair = await generateCaKeyPair();

  return exportPrivateKeyJwk(keyPair.privateKey);
};

/** Flip one bit in the ciphertext so the GCM tag no longer verifies. */
const tamper = (base64: string) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  const last = bytes.byteLength - 1;
  bytes[last] = bytes[last]! ^ 0x01;
  let out = "";

  for (const byte of bytes) out += String.fromCharCode(byte);

  return btoa(out);
};

describe("SCEP CA private key sealing", () => {
  it("seals and opens a round trip without changing the key", async () => {
    const jwk = await makeJwk();
    const sealed = await sealCaPrivateKey(secret, jwk);

    expect(sealed.v).toBe(1);
    expect(typeof sealed.sealed).toBe("string");
    expect(isSealedCaPrivateKey(sealed)).toBe(true);

    const opened = await openCaPrivateKey(sealed, secret);
    expect(opened.privateKeyJwk).toEqual(jwk);
    expect(opened.migrated).toBeUndefined();
  });

  it("never writes the plaintext JWK into the envelope", async () => {
    const jwk = await makeJwk();
    const sealed = await sealCaPrivateKey(secret, jwk);

    expect(Object.keys(sealed).sort()).toEqual(["sealed", "v"]);
    const serialized = JSON.stringify(sealed);
    expect(serialized).not.toContain(jwk.d!);
    expect(serialized).not.toContain(jwk.n!);
    expect(serialized).not.toContain("kty");
    expect(jwk.d).toBeTruthy();
  });

  it("migrates a legacy plaintext JWK on read", async () => {
    const jwk = await makeJwk();
    const opened = await openCaPrivateKey(jwk, secret);

    expect(opened.privateKeyJwk).toEqual(jwk);
    expect(opened.migrated).toBeDefined();
    expect(isSealedCaPrivateKey(opened.migrated)).toBe(true);

    // The envelope it asks the caller to persist opens back to the same key.
    const reloaded = await openCaPrivateKey(opened.migrated, secret);
    expect(reloaded.privateKeyJwk).toEqual(jwk);
    expect(reloaded.migrated).toBeUndefined();
  });

  it("migrates a plaintext JWK stored as JSON text (D1/fs)", async () => {
    const jwk = await makeJwk();
    const opened = await openCaPrivateKey(JSON.stringify(jwk), secret);
    expect(opened.privateKeyJwk).toEqual(jwk);
    expect(opened.migrated).toBeDefined();
  });

  it("fails closed when a sealed value is tampered with", async () => {
    const jwk = await makeJwk();
    const sealed = await sealCaPrivateKey(secret, jwk);
    const corrupted = { v: 1 as const, sealed: tamper(sealed.sealed) };

    await expect(openCaPrivateKey(corrupted, secret)).rejects.toMatchObject({
      _tag: "ScepCaKeyError",
      reason: "decrypt_failed",
    });
  });

  it("fails closed when the sealed value was written with another secret", async () => {
    const jwk = await makeJwk();
    const sealed = await sealCaPrivateKey("another-secret", jwk);

    await expect(openCaPrivateKey(sealed, secret)).rejects.toMatchObject({
      _tag: "ScepCaKeyError",
      reason: "decrypt_failed",
    });
  });

  it("fails closed when no application secret is configured", async () => {
    const jwk = await makeJwk();
    const sealed = await sealCaPrivateKey(secret, jwk);

    for (const stored of [sealed, jwk]) {
      await expect(openCaPrivateKey(stored, undefined)).rejects.toMatchObject({
        _tag: "ScepCaKeyError",
        reason: "missing_secret",
        message: expect.stringContaining("AUTH_SECRET"),
      });
    }

    await expect(sealCaPrivateKey(undefined, jwk)).rejects.toMatchObject({
      _tag: "ScepCaKeyError",
      reason: "missing_secret",
    });
  });

  it("rejects malformed stored values without leaking them", async () => {
    const jwk = await makeJwk();

    const cases: unknown[] = [
      {},
      { v: 2, sealed: "abc" },
      { v: 1 },
      { v: 1, sealed: "" },
      "not json",
      JSON.stringify({ kty: "RSA" }),
      { kty: "RSA", n: jwk.n, d: "" },
    ];

    for (const stored of cases) {
      const error = await openCaPrivateKey(stored, secret).catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(ScepCaKeyError);
      expect((error as ScepCaKeyError).reason).toBe("invalid");
      expect((error as ScepCaKeyError).message).not.toContain(jwk.d!);
    }
  });

  it("does not attach key material to decrypt errors", async () => {
    const jwk = await makeJwk();
    const sealed = await sealCaPrivateKey(secret, jwk);

    const error = (await openCaPrivateKey({ v: 1, sealed: tamper(sealed.sealed) }, secret).catch(
      (cause: unknown) => cause,
    )) as ScepCaKeyError;

    expect(JSON.stringify(error)).not.toContain(sealed.sealed);
    expect((error as { cause?: unknown }).cause).toBeUndefined();
  });

  it("validates RSA private JWK shape", async () => {
    const jwk = await makeJwk();
    expect(isPrivateRsaJwk(jwk)).toBe(true);
    expect(isPrivateRsaJwk({ kty: "RSA", n: "abc" })).toBe(false);
    expect(isPrivateRsaJwk({ kty: "RSA", n: "abc", d: "" })).toBe(false);
    expect(isPrivateRsaJwk(null)).toBe(false);
  });
});
