import { Layer, Effect } from "effect";
import * as pkijs from "pkijs";
import * as asn1js from "asn1js";
import { publicEncrypt, constants } from "node:crypto";
import { ScepRepository, type ScepPkcsReq } from "../repository.js";
import { ScepError } from "../schema.js";
import { pemEncode } from "../crypto.js";

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

export async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(ALGORITHM as any, true, [
    "sign",
    "verify",
  ]) as Promise<CryptoKeyPair>;
}

export async function createTestCaCert(
  keyPair: CryptoKeyPair,
  cn: string,
): Promise<pkijs.Certificate> {
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
  cert.notAfter.value = new Date(now.getTime() + 10 * 365 * 24 * 60 * 60 * 1000);

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

export async function createTestSignerCert(
  keyPair: CryptoKeyPair,
  cn: string,
): Promise<pkijs.Certificate> {
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

export async function buildTestCsr(
  keyPair: CryptoKeyPair,
  cn: string,
): Promise<pkijs.CertificationRequest> {
  const csr = new pkijs.CertificationRequest();
  csr.version = 0;
  csr.subject = new pkijs.RelativeDistinguishedNames({
    typesAndValues: [
      new pkijs.AttributeTypeAndValue({
        type: "2.5.4.3",
        value: new asn1js.Utf8String({ value: cn }),
      }),
    ],
  });
  await csr.subjectPublicKeyInfo.importKey(keyPair.publicKey);
  await csr.sign(keyPair.privateKey, "SHA-256");
  return csr;
}

export async function encryptEnvelopedData(
  plaintext: ArrayBuffer,
  recipientCert: pkijs.Certificate,
): Promise<ArrayBuffer> {
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
        algorithmId: "2.16.840.1.101.3.4.1.2",
        algorithmParams: new asn1js.OctetString({ valueHex: iv.buffer as ArrayBuffer }),
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
}

export async function buildPkcsReq(
  csr: pkijs.CertificationRequest,
  caCert: pkijs.Certificate,
  signerCert: pkijs.Certificate,
  signerPrivateKey: CryptoKey,
  transactionId: string,
  senderNonce: Uint8Array,
  encryptCsr: boolean,
): Promise<ArrayBuffer> {
  const csrDer = csr.toSchema().toBER(false);
  const innerContent = encryptCsr ? await encryptEnvelopedData(csrDer, caCert) : csrDer;

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
  })
    .toSchema()
    .toBER(false);
}

export function mockScepRepository(
  overrides?: Partial<{
    getCa: () => Effect.Effect<{ certPem: string; privateKeyJwk: JsonWebKey } | null, ScepError>;
    saveCa: (certPem: string, privateKeyJwk: JsonWebKey) => Effect.Effect<void, ScepError>;
    authenticatePkcsReq: (req: ScepPkcsReq) => Effect.Effect<void, ScepError>;
  }>,
) {
  return Layer.succeed(
    ScepRepository,
    ScepRepository.of({
      getCa: overrides?.getCa ?? (() => Effect.succeed(null)),
      saveCa: overrides?.saveCa ?? (() => Effect.void),
      authenticatePkcsReq: overrides?.authenticatePkcsReq ?? (() => Effect.void),
    }),
  );
}
