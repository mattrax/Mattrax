import { Effect } from "effect";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { ScepError } from "../schema";
import { pemEncode, pemDecode } from "./crypto";

// ─── PKIjs Crypto Engine Setup ───────────────────────────────────

if (typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined") {
  try {
    pkijs.getEngine();
  } catch {
    pkijs.setEngine("WebCrypto", crypto, crypto.subtle);
  }
}

// ─── Constants ───────────────────────────────────────────────────

const SHA256_OID = "2.16.840.1.101.3.4.2.1";
const SHA256_WITH_RSA_OID = "1.2.840.113549.1.1.11";

// ─── Certificate Helpers ─────────────────────────────────────────

export function certToPem(cert: pkijs.Certificate): string {
  const der = cert.toSchema().toBER(false);
  return pemEncode("CERTIFICATE", der);
}

export function pemToCert(pem: string): pkijs.Certificate {
  const der = pemDecode("CERTIFICATE", pem);
  return pkijs.Certificate.fromBER(der);
}

// ─── PKCS#7 Builders ─────────────────────────────────────────────

export function buildPkcs7Degenerate(caCert: pkijs.Certificate): ArrayBuffer {
  const signedData = new pkijs.SignedData({
    version: 1,
    digestAlgorithms: [],
    encapContentInfo: new pkijs.EncapsulatedContentInfo({
      eContentType: pkijs.ContentInfo.DATA,
    }),
    certificates: [caCert],
    signerInfos: [],
  });

  const contentInfo = new pkijs.ContentInfo({
    contentType: pkijs.ContentInfo.SIGNED_DATA,
    content: signedData.toSchema(),
  });

  return contentInfo.toSchema().toBER(false);
}

export async function buildCertRep(
  deviceCert: pkijs.Certificate,
  caCert: pkijs.Certificate,
  caPrivateKey: CryptoKey,
): Promise<ArrayBuffer> {
  const deviceCertDer = deviceCert.toSchema().toBER(false);

  const encapContentInfo = new pkijs.EncapsulatedContentInfo({
    eContentType: pkijs.ContentInfo.DATA,
    eContent: new asn1js.OctetString({ valueHex: deviceCertDer }),
  });

  const signerInfo = new pkijs.SignerInfo({
    version: 1,
    sid: new pkijs.IssuerAndSerialNumber({
      issuer: caCert.issuer,
      serialNumber: caCert.serialNumber,
    }),
    digestAlgorithm: new pkijs.AlgorithmIdentifier({
      algorithmId: SHA256_OID,
    }),
    signatureAlgorithm: new pkijs.AlgorithmIdentifier({
      algorithmId: SHA256_WITH_RSA_OID,
    }),
    signature: new asn1js.OctetString({ valueHex: new ArrayBuffer(0) }),
  });

  const signedData = new pkijs.SignedData({
    version: 1,
    digestAlgorithms: [
      new pkijs.AlgorithmIdentifier({ algorithmId: SHA256_OID }),
    ],
    encapContentInfo,
    certificates: [deviceCert, caCert],
    signerInfos: [signerInfo],
  });

  await signedData.sign(caPrivateKey, 0, "SHA-256");

  const contentInfo = new pkijs.ContentInfo({
    contentType: pkijs.ContentInfo.SIGNED_DATA,
    content: signedData.toSchema(),
  });

  return contentInfo.toSchema().toBER(false);
}

// ─── PKCS#7 / CSR Parsers ────────────────────────────────────────

export function parsePkcs7Content(der: ArrayBuffer): Effect.Effect<ArrayBuffer, ScepError> {
  return Effect.tryPromise({
    try: async () => {
      const contentInfo = pkijs.ContentInfo.fromBER(der);
      if (contentInfo.contentType !== pkijs.ContentInfo.SIGNED_DATA) {
        throw new Error(`Unexpected content type: ${contentInfo.contentType}`);
      }

      const signedData = new pkijs.SignedData({ schema: contentInfo.content });
      const eContent = signedData.encapContentInfo.eContent;
      if (!eContent) {
        throw new Error("No eContent found in PKCS#7");
      }

      // eContent is an OctetString containing the inner data (CSR bytes)
      return eContent.getValue();
    },
    catch: (cause) => new ScepError({ message: "Failed to parse PKCS#7 content", cause }),
  });
}

