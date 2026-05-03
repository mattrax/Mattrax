import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import * as pkijs from "pkijs";
import { ScepService, ScepServiceLive } from "../service.js";
import { ScepRepository } from "../repository.js";
import { ScepError } from "../schema.js";
import { certToPem } from "../pkcs7.js";
import {
  generateKeyPair,
  createTestCaCert,
  createTestSignerCert,
  buildTestCsr,
  buildPkcsReq,
  mockScepRepository,
} from "./helpers.js";

if (typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined") {
  try {
    pkijs.getEngine();
  } catch {
    pkijs.setEngine("WebCrypto", crypto, crypto.subtle);
  }
}

function runWithService<A, E>(
  repoLayer: Layer.Layer<ScepRepository>,
  effect: Effect.Effect<A, E, ScepService>,
) {
  const layer = ScepServiceLive.pipe(Layer.provide(repoLayer));
  return effect.pipe(Effect.provide(layer), Effect.runPromise);
}

describe("ScepService", () => {
  describe("getCaCaps", () => {
    it("returns the expected capability string", async () => {
      const repo = mockScepRepository();
      const caps = await runWithService(repo, Effect.gen(function* () {
        const scep = yield* ScepService;
        return yield* scep.getCaCaps();
      }));
      expect(caps).toContain("SHA-256");
      expect(caps).toContain("AES");
      expect(caps).toContain("POSTPKIOperation");
    });
  });

  describe("getCaCert", () => {
    it("generates a new CA when repository returns null", async () => {
      const saved = { certPem: "", privateKeyJwk: {} as JsonWebKey };
      const repo = mockScepRepository({
        getCa: () => Effect.succeed(null),
        saveCa: (certPem, privateKeyJwk) =>
          Effect.sync(() => {
            saved.certPem = certPem;
            saved.privateKeyJwk = privateKeyJwk;
          }),
      });

      const result = await runWithService(repo, Effect.gen(function* () {
        const scep = yield* ScepService;
        return yield* scep.getCaCert();
      }));

      expect(result.raw.byteLength).toBeGreaterThan(0);
      expect(result.isPkcs7).toBe(false);
      expect(saved.certPem).toContain("BEGIN CERTIFICATE");
      expect(saved.privateKeyJwk.kty).toBe("RSA");
    });

    it("reuses an existing valid CA", async () => {
      const keyPair = await generateKeyPair();
      const caCert = await createTestCaCert(keyPair, "Reuse CA");
      const certPem = certToPem(caCert);
      const privateKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey) as JsonWebKey;

      let saveCount = 0;
      const repo = mockScepRepository({
        getCa: () => Effect.succeed({ certPem, privateKeyJwk }),
        saveCa: () =>
          Effect.sync(() => {
            saveCount++;
          }),
      });

      const result = await runWithService(repo, Effect.gen(function* () {
        const scep = yield* ScepService;
        return yield* scep.getCaCert();
      }));

      expect(result.raw.byteLength).toBeGreaterThan(0);
      expect(result.isPkcs7).toBe(false);
      expect(saveCount).toBe(0);
    });

    it("regenerates CA when stored PEM is malformed", async () => {
      let saveCount = 0;
      const repo = mockScepRepository({
        getCa: () => Effect.succeed({ certPem: "invalid-pem", privateKeyJwk: {} as JsonWebKey }),
        saveCa: () =>
          Effect.sync(() => {
            saveCount++;
          }),
      });

      const result = await runWithService(repo, Effect.gen(function* () {
        const scep = yield* ScepService;
        return yield* scep.getCaCert();
      }));

      expect(result.raw.byteLength).toBeGreaterThan(0);
      expect(saveCount).toBe(1);
    });
  });

  describe("pkiOperation", () => {
    it("issues a device certificate from a valid PKCSReq", async () => {
      const caKeyPair = await generateKeyPair();
      const caCert = await createTestCaCert(caKeyPair, "Test CA");
      const caCertPem = certToPem(caCert);
      const caPrivateKeyJwk = await crypto.subtle.exportKey("jwk", caKeyPair.privateKey) as JsonWebKey;

      const deviceKeyPair = await generateKeyPair();
      const signerCert = await createTestSignerCert(deviceKeyPair, "Device");
      const csr = await buildTestCsr(deviceKeyPair, "Device");
      const senderNonce = crypto.getRandomValues(new Uint8Array(16));
      const pkcsReq = await buildPkcsReq(csr, caCert, signerCert, deviceKeyPair.privateKey, "txn-001", senderNonce, true);

      let authenticated = false;
      const repo = mockScepRepository({
        getCa: () => Effect.succeed({ certPem: caCertPem, privateKeyJwk: caPrivateKeyJwk }),
        saveCa: () => Effect.void,
        authenticatePkcsReq: () =>
          Effect.sync(() => {
            authenticated = true;
          }),
      });

      const response = await runWithService(repo, Effect.gen(function* () {
        const scep = yield* ScepService;
        return yield* scep.pkiOperation(pkcsReq);
      }));

      expect(response.byteLength).toBeGreaterThan(0);
      expect(authenticated).toBe(true);

      // Verify outer SignedData
      const contentInfo = pkijs.ContentInfo.fromBER(response);
      expect(contentInfo.contentType).toBe(pkijs.ContentInfo.SIGNED_DATA);
      const signedData = new pkijs.SignedData({ schema: contentInfo.content });
      expect(signedData.certificates).toBeDefined();
      expect(signedData.certificates!.length).toBe(2); // device + CA
    });

    it("rejects when authenticatePkcsReq fails", async () => {
      const caKeyPair = await generateKeyPair();
      const caCert = await createTestCaCert(caKeyPair, "Test CA");
      const caCertPem = certToPem(caCert);
      const caPrivateKeyJwk = await crypto.subtle.exportKey("jwk", caKeyPair.privateKey) as JsonWebKey;

      const deviceKeyPair = await generateKeyPair();
      const signerCert = await createTestSignerCert(deviceKeyPair, "Device");
      const csr = await buildTestCsr(deviceKeyPair, "Device");
      const senderNonce = crypto.getRandomValues(new Uint8Array(16));
      const pkcsReq = await buildPkcsReq(csr, caCert, signerCert, deviceKeyPair.privateKey, "txn-002", senderNonce, true);

      const repo = mockScepRepository({
        getCa: () => Effect.succeed({ certPem: caCertPem, privateKeyJwk: caPrivateKeyJwk }),
        saveCa: () => Effect.void,
        authenticatePkcsReq: () =>
          Effect.fail(new ScepError({ message: "Authentication failed" })),
      });

      const result = await runWithService(repo, Effect.gen(function* () {
        const scep = yield* ScepService;
        return yield* scep.pkiOperation(pkcsReq);
      })).then(() => "Success").catch(() => "Failure");
      expect(result).toBe("Failure");
    });

    it("extracts the CN from the CSR as the subject", async () => {
      const caKeyPair = await generateKeyPair();
      const caCert = await createTestCaCert(caKeyPair, "Test CA");
      const caCertPem = certToPem(caCert);
      const caPrivateKeyJwk = await crypto.subtle.exportKey("jwk", caKeyPair.privateKey) as JsonWebKey;

      const deviceKeyPair = await generateKeyPair();
      const signerCert = await createTestSignerCert(deviceKeyPair, "Device");
      const csr = await buildTestCsr(deviceKeyPair, "MyTestDevice");
      const senderNonce = crypto.getRandomValues(new Uint8Array(16));
      const pkcsReq = await buildPkcsReq(csr, caCert, signerCert, deviceKeyPair.privateKey, "txn-003", senderNonce, true);

      const repo = mockScepRepository({
        getCa: () => Effect.succeed({ certPem: caCertPem, privateKeyJwk: caPrivateKeyJwk }),
        saveCa: () => Effect.void,
        authenticatePkcsReq: () => Effect.void,
      });

      const response = await runWithService(repo, Effect.gen(function* () {
        const scep = yield* ScepService;
        return yield* scep.pkiOperation(pkcsReq);
      }));

      const contentInfo = pkijs.ContentInfo.fromBER(response);
      const signedData = new pkijs.SignedData({ schema: contentInfo.content });
      const deviceCert = signedData.certificates![0] as pkijs.Certificate;

      const cnAttr = deviceCert.subject.typesAndValues.find((a) => a.type === "2.5.4.3");
      expect((cnAttr?.value as any).valueBlock.value).toBe("MyTestDevice");
    });
  });
});
