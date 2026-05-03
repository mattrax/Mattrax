import { describe, it, expect, beforeAll } from "vitest";
import { Effect } from "effect";
import * as pkijs from "pkijs";
import * as asn1js from "asn1js";
import { publicEncrypt, privateDecrypt, constants } from "node:crypto";
import {
  createCaCertificate,
  createDeviceCertificate,
  buildPkcs7Degenerate,
  buildScepCertRep,
  parseScepPkcsReq,
  certToPem,
  pemToCert,
} from "../pkcs7.js";
import { pemEncode } from "../crypto.js";

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

// ─── Test Helpers ─────────────────────────────────────────────────

// Build a minimal self-signed certificate for the SCEP signer key.
async function createScepSignerCert(keyPair: CryptoKeyPair, cn: string): Promise<pkijs.Certificate> {
  const cert = new pkijs.Certificate();
  cert.version = 2;
  cert.serialNumber = new asn1js.Integer({ value: 1 });

  const name = new pkijs.RelativeDistinguishedNames({
    typesAndValues: [
      new pkijs.AttributeTypeAndValue({
        type: "2.5.4.3",
        value: new asn1js.Utf8String({ value: cn }),
      }),
    ],
  });
  cert.issuer = name;
  cert.subject = name;

  const now = new Date();
  cert.notBefore.value = now;
  cert.notAfter.value = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  await cert.subjectPublicKeyInfo.importKey(keyPair.publicKey);
  await cert.sign(keyPair.privateKey, "SHA-256");
  return cert;
}

// Encrypt `plaintext` for `recipientCert` using AES-128-CBC + PKCS#1 v1.5 key transport.
// Returns a ContentInfo(EnvelopedData) DER.
async function encryptTestEnvelopedData(
  plaintext: ArrayBuffer,
  recipientCert: pkijs.Certificate,
): Promise<ArrayBuffer> {
  const sessionKey = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(16));

  const aesKey = await crypto.subtle.importKey("raw", sessionKey, { name: "AES-CBC" }, false, ["encrypt"]);
  const encryptedContent = await crypto.subtle.encrypt({ name: "AES-CBC", iv }, aesKey, plaintext);

  const spkiDer = recipientCert.subjectPublicKeyInfo.toSchema().toBER(false);
  const spkiPem = pemEncode("PUBLIC KEY", spkiDer);
  const encryptedSessionKey = publicEncrypt(
    { key: spkiPem, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(sessionKey),
  );

  const ktri = new pkijs.KeyTransRecipientInfo({
    version: 0,
    rid: new pkijs.IssuerAndSerialNumber({
      issuer: recipientCert.issuer,
      serialNumber: recipientCert.serialNumber,
    }),
    keyEncryptionAlgorithm: new pkijs.AlgorithmIdentifier({
      algorithmId: "1.2.840.113549.1.1.1",
      algorithmParams: new asn1js.Null(),
    }),
    encryptedKey: new asn1js.OctetString({ valueHex: encryptedSessionKey.buffer.slice(encryptedSessionKey.byteOffset, encryptedSessionKey.byteOffset + encryptedSessionKey.byteLength) as ArrayBuffer }),
  });

  const envelopedData = new pkijs.EnvelopedData({
    version: 0,
    recipientInfos: [new pkijs.RecipientInfo({ variant: 1, value: ktri })],
    encryptedContentInfo: new pkijs.EncryptedContentInfo({
      contentType: pkijs.ContentInfo.DATA,
      contentEncryptionAlgorithm: new pkijs.AlgorithmIdentifier({
        algorithmId: "2.16.840.1.101.3.4.1.2", // AES-128-CBC
        algorithmParams: new asn1js.OctetString({ valueHex: iv.buffer as ArrayBuffer }),
      }),
      encryptedContent: new asn1js.OctetString({ valueHex: encryptedContent }),
    }),
  });

  return new pkijs.ContentInfo({
    contentType: pkijs.ContentInfo.ENVELOPED_DATA,
    content: envelopedData.toSchema(),
  }).toSchema().toBER(false);
}

