import { beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { pemEncode } from "@mattrax/crypto";
import {
  CLIENT_AUTH_EKU_OID,
  MAX_MDM_SIGNATURE_BASE64_LENGTH,
  verifyMdmSignature,
  verifyScepPkcsReqSignature,
} from "../signature.js";

// ─── PKIjs Engine ────────────────────────────────────────────────

beforeAll(() => {
  try {
    pkijs.getEngine();
  } catch {
    pkijs.setEngine("WebCrypto", crypto as unknown as Crypto, crypto.subtle);
  }
});

// ─── Test PKI ────────────────────────────────────────────────────

const RSA_ALGORITHM = {
  name: "RSASSA-PKCS1-v1_5",
  hash: "SHA-256",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
};

const SHA256_OID = "2.16.840.1.101.3.4.2.1";
const SHA256_WITH_RSA_OID = "1.2.840.113549.1.1.11";
const CONTENT_TYPE_OID = "1.2.840.113549.1.9.3";
const MESSAGE_DIGEST_OID = "1.2.840.113549.1.9.4";

const DAY = 24 * 60 * 60 * 1000;

type TestCertificate = {
  readonly cert: pkijs.Certificate;
  readonly keyPair: CryptoKeyPair;
  readonly pem: string;
};

let serialCounter = 0;

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const generateKeyPair = (): Promise<CryptoKeyPair> =>
  crypto.subtle.generateKey(RSA_ALGORITHM as never, true, [
    "sign",
    "verify",
  ]) as Promise<CryptoKeyPair>;

const DN_OIDS: Record<string, string> = {
  CN: "2.5.4.3",
  O: "2.5.4.10",
  OU: "2.5.4.11",
};

const distinguishedName = (attributes: ReadonlyArray<readonly [string, string]>) =>
  new pkijs.RelativeDistinguishedNames({
    typesAndValues: attributes.map(
      ([type, value]) =>
        new pkijs.AttributeTypeAndValue({
          type: DN_OIDS[type] ?? type,
          value: new asn1js.Utf8String({ value }),
        }),
    ),
  });

const createCertificate = async (options: {
  subject: pkijs.RelativeDistinguishedNames;
  issuer: pkijs.RelativeDistinguishedNames;
  publicKey: CryptoKey;
  signingKey: CryptoKey;
  isCa?: boolean;
  clientAuthEku?: boolean;
  notBefore?: Date;
  notAfter?: Date;
}): Promise<pkijs.Certificate> => {
  const cert = new pkijs.Certificate();
  cert.version = 2;
  cert.serialNumber = new asn1js.Integer({ value: ++serialCounter });
  cert.subject = options.subject;
  cert.issuer = options.issuer;
  cert.notBefore.value = options.notBefore ?? new Date(Date.now() - DAY);
  cert.notAfter.value = options.notAfter ?? new Date(Date.now() + 365 * DAY);

  const extensions = [
    new pkijs.Extension({
      extnID: "2.5.29.19",
      critical: true,
      extnValue: new pkijs.BasicConstraints({ cA: options.isCa ?? false }).toSchema().toBER(false),
    }),
  ];

  if (options.clientAuthEku) {
    extensions.push(
      new pkijs.Extension({
        extnID: "2.5.29.37",
        critical: false,
        extnValue: new pkijs.ExtKeyUsage({ keyPurposes: [CLIENT_AUTH_EKU_OID] })
          .toSchema()
          .toBER(false),
      }),
    );
  }

  cert.extensions = extensions;

  await cert.subjectPublicKeyInfo.importKey(options.publicKey);
  await cert.sign(options.signingKey, "SHA-256");

  return cert;
};

const createCa = async (name: string): Promise<TestCertificate> => {
  const keyPair = await generateKeyPair();
  const subject = distinguishedName([["CN", name]]);

  const cert = await createCertificate({
    subject,
    issuer: subject,
    publicKey: keyPair.publicKey,
    signingKey: keyPair.privateKey,
    isCa: true,
    notBefore: new Date(Date.now() - DAY),
    notAfter: new Date(Date.now() + 10 * 365 * DAY),
  });

  return { cert, keyPair, pem: pemEncode("CERTIFICATE", cert.toSchema().toBER(false)) };
};

const createLeaf = async (options: {
  ca?: TestCertificate;
  cn?: string;
  ou?: string;
  clientAuthEku?: boolean;
  notBefore?: Date;
  notAfter?: Date;
}): Promise<TestCertificate> => {
  const keyPair = await generateKeyPair();

  const subject = distinguishedName([
    ["O", "Acme Inc"],
    ["OU", options.ou ?? "org-123"],
    ["CN", options.cn ?? "Device 1"],
  ]);

  const cert = await createCertificate({
    subject,
    issuer: options.ca ? options.ca.cert.subject : subject,
    publicKey: keyPair.publicKey,
    signingKey: options.ca ? options.ca.keyPair.privateKey : keyPair.privateKey,
    clientAuthEku: options.clientAuthEku ?? true,
    notBefore: options.notBefore,
    notAfter: options.notAfter,
  });

  return { cert, keyPair, pem: pemEncode("CERTIFICATE", cert.toSchema().toBER(false)) };
};

// ─── CMS Builder ─────────────────────────────────────────────────

type CmsSigner = { readonly certificate: TestCertificate };

const buildCms = async (options: {
  signers: readonly CmsSigner[];
  body: Uint8Array;
  /** When set, the CMS encapsulates these bytes instead of being detached. */
  eContent?: Uint8Array;
  /** Extra certificates embedded in the CMS (defaults to the signer certs). */
  certificates?: readonly pkijs.Certificate[];
}): Promise<Uint8Array> => {
  const digestAlgorithm = new pkijs.AlgorithmIdentifier({
    algorithmId: SHA256_OID,
    algorithmParams: new asn1js.Null(),
  });

  const signedData = new pkijs.SignedData({
    version: 1,
    digestAlgorithms: [digestAlgorithm],
    encapContentInfo: new pkijs.EncapsulatedContentInfo({
      eContentType: pkijs.ContentInfo.DATA,
      ...(options.eContent
        ? { eContent: new asn1js.OctetString({ valueHex: toArrayBuffer(options.eContent) }) }
        : {}),
    }),
    certificates:
      options.certificates?.slice() ?? options.signers.map((signer) => signer.certificate.cert),
    signerInfos: [],
  });

  const signedBytes = options.eContent ?? options.body;
  const messageDigest = await crypto.subtle.digest("SHA-256", toArrayBuffer(signedBytes));

  for (const signer of options.signers) {
    const cert = signer.certificate.cert;
    signedData.signerInfos.push(
      new pkijs.SignerInfo({
        version: 1,
        sid: new pkijs.IssuerAndSerialNumber({
          issuer: cert.issuer,
          serialNumber: cert.serialNumber,
        }),
        digestAlgorithm,
        signedAttrs: new pkijs.SignedAndUnsignedAttributes({
          type: 0,
          attributes: [
            new pkijs.Attribute({
              type: CONTENT_TYPE_OID,
              values: [new asn1js.ObjectIdentifier({ value: pkijs.ContentInfo.DATA })],
            }),
            new pkijs.Attribute({
              type: MESSAGE_DIGEST_OID,
              values: [new asn1js.OctetString({ valueHex: messageDigest })],
            }),
          ],
        }),
        signatureAlgorithm: new pkijs.AlgorithmIdentifier({
          algorithmId: SHA256_WITH_RSA_OID,
          algorithmParams: new asn1js.Null(),
        }),
      }),
    );
  }

  for (let index = 0; index < options.signers.length; index++) {
    await signedData.sign(
      options.signers[index]!.certificate.keyPair.privateKey,
      index,
      "SHA-256",
      toArrayBuffer(options.body),
    );
  }

  const contentInfo = new pkijs.ContentInfo({
    contentType: pkijs.ContentInfo.SIGNED_DATA,
    content: signedData.toSchema(true),
  });

  return new Uint8Array(contentInfo.toSchema().toBER(false));
};

const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");

const sha256Hex = (bytes: Uint8Array): string =>
  createHash("sha256").update(Buffer.from(bytes)).digest("hex");

const body = (value = "test-request-body"): Uint8Array => new TextEncoder().encode(value);

// ─── MDM Signature Tests ─────────────────────────────────────────

describe("verifyMdmSignature", () => {
  it("accepts a valid detached signature and returns the signer identity", async () => {
    const ca = await createCa("Test CA");
    const leaf = await createLeaf({ ca, cn: "Device 1", ou: "org-123" });
    const payload = body();
    const signature = toBase64(await buildCms({ signers: [{ certificate: leaf }], body: payload }));

    const result = await verifyMdmSignature({
      signature,
      body: payload,
      caCertPems: [ca.pem],
    });

    expect(result.subject).toContain("CN=Device 1");
    expect(result.subject).toContain("OU=org-123");
    expect(result.organizationId).toBe("org-123");
    expect(result.serial).toMatch(/^[0-9a-f]+$/);
    expect(result.fingerprintSha256).toBe(
      sha256Hex(new Uint8Array(leaf.cert.toSchema().toBER(false))),
    );
  });

  it("accepts a CMS whose encapsulated eContent equals the body", async () => {
    const ca = await createCa("Test CA");
    const leaf = await createLeaf({ ca });
    const payload = body();

    const signature = toBase64(
      await buildCms({ signers: [{ certificate: leaf }], body: payload, eContent: payload }),
    );

    await expect(
      verifyMdmSignature({ signature, body: payload, caCertPems: [ca.pem] }),
    ).resolves.toMatchObject({ organizationId: "org-123" });
  });

  it("rejects a tampered body", async () => {
    const ca = await createCa("Test CA");
    const leaf = await createLeaf({ ca });

    const signature = toBase64(
      await buildCms({ signers: [{ certificate: leaf }], body: body("original") }),
    );

    await expect(
      verifyMdmSignature({ signature, body: body("tampered"), caCertPems: [ca.pem] }),
    ).rejects.toThrow(/invalid|message digest/i);
  });

  it("rejects a signer that does not chain to the supplied CA", async () => {
    const ca = await createCa("Test CA");
    const otherCa = await createCa("Other CA");
    const leaf = await createLeaf({ ca });
    const payload = body();
    const signature = toBase64(await buildCms({ signers: [{ certificate: leaf }], body: payload }));

    await expect(
      verifyMdmSignature({ signature, body: payload, caCertPems: [otherCa.pem] }),
    ).rejects.toThrow(/does not chain/i);
  });

  it("rejects a self-signed signer even when its subject carries the right OU", async () => {
    const ca = await createCa("Test CA");
    const selfSigned = await createLeaf({ ou: "org-123" });
    const payload = body();

    const signature = toBase64(
      await buildCms({ signers: [{ certificate: selfSigned }], body: payload }),
    );

    await expect(
      verifyMdmSignature({ signature, body: payload, caCertPems: [ca.pem] }),
    ).rejects.toThrow(/does not chain/i);
  });

  it("rejects a CMS with multiple signers", async () => {
    const ca = await createCa("Test CA");
    const first = await createLeaf({ ca, cn: "Device 1" });
    const second = await createLeaf({ ca, cn: "Device 2" });
    const payload = body();

    const signature = toBase64(
      await buildCms({ signers: [{ certificate: first }, { certificate: second }], body: payload }),
    );

    await expect(
      verifyMdmSignature({ signature, body: payload, caCertPems: [ca.pem] }),
    ).rejects.toThrow(/exactly one SignerInfo/i);
  });

  it("rejects encapsulated eContent that differs from the body", async () => {
    const ca = await createCa("Test CA");
    const leaf = await createLeaf({ ca });
    const payload = body("request-body");

    const signature = toBase64(
      await buildCms({
        signers: [{ certificate: leaf }],
        body: payload,
        eContent: body("different-body"),
      }),
    );

    await expect(
      verifyMdmSignature({ signature, body: payload, caCertPems: [ca.pem] }),
    ).rejects.toThrow(/eContent does not match/i);
  });

  it("rejects an oversized signature header", async () => {
    const ca = await createCa("Test CA");

    await expect(
      verifyMdmSignature({
        signature: "A".repeat(MAX_MDM_SIGNATURE_BASE64_LENGTH + 1),
        body: body(),
        caCertPems: [ca.pem],
      }),
    ).rejects.toThrow(/too large/i);
  });

  it("rejects an expired signer certificate", async () => {
    const ca = await createCa("Test CA");

    const leaf = await createLeaf({
      ca,
      notBefore: new Date(Date.now() - 2 * 365 * DAY),
      notAfter: new Date(Date.now() - 365 * DAY),
    });

    const payload = body();
    const signature = toBase64(await buildCms({ signers: [{ certificate: leaf }], body: payload }));

    await expect(
      verifyMdmSignature({ signature, body: payload, caCertPems: [ca.pem] }),
    ).rejects.toThrow(/expired/i);
  });

  it("rejects a signer without the client authentication EKU", async () => {
    const ca = await createCa("Test CA");
    const leaf = await createLeaf({ ca, clientAuthEku: false });
    const payload = body();
    const signature = toBase64(await buildCms({ signers: [{ certificate: leaf }], body: payload }));

    await expect(
      verifyMdmSignature({ signature, body: payload, caCertPems: [ca.pem] }),
    ).rejects.toThrow(/client authentication EKU/i);
  });

  it("rejects malformed base64 and non-CMS payloads", async () => {
    const ca = await createCa("Test CA");

    await expect(
      verifyMdmSignature({ signature: "!!!!", body: body(), caCertPems: [ca.pem] }),
    ).rejects.toThrow(/not valid base64/i);

    await expect(
      verifyMdmSignature({
        signature: Buffer.from("not a CMS message").toString("base64"),
        body: body(),
        caCertPems: [ca.pem],
      }),
    ).rejects.toThrow(/not valid CMS/i);
  });

  it("binds the signer to a supplied mTLS identity", async () => {
    const ca = await createCa("Test CA");
    const leaf = await createLeaf({ ca, cn: "Device 1", ou: "org-123" });
    const payload = body();
    const signature = toBase64(await buildCms({ signers: [{ certificate: leaf }], body: payload }));

    const verified = await verifyMdmSignature({ signature, body: payload, caCertPems: [ca.pem] });

    await expect(
      verifyMdmSignature({
        signature,
        body: payload,
        caCertPems: [ca.pem],
        identityCertificateSubject: verified.subject,
        identityCertificateSerial: verified.serial,
        identityCertificateFingerprintSha256: verified.fingerprintSha256,
      }),
    ).resolves.toEqual(verified);

    await expect(
      verifyMdmSignature({
        signature,
        body: payload,
        caCertPems: [ca.pem],
        identityCertificateSubject: "CN=Different Device,OU=org-123",
      }),
    ).rejects.toThrow(/subject does not match/i);

    await expect(
      verifyMdmSignature({
        signature,
        body: payload,
        caCertPems: [ca.pem],
        identityCertificateSerial: "deadbeef",
      }),
    ).rejects.toThrow(/serial does not match/i);

    await expect(
      verifyMdmSignature({
        signature,
        body: payload,
        caCertPems: [ca.pem],
        identityCertificateFingerprintSha256: "00".repeat(32),
      }),
    ).rejects.toThrow(/fingerprint does not match/i);
  });
});

// ─── SCEP PKCSReq Tests ─────────────────────────────────────────

describe("verifyScepPkcsReqSignature", () => {
  it("accepts a self-signed PKCSReq and returns its eContent", async () => {
    const bootstrap = await createLeaf({ ou: "bootstrap" });
    const eContent = body("enveloped-csr");

    const signature = await buildCms({
      signers: [{ certificate: bootstrap }],
      body: eContent,
      eContent,
    });

    const result = await verifyScepPkcsReqSignature({ signature });
    expect(result.selfSigned).toBe(true);
    expect(result.subject).toContain("CN=Device 1");
    expect(result.eContent).toEqual(eContent);
  });

  it("validates a CA-issued PKCSReq against the supplied CA", async () => {
    const ca = await createCa("SCEP CA");
    const leaf = await createLeaf({ ca });
    const eContent = body("renewal-csr");

    const signature = await buildCms({
      signers: [{ certificate: leaf }],
      body: eContent,
      eContent,
    });

    await expect(
      verifyScepPkcsReqSignature({ signature, caCertPems: [ca.pem] }),
    ).resolves.toMatchObject({ selfSigned: false });

    const otherCa = await createCa("Other CA");
    await expect(
      verifyScepPkcsReqSignature({ signature, caCertPems: [otherCa.pem] }),
    ).rejects.toThrow(/does not chain/i);
  });
});
