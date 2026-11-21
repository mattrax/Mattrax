import { Schema } from "effect";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { constants, privateDecrypt, publicEncrypt } from "node:crypto";
import {
  certificateSerialHex,
  certToPem,
  createCaCertificate,
  createDeviceCertificate,
  pemEncode,
} from "@mattrax/scep";

if (typeof crypto !== "undefined" && crypto.subtle !== undefined) {
  try {
    pkijs.getEngine();
  } catch {
    pkijs.setEngine("WebCrypto", crypto, crypto.subtle);
  }
}

const algorithm: RsaHashedKeyGenParams = {
  name: "RSASSA-PKCS1-v1_5",
  hash: "SHA-256",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
};

type AttributeValueBlock = { readonly value?: unknown; readonly valueDec?: number };

function hasAttributeValueBlock(node: unknown): node is AttributeValueBlock {
  return typeof node === "object" && node !== null;
}

function hasHexValue(
  node: unknown,
): node is { valueBlock: { valueHexView: Uint8Array<ArrayBuffer> } } {
  if (typeof node !== "object" || node === null || !("valueBlock" in node)) return false;
  const block = node.valueBlock;

  if (typeof block !== "object" || block === null || !("valueHexView" in block)) return false;

  return block.valueHexView instanceof Uint8Array;
}

export type ScepCaFixture = {
  readonly keyPair: CryptoKeyPair;
  readonly cert: pkijs.Certificate;
  readonly certPem: string;
  readonly privateKeyJwk: JsonWebKey;
  readonly serial: string;
};

export const generateKeyPair = async (): Promise<CryptoKeyPair> =>
  crypto.subtle.generateKey(algorithm, true, ["sign", "verify"] as const);

export const createCaFixture = async (): Promise<ScepCaFixture> => {
  const keyPair = await generateKeyPair();
  const cert = await createCaCertificate(keyPair, "Compliance SCEP CA");

  return {
    keyPair,
    cert,
    certPem: certToPem(cert),
    privateKeyJwk: await crypto.subtle.exportKey("jwk", keyPair.privateKey),
    serial: certificateSerialHex(cert),
  };
};

export const createSelfSignedCertificate = async (
  keyPair: CryptoKeyPair,
  commonName: string,
): Promise<pkijs.Certificate> => {
  const cert = new pkijs.Certificate();
  cert.version = 2;
  cert.serialNumber = new asn1js.Integer({
    valueHex: crypto.getRandomValues(new Uint8Array(8)).buffer,
  });

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
  const now = new Date();
  cert.notBefore.value = new Date(now.getTime() - 60_000);
  cert.notAfter.value = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  await cert.subjectPublicKeyInfo.importKey(keyPair.publicKey);
  await cert.sign(keyPair.privateKey, "SHA-256");

  return cert;
};

export const createCsr = async (
  keyPair: CryptoKeyPair,
  options: {
    readonly commonName?: string;
    readonly organizationalUnit?: string;
    readonly organization?: string;
    readonly challengePassword?: string;
  } = {},
): Promise<pkijs.CertificationRequest> => {
  const csr = new pkijs.CertificationRequest();
  csr.version = 0;

  const values = [
    new pkijs.AttributeTypeAndValue({
      type: "2.5.4.3",
      value: new asn1js.Utf8String({ value: options.commonName ?? "Compliance Device" }),
    }),
  ];

  if (options.organizationalUnit) {
    values.push(
      new pkijs.AttributeTypeAndValue({
        type: "2.5.4.11",
        value: new asn1js.Utf8String({ value: options.organizationalUnit }),
      }),
    );
  }

  if (options.organization) {
    values.push(
      new pkijs.AttributeTypeAndValue({
        type: "2.5.4.10",
        value: new asn1js.Utf8String({ value: options.organization }),
      }),
    );
  }

  csr.subject = new pkijs.RelativeDistinguishedNames({ typesAndValues: values });

  if (options.challengePassword) {
    csr.attributes = [
      new pkijs.Attribute({
        type: "1.2.840.113549.1.9.7",
        values: [new asn1js.PrintableString({ value: options.challengePassword })],
      }),
    ];
  }

  await csr.subjectPublicKeyInfo.importKey(keyPair.publicKey);
  await csr.sign(keyPair.privateKey, "SHA-256");

  return csr;
};