export function parseCsr(der: ArrayBuffer): Effect.Effect<{ subject: string; publicKey: CryptoKey }, ScepError> {
  return Effect.tryPromise({
    try: async () => {
      const csr = pkijs.CertificationRequest.fromBER(der);

      let subject = "device";
      for (const rdn of csr.subject.typesAndValues) {
        if (rdn.type === "2.5.4.3") {
          const val = rdn.value.valueBlock as any;
          if (typeof val.value === "string") {
            subject = val.value;
          }
          break;
        }
      }

      const publicKey = await csr.getPublicKey();
      return { subject, publicKey };
    },
    catch: (cause) => new ScepError({ message: "Failed to parse CSR", cause }),
  });
}

// ─── Certificate Creation ────────────────────────────────────────

export async function createCaCertificate(
  keyPair: CryptoKeyPair,
  commonName: string,
): Promise<pkijs.Certificate> {
  const cert = new pkijs.Certificate();
  cert.version = 2;
  cert.serialNumber = new asn1js.Integer({ value: 1 });

  const name = new pkijs.RelativeDistinguishedNames({
    typesAndValues: [
      new pkijs.AttributeTypeAndValue({
        type: "2.5.4.3",
        value: new asn1js.Utf8String({ value: commonName }),
      }),
    ],
  });

  cert.issuer = name;
  cert.subject = name;

  cert.notBefore.value = new Date();
  const notAfter = new Date();
  notAfter.setUTCFullYear(notAfter.getUTCFullYear() + 10);
  cert.notAfter.value = notAfter;

  // KeyUsage: digitalSignature | keyCertSign | cRLSign
  const keyUsage = new asn1js.BitString({
    unusedBits: 1,
    valueHex: new Uint8Array([0x86]).buffer,
  });

  cert.extensions = [
    new pkijs.Extension({
      extnID: "2.5.29.19",
      critical: true,
      extnValue: new pkijs.BasicConstraints({ cA: true, pathLenConstraint: 3 }).toSchema().toBER(false),
      parsedValue: new pkijs.BasicConstraints({ cA: true, pathLenConstraint: 3 }),
    }),
    new pkijs.Extension({
      extnID: "2.5.29.15",
      critical: true,
      extnValue: keyUsage.toBER(false),
      parsedValue: keyUsage,
    }),
  ];

  await cert.subjectPublicKeyInfo.importKey(keyPair.publicKey);
  await cert.sign(keyPair.privateKey, "SHA-256");

  return cert;
}

export async function createDeviceCertificate(
  serial: number,
  subjectName: string,
  publicKey: CryptoKey,
  caCert: pkijs.Certificate,
  caPrivateKey: CryptoKey,
  validity: { notBefore: Date; notAfter: Date },
): Promise<pkijs.Certificate> {
  const cert = new pkijs.Certificate();
  cert.version = 2;
  cert.serialNumber = new asn1js.Integer({ value: serial });

  cert.issuer = caCert.subject;

  cert.subject = new pkijs.RelativeDistinguishedNames({
    typesAndValues: [
      new pkijs.AttributeTypeAndValue({
        type: "2.5.4.3",
        value: new asn1js.Utf8String({ value: subjectName }),
      }),
    ],
  });

  cert.notBefore.value = validity.notBefore;
  cert.notAfter.value = validity.notAfter;

  // KeyUsage: digitalSignature
  const keyUsage = new asn1js.BitString({
    unusedBits: 1,
    valueHex: new Uint8Array([0x80]).buffer,
  });

  cert.extensions = [
    new pkijs.Extension({
      extnID: "2.5.29.15",
      critical: true,
      extnValue: keyUsage.toBER(false),
      parsedValue: keyUsage,
    }),
    new pkijs.Extension({
      extnID: "2.5.29.19",
      critical: true,
      extnValue: new pkijs.BasicConstraints({ cA: false }).toSchema().toBER(false),
      parsedValue: new pkijs.BasicConstraints({ cA: false }),
    }),
  ];

  await cert.subjectPublicKeyInfo.importKey(publicKey);
  await cert.sign(caPrivateKey, "SHA-256");

  return cert;
}