// Decrypt a ContentInfo(EnvelopedData) using PKCS#1 v1.5 and the given private key JWK.
async function decryptTestEnvelopedData(
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
  const pkcs8Der = await crypto.subtle.exportKey("pkcs8", signingKey) as ArrayBuffer;
  const pkcs8Pem = pemEncode("PRIVATE KEY", pkcs8Der);

  const sessionKeyBytes = privateDecrypt({ key: pkcs8Pem, padding: constants.RSA_PKCS1_PADDING }, encryptedKey);

  const ivHex = (envelopedData.encryptedContentInfo.contentEncryptionAlgorithm.algorithmParams as any)
    ?.valueBlock?.valueHex as ArrayBuffer;
  const iv = Buffer.from(ivHex);
  const encryptedContent = envelopedData.encryptedContentInfo.getEncryptedContent();

  const aesKey = await crypto.subtle.importKey("raw", sessionKeyBytes, { name: "AES-CBC" }, false, ["decrypt"]);
  return crypto.subtle.decrypt({ name: "AES-CBC", iv }, aesKey, encryptedContent);
}

// Build a SCEP PKCSReq with the CSR wrapped in EnvelopedData for the CA (simulates Apple device).
async function buildFullPkcsReq(
  csr: pkijs.CertificationRequest,
  caCert: pkijs.Certificate,
  signerCert: pkijs.Certificate,
  signerPrivateKey: CryptoKey,
  transactionId: string,
  senderNonce: Uint8Array,
): Promise<ArrayBuffer> {
  const csrDer = csr.toSchema().toBER(false);

  // Encrypt CSR for the CA
  const envelopedCsrDer = await encryptTestEnvelopedData(csrDer, caCert);

  const signedData = new pkijs.SignedData({
    version: 1,
    digestAlgorithms: [
      new pkijs.AlgorithmIdentifier({
        algorithmId: "2.16.840.1.101.3.4.2.1", // SHA-256
        algorithmParams: new asn1js.Null(),
      }),
    ],
    encapContentInfo: new pkijs.EncapsulatedContentInfo({
      eContentType: pkijs.ContentInfo.DATA,
      eContent: new asn1js.OctetString({ valueHex: envelopedCsrDer }),
    }),
    certificates: [signerCert],
    signerInfos: [],
  });

  // Build a placeholder signerInfo; sign() replaces the signature
  const signerInfo = new pkijs.SignerInfo({
    version: 1,
    sid: new pkijs.IssuerAndSerialNumber({
      issuer: signerCert.issuer,
      serialNumber: signerCert.serialNumber,
    }),
    digestAlgorithm: new pkijs.AlgorithmIdentifier({
      algorithmId: "2.16.840.1.101.3.4.2.1",
      algorithmParams: new asn1js.Null(),
    }),
    signedAttrs: new pkijs.SignedAndUnsignedAttributes({
      type: 0,
      attributes: [
        new pkijs.Attribute({
          type: "1.2.840.113549.1.9.3",
          values: [new asn1js.ObjectIdentifier({ value: pkijs.ContentInfo.DATA })],
        }),
        new pkijs.Attribute({
          type: "2.16.840.1.113733.1.9.7", // transactionID
          values: [new asn1js.PrintableString({ value: transactionId })],
        }),
        new pkijs.Attribute({
          type: "2.16.840.1.113733.1.9.2", // messageType = PKCSReq (19)
          values: [new asn1js.PrintableString({ value: "19" })],
        }),
        new pkijs.Attribute({
          type: "2.16.840.1.113733.1.9.5", // senderNonce
          values: [new asn1js.OctetString({ valueHex: senderNonce.buffer as ArrayBuffer })],
        }),
      ],
    }),
    signatureAlgorithm: new pkijs.AlgorithmIdentifier({
      algorithmId: "1.2.840.113549.1.1.11",
      algorithmParams: new asn1js.Null(),
    }),
    signature: new asn1js.OctetString({ valueHex: new ArrayBuffer(0) }),
  });

  signedData.signerInfos.push(signerInfo);
  await signedData.sign(signerPrivateKey, 0, "SHA-256");

  return new pkijs.ContentInfo({
    contentType: pkijs.ContentInfo.SIGNED_DATA,
    content: signedData.toSchema(),
  }).toSchema().toBER(false);
}

