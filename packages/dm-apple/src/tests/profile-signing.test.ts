import { describe, expect, it } from "vitest";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { pemEncode } from "@mattrax/crypto";
import {
  AppleProfileSigningError,
  createAppleProfileSigner,
  signAppleProfilePlist,
} from "../profile-signing.js";

const pemToPkcs8 = (pem: string): ArrayBuffer => {
  const base64 = pem
    .replaceAll("-----BEGIN PRIVATE KEY-----", "")
    .replaceAll("-----END PRIVATE KEY-----", "")
    .replaceAll(/\s/g, "");

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
};

const makeCertificate = async (
  keyPair: CryptoKeyPair,
  subjectCommonName: string,
): Promise<string> => {
  const attribute = (type: string, value: string) =>
    new pkijs.AttributeTypeAndValue({ type, value: new asn1js.Utf8String({ value }) });

  const certificate = new pkijs.Certificate();
  certificate.version = 2;
  certificate.serialNumber = new asn1js.Integer({ value: 1 });

  const name = new pkijs.RelativeDistinguishedNames({
    typesAndValues: [attribute("2.5.4.10", "Mattrax"), attribute("2.5.4.3", subjectCommonName)],
  });

  certificate.issuer = name;
  certificate.subject = name;
  certificate.notBefore.value = new Date(Date.now() - 60_000);
  certificate.notAfter.value = new Date(Date.now() + 86_400_000);
  await certificate.subjectPublicKeyInfo.importKey(keyPair.publicKey);
  await certificate.sign(keyPair.privateKey, "SHA-256");

  return pemEncode("CERTIFICATE", certificate.toSchema(true).toBER(false));
};

const makeSigningMaterial = async () => {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ["sign", "verify"],
  );

  return {
    certificatePem: await makeCertificate(keyPair, "Mattrax Profile Signing"),
    privateKeyPem: pemEncode(
      "PRIVATE KEY",
      await crypto.subtle.exportKey("pkcs8", keyPair.privateKey),
    ),
  };
};

const parseSignedData = (bytes: Uint8Array) => {
  const buffer = new ArrayBuffer(bytes.byteLength);

  new Uint8Array(buffer).set(bytes);

  const contentInfo = pkijs.ContentInfo.fromBER(buffer);

  expect(contentInfo.contentType).toBe(pkijs.ContentInfo.SIGNED_DATA);
  expect(contentInfo.content).toBeDefined();

  return new pkijs.SignedData({ schema: contentInfo.content });
};

describe("Apple profile signing", () => {
  it("produces a CMS SignedData message with the plist encapsulated", async () => {
    const material = await makeSigningMaterial();
    const plist = '<?xml version="1.0"?><plist><dict><key>Test</key><true/></dict></plist>';

    const bytes = await signAppleProfilePlist(plist, {
      certificatePem: material.certificatePem,
      privateKey: material.privateKeyPem,
    });

    const signedData = parseSignedData(bytes);

    const certificates = (signedData.certificates ?? []).filter(
      (certificate): certificate is pkijs.Certificate => certificate instanceof pkijs.Certificate,
    );

    expect(certificates).toHaveLength(1);
    expect(certificates[0]?.subject.typesAndValues[1]?.value.valueBlock.value).toBe(
      "Mattrax Profile Signing",
    );

    const eContent = signedData.encapContentInfo.eContent;

    expect(eContent).toBeDefined();
    expect(new Uint8Array(eContent!.getValue())).toEqual(new TextEncoder().encode(plist));

    const attributes = signedData.signerInfos[0]?.signedAttrs?.attributes ?? [];

    expect(attributes.map((attribute) => attribute.type)).toEqual([
      "1.2.840.113549.1.9.3",
      "1.2.840.113549.1.9.4",
    ]);

    const result = await signedData.verify({
      signer: 0,
      checkChain: false,
      extendedMode: true,
    });

    expect(result.signatureVerified).toBe(true);
    expect(result.signerCertificate?.subject.isEqual(certificates[0].subject)).toBe(true);
  });

  it("includes a supplied certificate chain", async () => {
    const material = await makeSigningMaterial();

    const chainKeyPair = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        hash: "SHA-256",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
      },
      true,
      ["sign", "verify"],
    );

    const bytes = await signAppleProfilePlist("<plist/>", {
      certificatePem: material.certificatePem,
      privateKey: material.privateKeyPem,
      chainPem: await makeCertificate(chainKeyPair, "Mattrax Profile Chain"),
    });

    const signedData = parseSignedData(bytes);

    expect(
      (signedData.certificates ?? []).filter(
        (certificate) => certificate instanceof pkijs.Certificate,
      ),
    ).toHaveLength(2);
  });

  it("detects a modified profile body", async () => {
    const material = await makeSigningMaterial();

    const bytes = await signAppleProfilePlist("<plist>original</plist>", {
      certificatePem: material.certificatePem,
      privateKey: material.privateKeyPem,
    });

    const signedData = parseSignedData(bytes);
    signedData.encapContentInfo.eContent = new asn1js.OctetString({
      valueHex: new TextEncoder().encode("<plist>tampered</plist>").buffer,
    });

    await expect(
      signedData.verify({ signer: 0, checkChain: false, extendedMode: true }),
    ).rejects.toThrow();
  });

  it("reuses the loaded identity in the signer factory", async () => {
    const material = await makeSigningMaterial();
    const signer = createAppleProfileSigner(material);

    const first = await signer.sign("<plist>first</plist>");
    const second = await signer.sign("<plist>second</plist>");

    expect(new Uint8Array(parseSignedData(first).encapContentInfo.eContent!.getValue())).toEqual(
      new TextEncoder().encode("<plist>first</plist>"),
    );
    expect(new Uint8Array(parseSignedData(second).encapContentInfo.eContent!.getValue())).toEqual(
      new TextEncoder().encode("<plist>second</plist>"),
    );
  });

  it("fails closed when the signing identity is invalid", async () => {
    await expect(
      signAppleProfilePlist("<plist/>", {
        certificatePem: "not a certificate",
        privateKey: "not a key",
      }),
    ).rejects.toBeInstanceOf(AppleProfileSigningError);

    const signer = createAppleProfileSigner({
      certificatePem: undefined,
      privateKeyPem: undefined,
    });

    await expect(signer.sign("<plist/>")).rejects.toBeInstanceOf(AppleProfileSigningError);
  });

  it("accepts a WebCrypto key instead of a PEM private key", async () => {
    const material = await makeSigningMaterial();

    const privateKey = await crypto.subtle.importKey(
      "pkcs8",
      pemToPkcs8(material.privateKeyPem),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );

    const bytes = await signAppleProfilePlist("<plist/>", {
      certificatePem: material.certificatePem,
      privateKey,
    });

    const result = await parseSignedData(bytes).verify({
      signer: 0,
      checkChain: false,
      extendedMode: true,
    });

    expect(result.signatureVerified).toBe(true);
  });
});
