import { describe, it, expect } from "vitest";
import { Effect, Schema } from "effect";
import {
  generateCaKeyPair,
  exportPrivateKeyJwk,
  importPrivateKeyJwk,
  exportPublicKeySpki,
  signData,
  sha256,
  arrayBufferToBase64,
  base64ToArrayBuffer,
  pemEncode,
  pemDecode,
} from "../crypto.js";

describe("SCEP crypto wrappers", () => {
  describe("generateCaKeyPair", () => {
    it("produces a valid RSA key pair", async () => {
      const keyPair = await generateCaKeyPair().pipe(Effect.runPromise);
      expect(keyPair).toBeDefined();
      expect(keyPair.privateKey).toBeInstanceOf(CryptoKey);
      expect(keyPair.publicKey).toBeInstanceOf(CryptoKey);
      expect(keyPair.privateKey.algorithm.name).toBe("RSASSA-PKCS1-v1_5");
      expect(keyPair.publicKey.algorithm.name).toBe("RSASSA-PKCS1-v1_5");
    });
  });

  describe("exportPrivateKeyJwk / importPrivateKeyJwk", () => {
    it("round-trips a private key", async () => {
      const keyPair = await generateCaKeyPair().pipe(Effect.runPromise);
      const jwk = await exportPrivateKeyJwk(keyPair.privateKey).pipe(Effect.runPromise);
      expect(jwk).toBeDefined();
      expect(jwk.kty).toBe("RSA");
      expect(jwk.d).toBeDefined();

      const imported = await importPrivateKeyJwk(jwk).pipe(Effect.runPromise);
      expect(imported).toBeInstanceOf(CryptoKey);
      expect(imported.type).toBe("private");
    });
  });

  describe("exportPublicKeySpki", () => {
    it("exports a non-empty SPKI buffer", async () => {
      const keyPair = await generateCaKeyPair().pipe(Effect.runPromise);
      const spki = await exportPublicKeySpki(keyPair.publicKey).pipe(Effect.runPromise);
      expect(spki).toBeInstanceOf(ArrayBuffer);
      expect(spki.byteLength).toBeGreaterThan(0);
    });
  });

  describe("signData", () => {
    it("produces a verifiable RSA signature", async () => {
      const keyPair = await generateCaKeyPair().pipe(Effect.runPromise);
      const data = new TextEncoder().encode("hello world");
      const signature = await signData(keyPair.privateKey, data.buffer).pipe(Effect.runPromise);
      expect(signature).toBeInstanceOf(ArrayBuffer);
      expect(signature.byteLength).toBeGreaterThan(0);

      const isValid = await crypto.subtle.verify(
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        keyPair.publicKey,
        signature,
        data,
      );

      expect(isValid).toBe(true);
    });
  });

  describe("sha256", () => {
    it("produces a 32-byte hash", async () => {
      const data = new TextEncoder().encode("test");
      const hash = await sha256(data.buffer).pipe(Effect.runPromise);
      expect(hash).toBeInstanceOf(ArrayBuffer);
      expect(hash.byteLength).toBe(32);
    });

    it("produces deterministic output", async () => {
      const data = new TextEncoder().encode("deterministic");
      const h1 = await sha256(data.buffer).pipe(Effect.runPromise);
      const h2 = await sha256(data.buffer).pipe(Effect.runPromise);
      expect(new Uint8Array(h1)).toEqual(new Uint8Array(h2));
    });
  });

  describe("arrayBufferToBase64 / base64ToArrayBuffer", () => {
    it("round-trips random bytes", () => {
      const bytes = crypto.getRandomValues(new Uint8Array(64));
      const base64 = arrayBufferToBase64(bytes.buffer);
      expect(Schema.is(Schema.String)(base64)).toBe(true);
      expect(base64.length).toBeGreaterThan(0);

      const recovered = base64ToArrayBuffer(base64);
      expect(new Uint8Array(recovered)).toEqual(bytes);
    });
  });

  describe("pemEncode / pemDecode", () => {
    it("round-trips DER data", () => {
      const der = new Uint8Array([0x30, 0x82, 0x01, 0x00]);
      const pem = pemEncode("CERTIFICATE", der.buffer);
      expect(pem).toContain("BEGIN CERTIFICATE");
      expect(pem).toContain("END CERTIFICATE");

      const recovered = pemDecode("CERTIFICATE", pem);
      expect(new Uint8Array(recovered)).toEqual(der);
    });

    it("throws on missing PEM label", () => {
      expect(() => pemDecode("CERTIFICATE", "not a pem")).toThrow("PEM CERTIFICATE not found");
    });
  });
});