// Build a SCEP PKCSReq with raw (unencrypted) CSR in eContent (legacy / test-only path).
async function buildRawCsrPkcsReq(
  csr: pkijs.CertificationRequest,
  signerCert: pkijs.Certificate,
  signerPrivateKey: CryptoKey,
  transactionId: string,
  senderNonce: Uint8Array,
): Promise<ArrayBuffer> {
  const csrDer = csr.toSchema().toBER(false);

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
    certificates: [signerCert],
    signerInfos: [],
  });

  const signerInfo = new pkijs.SignerInfo({
    version: 1,
    sid: new pkijs.IssuerAndSerialNumber({
      issuer: signerCert.issuer,
      serialNumber: signerCert.serialNumber,
    }),
    digestAlgorithm: new pkijs.AlgorithmIdentifier({
      algorithmId: "2.16.840.1.101.3.4.2.1",
      algorithmParams: new asn1js.Null(),
    }),
    signedAttrs: new pkijs.SignedAndUnsignedAttributes({
      type: 0,
      attributes: [
        new pkijs.Attribute({
          type: "1.2.840.113549.1.9.3",
          values: [new asn1js.ObjectIdentifier({ value: pkijs.ContentInfo.DATA })],
        }),
        new pkijs.Attribute({
          type: "2.16.840.1.113733.1.9.7",
          values: [new asn1js.PrintableString({ value: transactionId })],
        }),
        new pkijs.Attribute({
          type: "2.16.840.1.113733.1.9.2",
          values: [new asn1js.PrintableString({ value: "19" })],
        }),
        new pkijs.Attribute({
          type: "2.16.840.1.113733.1.9.5",
          values: [new asn1js.OctetString({ valueHex: senderNonce.buffer as ArrayBuffer })],
        }),
      ],
    }),
    signatureAlgorithm: new pkijs.AlgorithmIdentifier({
      algorithmId: "1.2.840.113549.1.1.11",
      algorithmParams: new asn1js.Null(),
    }),
    signature: new asn1js.OctetString({ valueHex: new ArrayBuffer(0) }),
  });

  signedData.signerInfos.push(signerInfo);
  await signedData.sign(signerPrivateKey, 0, "SHA-256");

  return new pkijs.ContentInfo({
    contentType: pkijs.ContentInfo.SIGNED_DATA,
    content: signedData.toSchema(),
  }).toSchema().toBER(false);
}

