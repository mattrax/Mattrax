import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
  Crypto,
  CryptoError,
  generateCaKeyPair,
  importPrivateKeyJwk,
  openWithPassphrase,
  openSecret,
  PASSPHRASE_PBKDF2_MIN_ITERATIONS,
  pemDecode,
  pemEncode,
  sealWithPassphrase,
  sealSecret,
  signScopedToken,
  signData,
  verifyScopedToken,
} from "../src/index.ts";

describe("Effect crypto API", () => {
  it("reports invalid key material as a typed CryptoError", async () => {
    const error = await Crypto.importPrivateKeyJwk({}).pipe(Effect.flip, Effect.runPromise);

    expect(error).toBeInstanceOf(CryptoError);
    expect(error._tag).toBe("CryptoError");
  });

  it("reports malformed ciphertext as a typed CryptoError", async () => {
    const error = await Crypto.openSecret("secret", "AAAA").pipe(Effect.flip, Effect.runPromise);

    expect(error).toBeInstanceOf(CryptoError);
  });

  it("reports malformed PEM as a typed CryptoError", async () => {
    const error = await Crypto.pemDecode("CERTIFICATE", "not-a-pem").pipe(
      Effect.flip,
      Effect.runPromise,
    );

    expect(error).toBeInstanceOf(CryptoError);
  });
});

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

    // `.at()` returns the value, so it cannot be an assignment target.
    // oxlint-disable-next-line unicorn/prefer-at -- the array index is assigned through.
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

describe("passphrase-sealed handover envelopes", () => {
  // The production work factor is 600,000, but the tests only need to prove the
  // construction and the lower bound enforcement, so they use the floor.
  const iterations = PASSPHRASE_PBKDF2_MIN_ITERATIONS;

  it("seals and opens an archive with the supplied passphrase", async () => {
    const envelope = await sealWithPassphrase(
      "correct horse battery staple",
      JSON.stringify({ serial: "C02XYZ", recoveryKey: "AAAA-BBBB" }),
      { iterations },
    );

    // The envelope carries the KDF parameters but no verifier for the
    // passphrase and no plaintext.
    expect(envelope).toMatchObject({
      version: 1,
      kdf: { name: "PBKDF2", hash: "SHA-256", iterations },
      cipher: { name: "AES-GCM" },
    });
    expect(JSON.stringify(envelope)).not.toContain("correct horse");
    expect(JSON.stringify(envelope)).not.toContain("AAAA-BBBB");

    await expect(openWithPassphrase("correct horse battery staple", envelope)).resolves.toBe(
      JSON.stringify({ serial: "C02XYZ", recoveryKey: "AAAA-BBBB" }),
    );
  });

  it("rejects a wrong passphrase and a tampered ciphertext", async () => {
    const envelope = await sealWithPassphrase("right", "archive", { iterations });

    await expect(openWithPassphrase("wrong", envelope)).rejects.toThrow(
      "The passphrase is incorrect or the archive has been modified",
    );

    const ciphertext = Buffer.from(envelope.ciphertext, "base64");

    // oxlint-disable-next-line unicorn/prefer-at -- the array index is assigned through.
    ciphertext[ciphertext.length - 1]! ^= 0xff;
    await expect(
      openWithPassphrase("right", { ...envelope, ciphertext: ciphertext.toString("base64") }),
    ).rejects.toThrow("The passphrase is incorrect or the archive has been modified");
  });

  it("rejects a modified header, unknown version and weak work factor", async () => {
    const envelope = await sealWithPassphrase("right", "archive", { iterations });

    await expect(
      openWithPassphrase("right", {
        ...envelope,
        kdf: { ...envelope.kdf, salt: "AAAAAAAAAAAAAAAAAAAAAA==" },
      }),
    ).rejects.toThrow("The passphrase is incorrect or the archive has been modified");

    await expect(openWithPassphrase("right", { ...envelope, version: 99 })).rejects.toThrow(
      "Unsupported passphrase envelope version: 99",
    );

    await expect(
      openWithPassphrase("right", {
        ...envelope,
        kdf: { ...envelope.kdf, iterations: 1 },
      }),
    ).rejects.toThrow("Passphrase envelope has an unsupported work factor");

    await expect(
      openWithPassphrase("right", { ...envelope, ciphertext: "not base64!" }),
    ).rejects.toThrow("Passphrase envelope is not valid base64");
  });

  it("seals an envelope at the production work factor", async () => {
    const envelope = await sealWithPassphrase("production", "archive");

    expect(envelope.kdf.iterations).toBe(600_000);
    await expect(openWithPassphrase("production", envelope)).resolves.toBe("archive");
  });
});

describe("scoped download tokens", () => {
  const secret = "download-token-secret";
  const now = Date.UTC(2026, 0, 1, 12);
  const expiresAt = Math.floor(now / 1000) + 600;

  it("verifies a token for its own scope and expiry", async () => {
    const token = await signScopedToken(secret, "device-handover", "archive-1", expiresAt);

    await expect(
      verifyScopedToken(secret, "device-handover", "archive-1", token, now),
    ).resolves.toBe(true);
  });

  it("rejects an expired, tampered or differently scoped token", async () => {
    const token = await signScopedToken(secret, "device-handover", "archive-1", expiresAt);

    await expect(
      verifyScopedToken(secret, "device-handover", "archive-1", token, expiresAt * 1000),
    ).resolves.toBe(false);
    await expect(
      verifyScopedToken(secret, "device-handover", "archive-2", token, now),
    ).resolves.toBe(false);
    await expect(
      verifyScopedToken("another-secret", "device-handover", "archive-1", token, now),
    ).resolves.toBe(false);
    await expect(
      verifyScopedToken(secret, "device-handover", "archive-1", `${expiresAt}.forged`, now),
    ).resolves.toBe(false);
    await expect(
      verifyScopedToken(secret, "device-handover", "archive-1", "not-a-token", now),
    ).resolves.toBe(false);
  });
});
