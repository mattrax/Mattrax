/**
 * Apple MDM request-signature verification.
 *
 * Devices that enroll through the `com.apple.mdm` payload with
 * `SignMessage: true` send an `Mdm-Signature` header on every check-in and
 * command-poll response. The header is base64 encoded DER for a detached CMS
 * `SignedData` (PKCS#7) whose signature covers the raw request body.
 *
 * This module is deliberately self-contained: it parses and verifies the CMS
 * message, checks the signer chains to a supplied tenant CA, and optionally
 * binds the signer to the certificate the device presented over mTLS. Callers
 * decide what to do on failure; nothing here touches the request pipeline.
 */
import { Schema } from "effect";
import * as pkijs from "pkijs";

// ─── PKIjs Crypto Engine Setup ───────────────────────────────────

if (typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined") {
  try {
    pkijs.getEngine();
  } catch {
    pkijs.setEngine("WebCrypto", crypto, crypto.subtle);
  }
}

// ─── Constants ───────────────────────────────────────────────────

/**
 * Apple sends the signature as a header value, so anything larger than a few
 * KiB is either corrupt or an attempt to make the server burn cycles parsing
 * ASN.1. Base64 characters, not decoded bytes.
 */
export const MAX_MDM_SIGNATURE_BASE64_LENGTH = 16 * 1024;

/** SCEP PKCSReq messages encapsulate a CSR and can be much larger. */
export const MAX_SCEP_CMS_BASE64_LENGTH = 1024 * 1024;

/** Extended key usage Apple requires on an MDM identity certificate. */
export const CLIENT_AUTH_EKU_OID = "1.3.6.1.5.5.7.3.2";

const SIGNED_DATA_OID = "1.2.840.113549.1.7.2";
const BASIC_CONSTRAINTS_OID = "2.5.29.19";
const EXT_KEY_USAGE_OID = "2.5.29.37";

// ─── Public Types ────────────────────────────────────────────────

export type VerifyMdmSignatureOptions = {
  /** Raw `Mdm-Signature` header value (base64 DER detached CMS). */
  readonly signature: string;
  /** Raw request body bytes the signature must cover. */
  readonly body: ArrayBuffer | Uint8Array;
  /** PEM encoded CA certificate(s) trusted to issue identity certificates. */
  readonly caCertPems: readonly string[];
  /** Subject DN the device presented over mTLS, when available. */
  readonly identityCertificateSubject?: string;
  /** Serial number of the mTLS certificate, hex. */
  readonly identityCertificateSerial?: string;
  /** SHA-256 fingerprint of the mTLS certificate DER, hex. */
  readonly identityCertificateFingerprintSha256?: string;
};

export type VerifiedMdmSignature = {
  /** Signer certificate subject formatted as `CN=...,OU=...,O=...`. */
  readonly subject: string;
  /** Signer certificate serial number, lowercase hex. */
  readonly serial: string;
  /** SHA-256 of the signer certificate DER, lowercase hex. */
  readonly fingerprintSha256: string;
  /** First `OU` value from the signer subject, when present. */
  readonly organizationId?: string;
};

export type VerifyScepPkcsReqSignatureOptions = {
  /** Base64 DER, or raw CMS bytes from a SCEP PKCSReq. */
  readonly signature: string | ArrayBuffer | Uint8Array;
  /**
   * PEM encoded CA certificate(s). SCEP PKCSReq messages are usually signed by
   * a self-signed bootstrap certificate, so supplying CAs is optional; when
   * present they are used for non-self-signed (renewal) requests.
   */
  readonly caCertPems?: readonly string[];
};

export type VerifiedScepPkcsReqSignature = {
  readonly subject: string;
  readonly serial: string;
  readonly fingerprintSha256: string;
  /** The encapsulated payload (normally an EnvelopedData wrapping the CSR). */
  readonly eContent: Uint8Array;
  /** True when the signer certificate is self-signed. */
  readonly selfSigned: boolean;
};

export type SubjectDnAttribute = {
  /** Short attribute name (`CN`, `OU`, `O`) or the original OID. */
  readonly type: string;
  readonly value: string;
};

// ─── Helpers ─────────────────────────────────────────────────────

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => new Uint8Array(bytes).buffer;

