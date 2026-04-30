import { describe, it, expect, beforeAll } from "vitest";
import { Effect } from "effect";
import * as pkijs from "pkijs";
import * as asn1js from "asn1js";
import {
  createCaCertificate,
  createDeviceCertificate,
  buildPkcs7Degenerate,
  buildScepCertRep,
  parseScepPkcsReq,
  certToPem,
  pemToCert,
} from "./pkcs7";

// Ensure WebCrypto is available and pkijs is initialized
if (typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined") {
  try {
    pkijs.getEngine();
  } catch {
    pkijs.setEngine("WebCrypto", crypto, crypto.subtle);
  }
}

const ALGORITHM = {
  name: "RSASSA-PKCS1-v1_5",
  hash: "SHA-256",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
};

async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(ALGORITHM as any, true, ["sign", "verify"]) as Promise<CryptoKeyPair>;
}

// Build a SCEP PKCSReq message for testing
async function buildTestScepPkcsReq(
  _caCert: pkijs.Certificate,
  _caPublicKey: CryptoKey,
  deviceKeyPair: CryptoKeyPair,
  csr: pkijs.CertificationRequest,
): Promise<ArrayBuffer> {
  const csrDer = csr.toSchema().toBER(false);

  // Build SCEP signed attributes
  const transactionId = "test-txn-123";
  const senderNonce = crypto.getRandomValues(new Uint8Array(16));

  const signedAttrs = new pkijs.SignedAndUnsignedAttributes({
    type: 0,
    attributes: [
      new pkijs.Attribute({
        type: "1.2.840.113549.1.9.3",
        values: [new asn1js.ObjectIdentifier({ value: "1.2.840.113549.1.7.1" })],
      }),
      new pkijs.Attribute({
        type: "2.16.840.1.113733.1.9.7",
        values: [new asn1js.PrintableString({ value: transactionId })],
      }),
      new pkijs.Attribute({
        type: "2.16.840.1.113733.1.9.8",
        values: [new asn1js.PrintableString({ value: "19" })],
      }),
      new pkijs.Attribute({
        type: "2.16.840.1.113733.1.9.5",
        values: [new asn1js.OctetString({ valueHex: senderNonce.buffer })],
      }),
    ],
  });

  // Build SignerInfo
  const signerInfo = new pkijs.SignerInfo({
    version: 1,
    sid: new pkijs.IssuerAndSerialNumber({
      issuer: csr.subject,
      serialNumber: new asn1js.Integer({ value: 1 }),
    }),
    digestAlgorithm: new pkijs.AlgorithmIdentifier({
      algorithmId: "2.16.840.1.101.3.4.2.1",
      algorithmParams: new asn1js.Null(),
    }),
    signedAttrs,
    signatureAlgorithm: new pkijs.AlgorithmIdentifier({
      algorithmId: "1.2.840.113549.1.1.11",
      algorithmParams: new asn1js.Null(),
    }),
    signature: new asn1js.OctetString({ valueHex: new ArrayBuffer(0) }),
  });

  const signedData = new pkijs.SignedData({
    version: 1,
    digestAlgorithms: [
      new pkijs.AlgorithmIdentifier({
        algorithmId: "2.16.840.1.101.3.4.2.1",
        algorithmParams: new asn1js.Null(),
      }),
    ],
    encapContentInfo: new pkijs.EncapsulatedContentInfo({
      eContentType: pkijs.ContentInfo.DATA,
      eContent: new asn1js.OctetString({ valueHex: csrDer }),
    }),
    signerInfos: [signerInfo],
  });

  await signedData.sign(deviceKeyPair.privateKey, 0, "SHA-256");

  const contentInfo = new pkijs.ContentInfo({
    contentType: pkijs.ContentInfo.SIGNED_DATA,
    content: signedData.toSchema(),
  });

  return contentInfo.toSchema().toBER(false);
}