// ─── Tests ────────────────────────────────────────────────────────

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

  describe("parseScepPkcsReq", () => {
    it("parses a PKCSReq with raw (unencrypted) CSR", async () => {
      const signerCert = await createScepSignerCert(deviceKeyPair, "TestDevice");
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

      const senderNonce = crypto.getRandomValues(new Uint8Array(16));
      const reqDer = await buildRawCsrPkcsReq(csr, signerCert, deviceKeyPair.privateKey, "txn-raw-001", senderNonce);

      const caJwk = await crypto.subtle.exportKey("jwk", caKeyPair.privateKey) as JsonWebKey;
      const result = await parseScepPkcsReq(reqDer, caCert, caJwk).pipe(Effect.runPromise);

      expect(result.csr).toBeDefined();
      expect(result.transactionId).toBe("txn-raw-001");
      expect(new Uint8Array(result.senderNonce)).toEqual(senderNonce);
      expect(result.signerCerts).toHaveLength(1);
    });

    it("parses a PKCSReq with EnvelopedData-wrapped CSR", async () => {
      const signerCert = await createScepSignerCert(deviceKeyPair, "TestDevice");
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

      const senderNonce = crypto.getRandomValues(new Uint8Array(16));
      const reqDer = await buildFullPkcsReq(csr, caCert, signerCert, deviceKeyPair.privateKey, "txn-env-001", senderNonce);

      const caJwk = await crypto.subtle.exportKey("jwk", caKeyPair.privateKey) as JsonWebKey;
      const result = await parseScepPkcsReq(reqDer, caCert, caJwk).pipe(Effect.runPromise);

      expect(result.csr).toBeDefined();
      expect(result.transactionId).toBe("txn-env-001");
      expect(new Uint8Array(result.senderNonce)).toEqual(senderNonce);
      expect(result.signerCerts).toHaveLength(1);

      // Verify the CSR subject
      const cnAttr = result.csr.subject.typesAndValues.find((a: pkijs.AttributeTypeAndValue) => a.type === "2.5.4.3");
      expect((cnAttr?.value as asn1js.Utf8String).valueBlock.value).toBe("TestDevice");
    });

    it("parses the Fleet test PKCSReq.der outer structure", async () => {
      // @ts-ignore
      const { readFileSync } = await import("fs");
      // @ts-ignore
      const { join } = await import("path");
      // @ts-ignore
      const { fileURLToPath } = await import("url");
      // @ts-ignore
      const __dirname = join(fileURLToPath(import.meta.url), "..", "..");
      const filePath = join(__dirname, "testdata", "PKCSReq.der");
      const data = readFileSync(filePath);

      const contentInfo = pkijs.ContentInfo.fromBER(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
      expect(contentInfo.contentType).toBe(pkijs.ContentInfo.SIGNED_DATA);

      const signedData = new pkijs.SignedData({ schema: contentInfo.content });
      expect(signedData.signerInfos.length).toBeGreaterThan(0);

      const eContent = signedData.encapContentInfo.eContent;
      expect(eContent).toBeDefined();

      const signerInfo = signedData.signerInfos[0];
      expect(signerInfo.signedAttrs).toBeDefined();
      expect(signerInfo.signedAttrs!.attributes.length).toBeGreaterThan(0);
    });
  });

  describe("Full SCEP roundtrip with EnvelopedData", () => {
    it("issues a cert and builds a CertRep that the device can decrypt", async () => {
      const signerCert = await createScepSignerCert(deviceKeyPair, "MyDevice");
      const caJwk = await crypto.subtle.exportKey("jwk", caKeyPair.privateKey) as JsonWebKey;

      // Build CSR
      const csr = new pkijs.CertificationRequest();
      csr.version = 0;
      csr.subject = new pkijs.RelativeDistinguishedNames({
        typesAndValues: [
          new pkijs.AttributeTypeAndValue({
            type: "2.5.4.3",
            value: new asn1js.Utf8String({ value: "MyDevice" }),
          }),
        ],
      });
      await csr.subjectPublicKeyInfo.importKey(deviceKeyPair.publicKey);
      await csr.sign(deviceKeyPair.privateKey, "SHA-256");

      const senderNonce = crypto.getRandomValues(new Uint8Array(16));
      const txnId = "txn-roundtrip-001";

      // Build PKCSReq (with encrypted CSR)
      const reqDer = await buildFullPkcsReq(csr, caCert, signerCert, deviceKeyPair.privateKey, txnId, senderNonce);

      // Parse on the server side
      const req = await parseScepPkcsReq(reqDer, caCert, caJwk).pipe(Effect.runPromise);
      expect(req.transactionId).toBe(txnId);
      expect(req.signerCerts).toHaveLength(1);

      // Issue device certificate
      const publicKey = await req.csr.getPublicKey();
      const deviceCert = await createDeviceCertificate(
        99,
        "MyDevice",
        publicKey,
        caCert,
        caKeyPair.privateKey,
        { notBefore: new Date(), notAfter: new Date(Date.now() + 86400000) },
      );

      // Build CertRep
      const certRepDer = await buildScepCertRep(
        deviceCert,
        caCert,
        caKeyPair.privateKey,
        req.transactionId,
        req.senderNonce,
        req.signerCerts,
      );

      // ── Parse outer SignedData ─────────────────────────────────────────
      const certRepCI = pkijs.ContentInfo.fromBER(certRepDer);
      expect(certRepCI.contentType).toBe(pkijs.ContentInfo.SIGNED_DATA);

      const sd = new pkijs.SignedData({ schema: certRepCI.content });
      expect(sd.signerInfos).toHaveLength(1);

      const si = sd.signerInfos[0];
      expect(si.signedAttrs).toBeDefined();

      const attrMap = new Map(si.signedAttrs!.attributes.map((a) => [a.type, a]));

      // messageType = CertRep (3)
      const msgTypeAttr = attrMap.get("2.16.840.1.113733.1.9.2");
      expect(msgTypeAttr).toBeDefined();
      expect((msgTypeAttr!.values[0] as asn1js.PrintableString).valueBlock.value).toBe("3");

      // pkiStatus = SUCCESS (0)
      const pkiStatusAttr = attrMap.get("2.16.840.1.113733.1.9.3");
      expect(pkiStatusAttr).toBeDefined();
      expect((pkiStatusAttr!.values[0] as asn1js.PrintableString).valueBlock.value).toBe("0");

      // transactionID matches
      const txnAttr = attrMap.get("2.16.840.1.113733.1.9.7");
      expect((txnAttr!.values[0] as asn1js.PrintableString).valueBlock.value).toBe(txnId);

      // recipientNonce = senderNonce (verbatim copy)
      const recipNonceAttr = attrMap.get("2.16.840.1.113733.1.9.6");
      const recipNonce = new Uint8Array(
        (recipNonceAttr!.values[0] as asn1js.OctetString).valueBlock.valueHexView,
      );
      expect(recipNonce).toEqual(senderNonce);

      // ── Verify outer SignedData signature (catches wrong messageDigest) ──
      const isValid = await sd.verify({ signer: 0, checkChain: false });
      expect(isValid).toBe(true);

      // ── Decrypt eContent → degenerate PKCS#7 → device cert ───────────
      const eContentNode = sd.encapContentInfo.eContent!;
      // pkijs stores eContent as a CONSTRUCTED OctetString (chunked BER), so
      // valueHexView is empty on the outer node. getValue() reassembles the chunks.
      const envelopedDer = (eContentNode as asn1js.OctetString).getValue() as ArrayBuffer;

      const deviceJwk = await crypto.subtle.exportKey("jwk", deviceKeyPair.privateKey) as JsonWebKey;
      const decryptedDer = await decryptTestEnvelopedData(envelopedDer, deviceJwk);

      // The decrypted bytes should be a degenerate PKCS#7 containing the device cert
      const degCI = pkijs.ContentInfo.fromBER(decryptedDer);
      expect(degCI.contentType).toBe(pkijs.ContentInfo.SIGNED_DATA);

      const degSD = new pkijs.SignedData({ schema: degCI.content });
      expect(degSD.certificates).toHaveLength(1);

      const issuedCert = degSD.certificates![0] as pkijs.Certificate;
      const issuedCertDer = issuedCert.toSchema().toBER(false);
      const expectedDer = deviceCert.toSchema().toBER(false);
      expect(new Uint8Array(issuedCertDer)).toEqual(new Uint8Array(expectedDer));
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

      const signerCert = await createScepSignerCert(deviceKeyPair, "Device");
      const senderNonce = crypto.getRandomValues(new Uint8Array(16));
      const der = await buildScepCertRep(
        deviceCert,
        caCert,
        caKeyPair.privateKey,
        "txn-123",
        senderNonce.buffer as ArrayBuffer,
        [signerCert],
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

      const signerCert = await createScepSignerCert(deviceKeyPair, "Device");
      const senderNonce = crypto.getRandomValues(new Uint8Array(16));
      const der = await buildScepCertRep(
        deviceCert,
        caCert,
        caKeyPair.privateKey,
        "txn-456",
        senderNonce.buffer as ArrayBuffer,
        [signerCert],
      );

      const contentInfo = pkijs.ContentInfo.fromBER(der);
      const signedData = new pkijs.SignedData({ schema: contentInfo.content });
      expect(signedData.certificates).toBeDefined();
      expect(signedData.certificates!.length).toBe(2);
    });

    it("contains correct SCEP OIDs in signedAttrs", async () => {
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

      const signerCert = await createScepSignerCert(deviceKeyPair, "Device");
      const senderNonce = crypto.getRandomValues(new Uint8Array(16));
      const der = await buildScepCertRep(
        deviceCert,
        caCert,
        caKeyPair.privateKey,
        "txn-789",
        senderNonce.buffer as ArrayBuffer,
        [signerCert],
      );

      const contentInfo = pkijs.ContentInfo.fromBER(der);
      const signedData = new pkijs.SignedData({ schema: contentInfo.content });
      const si = signedData.signerInfos[0];
      expect(si.signedAttrs).toBeDefined();

      const attrTypes = si.signedAttrs!.attributes.map((a) => a.type);
      expect(attrTypes).toContain("1.2.840.113549.1.9.3");  // contentType
      expect(attrTypes).toContain("1.2.840.113549.1.9.4");  // messageDigest
      expect(attrTypes).toContain("2.16.840.1.113733.1.9.2"); // messageType
      expect(attrTypes).toContain("2.16.840.1.113733.1.9.3"); // pkiStatus
      expect(attrTypes).toContain("2.16.840.1.113733.1.9.6"); // recipientNonce
      expect(attrTypes).toContain("2.16.840.1.113733.1.9.7"); // transactionID

      // Verify no wrong OIDs
      expect(attrTypes).not.toContain("2.16.840.1.113733.1.9.8"); // .8 = extensionRequest, not messageType
    });
  });
});