const toBytes = (value: ArrayBuffer | Uint8Array): Uint8Array =>
  value instanceof Uint8Array ? value : new Uint8Array(value);

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.byteLength !== right.byteLength) return false;

  for (let i = 0; i < left.byteLength; i++) if (left[i] !== right[i]) return false;

  return true;
};

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const decodeBase64 = (value: string, label: string): Uint8Array => {
  const cleaned = value.replace(/\s/g, "");

  if (cleaned.length === 0) throw new Error(`${label} is empty`);

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) {
    throw new Error(`${label} is not valid base64`);
  }

  const padded = cleaned.padEnd(cleaned.length + ((4 - (cleaned.length % 4)) % 4), "=");

  try {
    const binary = atob(padded);

    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    throw new Error(`${label} is not valid base64`);
  }
};

const decodePemCertificate = (pem: string): Uint8Array => {
  const match =
    /-----BEGIN (?:TRUSTED )?CERTIFICATE-----([\s\S]*?)-----END (?:TRUSTED )?CERTIFICATE-----/.exec(
      pem,
    );

  const base64 = match ? match[1]! : pem;

  return decodeBase64(base64, "CA certificate");
};

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

// ─── Subject DN Parsing ──────────────────────────────────────────

const DN_OID_TO_NAME = new Map<string, string>([
  ["2.5.4.3", "CN"],
  ["2.5.4.5", "SERIALNUMBER"],
  ["2.5.4.6", "C"],
  ["2.5.4.7", "L"],
  ["2.5.4.8", "ST"],
  ["2.5.4.9", "STREET"],
  ["2.5.4.10", "O"],
  ["2.5.4.11", "OU"],
  ["2.5.4.12", "T"],
  ["2.5.4.42", "GIVENNAME"],
  ["2.5.4.4", "SN"],
  ["0.9.2342.19200300.100.1.1", "UID"],
  ["1.2.840.113549.1.9.1", "EMAILADDRESS"],
]);

const normalizeAttributeType = (type: string): string =>
  DN_OID_TO_NAME.get(type) ?? type.toUpperCase();

const normalizeDnValue = (value: string): string => value.replace(/\s+/g, " ").trim().toLowerCase();

const splitDnParts = (dn: string): string[] => {
  const parts: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < dn.length; i++) {
    const char = dn[i]!;

    if (char === "\\") {
      current += char;

      if (i + 1 < dn.length) current += dn[++i]!;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      current += char;
      continue;
    }

    if (!quoted && (char === "," || char === ";" || char === "+")) {
      parts.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim().length > 0) parts.push(current);

  return parts;
};

const unquoteDnValue = (value: string): string => {
  const trimmed = value.trim();

  const unquoted =
    trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
      ? trimmed.slice(1, -1)
      : trimmed;

  return unquoted.replace(/\\(.)/g, "$1");
};

/**
 * Parse an RFC 4514-style DN string (`CN=Device,OU=org-123,O=Acme`) into
 * attribute/value pairs. Values containing commas can be quoted or escaped.
 */
export function parseSubjectDn(dn: string): SubjectDnAttribute[] {
  const attributes: SubjectDnAttribute[] = [];

  for (const part of splitDnParts(dn)) {
    const separator = part.indexOf("=");

    if (separator === -1) continue;
    const type = part.slice(0, separator).trim();
    const value = unquoteDnValue(part.slice(separator + 1));

    if (type.length === 0 || value.length === 0) continue;
    attributes.push({ type: normalizeAttributeType(type), value });
  }

  return attributes;
}

type AttributeValueBlock = {
  readonly value?: unknown;
  readonly valueHexView?: Uint8Array<ArrayBuffer>;
};

function hasAttributeValueBlock(
  value: pkijs.AttributeValueType,
): value is pkijs.AttributeValueType & { readonly valueBlock: AttributeValueBlock } {
  const block: unknown = value.valueBlock;

  return typeof block === "object" && block !== null;
}

function hasValueHexView(node: unknown): node is { valueHexView: Uint8Array<ArrayBuffer> } {
  return (
    typeof node === "object" &&
    node !== null &&
    "valueHexView" in node &&
    node.valueHexView instanceof Uint8Array
  );
}

