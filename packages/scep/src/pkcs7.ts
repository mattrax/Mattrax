import { Effect } from "effect";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { privateDecrypt, publicEncrypt, constants, createDecipheriv } from "node:crypto";
import { ScepError } from "./schema.js";
import { pemEncode, pemDecode } from "./crypto.js";

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
// SCEP attributes (VeriSign/iPlanet arc) — OIDs per RFC 8894 / draft-gutmann-scep
const SCEP_MESSAGE_TYPE = "2.16.840.1.113733.1.9.2";
const SCEP_PKI_STATUS = "2.16.840.1.113733.1.9.3";
// OID .4 = failInfo (unused in success path)
const SCEP_SENDER_NONCE = "2.16.840.1.113733.1.9.5";
const SCEP_RECIPIENT_NONCE = "2.16.840.1.113733.1.9.6";
const SCEP_TRANSACTION_ID = "2.16.840.1.113733.1.9.7";
// PKCS#9 challengePassword, carried in the CSR attributes (not signedAttrs).
const PKCS9_CHALLENGE_PASSWORD = "1.2.840.113549.1.9.7";

// Content encryption algorithms
const AES_128_CBC_OID = "2.16.840.1.101.3.4.1.2";
const AES_192_CBC_OID = "2.16.840.1.101.3.4.1.22";
const AES_256_CBC_OID = "2.16.840.1.101.3.4.1.42";
const DES3_CBC_OID = "1.2.840.113549.3.7";

// SCEP message types
const MSG_TYPE_PKCSREQ = "19";
const MSG_TYPE_CERTREP = "3";
const PKI_STATUS_SUCCESS = "0";

// ─── EnvelopedData Decryption ─────────────────────────────────────

// Decrypt a CMS EnvelopedData using PKCS#1 v1.5 RSA key transport.
// WebCrypto omits RSAES-PKCS1-v1_5, so we use Node.js native crypto for the
// RSA step and WebCrypto for AES content decryption.
async function decryptEnvelopedData(
  envelopedData: pkijs.EnvelopedData,
  privateKeyJwk: JsonWebKey,
): Promise<ArrayBuffer> {
  const recipientInfo = envelopedData.recipientInfos[0]?.value as
    | pkijs.KeyTransRecipientInfo
    | undefined;
  if (!recipientInfo) throw new Error("No recipient info in EnvelopedData");

  // Export JWK → PKCS8 DER so Node.js privateDecrypt can use it for PKCS#1 v1.5.
  // We can't use a KeyObject here because Vite's module context causes instanceof
  // checks in privateDecrypt to fail; passing raw DER avoids that.
  const signingKey = await crypto.subtle.importKey(
    "jwk",
    privateKeyJwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    true,
    ["sign"],
  );
  const pkcs8Der = (await crypto.subtle.exportKey("pkcs8", signingKey)) as ArrayBuffer;
  const pkcs8Pem = pemEncode("PRIVATE KEY", pkcs8Der);

  const encryptedSessionKey = Buffer.from(recipientInfo.encryptedKey.valueBlock.valueHexView);
  const sessionKeyBytes = privateDecrypt(
    { key: pkcs8Pem, padding: constants.RSA_PKCS1_PADDING },
    encryptedSessionKey,
  );

  const contentEncAlgId = envelopedData.encryptedContentInfo.contentEncryptionAlgorithm.algorithmId;
  const ivHex = (
    envelopedData.encryptedContentInfo.contentEncryptionAlgorithm.algorithmParams as any
  )?.valueBlock?.valueHex as ArrayBuffer | undefined;
  if (!ivHex) throw new Error("Missing IV in content encryption algorithm params");
  const iv = Buffer.from(ivHex);
  const encryptedContent = envelopedData.encryptedContentInfo.getEncryptedContent();

  if (
    contentEncAlgId === AES_128_CBC_OID ||
    contentEncAlgId === AES_192_CBC_OID ||
    contentEncAlgId === AES_256_CBC_OID
  ) {
    const aesKey = await crypto.subtle.importKey(
      "raw",
      sessionKeyBytes,
      { name: "AES-CBC" },
      false,
      ["decrypt"],
    );
    return crypto.subtle.decrypt({ name: "AES-CBC", iv }, aesKey, encryptedContent);
  }

  if (contentEncAlgId === DES3_CBC_OID) {
    const decipher = createDecipheriv("des-ede3-cbc", sessionKeyBytes, iv);
    return Buffer.concat([decipher.update(Buffer.from(encryptedContent)), decipher.final()])
      .buffer as ArrayBuffer;
  }

  throw new Error(`Unsupported content encryption algorithm: ${contentEncAlgId}`);
}

