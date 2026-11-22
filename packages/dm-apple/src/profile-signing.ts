/**
 * CMS/PKCS#7 signing for Apple configuration profiles.
 *
 * Apple expects a `.mobileconfig` download to be a BER encoded `ContentInfo`
 * wrapping a `SignedData` structure. A signed profile lets the device check
 * that the payload was not modified in transit and, when the signing
 * certificate chains to a CA the device trusts, show the profile as verified.
 *
 * The signature is attached (the plist is the encapsulated `eContent`) and
 * carries the `contentType` and `messageDigest` signed attributes required by
 * RFC 5652. SHA-256 is used explicitly: PKIjs defaults to SHA-1.
 */
import { Data, Schema } from "effect";
import type * as pkijs from "pkijs";
import { loadPkijs } from "./pkijs.js";
import type { Asn1jsModule, PkijsModule } from "./pkijs.js";

// pkijs is loaded on first use (see `loadPkijs`) so signing a profile does not
// put it in the Worker's startup closure.

// ─── Constants ───────────────────────────────────────────────────

const DATA_CONTENT_TYPE_OID = "1.2.840.113549.1.7.1";

const SIGNED_DATA_CONTENT_TYPE_OID = "1.2.840.113549.1.7.2";

const CONTENT_TYPE_ATTRIBUTE_OID = "1.2.840.113549.1.9.3";

const MESSAGE_DIGEST_ATTRIBUTE_OID = "1.2.840.113549.1.9.4";

const CERTIFICATE_PATTERN =
  /-----BEGIN (?:TRUSTED )?CERTIFICATE-----([\s\S]*?)-----END (?:TRUSTED )?CERTIFICATE-----/g;

const PRIVATE_KEY_PATTERN = /-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/;

// ─── Public Types ────────────────────────────────────────────────

export class AppleProfileSigningError extends Data.TaggedError("AppleProfileSigningError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Deployment configuration for the dedicated profile signing identity.
 * Fields are optional so that a half-configured identity fails closed at
 * signing time instead of being silently ignored.
 */
export type AppleProfileSigningConfig = {
  readonly certificatePem?: string;
  readonly privateKeyPem?: string;
  /** Optional PEM bundle of intermediate/root certificates. */
  readonly chainPem?: string;
};

/**
 * Loaded signing material. `privateKey` is either a PKCS#8 PEM string or an
 * already imported WebCrypto signing key (the SCEP CA fallback path).
 */
export type AppleProfileSigningMaterial = {
  readonly certificatePem: string;
  readonly privateKey: CryptoKey | string;
  readonly chainPem?: string;
};

export type AppleProfileSigner = {
  sign(plist: string): Promise<Uint8Array>;
};

// ─── Helpers ─────────────────────────────────────────────────────

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => new Uint8Array(bytes).buffer;

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const decodeBase64 = (value: string, label: string): Uint8Array => {
  const cleaned = value.replaceAll(/\s/g, "");

  if (cleaned.length === 0) {
    throw new AppleProfileSigningError({ message: `${label} is empty` });
  }

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) {
    throw new AppleProfileSigningError({ message: `${label} is not valid base64` });
  }

  const padded = cleaned.padEnd(cleaned.length + ((4 - (cleaned.length % 4)) % 4), "=");

  try {
    const binary = atob(padded);

    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new AppleProfileSigningError({ message: `${label} is not valid base64` });
  }
};

const parsePemCertificates = (
  pkijs: PkijsModule,
  pem: string,
  label: string,
): pkijs.Certificate[] => {
  const matches = Array.from(pem.matchAll(CERTIFICATE_PATTERN));

  if (matches.length === 0) {
    throw new AppleProfileSigningError({ message: `${label} is not a PEM certificate` });
  }

  const certificates: pkijs.Certificate[] = [];

  for (const match of matches) {
    const der = decodeBase64(match[1] ?? "", label);

    try {
      certificates.push(pkijs.Certificate.fromBER(toArrayBuffer(der)));
    } catch (error) {
      throw new AppleProfileSigningError({
        message: `${label} could not be parsed: ${errorMessage(error)}`,
        cause: error,
      });
    }
  }

  return certificates;
};