describe("SCEP PKCS#7", () => {
  let caKeyPair: CryptoKeyPair;
  let caCert: pkijs.Certificate;
  let deviceKeyPair: CryptoKeyPair;

  beforeAll(async () => {
    caKeyPair = await generateKeyPair();
    caCert = await createCaCertificate(caKeyPair, "Test SCEP CA");
    deviceKeyPair = await generateKeyPair();
  });

  describe("createCaCertificate", () => {
    it("creates a valid self-signed CA certificate", async () => {
      expect(caCert).toBeDefined();
      expect(caCert.version).toBe(2);
      expect(caCert.serialNumber.valueBlock.valueDec).toBe(1);

      const isValid = await caCert.verify(caCert);
      expect(isValid).toBe(true);
    });

    it("has CA basic constraints", () => {
      const bcExt = caCert.extensions?.find((e) => e.extnID === "2.5.29.19");
      expect(bcExt).toBeDefined();
      expect(bcExt?.parsedValue).toBeInstanceOf(pkijs.BasicConstraints);
      expect((bcExt?.parsedValue as pkijs.BasicConstraints).cA).toBe(true);
    });

    it("has keyCertSign key usage", () => {
      const kuExt = caCert.extensions?.find((e) => e.extnID === "2.5.29.15");
      expect(kuExt).toBeDefined();
    });

    it("round-trips through PEM", () => {
      const pem = certToPem(caCert);
      expect(pem).toContain("BEGIN CERTIFICATE");
      expect(pem).toContain("END CERTIFICATE");

      const parsed = pemToCert(pem);
      expect(parsed.serialNumber.valueBlock.valueDec).toBe(1);
    });
  });

  describe("createDeviceCertificate", () => {
    it("creates a valid device certificate signed by CA", async () => {
      const deviceCert = await createDeviceCertificate(
        42,
        "Test Device",
        deviceKeyPair.publicKey,
        caCert,
        caKeyPair.privateKey,
        {
          notBefore: new Date(),
          notAfter: new Date(Date.now() + 86400000),
        },
      );

      expect(deviceCert).toBeDefined();
      expect(deviceCert.serialNumber.valueBlock.valueDec).toBe(42);

      const isValid = await deviceCert.verify(caCert);
      expect(isValid).toBe(true);
    });

    it("has non-CA basic constraints", async () => {
      const deviceCert = await createDeviceCertificate(
        43,
        "Test Device 2",
        deviceKeyPair.publicKey,
        caCert,
        caKeyPair.privateKey,
        {
          notBefore: new Date(),
          notAfter: new Date(Date.now() + 86400000),
        },
      );

      const bcExt = deviceCert.extensions?.find((e) => e.extnID === "2.5.29.19");
      expect(bcExt).toBeDefined();
      expect((bcExt?.parsedValue as pkijs.BasicConstraints).cA).toBe(false);
    });
  });

  describe("buildPkcs7Degenerate", () => {
    it("produces a valid ContentInfo", () => {
      const der = buildPkcs7Degenerate(caCert);
      const contentInfo = pkijs.ContentInfo.fromBER(der);
      expect(contentInfo.contentType).toBe(pkijs.ContentInfo.SIGNED_DATA);
    });

    it("contains the CA certificate", () => {
      const der = buildPkcs7Degenerate(caCert);
      const contentInfo = pkijs.ContentInfo.fromBER(der);
      const signedData = new pkijs.SignedData({ schema: contentInfo.content });
      expect(signedData.certificates).toBeDefined();
      expect(signedData.certificates!.length).toBe(1);
    });

    it("has no signer infos", () => {
      const der = buildPkcs7Degenerate(caCert);
      const contentInfo = pkijs.ContentInfo.fromBER(der);
      const signedData = new pkijs.SignedData({ schema: contentInfo.content });
      expect(signedData.signerInfos.length).toBe(0);
    });
  });

  describe("buildScepCertRep", () => {
    it("produces a valid signed ContentInfo", async () => {
      const deviceCert = await createDeviceCertificate(
        100,
        "Device",
        deviceKeyPair.publicKey,
        caCert,
        caKeyPair.privateKey,
        {
          notBefore: new Date(),
          notAfter: new Date(Date.now() + 86400000),
        },
      );

      const senderNonce = crypto.getRandomValues(new Uint8Array(16));
      const der = await buildScepCertRep(
        deviceCert,
        caCert,
        caKeyPair.privateKey,
        "txn-123",
        senderNonce.buffer,
      );

      const contentInfo = pkijs.ContentInfo.fromBER(der);
      expect(contentInfo.contentType).toBe(pkijs.ContentInfo.SIGNED_DATA);

      const signedData = new pkijs.SignedData({ schema: contentInfo.content });
      expect(signedData.signerInfos.length).toBe(1);
    });

    it("includes both device and CA certificates", async () => {
      const deviceCert = await createDeviceCertificate(
        101,
        "Device",
        deviceKeyPair.publicKey,
        caCert,
        caKeyPair.privateKey,
        {
          notBefore: new Date(),
          notAfter: new Date(Date.now() + 86400000),
        },
      );

      const senderNonce = crypto.getRandomValues(new Uint8Array(16));
      const der = await buildScepCertRep(
        deviceCert,
        caCert,
        caKeyPair.privateKey,
        "txn-456",
        senderNonce.buffer,
      );

      const contentInfo = pkijs.ContentInfo.fromBER(der);
      const signedData = new pkijs.SignedData({ schema: contentInfo.content });
      expect(signedData.certificates).toBeDefined();
      expect(signedData.certificates!.length).toBe(2);
    });

    it("contains SCEP attributes in signedAttrs", async () => {
      const deviceCert = await createDeviceCertificate(
        102,
        "Device",
        deviceKeyPair.publicKey,
        caCert,
        caKeyPair.privateKey,
        {
          notBefore: new Date(),
          notAfter: new Date(Date.now() + 86400000),
        },
      );

      const senderNonce = crypto.getRandomValues(new Uint8Array(16));
      const der = await buildScepCertRep(
        deviceCert,
        caCert,
        caKeyPair.privateKey,
        "txn-789",
        senderNonce.buffer,
      );

      const contentInfo = pkijs.ContentInfo.fromBER(der);
      const signedData = new pkijs.SignedData({ schema: contentInfo.content });
      const signerInfo = signedData.signerInfos[0];
      expect(signerInfo.signedAttrs).toBeDefined();

      const attrTypes = signerInfo.signedAttrs!.attributes.map((a) => a.type);
      expect(attrTypes).toContain("1.2.840.113549.1.9.3"); // contentType
      expect(attrTypes).toContain("1.2.840.113549.1.9.4"); // messageDigest
      expect(attrTypes).toContain("2.16.840.1.113733.1.9.7"); // transactionID
      expect(attrTypes).toContain("2.16.840.1.113733.1.9.8"); // messageType
      expect(attrTypes).toContain("2.16.840.1.113733.1.9.2"); // pkiStatus
      expect(attrTypes).toContain("2.16.840.1.113733.1.9.6"); // recipientNonce
    });
  });

  describe("parseScepPkcsReq", () => {
    it("parses a valid SCEP PKCSReq", async () => {
      // Build a CSR
      const csr = new pkijs.CertificationRequest();
      csr.version = 0;
      csr.subject = new pkijs.RelativeDistinguishedNames({
        typesAndValues: [
          new pkijs.AttributeTypeAndValue({
            type: "2.5.4.3",
            value: new asn1js.Utf8String({ value: "TestDevice" }),
          }),
        ],
      });
      await csr.subjectPublicKeyInfo.importKey(deviceKeyPair.publicKey);
      await csr.sign(deviceKeyPair.privateKey, "SHA-256");

      const reqDer = await buildTestScepPkcsReq(caCert, caKeyPair.publicKey, deviceKeyPair, csr);

      const caPrivateKeyJwk = await crypto.subtle.exportKey("jwk", caKeyPair.privateKey) as JsonWebKey;
      const result = await parseScepPkcsReq(reqDer, caCert, caPrivateKeyJwk).pipe(
        Effect.runPromise,
      );

      expect(result.csr).toBeDefined();
      expect(result.transactionId).toBe("test-txn-123");
      expect(result.senderNonce).toBeDefined();
      expect(result.senderNonce.byteLength).toBe(16);
    });

    it("parses the Fleet test PKCSReq.der outer structure", async () => {
      // We don't have the CA key to decrypt the inner EnvelopedData,
      // but we can at least verify our outer parser handles the real file.
      // @ts-ignore — vitest runs in Node.js; fs is available at runtime
      const { readFileSync } = await import("fs");
      // @ts-ignore
      const { join } = await import("path");
      // @ts-ignore
      const { fileURLToPath } = await import("url");
      // @ts-ignore
      const __dirname = join(fileURLToPath(import.meta.url), "..");
      const filePath = join(__dirname, "testdata", "PKCSReq.der");
      const data = readFileSync(filePath);

      // Parse outer ContentInfo
      const contentInfo = pkijs.ContentInfo.fromBER(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
      expect(contentInfo.contentType).toBe(pkijs.ContentInfo.SIGNED_DATA);

      const signedData = new pkijs.SignedData({ schema: contentInfo.content });
      expect(signedData.signerInfos.length).toBeGreaterThan(0);

      // Verify we can extract eContent without crashing
      const eContent = signedData.encapContentInfo.eContent;
      expect(eContent).toBeDefined();

      // eContent should be an OCTET STRING or constructed wrapper
      expect(eContent!.idBlock).toBeDefined();

      // The signerInfo should have signedAttrs with SCEP attributes
      const signerInfo = signedData.signerInfos[0];
      expect(signerInfo.signedAttrs).toBeDefined();
      expect(signerInfo.signedAttrs!.attributes.length).toBeGreaterThan(0);
    });
  });
});