// Encrypt plaintext as a CMS EnvelopedData for a single RSA recipient.
// Uses AES-128-CBC content encryption and PKCS#1 v1.5 RSA key transport —
// the same pairing Apple uses in SCEP PKCSReq, so devices can decrypt it.
async function encryptForDevice(
  plaintext: ArrayBuffer,
  recipientCert: pkijs.Certificate,
): Promise<ArrayBuffer> {
  // Generate session key and IV
  const sessionKeyBytes = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(16));

  const aesKey = await crypto.subtle.importKey("raw", sessionKeyBytes, { name: "AES-CBC" }, false, [
    "encrypt",
  ]);
  const encryptedContent = await crypto.subtle.encrypt({ name: "AES-CBC", iv }, aesKey, plaintext);

  // Encrypt session key with recipient's RSA public key using PKCS#1 v1.5.
  // We pass the SPKI as PEM to avoid KeyObject instanceof issues in Vite context.
  const spkiDer = recipientCert.subjectPublicKeyInfo.toSchema().toBER(false);
  const spkiPem = pemEncode("PUBLIC KEY", spkiDer);
  const encryptedSessionKey = publicEncrypt(
    { key: spkiPem, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(sessionKeyBytes),
  );

  const ktri = new pkijs.KeyTransRecipientInfo({
    version: 0,
    rid: new pkijs.IssuerAndSerialNumber({
      issuer: recipientCert.issuer,
      serialNumber: recipientCert.serialNumber,
    }),
    keyEncryptionAlgorithm: new pkijs.AlgorithmIdentifier({
      algorithmId: "1.2.840.113549.1.1.1", // rsaEncryption (PKCS#1 v1.5 key transport)
      algorithmParams: new asn1js.Null(),
    }),
    encryptedKey: new asn1js.OctetString({
      valueHex: encryptedSessionKey.buffer.slice(
        encryptedSessionKey.byteOffset,
        encryptedSessionKey.byteOffset + encryptedSessionKey.byteLength,
      ) as ArrayBuffer,
    }),
  });

  const envelopedData = new pkijs.EnvelopedData({
    version: 0,
    recipientInfos: [new pkijs.RecipientInfo({ variant: 1, value: ktri })],
    encryptedContentInfo: new pkijs.EncryptedContentInfo({
      contentType: pkijs.ContentInfo.DATA,
      contentEncryptionAlgorithm: new pkijs.AlgorithmIdentifier({
        algorithmId: AES_128_CBC_OID,
        algorithmParams: new asn1js.OctetString({ valueHex: iv.buffer as ArrayBuffer }),
      }),
      encryptedContent: new asn1js.OctetString({ valueHex: encryptedContent }),
    }),
  });

  const contentInfo = new pkijs.ContentInfo({
    contentType: pkijs.ContentInfo.ENVELOPED_DATA,
    content: envelopedData.toSchema(),
  });

  return contentInfo.toSchema().toBER(false);
}

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

export function buildPkcs7Degenerate(cert: pkijs.Certificate): ArrayBuffer {
  const signedData = new pkijs.SignedData({
    version: 1,
    digestAlgorithms: [],
    encapContentInfo: new pkijs.EncapsulatedContentInfo({
      eContentType: pkijs.ContentInfo.DATA,
    }),
    certificates: [cert],
    signerInfos: [],
  });

  const contentInfo = new pkijs.ContentInfo({
    contentType: pkijs.ContentInfo.SIGNED_DATA,
    content: signedData.toSchema(),
  });

  return contentInfo.toSchema().toBER(false);
}