const attributeValueToString = (value: pkijs.AttributeValueType): string => {
  if (!hasAttributeValueBlock(value)) return "";

  const block = value.valueBlock;

  if (Schema.is(Schema.String)(block.value)) return block.value;

  if (block.valueHexView !== undefined) return new TextDecoder().decode(block.valueHexView);

  return "";
};

const certificateSubjectAttributes = (cert: pkijs.Certificate): SubjectDnAttribute[] =>
  cert.subject.typesAndValues.map((attribute) => ({
    type: normalizeAttributeType(attribute.type),
    value: attributeValueToString(attribute.value),
  }));

const formatSubject = (attributes: readonly SubjectDnAttribute[]): string =>
  attributes.map((attribute) => `${attribute.type}=${attribute.value}`).join(",");

/**
 * The mTLS subject may be a full DN or a bare CN/OU value. Require every
 * attribute it names to be present on the signing certificate, so a device
 * cannot sign with a certificate from a different tenant.
 */
const identitySubjectMatches = (
  signerSubject: readonly SubjectDnAttribute[],
  identitySubject: string,
): boolean => {
  const provided = parseSubjectDn(identitySubject);

  if (provided.length === 0) {
    const expected = normalizeDnValue(identitySubject);

    return signerSubject.some(
      (attribute) =>
        (attribute.type === "CN" || attribute.type === "OU") &&
        normalizeDnValue(attribute.value) === expected,
    );
  }

  for (const attribute of provided) {
    const signerValues = signerSubject.flatMap((candidate) =>
      candidate.type === attribute.type ? [normalizeDnValue(candidate.value)] : [],
    );

    if (!signerValues.includes(normalizeDnValue(attribute.value))) return false;
  }

  return true;
};

const normalizeSerial = (value: string): string => {
  const hex = value
    .replace(/^0x/i, "")
    .replace(/[^0-9a-f]/gi, "")
    .toLowerCase();

  return hex.replace(/^0+/, "") || "0";
};

const normalizeFingerprint = (value: string): string =>
  value.replace(/[^0-9a-f]/gi, "").toLowerCase();

const certificateSerialHex = (cert: pkijs.Certificate): string => {
  const block: unknown = cert.serialNumber.valueBlock;

  if (hasValueHexView(block)) return bytesToHex(block.valueHexView);

  return normalizeSerial(cert.serialNumber.valueBlock.toString());
};

const certificateFingerprintSha256 = async (cert: pkijs.Certificate): Promise<string> => {
  // `toSchema()` without re-encoding reuses the original TBS bytes, so the
  // fingerprint matches the certificate exactly as it was transmitted.
  const der = new Uint8Array(cert.toSchema().toBER(false));
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(der));

  return bytesToHex(new Uint8Array(digest));
};

const findExtension = (cert: pkijs.Certificate, oid: string): pkijs.Extension | undefined =>
  cert.extensions?.find((extension) => extension.extnID === oid);

const isCertificateAuthority = (cert: pkijs.Certificate): boolean => {
  const extension = findExtension(cert, BASIC_CONSTRAINTS_OID);

  if (!extension) return false;

  try {
    const value = extension.parsedValue;

    return value instanceof pkijs.BasicConstraints && value.cA;
  } catch {
    return false;
  }
};

const hasClientAuthEku = (cert: pkijs.Certificate): boolean => {
  const extension = findExtension(cert, EXT_KEY_USAGE_OID);

  if (!extension) return false;

  try {
    const value = extension.parsedValue;

    return value instanceof pkijs.ExtKeyUsage && value.keyPurposes.includes(CLIENT_AUTH_EKU_OID);
  } catch {
    return false;
  }
};

const assertValidityWindow = (cert: pkijs.Certificate, now: Date): void => {
  if (now.getTime() < cert.notBefore.value.getTime()) {
    throw new Error("signer certificate is not yet valid");
  }

  if (now.getTime() > cert.notAfter.value.getTime()) {
    throw new Error("signer certificate has expired");
  }
};

const parseCaCertificates = (pems: readonly string[]): pkijs.Certificate[] =>
  pems.map((pem) => {
    try {
      return pkijs.Certificate.fromBER(toArrayBuffer(decodePemCertificate(pem)));
    } catch (cause) {
      throw new Error(`CA certificate could not be parsed: ${errorMessage(cause)}`);
    }
  });