export const encryptEnvelopedData = async (
  plaintext: ArrayBuffer,
  recipientCert: pkijs.Certificate,
): Promise<ArrayBuffer> => {
  const sessionKey = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(16));

  const aesKey = await crypto.subtle.importKey("raw", sessionKey, { name: "AES-CBC" }, false, [
    "encrypt",
  ]);

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
    encryptedKey: new asn1js.OctetString({
      valueHex: new Uint8Array(encryptedSessionKey).buffer,
    }),
  });

  const envelopedData = new pkijs.EnvelopedData({
    version: 0,
    recipientInfos: [new pkijs.RecipientInfo({ variant: 1, value: ktri })],
    encryptedContentInfo: new pkijs.EncryptedContentInfo({
      contentType: pkijs.ContentInfo.DATA,
      contentEncryptionAlgorithm: new pkijs.AlgorithmIdentifier({
        algorithmId: "2.16.840.1.101.3.4.1.2",
        algorithmParams: new asn1js.OctetString({ valueHex: new Uint8Array(iv).buffer }),
      }),
      encryptedContent: new asn1js.OctetString({ valueHex: encryptedContent }),
    }),
  });

  return new pkijs.ContentInfo({
    contentType: pkijs.ContentInfo.ENVELOPED_DATA,
    content: envelopedData.toSchema(),
  })
    .toSchema()
    .toBER(false);
};

const signerAttribute = (signedData: pkijs.SignedData, oid: string): pkijs.Attribute | undefined =>
  signedData.signerInfos[0]?.signedAttrs?.attributes.find((attribute) => attribute.type === oid);

const stringValue = (attribute: pkijs.Attribute | undefined): string | undefined => {
  const value = attribute?.values[0];

  if (!value) return undefined;

  const block: unknown = value.valueBlock;

  if (!hasAttributeValueBlock(block)) return undefined;

  if (Schema.is(Schema.String)(block.value)) return block.value;

  return block.valueDec === undefined ? undefined : String(block.valueDec);
};

const octetValue = (attribute: pkijs.Attribute | undefined): ArrayBuffer | undefined => {
  const value = attribute?.values[0];

  if (!(value instanceof asn1js.OctetString)) return undefined;

  return value.valueBlock.valueHexView.slice().buffer;
};

export type ParsedCertRep = {
  readonly signedData: pkijs.SignedData;
  readonly certificates: ReadonlyArray<pkijs.Certificate>;
  readonly messageType?: string;
  readonly pkiStatus?: string;
  readonly failInfo?: string;
  readonly transactionId?: string;
  readonly recipientNonce?: ArrayBuffer;
  readonly signerVerified: boolean;
};

export const parseCertRep = async (der: ArrayBuffer): Promise<ParsedCertRep> => {
  let signedData: pkijs.SignedData | undefined;

  try {
    const contentInfo = pkijs.ContentInfo.fromBER(der);

    if (contentInfo.contentType === pkijs.ContentInfo.SIGNED_DATA)
      signedData = new pkijs.SignedData({ schema: contentInfo.content });
  } catch {
    // Failure CertReps are encoded as a bare SignedData rather than ContentInfo.
  }

  if (!signedData) {
    const parsed = asn1js.fromBER(der);

    if (parsed.offset === -1) throw new Error("SCEP CertRep is not valid DER");
    signedData = new pkijs.SignedData({ schema: parsed.result });
  }

  const verified = await signedData.verify({ signer: 0, checkChain: false });

  return {
    signedData,
    certificates: (signedData.certificates ?? []).filter(
      (certificate): certificate is pkijs.Certificate => certificate instanceof pkijs.Certificate,
    ),
    messageType: stringValue(signerAttribute(signedData, "2.16.840.1.113733.1.9.2")),
    pkiStatus: stringValue(signerAttribute(signedData, "2.16.840.1.113733.1.9.3")),
    failInfo: stringValue(signerAttribute(signedData, "2.16.840.1.113733.1.9.4")),
    transactionId: stringValue(signerAttribute(signedData, "2.16.840.1.113733.1.9.7")),
    recipientNonce: octetValue(signerAttribute(signedData, "2.16.840.1.113733.1.9.6")),
    signerVerified: verified === true,
  };
};

