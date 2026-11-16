import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { Effect } from "effect";
import { serializePlist } from "@mattrax/plist";
import {
  arrayBufferToBase64,
  exportPrivateKeyJwk,
  generateCaKeyPair,
  importPrivateKeyJwk,
  pemDecode,
  pemEncode,
  uint8ArrayToBase64,
} from "@mattrax/crypto";
import {
  APPLE_ROOT_CA,
  APPLE_WORLDWIDE_DEVELOPER_RELATIONS_CERTIFICATION_AUTHORITY,
} from "./appleCerts.js";

if (typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined") {
  try {
    pkijs.getEngine();
  } catch {
    pkijs.setEngine("WebCrypto", crypto, crypto.subtle);
  }
}

const RSA_ALGORITHM = {
  name: "RSASSA-PKCS1-v1_5",
  hash: "SHA-256",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
} as const;

const SIGN_ALGORITHM = { name: "RSASSA-PKCS1-v1_5" } as const;

const ORGANIZATION_OID = "2.5.4.10";

const ORGANIZATIONAL_UNIT_OID = "2.5.4.11";

export type ApnsCsrSubject = {
  readonly organization: string;
  readonly organizationalUnit: string;
};

/**
 * Generate the RSA-2048 key pair used for an APNs MDM push certificate. The
 * private key never leaves the server; it is stored sealed in the database.
 */
export const generateApnsKeyPair = (): Promise<CryptoKeyPair> => generateCaKeyPair();

export const exportApnsKeyJwk = (key: CryptoKey): Promise<JsonWebKey> => exportPrivateKeyJwk(key);

export const importApnsKeyJwk = (jwk: JsonWebKey): Promise<CryptoKey> => importPrivateKeyJwk(jwk);

export const apnsKeyToPkcs8Pem = async (jwk: JsonWebKey): Promise<string> => {
  const key = await importPrivateKeyJwk(jwk);
  const der = await crypto.subtle.exportKey("pkcs8", key);

  return pemEncode("PRIVATE KEY", der);
};

const rdn = (type: string, value: string) =>
  new pkijs.AttributeTypeAndValue({ type, value: new asn1js.Utf8String({ value }) });

/** Build a DER encoded PKCS#10 certification request for an Apple MDM push cert. */
export async function createApnsCsrDer(
  keyPair: CryptoKeyPair,
  subject: ApnsCsrSubject,
): Promise<ArrayBuffer> {
  const csr = new pkijs.CertificationRequest();
  csr.version = 0;
  csr.subject = new pkijs.RelativeDistinguishedNames({
    typesAndValues: [
      rdn(ORGANIZATION_OID, subject.organization),
      rdn(ORGANIZATIONAL_UNIT_OID, subject.organizationalUnit),
    ],
  });
  await csr.subjectPublicKeyInfo.importKey(keyPair.publicKey);
  await csr.sign(keyPair.privateKey, "SHA-256");

  return csr.toSchema(true).toBER(false);
}

async function importVendorPrivateKey(pem: string): Promise<CryptoKey> {
  const der = pemDecode("PRIVATE KEY", pem);

  return crypto.subtle.importKey("pkcs8", der, RSA_ALGORITHM, false, ["sign"]);
}

/**
 * Produce the PKCS#1 v1.5 signature Apple expects for `PushCertSignature`. The
 * vendor key is the Apple MDM vendor private key configured on this deployment.
 */
export async function signApnsCsr(csrDer: ArrayBuffer, vendorKeyPem: string): Promise<ArrayBuffer> {
  const key = await importVendorPrivateKey(vendorKeyPem);

  return crypto.subtle.sign(SIGN_ALGORITHM, key, csrDer);
}

export type ApnsCsrVendor = {
  readonly certificatePem: string;
  readonly privateKeyPem: string;
};

export type ApnsCsrResult = {
  /** Base64 encoded XML plist ready to hand to Apple's push certificate portal. */
  readonly plist: string;
  /** Base64 encoded DER CSR (`PushCertRequestCSR`). */
  readonly certificateSigningRequest: string;
  /** Base64 encoded vendor signature, empty when no vendor key is configured. */
  readonly signature: string;
  /** PEM certificate chain, empty when no vendor certificate is configured. */
  readonly certificateChain: string;
  readonly csrDer: ArrayBuffer;
  readonly privateKeyJwk: JsonWebKey;
};

/**
 * Build the APNs CSR plist. When an Apple vendor certificate/key is configured
 * the certificate chain and PKCS#1 signature are included so Apple can sign the
 * request immediately. Otherwise the CSR is returned with empty chain/signature;
 * this still works when a certificate is signed manually via the Apple portal.
 */
export async function buildApnsCsr(options: {
  readonly keyPair: CryptoKeyPair;
  readonly subject: ApnsCsrSubject;
  readonly vendor?: ApnsCsrVendor;
}): Promise<ApnsCsrResult> {
  const csrDer = await createApnsCsrDer(options.keyPair, options.subject);
  const privateKeyJwk = await exportPrivateKeyJwk(options.keyPair.privateKey);

  let certificateChain = "";
  let signature = "";

  if (options.vendor) {
    certificateChain = [
      options.vendor.certificatePem.trim(),
      APPLE_WORLDWIDE_DEVELOPER_RELATIONS_CERTIFICATION_AUTHORITY.trim(),
      APPLE_ROOT_CA.trim(),
    ].join("\n");
    signature = arrayBufferToBase64(await signApnsCsr(csrDer, options.vendor.privateKeyPem));
  }

  const certificateSigningRequest = arrayBufferToBase64(csrDer);

  const plist = await Effect.runPromise(
    serializePlist({
      PushCertCertificateChain: certificateChain,
      PushCertRequestCSR: certificateSigningRequest,
      PushCertSignature: signature,
    }),
  );

  return {
    plist: uint8ArrayToBase64(new TextEncoder().encode(plist)),
    certificateSigningRequest,
    signature,
    certificateChain,
    csrDer,
    privateKeyJwk,
  };
}