/** Find a supplied CA that issued (and signed) the signer certificate. */
const findIssuerCertificate = async (
  signer: pkijs.Certificate,
  caCertificates: readonly pkijs.Certificate[],
): Promise<pkijs.Certificate> => {
  for (const candidate of caCertificates) {
    if (!isCertificateAuthority(candidate)) continue;

    if (!signer.issuer.isEqual(candidate.subject)) continue;

    try {
      if (await signer.verify(candidate)) return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error("signer certificate does not chain to a supplied CA");
};

// ─── CMS Parsing / Verification ─────────────────────────────────

type ParsedSignedData = {
  readonly signedData: pkijs.SignedData;
  readonly certificates: pkijs.Certificate[];
};

const parseSignedData = (bytes: Uint8Array): ParsedSignedData => {
  if (bytes.byteLength === 0) throw new Error("signature is empty");

  let contentInfo: pkijs.ContentInfo;

  try {
    contentInfo = pkijs.ContentInfo.fromBER(toArrayBuffer(bytes));
  } catch (cause) {
    throw new Error(`signature is not valid CMS: ${errorMessage(cause)}`);
  }

  if (contentInfo.contentType !== SIGNED_DATA_OID) {
    throw new Error(`signature is not CMS SignedData (content type ${contentInfo.contentType})`);
  }

  if (!contentInfo.content) throw new Error("signature is missing SignedData content");

  let signedData: pkijs.SignedData;

  try {
    signedData = new pkijs.SignedData({ schema: contentInfo.content });
  } catch (cause) {
    throw new Error(`signature SignedData could not be parsed: ${errorMessage(cause)}`);
  }

  const certificates = (signedData.certificates ?? []).filter(
    (certificate): certificate is pkijs.Certificate => certificate instanceof pkijs.Certificate,
  );

  return { signedData, certificates };
};

const verifyCmsSignature = async (
  signedData: pkijs.SignedData,
  certificates: readonly pkijs.Certificate[],
  body: Uint8Array | undefined,
  now: Date,
): Promise<pkijs.Certificate> => {
  if (signedData.signerInfos.length !== 1) {
    throw new Error(
      `CMS signature must contain exactly one SignerInfo (found ${signedData.signerInfos.length})`,
    );
  }

  if (certificates.length === 0) {
    throw new Error("CMS signature must contain at least one certificate");
  }

  const eContent = signedData.encapContentInfo.eContent;

  if (eContent) {
    let embedded: Uint8Array;

    try {
      embedded = new Uint8Array(eContent.getValue());
    } catch (cause) {
      throw new Error(`CMS eContent could not be read: ${errorMessage(cause)}`);
    }

    if (body && !bytesEqual(embedded, body)) {
      throw new Error("CMS eContent does not match the request body");
    }
  } else if (!body || body.byteLength === 0) {
    throw new Error("CMS signature is detached but no body was supplied");
  }

  const data = toArrayBuffer(body ?? new Uint8Array(0));
  let result: pkijs.SignedDataVerifyResult;

  try {
    result = await signedData.verify({
      signer: 0,
      data,
      checkChain: false,
      checkDate: now,
      extendedMode: true,
    });
  } catch (cause) {
    throw new Error(`CMS signature is invalid: ${errorMessage(cause)}`);
  }

  if (result.signatureVerified !== true) throw new Error("CMS signature is invalid");

  if (!result.signerCertificate) throw new Error("CMS signer certificate was not found");

  return result.signerCertificate;
};

// ─── MDM Signature ──────────────────────────────────────────────

/**
 * Verify an Apple `Mdm-Signature` header over the raw request body.
 *
 * The CMS must be detached (or encapsulate the same bytes as the body), carry
 * exactly one signer, and chain to one of `caCertPems`. The signer must be
 * valid now and carry the client-authentication EKU. Any supplied mTLS
 * identity details must match the signer certificate.
 *
 * @throws Error when the signature, chain or identity binding is invalid.
 */
export async function verifyMdmSignature(
  options: VerifyMdmSignatureOptions,
): Promise<VerifiedMdmSignature> {
  const { signature, body, caCertPems } = options;

  if (!Schema.is(Schema.String)(signature) || signature.length === 0) {
    throw new Error("Mdm-Signature is empty");
  }

  if (signature.length > MAX_MDM_SIGNATURE_BASE64_LENGTH) {
    throw new Error("Mdm-Signature is too large");
  }

  if (!Array.isArray(caCertPems) || caCertPems.length === 0) {
    throw new Error("at least one CA certificate is required");
  }

  const cmsBytes = decodeBase64(signature, "Mdm-Signature");
  const bodyBytes = toBytes(body);
  const { signedData, certificates } = parseSignedData(cmsBytes);

  const now = new Date();
  const signer = await verifyCmsSignature(signedData, certificates, bodyBytes, now);

  assertValidityWindow(signer, now);

  if (!hasClientAuthEku(signer)) {
    throw new Error("signer certificate is missing the client authentication EKU");
  }

  const caCertificates = parseCaCertificates(caCertPems);
  await findIssuerCertificate(signer, caCertificates);

  const signerSubject = certificateSubjectAttributes(signer);
  const subject = formatSubject(signerSubject);
  const serial = certificateSerialHex(signer);
  const fingerprintSha256 = await certificateFingerprintSha256(signer);

  if (
    options.identityCertificateSubject !== undefined &&
    !identitySubjectMatches(signerSubject, options.identityCertificateSubject)
  ) {
    throw new Error("signer certificate subject does not match the mTLS identity certificate");
  }

  if (
    options.identityCertificateSerial !== undefined &&
    normalizeSerial(options.identityCertificateSerial) !== normalizeSerial(serial)
  ) {
    throw new Error("signer certificate serial does not match the mTLS identity certificate");
  }

  if (
    options.identityCertificateFingerprintSha256 !== undefined &&
    normalizeFingerprint(options.identityCertificateFingerprintSha256) !== fingerprintSha256
  ) {
    throw new Error("signer certificate fingerprint does not match the mTLS identity certificate");
  }

  return {
    subject,
    serial,
    fingerprintSha256,
    organizationId: signerSubject.find((attribute) => attribute.type === "OU")?.value,
  };
}

// ─── SCEP PKCSReq Signature ─────────────────────────────────────

/**
 * Verify the CMS signature on a SCEP PKCSReq message.
 *
 * Unlike an MDM signature, a PKCSReq is normally self-signed by the bootstrap
 * key pair in the CSR, so there is no CA chain to validate. When the CMS is
 * signed by a CA-issued certificate and `caCertPems` is supplied, the chain is
 * required; a self-signed signer must verify against its own certificate.
 */
export async function verifyScepPkcsReqSignature(
  options: VerifyScepPkcsReqSignatureOptions,
): Promise<VerifiedScepPkcsReqSignature> {
  const input = options.signature;
  let cmsBytes: Uint8Array;

  if (Schema.is(Schema.String)(input)) {
    if (input.length > MAX_SCEP_CMS_BASE64_LENGTH) {
      throw new Error("SCEP PKCSReq signature is too large");
    }

    cmsBytes = decodeBase64(input, "SCEP PKCSReq signature");
  } else {
    cmsBytes = toBytes(input);
  }

  if (cmsBytes.byteLength > MAX_SCEP_CMS_BASE64_LENGTH) {
    throw new Error("SCEP PKCSReq signature is too large");
  }

  const { signedData, certificates } = parseSignedData(cmsBytes);
  const eContent = signedData.encapContentInfo.eContent;

  if (!eContent) throw new Error("SCEP PKCSReq signature must encapsulate eContent");

  const now = new Date();
  const signer = await verifyCmsSignature(signedData, certificates, undefined, now);
  assertValidityWindow(signer, now);

  const selfSigned = signer.issuer.isEqual(signer.subject);

  if (selfSigned) {
    let valid = false;

    try {
      valid = await signer.verify();
    } catch {
      valid = false;
    }

    if (!valid) throw new Error("SCEP PKCSReq signer certificate is self-signed but invalid");
  } else if (options.caCertPems && options.caCertPems.length > 0) {
    await findIssuerCertificate(signer, parseCaCertificates(options.caCertPems));
  }

  const signerSubject = certificateSubjectAttributes(signer);

  return {
    subject: formatSubject(signerSubject),
    serial: certificateSerialHex(signer),
    fingerprintSha256: await certificateFingerprintSha256(signer),
    eContent: new Uint8Array(eContent.getValue()),
    selfSigned,
  };
}