const importPrivateKeyPem = async (pem: string): Promise<CryptoKey> => {
  const match = PRIVATE_KEY_PATTERN.exec(pem);

  if (!match) {
    throw new AppleProfileSigningError({
      message:
        "Profile signing key is not an unencrypted PKCS#8 PEM private key (expected -----BEGIN PRIVATE KEY-----)",
    });
  }

  const der = decodeBase64(match[1] ?? "", "Profile signing key");

  try {
    return await crypto.subtle.importKey(
      "pkcs8",
      toArrayBuffer(der),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch (error) {
    throw new AppleProfileSigningError({
      message: `Profile signing key could not be imported as an RSA PKCS#8 key: ${errorMessage(error)}`,
      cause: error,
    });
  }
};

const requireCertificatePem = (value: string | undefined): string => {
  if (!value?.trim()) {
    throw new AppleProfileSigningError({
      message: "Profile signing certificate is not configured (APPLE_PROFILE_SIGNING_CERT)",
    });
  }

  return value;
};

const requirePrivateKeyPem = (value: string | undefined): string => {
  if (!value?.trim()) {
    throw new AppleProfileSigningError({
      message: "Profile signing private key is not configured (APPLE_PROFILE_SIGNING_KEY)",
    });
  }

  return value;
};

const encodeSignedProfile = async (
  pkijs: PkijsModule,
  asn1js: Asn1jsModule,
  plist: string,
  signerCertificate: pkijs.Certificate,
  chain: readonly pkijs.Certificate[],
  privateKey: CryptoKey,
): Promise<Uint8Array> => {
  const content = new TextEncoder().encode(plist);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(content)));

  const signedAttributes = new pkijs.SignedAndUnsignedAttributes({
    type: 0,
    attributes: [
      new pkijs.Attribute({
        type: CONTENT_TYPE_ATTRIBUTE_OID,
        values: [new asn1js.ObjectIdentifier({ value: DATA_CONTENT_TYPE_OID })],
      }),
      new pkijs.Attribute({
        type: MESSAGE_DIGEST_ATTRIBUTE_OID,
        values: [new asn1js.OctetString({ valueHex: toArrayBuffer(digest) })],
      }),
    ],
  });

  const signerInfo = new pkijs.SignerInfo({
    version: 1,
    sid: new pkijs.IssuerAndSerialNumber({
      issuer: signerCertificate.issuer,
      serialNumber: signerCertificate.serialNumber,
    }),
    signedAttrs: signedAttributes,
  });

  const signedData = new pkijs.SignedData({
    version: 1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({
      eContentType: DATA_CONTENT_TYPE_OID,
      eContent: new asn1js.OctetString({ valueHex: toArrayBuffer(content) }),
    }),
    certificates: [signerCertificate, ...chain],
    signerInfos: [signerInfo],
  });

  // Never rely on PKIjs' SHA-1 default.
  await signedData.sign(privateKey, 0, "SHA-256");

  const contentInfo = new pkijs.ContentInfo({
    contentType: SIGNED_DATA_CONTENT_TYPE_OID,
    content: signedData.toSchema(true),
  });

  return new Uint8Array(contentInfo.toSchema().toBER(false));
};

// ─── Public API ──────────────────────────────────────────────────

/**
 * Sign a plist with the supplied certificate and private key.
 *
 * The result is a BER encoded CMS `SignedData` with attached content, SHA-256
 * digest, `contentType`/`messageDigest` signed attributes, the signer
 * certificate and any supplied chain. The function throws
 * {@link AppleProfileSigningError} when the material is missing or invalid.
 */
export async function signAppleProfilePlist(
  plist: string,
  material: AppleProfileSigningMaterial,
): Promise<Uint8Array> {
  if (plist.length === 0) {
    throw new AppleProfileSigningError({ message: "Cannot sign an empty Apple profile" });
  }

  try {
    const [pkijs, asn1js] = await Promise.all([loadPkijs(), import("asn1js")]);

    const signerCertificate = parsePemCertificates(
      pkijs,
      material.certificatePem,
      "Profile signing certificate",
    )[0];

    if (!signerCertificate) {
      throw new AppleProfileSigningError({
        message: "Profile signing certificate is not a PEM certificate",
      });
    }

    const chain = material.chainPem?.trim()
      ? parsePemCertificates(pkijs, material.chainPem, "Profile signing certificate chain")
      : [];

    const privateKey = Schema.is(Schema.String)(material.privateKey)
      ? await importPrivateKeyPem(material.privateKey)
      : material.privateKey;

    return await encodeSignedProfile(pkijs, asn1js, plist, signerCertificate, chain, privateKey);
  } catch (error) {
    if (error instanceof AppleProfileSigningError) throw error;

    throw new AppleProfileSigningError({
      message: `Apple profile signing failed: ${errorMessage(error)}`,
      cause: error,
    });
  }
}

type LoadedAppleProfileSigner = {
  readonly pkijs: PkijsModule;
  readonly asn1js: Asn1jsModule;
  readonly signerCertificate: pkijs.Certificate;
  readonly chain: readonly pkijs.Certificate[];
  readonly privateKey: CryptoKey;
};

const loadAppleProfileSigner = async (
  config: AppleProfileSigningConfig,
): Promise<LoadedAppleProfileSigner> => {
  const certificatePem = requireCertificatePem(config.certificatePem);
  const privateKeyPem = requirePrivateKeyPem(config.privateKeyPem);
  const [pkijs, asn1js] = await Promise.all([loadPkijs(), import("asn1js")]);

  const signerCertificate = parsePemCertificates(
    pkijs,
    certificatePem,
    "Profile signing certificate",
  )[0];

  if (!signerCertificate) {
    throw new AppleProfileSigningError({
      message: "Profile signing certificate is not a PEM certificate",
    });
  }

  const chain = config.chainPem?.trim()
    ? parsePemCertificates(pkijs, config.chainPem, "Profile signing certificate chain")
    : [];

  return {
    pkijs,
    asn1js,
    signerCertificate,
    chain,
    privateKey: await importPrivateKeyPem(privateKeyPem),
  };
};

/**
 * Create a reusable signer backed by a deployment signing identity. The
 * certificate chain and private key are parsed and imported once; failure is
 * cached so a misconfigured deployment keeps failing closed rather than
 * falling back to an unsigned profile.
 */
export const createAppleProfileSigner = (config: AppleProfileSigningConfig): AppleProfileSigner => {
  let loaded: Promise<LoadedAppleProfileSigner> | undefined;

  const load = () => {
    loaded ??= loadAppleProfileSigner(config);

    return loaded;
  };

  return {
    sign: async (plist) => {
      const material = await load();

      return encodeSignedProfile(
        material.pkijs,
        material.asn1js,
        plist,
        material.signerCertificate,
        material.chain,
        material.privateKey,
      );
    },
  };
};
