import { describe, expect, it } from "vitest";
import {
  generateCaKeyPair,
  importPrivateKeyJwk,
  openSecret,
  pemDecode,
  pemEncode,
  sealSecret,
  signData,
} from "../src/index.ts";

describe("crypto boundaries", () => {
  it("generates keys with the fixed RSA/SHA-256 parameters", async () => {
    const keyPair = await generateCaKeyPair();

    // The wrapper does not take algorithm parameters from callers: every
    // signature it produces must be RSASSA-PKCS1-v1_5 over SHA-256.
    expect(keyPair.privateKey.algorithm).toMatchObject({
      name: "RSASSA-PKCS1-v1_5",
      hash: { name: "SHA-256" },
      modulusLength: 2048,
    });
  });

  it("rejects a JWK for a different algorithm", async () => {
    const ec = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]);

    const jwk = await crypto.subtle.exportKey("jwk", ec.privateKey);

    // The import fixes RSASSA-PKCS1-v1_5, so WebCrypto must reject a key that
    // does not fit instead of the wrapper casting it through.
    await expect(importPrivateKeyJwk(jwk)).rejects.toThrow();
  });

  it("rejects a signing key that is not an RSA private key", async () => {
    const aes = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
      "encrypt",
      "decrypt",
    ]);

    await expect(signData(aes, new ArrayBuffer(8))).rejects.toThrow();
  });

  it("seals and opens a secret, and rejects a tampered payload", async () => {
    const sealed = await sealSecret("application-secret", "hello");

    await expect(openSecret("application-secret", sealed)).resolves.toBe("hello");
    // AES-GCM authenticates the ciphertext, so another key cannot open it.
    await expect(openSecret("another-secret", sealed)).rejects.toThrow();

    const tampered = Buffer.from(sealed, "base64");

    tampered[tampered.length - 1]! ^= 0xff;
    await expect(openSecret("application-secret", tampered.toString("base64"))).rejects.toThrow();
    // A payload shorter than the 12-byte IV is malformed, not a decryption
    // failure with an untyped cause.
    await expect(openSecret("application-secret", "AAAA")).rejects.toThrow(
      "Sealed secret is malformed",
    );
  });

  it("rejects a PEM block whose label does not match", () => {
    const pem = pemEncode("PRIVATE KEY", new ArrayBuffer(8));

    expect(() => pemDecode("CERTIFICATE", pem)).toThrow("PEM CERTIFICATE not found");
    expect(() => pemDecode("CERTIFICATE", "not a pem at all")).toThrow("PEM CERTIFICATE not found");
  });
});