// Build a SCEP CertRep response (CMS SignedData wrapping EnvelopedData).
//
// Structure per RFC 8894:
//   SignedData {
//     eContent = EnvelopedData {            ← device cert encrypted for the device
//       recipient = signer cert from PKCSReq
//       content   = DegenerateCerts([deviceCert])
//     }
//     certificates = [deviceCert, caCert]
//     SignerInfo signed by CA
//   }
export async function buildScepCertRep(
  deviceCert: pkijs.Certificate,
  caCert: pkijs.Certificate,
  caPrivateKey: CryptoKey,
  transactionId: string,
  senderNonce: ArrayBuffer,
  // The signer certificates embedded in the PKCSReq — used as EnvelopedData recipients
  pkcsReqSignerCerts: pkijs.Certificate[],
): Promise<ArrayBuffer> {
  // 1. Build degenerate PKCS#7 containing only the newly-issued device cert
  const degenerateDer = buildPkcs7Degenerate(deviceCert);

  // 2. Encrypt the degenerate cert for the requesting device.
  //    Use the first signer cert from the PKCSReq as the EnvelopedData recipient.
  //    Fall back to the device cert itself if no signer certs are present.
  const recipientCert = pkcsReqSignerCerts[0] ?? deviceCert;
  const envelopedDataDer = await encryptForDevice(degenerateDer, recipientCert);

  // 3. Build outer SignedData — eContent is the EnvelopedData bytes
  const encapContentInfo = new pkijs.EncapsulatedContentInfo({
    eContentType: pkijs.ContentInfo.DATA,
    eContent: new asn1js.OctetString({ valueHex: envelopedDataDer }),
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
    // Device cert first (client expects it first), then CA cert
    certificates: [deviceCert, caCert],
    signerInfos: [],
  });

  // 4. Add SignerInfo with SCEP attributes.
  //    recipientNonce = senderNonce (copied verbatim per RFC 8894 §3.2.1.3)
  //
  // RFC 5652 §5.4: messageDigest is computed over the VALUE bytes of eContent
  // (not the OCTET STRING TLV). pkijs stores eContent as a CONSTRUCTED OctetString
  // (chunked BER), so getValue() reassembles the raw content bytes correctly.
  const cryptoEngine = pkijs.getCrypto(true);
  const eContentValue = (signedData.encapContentInfo.eContent! as asn1js.OctetString).getValue();
  const messageDigest = await cryptoEngine.digest({ name: "SHA-256" }, eContentValue);

  const signedAttrs = new pkijs.SignedAndUnsignedAttributes({
    type: 0,
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
        values: [new asn1js.OctetString({ valueHex: senderNonce })],
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

  signedData.signerInfos.push(signerInfo);
  await signedData.sign(caPrivateKey, 0, "SHA-256");

  return new pkijs.ContentInfo({
    contentType: pkijs.ContentInfo.SIGNED_DATA,
    content: signedData.toSchema(),
  })
    .toSchema()
    .toBER(false);
}

// ─── Robust eContent Extraction ──────────────────────────────────

// Extract inner bytes from an OCTET STRING node, handling both primitive
// and constructed forms (as used in PKCS#7 eContent).
function extractOctetStringContent(node: any): ArrayBuffer {
  if (!node) return new ArrayBuffer(0);

  const isOctetString = node.idBlock && node.idBlock.tagClass === 1 && node.idBlock.tagNumber === 4;

  if (isOctetString) {
    // Primitive OCTET STRING has valueHexView
    if (node.valueBlock && node.valueBlock.valueHexView) {
      return node.valueBlock.valueHexView.slice().buffer;
    }
    // Constructed OCTET STRING has value array of fragments
    if (node.valueBlock && Array.isArray(node.valueBlock.value)) {
      let total = 0;
      const parts: Uint8Array[] = [];
      for (const child of node.valueBlock.value) {
        const bytes = new Uint8Array(
          child.valueBlock?.valueHexView
            ? child.valueBlock.valueHexView.slice().buffer
            : child.toBER(false),
        );
        parts.push(bytes);
        total += bytes.length;
      }
      const result = new Uint8Array(total);
      let offset = 0;
      for (const p of parts) {
        result.set(p, offset);
        offset += p.length;
      }
      return result.buffer;
    }
  }

  // Not an OCTET STRING — return raw inner bytes (without tag/length)
  if (node.valueBlock && node.valueBlock.valueHexView) {
    return node.valueBlock.valueHexView.slice().buffer;
  }

  // Fallback: return full serialization
  return node.toBER(false);
}

// Manual ASN.1 length reader for fallback extraction.
function readAsn1Length(der: Uint8Array, offset: number): [number, number] {
  let length = der[offset]!;
  let headerLen = 1;
  if (length & 0x80) {
    const numBytes = length & 0x7f;
    length = 0;
    for (let i = 0; i < numBytes; i++) {
      length = (length << 8) | der[offset + 1 + i]!;
    }
    headerLen = 1 + numBytes;
  }
  return [length, headerLen];
}

// Extract content from the eContent [0] EXPLICIT block in
// EncapsulatedContentInfo.
function extractEContent(eContent: any): ArrayBuffer {
  if (!eContent) return new ArrayBuffer(0);

  // Best case: eContent is a constructed block with children.
  // This happens when pkijs preserves the [0] EXPLICIT wrapper.
  if (
    eContent.valueBlock &&
    Array.isArray(eContent.valueBlock.value) &&
    eContent.valueBlock.value.length > 0
  ) {
    const children = eContent.valueBlock.value;

    if (children.length === 1) {
      return extractOctetStringContent(children[0]);
    }

    // Multiple children — concatenate their raw inner bytes.
    let total = 0;
    const parts: Uint8Array[] = [];
    for (const child of children) {
      const bytes = new Uint8Array(extractOctetStringContent(child));
      parts.push(bytes);
      total += bytes.length;
    }
    const result = new Uint8Array(total);
    let offset = 0;
    for (const p of parts) {
      result.set(p, offset);
      offset += p.length;
    }
    return result.buffer;
  }

  // eContent might be a primitive OCTET STRING (pkijs sometimes
  // rewrites the [0] EXPLICIT tag to 0x04 during parsing).
  if (eContent.valueBlock && eContent.valueBlock.valueHexView) {
    return eContent.valueBlock.valueHexView.slice().buffer;
  }

  // Fallback: serialize the whole eContent node and manually strip
  // the outer tag + length to get the inner bytes.
  const fullBytes = new Uint8Array(eContent.toBER(false));
  if (fullBytes.length < 2) return fullBytes.buffer;

  const tag = fullBytes[0];
  // Context-specific [0] EXPLICIT (0xa0) or OCTET STRING (0x04)
  if ((tag === 0xa0 || tag === 0x04) && fullBytes.length >= 2) {
    const [length, headerLen] = readAsn1Length(fullBytes, 1);
    const contentStart = 1 + headerLen;
    if (contentStart + length <= fullBytes.length) {
      return fullBytes.slice(contentStart, contentStart + length).buffer;
    }
  }

  return fullBytes.buffer;
}

// ─── SCEP Message Parser ─────────────────────────────────────────

interface ScepRequest {
  csr: pkijs.CertificationRequest;
  transactionId: string;
  senderNonce: ArrayBuffer;
  // Certificates from the PKCSReq SignedData — used to encrypt the CertRep for the device
  signerCerts: pkijs.Certificate[];
  challengePassword?: string;
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

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function getStringValue(node: any): string {
  if (!node) return "";
  if (
    isUniversalTag(node, TAG_PRINTABLE_STRING) ||
    isUniversalTag(node, TAG_UTF8_STRING) ||
    isUniversalTag(node, TAG_IA5_STRING) ||
    isUniversalTag(node, TAG_NUMERIC_STRING)
  ) {
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

function extractChallengePassword(csr: pkijs.CertificationRequest): string | undefined {
  const attributes = (csr as unknown as { attributes?: Array<{ type: string; values?: any[] }> })
    .attributes;
  if (!Array.isArray(attributes)) return undefined;
  for (const attribute of attributes) {
    if (attribute.type !== PKCS9_CHALLENGE_PASSWORD) continue;
    const value = attribute.values?.[0];
    if (!value) continue;
    // PrintableString and UTF8String are the common encodings. Some clients
    // wrap the password in an OCTET STRING.
    if (isUniversalTag(value, TAG_OCTET_STRING)) {
      const bytes = getOctetStringValue(value);
      return new TextDecoder().decode(bytes);
    }
    const text = getStringValue(value);
    if (text) return text;
  }
  return undefined;
}

function parseCsr(bytes: ArrayBuffer): pkijs.CertificationRequest {
  try {
    return pkijs.CertificationRequest.fromBER(bytes);
  } catch (err) {
    // Some implementations wrap the CSR in an OCTET STRING inside the EnvelopedData
    try {
      const parsed = asn1js.fromBER(bytes);
      if (parsed.result && parsed.result.idBlock && parsed.result.idBlock.tagNumber === 4) {
        const octet = parsed.result as asn1js.OctetString;
        const inner = octet.valueBlock.valueHexView
          ? octet.valueBlock.valueHexView.slice().buffer
          : octet.valueBlock.valueHex;
        return pkijs.CertificationRequest.fromBER(inner);
      }
      throw err;
    } catch {
      throw err;
    }
  }
}

export function parseScepPkcsReq(
  der: ArrayBuffer,
  _caCert: pkijs.Certificate,
  caPrivateKeyJwk: JsonWebKey,
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
        messageType = MSG_TYPE_PKCSREQ;
      }

      if (messageType !== MSG_TYPE_PKCSREQ) {
        throw new Error(
          `Unexpected SCEP message type: ${messageType}, expected ${MSG_TYPE_PKCSREQ}`,
        );
      }

      // Collect signer certificates for encrypting the CertRep response
      const signerCerts: pkijs.Certificate[] = signedData.certificates
        ? (signedData.certificates as pkijs.Certificate[]).filter(
            (c) => c instanceof pkijs.Certificate,
          )
        : [];

      // Extract eContent
      const eContent = signedData.encapContentInfo.eContent;
      if (!eContent) {
        throw new Error("Missing eContent in SCEP request");
      }
      const innerBytes = extractEContent(eContent);

      // Try to parse innerBytes as ContentInfo.
      // If it is EnvelopedData → decrypt to get CSR bytes.
      // If it is something else (or parsing fails) → treat innerBytes as raw CSR.
      let csrBytes: ArrayBuffer = innerBytes;
      let isEnveloped = false;

      try {
        const innerContentInfo = pkijs.ContentInfo.fromBER(innerBytes);
        if (innerContentInfo.contentType === pkijs.ContentInfo.ENVELOPED_DATA) {
          isEnveloped = true;
          const envelopedData = new pkijs.EnvelopedData({ schema: innerContentInfo.content });
          csrBytes = await decryptEnvelopedData(envelopedData, caPrivateKeyJwk);
        }
      } catch (decryptErr: any) {
        if (isEnveloped) {
          throw new Error(
            `EnvelopedData decryption failed: ${decryptErr.message ?? String(decryptErr)}`,
          );
        }
        // Not EnvelopedData — innerBytes is already the CSR (or unencrypted)
      }

      try {
        const csr = parseCsr(csrBytes);
        return {
          csr,
          transactionId,
          senderNonce,
          signerCerts,
          challengePassword: extractChallengePassword(csr),
        };
      } catch (csrErr: any) {
        throw new Error(
          `Failed to parse CSR (isEnveloped=${isEnveloped}, csrBytes.length=${csrBytes.byteLength}): ${csrErr.message ?? String(csrErr)}`,
        );
      }
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
      extnValue: new pkijs.BasicConstraints({ cA: true, pathLenConstraint: 3 })
        .toSchema()
        .toBER(false),
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
  subject: string | Array<{ type: string; value: string }>,
  publicKey: CryptoKey,
  caCert: pkijs.Certificate,
  caPrivateKey: CryptoKey,
  validity: { notBefore: Date; notAfter: Date; extensions?: pkijs.Extension[] },
): Promise<pkijs.Certificate> {
  const cert = new pkijs.Certificate();
  cert.version = 2;
  cert.serialNumber = new asn1js.Integer({ value: serial });

  cert.issuer = caCert.subject;

  cert.subject = new pkijs.RelativeDistinguishedNames({
    typesAndValues: (typeof subject === "string"
      ? [{ type: "2.5.4.3", value: subject }]
      : subject
    ).map(
      (item) =>
        new pkijs.AttributeTypeAndValue({
          type: item.type,
          value: new asn1js.Utf8String({ value: item.value }),
        }),
    ),
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
    new pkijs.Extension({
      extnID: "2.5.29.37",
      critical: false,
      extnValue: new pkijs.ExtKeyUsage({
        keyPurposes: ["1.3.6.1.5.5.7.3.2"],
      })
        .toSchema()
        .toBER(false),
      parsedValue: new pkijs.ExtKeyUsage({
        keyPurposes: ["1.3.6.1.5.5.7.3.2"],
      }),
    }),
    ...(validity.extensions ?? []),
  ];

  await cert.subjectPublicKeyInfo.importKey(publicKey);
  await cert.sign(caPrivateKey, "SHA-256");

  return cert;
}
