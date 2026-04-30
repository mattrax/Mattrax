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

// ─── OIDs ────────────────────────────────────────────────────────

const SHA256_OID = "2.16.840.1.101.3.4.2.1";
const SHA256_WITH_RSA_OID = "1.2.840.113549.1.1.11";

// CMS attributes
const CMS_CONTENT_TYPE = "1.2.840.113549.1.9.3";
const CMS_MESSAGE_DIGEST = "1.2.840.113549.1.9.4";
const CMS_SIGNING_TIME = "1.2.840.113549.1.9.5";

// SCEP attributes (VeriSign/iPlanet arc)
const SCEP_TRANSACTION_ID = "2.16.840.1.113733.1.9.7";
const SCEP_MESSAGE_TYPE = "2.16.840.1.113733.1.9.8";
const SCEP_PKI_STATUS = "2.16.840.1.113733.1.9.2";
const SCEP_SENDER_NONCE = "2.16.840.1.113733.1.9.5";
const SCEP_RECIPIENT_NONCE = "2.16.840.1.113733.1.9.6";

// SCEP message types
const MSG_TYPE_PKCSREQ = "19";
const MSG_TYPE_CERTREP = "3";
const PKI_STATUS_SUCCESS = "0";

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

// Build a proper SCEP CertRep response
export async function buildScepCertRep(
  deviceCert: pkijs.Certificate,
  caCert: pkijs.Certificate,
  caPrivateKey: CryptoKey,
  transactionId: string,
  senderNonce: ArrayBuffer,
): Promise<ArrayBuffer> {
  const cryptoEngine = pkijs.getCrypto(true);

  // Device cert as eContent
  const deviceCertDer = deviceCert.toSchema().toBER(false);

  const encapContentInfo = new pkijs.EncapsulatedContentInfo({
    eContentType: pkijs.ContentInfo.DATA,
    eContent: new asn1js.OctetString({ valueHex: deviceCertDer }),
  });

  // Compute messageDigest = SHA-256 of raw cert bytes
  const messageDigest = await cryptoEngine.digest({ name: "SHA-256" }, deviceCertDer);

  // Compute recipientNonce = SHA-1 of senderNonce
  const recipientNonce = await cryptoEngine.digest({ name: "SHA-1" }, senderNonce);

  // Build signed attributes including SCEP-specific ones
  const signedAttrs = new pkijs.SignedAndUnsignedAttributes({
    type: 0, // signed
    attributes: [
      new pkijs.Attribute({
        type: CMS_CONTENT_TYPE,
        values: [new asn1js.ObjectIdentifier({ value: pkijs.ContentInfo.DATA })],
      }),
      new pkijs.Attribute({
        type: CMS_MESSAGE_DIGEST,
        values: [new asn1js.OctetString({ valueHex: messageDigest })],
      }),
      new pkijs.Attribute({
        type: CMS_SIGNING_TIME,
        values: [new asn1js.UTCTime({ valueDate: new Date() })],
      }),
      new pkijs.Attribute({
        type: SCEP_TRANSACTION_ID,
        values: [new asn1js.PrintableString({ value: transactionId })],
      }),
      new pkijs.Attribute({
        type: SCEP_MESSAGE_TYPE,
        values: [new asn1js.PrintableString({ value: MSG_TYPE_CERTREP })],
      }),
      new pkijs.Attribute({
        type: SCEP_PKI_STATUS,
        values: [new asn1js.PrintableString({ value: PKI_STATUS_SUCCESS })],
      }),
      new pkijs.Attribute({
        type: SCEP_RECIPIENT_NONCE,
        values: [new asn1js.OctetString({ valueHex: recipientNonce })],
      }),
    ],
  });

  const signerInfo = new pkijs.SignerInfo({
    version: 1,
    sid: new pkijs.IssuerAndSerialNumber({
      issuer: caCert.issuer,
      serialNumber: caCert.serialNumber,
    }),
    digestAlgorithm: new pkijs.AlgorithmIdentifier({
      algorithmId: SHA256_OID,
      algorithmParams: new asn1js.Null(),
    }),
    signedAttrs,
    signatureAlgorithm: new pkijs.AlgorithmIdentifier({
      algorithmId: SHA256_WITH_RSA_OID,
      algorithmParams: new asn1js.Null(),
    }),
    signature: new asn1js.OctetString({ valueHex: new ArrayBuffer(0) }),
  });

  const signedData = new pkijs.SignedData({
    version: 1,
    digestAlgorithms: [
      new pkijs.AlgorithmIdentifier({
        algorithmId: SHA256_OID,
        algorithmParams: new asn1js.Null(),
      }),
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

// ─── SCEP Message Parser ─────────────────────────────────────────

interface ScepRequest {
  csr: pkijs.CertificationRequest;
  transactionId: string;
  senderNonce: ArrayBuffer;
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ASN.1 universal tag numbers (avoid instanceof across bundle boundaries)
const TAG_INTEGER = 2;
const TAG_OCTET_STRING = 4;
const TAG_UTF8_STRING = 12;
const TAG_NUMERIC_STRING = 18;
const TAG_PRINTABLE_STRING = 19;
const TAG_IA5_STRING = 22;
const TAG_UNIVERSAL_CLASS = 1;

function isUniversalTag(node: any, tagNumber: number): boolean {
  return (
    node &&
    node.idBlock &&
    node.idBlock.tagClass === TAG_UNIVERSAL_CLASS &&
    node.idBlock.tagNumber === tagNumber
  );
}

function getStringValue(node: any): string {
  if (!node) return "";
  if (isUniversalTag(node, TAG_PRINTABLE_STRING) ||
      isUniversalTag(node, TAG_UTF8_STRING) ||
      isUniversalTag(node, TAG_IA5_STRING) ||
      isUniversalTag(node, TAG_NUMERIC_STRING)) {
    return node.valueBlock.value ?? "";
  }
  if (isUniversalTag(node, TAG_INTEGER)) {
    // Some SCEP implementations encode messageType as INTEGER
    return String(node.valueBlock.valueDec ?? "");
  }
  if (isUniversalTag(node, TAG_OCTET_STRING)) {
    return bytesToHex(
      node.valueBlock.valueHexView
        ? node.valueBlock.valueHexView.slice().buffer
        : node.valueBlock.valueHex,
    );
  }
  return "";
}

function getOctetStringValue(node: any): ArrayBuffer {
  if (!node) return new ArrayBuffer(0);
  if (isUniversalTag(node, TAG_OCTET_STRING)) {
    const view = node.valueBlock.valueHexView;
    if (view) return view.slice().buffer;
    const hex = node.valueBlock.valueHex;
    if (hex) return hex.slice(0);
  }
  return new ArrayBuffer(0);
}

export function parseScepPkcsReq(
  der: ArrayBuffer,
  caCert: pkijs.Certificate,
  caPrivateKey: CryptoKey,
): Effect.Effect<ScepRequest, ScepError> {
  return Effect.tryPromise({
    try: async () => {
      // Parse outer ContentInfo → SignedData
      const contentInfo = pkijs.ContentInfo.fromBER(der);
      if (contentInfo.contentType !== pkijs.ContentInfo.SIGNED_DATA) {
        throw new Error(`Unexpected content type: ${contentInfo.contentType}`);
      }

      const signedData = new pkijs.SignedData({ schema: contentInfo.content });

      const signerInfo = signedData.signerInfos[0];
      if (!signerInfo || !signerInfo.signedAttrs) {
        throw new Error("Missing signerInfo or signedAttrs in SCEP request");
      }

      let transactionId = "";
      let senderNonce = new ArrayBuffer(0);
      let messageType = "";

      for (const attr of signerInfo.signedAttrs.attributes) {
        if (!attr.values || attr.values.length === 0) continue;
        switch (attr.type) {
          case SCEP_TRANSACTION_ID:
            transactionId = getStringValue(attr.values[0]);
            break;
          case SCEP_SENDER_NONCE:
            senderNonce = getOctetStringValue(attr.values[0]);
            break;
          case SCEP_MESSAGE_TYPE:
            messageType = getStringValue(attr.values[0]);
            break;
        }
      }

      if (!messageType) {
        // Apple sometimes omits messageType in legacy implementations;
        // default to PKCSReq if the structure otherwise looks right.
        messageType = MSG_TYPE_PKCSREQ;
      }

      if (messageType !== MSG_TYPE_PKCSREQ) {
        throw new Error(`Unexpected SCEP message type: ${messageType}, expected ${MSG_TYPE_PKCSREQ}`);
      }

      // Extract eContent
      const eContent = signedData.encapContentInfo.eContent;
      if (!eContent) {
        throw new Error("Missing eContent in SCEP request");
      }
      const innerBytes = eContent.getValue();

      // Try parsing innerBytes as ContentInfo(EnvelopedData) first.
      // If that succeeds, decrypt to get the CSR. Otherwise treat as raw CSR.
      let csrBytes: ArrayBuffer = innerBytes;
      try {
        const innerContentInfo = pkijs.ContentInfo.fromBER(innerBytes);
        if (innerContentInfo.contentType === pkijs.ContentInfo.ENVELOPED_DATA) {
          const envelopedData = new pkijs.EnvelopedData({ schema: innerContentInfo.content });
          csrBytes = await envelopedData.decrypt(0, {
            recipientCertificate: caCert,
            recipientPrivateKey: caPrivateKey,
          });
        }
      } catch {
        // Not an EnvelopedData — innerBytes is already the CSR (or unencrypted)
      }

      const csr = pkijs.CertificationRequest.fromBER(csrBytes);
      return { csr, transactionId, senderNonce };
    },
    catch: (cause) => new ScepError({ message: "Failed to parse SCEP PKCSReq", cause }),
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
