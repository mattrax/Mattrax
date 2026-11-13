import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import * as pkijs from "pkijs";
import * as asn1js from "asn1js";
import { privateDecrypt, constants } from "node:crypto";
import { scepRoutes } from "../routes.js";
import { ScepService } from "../service.js";
import { ScepRepository } from "../repository.js";
import { pemEncode } from "../crypto.js";
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

async function makeScepHandler(repoLayer: Layer.Layer<ScepRepository>) {
  const serviceLayer = ScepService.pipe(Layer.provideMerge(repoLayer));
  const appLayer = scepRoutes.pipe(Layer.provideMerge(serviceLayer));
  const { handler } = HttpRouter.toWebHandler(appLayer);

  return handler;
}

async function decryptEnvelopedData(
  envelopedDataDer: ArrayBuffer,
  privateKeyJwk: JsonWebKey,
): Promise<ArrayBuffer> {
  const contentInfo = pkijs.ContentInfo.fromBER(envelopedDataDer);
  const envelopedData = new pkijs.EnvelopedData({ schema: contentInfo.content });

  const recipientInfo = envelopedData.recipientInfos[0]!.value as pkijs.KeyTransRecipientInfo;
  const encryptedKey = Buffer.from(recipientInfo.encryptedKey.valueBlock.valueHexView);

  const signingKey = await crypto.subtle.importKey(
    "jwk",
    privateKeyJwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    true,
    ["sign"],
  );

  const pkcs8Der = (await crypto.subtle.exportKey("pkcs8", signingKey)) as ArrayBuffer;
  const pkcs8Pem = pemEncode("PRIVATE KEY", pkcs8Der);

  const sessionKeyBytes = privateDecrypt(
    { key: pkcs8Pem, padding: constants.RSA_PKCS1_PADDING },
    encryptedKey,
  );

  const ivHex = (
    envelopedData.encryptedContentInfo.contentEncryptionAlgorithm.algorithmParams as any
  )?.valueBlock?.valueHex as ArrayBuffer;

  const iv = Buffer.from(ivHex);
  const encryptedContent = envelopedData.encryptedContentInfo.getEncryptedContent();

  const aesKey = await crypto.subtle.importKey("raw", sessionKeyBytes, { name: "AES-CBC" }, false, [
    "decrypt",
  ]);

  return crypto.subtle.decrypt({ name: "AES-CBC", iv }, aesKey, encryptedContent);
}

describe("SCEP E2E", () => {
  it("completes a full SCEP enrollment roundtrip", async () => {
    // ── Setup CA ──────────────────────────────────────────────────────
    const caKeyPair = await generateKeyPair();
    const caCert = await createTestCaCert(caKeyPair, "E2E SCEP CA");
    const { certToPem } = await import("../pkcs7.js");
    const caCertPem = certToPem(caCert);

    const caPrivateKeyJwk = (await crypto.subtle.exportKey(
      "jwk",
      caKeyPair.privateKey,
    )) as JsonWebKey;

    const repo = mockScepRepository({
      getCa: () => Effect.succeed({ certPem: caCertPem, privateKeyJwk: caPrivateKeyJwk }),
      saveCa: () => Effect.void,
      authenticatePkcsReq: () => Effect.void,
    });

    const handler = await makeScepHandler(repo);

    // ── Step 1: Get CA Caps ───────────────────────────────────────────
    const capsRes = await handler(
      new Request("http://localhost/mdm/apple/scep?operation=GetCACaps"),
    );

    expect(capsRes.status).toBe(200);
    const capsText = await capsRes.text();
    expect(capsText).toContain("SHA-256");
    expect(capsText).toContain("POSTPKIOperation");

    // ── Step 2: Get CA Cert ───────────────────────────────────────────
    const certRes = await handler(
      new Request("http://localhost/mdm/apple/scep?operation=GetCACert"),
    );

    expect(certRes.status).toBe(200);
    const certDer = await certRes.arrayBuffer();
    expect(certDer.byteLength).toBeGreaterThan(0);

    // ── Step 3: Build PKCSReq ─────────────────────────────────────────
    const deviceKeyPair = await generateKeyPair();
    const signerCert = await createTestSignerCert(deviceKeyPair, "E2EDevice");
    const csr = await buildTestCsr(deviceKeyPair, "E2EDevice");
    const senderNonce = crypto.getRandomValues(new Uint8Array(16));
    const txnId = "txn-e2e-001";

    const pkcsReq = await buildPkcsReq(
      csr,
      caCert,
      signerCert,
      deviceKeyPair.privateKey,
      txnId,
      senderNonce,
      true,
    );

    // ── Step 4: POST PKIOperation ─────────────────────────────────────
    const pkiRes = await handler(
      new Request("http://localhost/mdm/apple/scep?operation=PKIOperation", {
        method: "POST",
        body: pkcsReq,
      }),
    );

    expect(pkiRes.status).toBe(200);
    const certRepDer = await pkiRes.arrayBuffer();
    expect(certRepDer.byteLength).toBeGreaterThan(0);

    // ── Step 5: Parse CertRep ─────────────────────────────────────────
    const contentInfo = pkijs.ContentInfo.fromBER(certRepDer);
    expect(contentInfo.contentType).toBe(pkijs.ContentInfo.SIGNED_DATA);

    const signedData = new pkijs.SignedData({ schema: contentInfo.content });
    expect(signedData.signerInfos).toHaveLength(1);
    expect(signedData.certificates).toBeDefined();
    expect(signedData.certificates!.length).toBe(2);

    // Verify CA signature
    const isValid = await signedData.verify({ signer: 0, checkChain: false });
    expect(isValid).toBe(true);

    // Check SCEP attributes
    const si = signedData.signerInfos[0];
    const attrMap = new Map(si.signedAttrs!.attributes.map((a) => [a.type, a]));
    expect(attrMap.has("2.16.840.1.113733.1.9.2")).toBe(true); // messageType = CertRep
    expect(attrMap.has("2.16.840.1.113733.1.9.3")).toBe(true); // pkiStatus = SUCCESS
    expect(attrMap.has("2.16.840.1.113733.1.9.7")).toBe(true); // transactionID
    expect(attrMap.has("2.16.840.1.113733.1.9.6")).toBe(true); // recipientNonce

    // ── Step 6: Decrypt EnvelopedData ─────────────────────────────────
    const eContentNode = signedData.encapContentInfo.eContent!;
    const envelopedDer = (eContentNode as asn1js.OctetString).getValue() as ArrayBuffer;

    const deviceJwk = (await crypto.subtle.exportKey(
      "jwk",
      deviceKeyPair.privateKey,
    )) as JsonWebKey;

    const decryptedDer = await decryptEnvelopedData(envelopedDer, deviceJwk);

    // Decrypted bytes should be a degenerate PKCS#7 containing the device cert
    const degCI = pkijs.ContentInfo.fromBER(decryptedDer);
    expect(degCI.contentType).toBe(pkijs.ContentInfo.SIGNED_DATA);

    const degSD = new pkijs.SignedData({ schema: degCI.content });
    expect(degSD.certificates).toHaveLength(1);

    const issuedCert = degSD.certificates![0] as pkijs.Certificate;
    const cnAttr = issuedCert.subject.typesAndValues.find((a) => a.type === "2.5.4.3");
    expect((cnAttr?.value as any).valueBlock.value).toBe("E2EDevice");

    // Verify the issued cert is signed by the CA
    const certValid = await issuedCert.verify(caCert);
    expect(certValid).toBe(true);
  });
});
