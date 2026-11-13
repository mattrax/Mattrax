import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { pemEncode } from "@mattrax/crypto";
import { generateApnsKeyPair } from "../csr.js";

if (typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined") {
  try {
    pkijs.getEngine();
  } catch {
    pkijs.setEngine("WebCrypto", crypto as unknown as Crypto, crypto.subtle);
  }
}

const attribute = (type: string, value: string) =>
  new pkijs.AttributeTypeAndValue({ type, value: new asn1js.Utf8String({ value }) });

export async function createTestApnsCertificate(options: {
  keyPair: CryptoKeyPair;
  topic: string;
  commonName?: string;
  organization?: string;
  organizationalUnit?: string;
  notBefore?: Date;
  notAfter?: Date;
}): Promise<{ certificate: pkijs.Certificate; pem: string }> {
  const certificate = new pkijs.Certificate();
  certificate.version = 2;
  certificate.serialNumber = new asn1js.Integer({ value: 1 });

  const name = new pkijs.RelativeDistinguishedNames({
    typesAndValues: [
      attribute("2.5.4.10", options.organization ?? "Mattrax"),
      attribute("2.5.4.11", options.organizationalUnit ?? "tenant-1"),
      attribute("2.5.4.3", options.commonName ?? "APNs Test Certificate"),
      // UID / APNs topic
      attribute("0.9.2342.19200300.100.1.1", options.topic),
    ],
  });

  certificate.issuer = name;
  certificate.subject = name;

  const now = new Date();
  certificate.notBefore.value = options.notBefore ?? new Date(now.getTime() - 60_000);
  certificate.notAfter.value =
    options.notAfter ?? new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  await certificate.subjectPublicKeyInfo.importKey(options.keyPair.publicKey);
  await certificate.sign(options.keyPair.privateKey, "SHA-256");

  const pem = pemEncode("CERTIFICATE", certificate.toSchema(true).toBER(false));

  return { certificate, pem };
}

export const createTestApnsKeys = async () => generateApnsKeyPair();
