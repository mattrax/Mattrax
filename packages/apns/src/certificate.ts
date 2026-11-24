import type * as pkijs from "pkijs";
import { Option, Schema } from "effect";
import { pemDecode } from "@mattrax/crypto";
import { loadPkijs } from "./pkijs.js";

const UID_OID = "0.9.2342.19200300.100.1.1";

const COMMON_NAME_OID = "2.5.4.3";

// Apple MDM push topics are issued as `com.apple.mgmt.External.<id>` (device
// enrollment) or `com.apple.mgmt.AccountDrivenEnrollment.<id>` (ADE).
const MDM_TOPIC_PATTERN = /^com\.apple\.mgmt\.[A-Za-z0-9._-]+$/;

export type ParsedApnsCertificate = {
  readonly topic: string;
  readonly commonName: string | null;
  readonly notBefore: Date;
  readonly notAfter: Date;
  readonly certificate: pkijs.Certificate;
};

/** Public certificate fields; the pkijs object stays an implementation detail. */
export type CertificateMetadata = {
  readonly topic: string | null;
  readonly commonName: string | null;
  readonly notBefore: Date;
  readonly notAfter: Date;
};

const AttributeValueBlock = Schema.Struct({
  valueBlock: Schema.optional(
    Schema.Struct({
      value: Schema.optional(Schema.String),
      valueHexView: Schema.optional(Schema.instanceOf(Uint8Array)),
    }),
  ),
});

const attributeValue = (attribute: pkijs.AttributeTypeAndValue): string => {
  const value = Option.getOrUndefined(
    Schema.decodeUnknownOption(AttributeValueBlock)(attribute.value),
  );

  return value?.valueBlock?.value ?? "";
};

const findAttribute = (certificate: pkijs.Certificate, oid: string): string | null => {
  const attributes = certificate.subject?.typesAndValues ?? [];

  for (const attribute of attributes) {
    if (attribute.type === oid) {
      const value = attributeValue(attribute);

      if (value) return value;
    }
  }

  return null;
};

export const isApnsMdmTopic = (topic: string | null | undefined): topic is string =>
  typeof topic === "string" && MDM_TOPIC_PATTERN.test(topic);

/**
 * Parse a PEM certificate without validating its lifetime or contents.
 *
 * Async because pkijs is loaded on first use, not at module evaluation.
 */
const parseCertificate = async (
  pem: string,
): Promise<{ readonly metadata: CertificateMetadata; readonly certificate: pkijs.Certificate }> => {
  const der = pemDecode("CERTIFICATE", pem);
  const { Certificate } = await loadPkijs();
  const certificate = Certificate.fromBER(der);
  const topic = findAttribute(certificate, UID_OID);

  return {
    metadata: {
      topic,
      commonName: findAttribute(certificate, COMMON_NAME_OID),
      notBefore: certificate.notBefore.value,
      notAfter: certificate.notAfter.value,
    },
    certificate,
  };
};

/** Parse public X.509 fields without exposing the PKI library's types. */
export const parseCertificateMetadata = async (pem: string): Promise<CertificateMetadata> =>
  (await parseCertificate(pem)).metadata;

export async function parseApnsCertificate(pem: string): Promise<ParsedApnsCertificate> {
  const { metadata, certificate } = await parseCertificate(pem);

  if (!metadata.topic)
    throw new Error("APNs certificate is missing the UID (topic) subject attribute");

  return { ...metadata, topic: metadata.topic, certificate };
}

/**
 * Verify that the certificate was signed for the given private key. WebCrypto
 * only needs the public half, which is embedded in the certificate.
 */
export async function certificateMatchesKey(
  certificate: pkijs.Certificate,
  privateKey: CryptoKey,
): Promise<boolean> {
  const publicKey = await certificate.getPublicKey();
  const data = crypto.getRandomValues(new Uint8Array(32));
  const signature = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, privateKey, data);

  return crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, publicKey, signature, data);
}

export type ValidateApnsCertificateOptions = {
  /** The private key that produced the CSR, when available. */
  readonly privateKey?: CryptoKey;
  /** Override the clock for tests. */
  readonly now?: Date;
};

/**
 * Parse and validate an uploaded APNs certificate:
 *
 * - it must be a readable X.509 certificate with a `UID` subject (the APNs topic)
 * - the topic must look like an Apple MDM topic
 * - the certificate must currently be valid
 * - when supplied, the certificate must match the pending private key
 */
export async function validateApnsCertificate(
  pem: string,
  options: ValidateApnsCertificateOptions = {},
): Promise<ParsedApnsCertificate> {
  const parsed = await parseApnsCertificate(pem);

  if (!isApnsMdmTopic(parsed.topic)) throw new Error(`Invalid APNs topic: ${parsed.topic}`);

  const now = options.now ?? new Date();

  if (parsed.notBefore.getTime() > now.getTime())
    throw new Error("The APNs certificate is not valid yet");

  if (parsed.notAfter.getTime() < now.getTime())
    throw new Error("The APNs certificate has expired");

  if (options.privateKey) {
    const matches = await certificateMatchesKey(parsed.certificate, options.privateKey);

    if (!matches)
      throw new Error(
        "The APNs certificate was not signed for the pending private key. Upload the certificate generated by this server.",
      );
  }

  return parsed;
}
