import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { scepRoutes } from "../routes.js";
import { ScepService } from "../service.js";
import type { ScepRepository } from "../repository.js";
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

const TENANT = "tenant-route";

const SCEP_URL = `http://localhost/mdm/apple/scep/${TENANT}`;

async function makeScepHandler(repoLayer: Layer.Layer<ScepRepository>) {
  const serviceLayer = ScepService.pipe(Layer.provideMerge(repoLayer));
  const appLayer = scepRoutes.pipe(Layer.provideMerge(serviceLayer));
  const { handler } = HttpRouter.toWebHandler(appLayer);

  return handler;
}

describe("SCEP routes", () => {
  describe("GET /mdm/apple/scep/:organizationId", () => {
    it("returns CA caps for GetCACaps", async () => {
      const repo = mockScepRepository();
      const handler = await makeScepHandler(repo);
      const request = new Request(`${SCEP_URL}?operation=GetCACaps`);
      const response = await handler(request);
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain("SHA-256");
    });

    it("returns the tenant CA for GetCACert", async () => {
      const keyPair = await generateKeyPair();
      const caCert = await createTestCaCert(keyPair, "Route CA");
      const certPem = certToPem(caCert);

      const privateKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);

      const repo = mockScepRepository({
        getCa: () => Effect.succeed({ certPem, privateKeyJwk }),
      });

      const handler = await makeScepHandler(repo);
      const request = new Request(`${SCEP_URL}?operation=GetCACert`);
      const response = await handler(request);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/x-x509-ca-cert");
      const body = await response.arrayBuffer();
      expect(body.byteLength).toBeGreaterThan(0);
    });

    it("returns 404 for an unknown tenant", async () => {
      const repo = mockScepRepository({
        getCa: () =>
          Effect.fail(new ScepError({ message: "Unknown SCEP tenant", reason: "unknown_tenant" })),
      });

      const handler = await makeScepHandler(repo);

      const response = await handler(
        new Request("http://localhost/mdm/apple/scep/missing?operation=GetCACert"),
      );

      expect(response.status).toBe(404);
    });

    it("returns 400 for missing operation", async () => {
      const repo = mockScepRepository();
      const handler = await makeScepHandler(repo);
      const response = await handler(new Request(SCEP_URL));
      expect(response.status).toBe(400);
    });

    it("returns 400 for invalid operation", async () => {
      const repo = mockScepRepository();
      const handler = await makeScepHandler(repo);
      const response = await handler(new Request(`${SCEP_URL}?operation=InvalidOperation`));
      expect(response.status).toBe(400);
    });

    it("rejects the old deployment-wide endpoint", async () => {
      const handler = await makeScepHandler(mockScepRepository());

      const response = await handler(
        new Request("http://localhost/mdm/apple/scep?operation=GetCACert"),
      );

      expect(response.status).toBe(410);
      expect(await response.text()).toContain("/mdm/apple/scep/<organizationId>");
    });
  });

  describe("POST /mdm/apple/scep/:organizationId", () => {
    const makeRequest = async (transactionId: string) => {
      const caKeyPair = await generateKeyPair();
      const caCert = await createTestCaCert(caKeyPair, "Post CA");
      const caCertPem = certToPem(caCert);
      const caPrivateKeyJwk = await crypto.subtle.exportKey("jwk", caKeyPair.privateKey);

      const deviceKeyPair = await generateKeyPair();
      const signerCert = await createTestSignerCert(deviceKeyPair, "PostDevice");
      const csr = await buildTestCsr(deviceKeyPair, "PostDevice");
      const senderNonce = crypto.getRandomValues(new Uint8Array(16));

      const pkcsReq = await buildPkcsReq(
        csr,
        caCert,
        signerCert,
        deviceKeyPair.privateKey,
        transactionId,
        senderNonce,
        true,
      );

      return { caCertPem, caPrivateKeyJwk, pkcsReq };
    };

    it("returns a CertRep for valid PKIOperation", async () => {
      const { caCertPem, caPrivateKeyJwk, pkcsReq } = await makeRequest("txn-post-001");

      const repo = mockScepRepository({
        getCa: () => Effect.succeed({ certPem: caCertPem, privateKeyJwk: caPrivateKeyJwk }),
        authenticatePkcsReq: () => Effect.succeed({ organizationalUnit: TENANT }),
      });

      const handler = await makeScepHandler(repo);

      const request = new Request(`${SCEP_URL}?operation=PKIOperation`, {
        method: "POST",
        body: pkcsReq,
      });

      const response = await handler(request);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/x-pki-message");
      const body = await response.arrayBuffer();
      expect(body.byteLength).toBeGreaterThan(0);
    });

    it("returns a failure CertRep when authentication fails", async () => {
      const { caCertPem, caPrivateKeyJwk, pkcsReq } = await makeRequest("txn-post-002");

      const repo = mockScepRepository({
        getCa: () => Effect.succeed({ certPem: caCertPem, privateKeyJwk: caPrivateKeyJwk }),
        authenticatePkcsReq: () => Effect.fail(new ScepError({ message: "Auth failed" })),
      });

      const handler = await makeScepHandler(repo);

      const request = new Request(`${SCEP_URL}?operation=PKIOperation`, {
        method: "POST",
        body: pkcsReq,
      });

      const response = await handler(request);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/x-pki-message");
    });

    it("rejects the old deployment-wide endpoint", async () => {
      const handler = await makeScepHandler(mockScepRepository());

      const response = await handler(
        new Request("http://localhost/mdm/apple/scep?operation=PKIOperation", {
          method: "POST",
          body: new Uint8Array(),
        }),
      );

      expect(response.status).toBe(410);
    });
  });
});
