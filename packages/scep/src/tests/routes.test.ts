import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { scepRoutes } from "../routes.js";
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

async function makeScepHandler(repoLayer: Layer.Layer<ScepRepository>) {
  const serviceLayer = ScepServiceLive.pipe(Layer.provideMerge(repoLayer));
  const appLayer = scepRoutes.pipe(Layer.provideMerge(serviceLayer));
  const { handler } = HttpRouter.toWebHandler(appLayer);
  return handler;
}

describe("SCEP routes", () => {
  describe("GET /mdm/apple/scep", () => {
    it("returns CA caps for GetCACaps", async () => {
      const repo = mockScepRepository();
      const handler = await makeScepHandler(repo);
      const request = new Request("http://localhost/mdm/apple/scep?operation=GetCACaps");
      const response = await handler(request);
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain("SHA-256");
    });

    it("returns CA cert for GetCACert", async () => {
      const keyPair = await generateKeyPair();
      const caCert = await createTestCaCert(keyPair, "Route CA");
      const certPem = certToPem(caCert);
      const privateKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey) as JsonWebKey;

      const repo = mockScepRepository({
        getCa: () => Effect.succeed({ certPem, privateKeyJwk }),
      });
      const handler = await makeScepHandler(repo);
      const request = new Request("http://localhost/mdm/apple/scep?operation=GetCACert");
      const response = await handler(request);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/x-x509-ca-cert");
      const body = await response.arrayBuffer();
      expect(body.byteLength).toBeGreaterThan(0);
    });

    it("returns 400 for missing operation", async () => {
      const repo = mockScepRepository();
      const handler = await makeScepHandler(repo);
      const request = new Request("http://localhost/mdm/apple/scep");
      const response = await handler(request);
      expect(response.status).toBe(400);
    });

    it("returns 400 for invalid operation", async () => {
      const repo = mockScepRepository();
      const handler = await makeScepHandler(repo);
      const request = new Request("http://localhost/mdm/apple/scep?operation=InvalidOperation");
      const response = await handler(request);
      expect(response.status).toBe(400);
    });
  });

  describe("POST /mdm/apple/scep", () => {
    it("returns a CertRep for valid PKIOperation", async () => {
      const caKeyPair = await generateKeyPair();
      const caCert = await createTestCaCert(caKeyPair, "Post CA");
      const caCertPem = certToPem(caCert);
      const caPrivateKeyJwk = await crypto.subtle.exportKey("jwk", caKeyPair.privateKey) as JsonWebKey;

      const deviceKeyPair = await generateKeyPair();
      const signerCert = await createTestSignerCert(deviceKeyPair, "PostDevice");
      const csr = await buildTestCsr(deviceKeyPair, "PostDevice");
      const senderNonce = crypto.getRandomValues(new Uint8Array(16));
      const pkcsReq = await buildPkcsReq(csr, caCert, signerCert, deviceKeyPair.privateKey, "txn-post-001", senderNonce, true);

      const repo = mockScepRepository({
        getCa: () => Effect.succeed({ certPem: caCertPem, privateKeyJwk: caPrivateKeyJwk }),
        saveCa: () => Effect.void,
        authenticatePkcsReq: () => Effect.void,
      });
      const handler = await makeScepHandler(repo);
      const request = new Request("http://localhost/mdm/apple/scep?operation=PKIOperation", {
        method: "POST",
        body: pkcsReq,
      });
      const response = await handler(request);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/x-pki-message");
      const body = await response.arrayBuffer();
      expect(body.byteLength).toBeGreaterThan(0);
    });

    it("returns 500 when authentication fails", async () => {
      const caKeyPair = await generateKeyPair();
      const caCert = await createTestCaCert(caKeyPair, "Post CA");
      const caCertPem = certToPem(caCert);
      const caPrivateKeyJwk = await crypto.subtle.exportKey("jwk", caKeyPair.privateKey) as JsonWebKey;

      const deviceKeyPair = await generateKeyPair();
      const signerCert = await createTestSignerCert(deviceKeyPair, "PostDevice");
      const csr = await buildTestCsr(deviceKeyPair, "PostDevice");
      const senderNonce = crypto.getRandomValues(new Uint8Array(16));
      const pkcsReq = await buildPkcsReq(csr, caCert, signerCert, deviceKeyPair.privateKey, "txn-post-002", senderNonce, true);

      const repo = mockScepRepository({
        getCa: () => Effect.succeed({ certPem: caCertPem, privateKeyJwk: caPrivateKeyJwk }),
        saveCa: () => Effect.void,
        authenticatePkcsReq: () => Effect.fail(new ScepError({ message: "Auth failed" })),
      });
      const handler = await makeScepHandler(repo);
      const request = new Request("http://localhost/mdm/apple/scep?operation=PKIOperation", {
        method: "POST",
        body: pkcsReq,
      });
      const response = await handler(request);
      expect(response.status).toBe(500);
    });
  });
});