export const decryptCertRep = async (
  certRep: ParsedCertRep,
  devicePrivateKeyJwk: JsonWebKey,
): Promise<pkijs.Certificate> => {
  const eContent = certRep.signedData.encapContentInfo.eContent;

  if (!(eContent instanceof asn1js.OctetString)) throw new Error("CertRep has no eContent");

  const envelopedDer = eContent.getValue();
  const contentInfo = pkijs.ContentInfo.fromBER(envelopedDer);
  const envelopedData = new pkijs.EnvelopedData({ schema: contentInfo.content });
  const recipient = envelopedData.recipientInfos[0]?.value;

  if (!recipient || !("encryptedKey" in recipient))
    throw new Error("CertRep has no key transport recipient");

  if (!hasHexValue(recipient.encryptedKey)) throw new Error("Recipient key has no bytes");

  const encryptedKey = Buffer.from(recipient.encryptedKey.valueBlock.valueHexView);

  const signingKey = await crypto.subtle.importKey(
    "jwk",
    devicePrivateKeyJwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    true,
    ["sign"],
  );

  const pkcs8Der = await crypto.subtle.exportKey("pkcs8", signingKey);
  const pkcs8Pem = pemEncode("PRIVATE KEY", pkcs8Der);

  const sessionKeyBytes = privateDecrypt(
    { key: pkcs8Pem, padding: constants.RSA_PKCS1_PADDING },
    encryptedKey,
  );

  const algorithmParams =
    envelopedData.encryptedContentInfo.contentEncryptionAlgorithm.algorithmParams;

  if (!hasHexValue(algorithmParams)) throw new Error("CertRep has no content encryption IV");

  const iv = algorithmParams.valueBlock.valueHexView;

  const aesKey = await crypto.subtle.importKey("raw", sessionKeyBytes, { name: "AES-CBC" }, false, [
    "decrypt",
  ]);

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv: Buffer.from(iv) },
    aesKey,
    envelopedData.encryptedContentInfo.getEncryptedContent(),
  );

  const degenerate = pkijs.ContentInfo.fromBER(decrypted);
  const signed = new pkijs.SignedData({ schema: degenerate.content });
  const certificate = signed.certificates?.[0];

  if (!(certificate instanceof pkijs.Certificate))
    throw new Error("CertRep does not contain an issued certificate");

  return certificate;
};

export const buildPkcsReq = async (options: {
  readonly csr: pkijs.CertificationRequest;
  readonly csrDer?: ArrayBuffer;
  readonly caCert: pkijs.Certificate;
  readonly signerCert: pkijs.Certificate;
  readonly signerPrivateKey: CryptoKey;
  readonly transactionId: string;
  readonly senderNonce: Uint8Array;
  readonly encryptCsr?: boolean;
  readonly messageType?: string;
}): Promise<ArrayBuffer> => {
  const csrDer = options.csrDer ?? options.csr.toSchema().toBER(false);

  const innerContent =
    options.encryptCsr === false ? csrDer : await encryptEnvelopedData(csrDer, options.caCert);

  const innerDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", innerContent));

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
      eContent: new asn1js.OctetString({ valueHex: innerContent }),
    }),
    certificates: [options.signerCert],
    signerInfos: [],
  });

  const signerInfo = new pkijs.SignerInfo({
    version: 1,
    sid: new pkijs.IssuerAndSerialNumber({
      issuer: options.signerCert.issuer,
      serialNumber: options.signerCert.serialNumber,
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
          type: "1.2.840.113549.1.9.4",
          values: [new asn1js.OctetString({ valueHex: innerDigest.buffer })],
        }),
        new pkijs.Attribute({
          type: "2.16.840.1.113733.1.9.7",
          values: [new asn1js.PrintableString({ value: options.transactionId })],
        }),
        new pkijs.Attribute({
          type: "2.16.840.1.113733.1.9.2",
          values: [new asn1js.PrintableString({ value: options.messageType ?? "19" })],
        }),
        new pkijs.Attribute({
          type: "2.16.840.1.113733.1.9.5",
          values: [
            new asn1js.OctetString({ valueHex: new Uint8Array(options.senderNonce).buffer }),
          ],
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
  await signedData.sign(options.signerPrivateKey, 0, "SHA-256");

  return new pkijs.ContentInfo({
    contentType: pkijs.ContentInfo.SIGNED_DATA,
    content: signedData.toSchema(),
  })
    .toSchema()
    .toBER(false);
};

export const issueIdentity = async (options: {
  readonly ca: ScepCaFixture;
  readonly commonName: string;
  readonly organizationalUnit?: string;
  readonly notAfter?: Date;
}): Promise<{ keyPair: CryptoKeyPair; certificate: pkijs.Certificate; serial: string }> => {
  const keyPair = await generateKeyPair();
  const now = new Date();

  const subject = [
    { type: "2.5.4.3", value: options.commonName },
    ...(options.organizationalUnit
      ? [{ type: "2.5.4.11", value: options.organizationalUnit }]
      : []),
  ];

  const certificate = await createDeviceCertificate(
    crypto.getRandomValues(new Uint8Array(8)).buffer,
    subject,
    keyPair.publicKey,
    options.ca.cert,
    options.ca.keyPair.privateKey,
    {
      notBefore: new Date(now.getTime() - 60_000),
      notAfter: options.notAfter ?? new Date(now.getTime() + 86_400_000),
    },
  );

  return { keyPair, certificate, serial: certificateSerialHex(certificate) };
};

export const certificateValue = (
  certificate: pkijs.Certificate,
  oid: string,
): string | undefined => {
  const attribute = certificate.subject.typesAndValues.find((item) => item.type === oid);
  const block: unknown = attribute?.value.valueBlock;

  if (!hasAttributeValueBlock(block)) return undefined;

  return Schema.is(Schema.String)(block.value) ? block.value : undefined;
};
