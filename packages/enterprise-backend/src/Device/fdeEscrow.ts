import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { schema as s } from "@mattrax/enterprise-core";
import type { EnterpriseDb } from "@mattrax/enterprise-core";
import { openSecret, sealSecret } from "@mattrax/crypto";
import {
  certificateCommonName,
  certificateDer,
  certificateNotAfter,
  createEscrowCertificate,
  decryptCmsEnvelopedData,
  encryptCmsEnvelopedData,
  importPrivateKeyPem,
  pemEncode,
  pemToCert,
} from "@mattrax/scep";

/**
 * Tenant FileVault personal recovery key (PRK) escrow.
 *
 * macOS wraps the PRK with the certificate in the
 * `com.apple.security.FDERecoveryKeyEscrow` profile and returns the CMS payload
 * from `SecurityInfo`. Mattrax generates (or accepts) one RSA keypair per
 * tenant, embeds the certificate in the profile, seals the private key with
 * `AUTH_SECRET` and unwraps the payload only during an audited reveal.
 */

export type EscrowKeyRow = typeof s.appleFdeEscrowKey.$inferSelect;

export class EscrowKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EscrowKeyError";
  }
}

/** OID for rsaEncryption, the only key type Apple's CMS escrow accepts. */
const RSA_ENCRYPTION_OID = "1.2.840.113549.1.1.1";

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/** SHA-256 of the DER certificate, matching the value stored with the key. */
export const escrowCertificateFingerprint = (
  certificatePem: string,
): Effect.Effect<string, EscrowKeyError> =>
  Effect.tryPromise({
    try: async () =>
      hex(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            // SAFETY: WebCrypto accepts a Uint8Array view as a BufferSource.
            certificateDer(certificatePem) as BufferSource,
          ),
        ),
      ),
    catch: () => new EscrowKeyError("The escrow certificate could not be fingerprinted"),
  });

const describeCertificate = (certificatePem: string) =>
  Effect.gen(function* () {
    return {
      certificateFingerprintSha256: yield* escrowCertificateFingerprint(certificatePem),
      subject: certificateCommonName(certificatePem),
      certificateNotAfter: certificateNotAfter(certificatePem),
    };
  });

/** Load the tenant's escrow key row, if one exists. */
export const loadTenantEscrowKey = (
  db: EnterpriseDb,
  organizationId: string,
): Effect.Effect<EscrowKeyRow | null, unknown> =>
  Effect.gen(function* () {
    const [row] = yield* db
      .select()
      .from(s.appleFdeEscrowKey)
      .where(eq(s.appleFdeEscrowKey.organizationId, organizationId))
      .limit(1);

    return row ?? null;
  });

const upsert = (
  db: EnterpriseDb,
  organizationId: string,
  values: {
    certificatePem: string;
    sealedPrivateKey: string;
    source: "generated" | "uploaded";
  },
): Effect.Effect<EscrowKeyRow, EscrowKeyError | unknown> =>
  Effect.gen(function* () {
    const description = yield* describeCertificate(values.certificatePem);
    const at = new Date();

    const [existing] = yield* db
      .select({ createdAt: s.appleFdeEscrowKey.createdAt })
      .from(s.appleFdeEscrowKey)
      .where(eq(s.appleFdeEscrowKey.organizationId, organizationId))
      .limit(1);

    yield* db
      .insert(s.appleFdeEscrowKey)
      .values({
        organizationId,
        certificatePem: values.certificatePem,
        sealedPrivateKey: values.sealedPrivateKey,
        certificateFingerprintSha256: description.certificateFingerprintSha256,
        subject: description.subject,
        certificateNotAfter: description.certificateNotAfter,
        source: values.source,
        createdAt: existing?.createdAt ?? at,
        updatedAt: at,
      })
      .onDuplicateKeyUpdate({
        set: {
          certificatePem: values.certificatePem,
          sealedPrivateKey: values.sealedPrivateKey,
          certificateFingerprintSha256: description.certificateFingerprintSha256,
          subject: description.subject,
          certificateNotAfter: description.certificateNotAfter,
          source: values.source,
          updatedAt: at,
        },
      });

    const row = yield* loadTenantEscrowKey(db, organizationId);

    if (!row)
      return yield* Effect.fail(new EscrowKeyError("The FileVault escrow key could not be stored"));

    return row;
  });

/**
 * Generate a tenant escrow keypair. The certificate is self-signed: only the
 * private key matters (it never leaves Mattrax), matching Jamf and Profile
 * Manager's "automatically encrypt and decrypt" mode.
 */
export const generateTenantEscrowKey = (input: {
  db: EnterpriseDb;
  organizationId: string;
  organizationName?: string | null;
  authSecret: string;
}): Effect.Effect<EscrowKeyRow, EscrowKeyError | unknown> =>
  Effect.gen(function* () {
    const { certificatePem, privateKeyPem } = yield* Effect.tryPromise({
      try: async () => {
        // SAFETY: RSA generation with signing usages always yields a key pair.
        const keyPair = await crypto.subtle.generateKey(
          {
            name: "RSASSA-PKCS1-v1_5",
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: "SHA-256",
          },
          true,
          ["sign", "verify"],
        );

        const certificate = await createEscrowCertificate(
          keyPair,
          `Mattrax FileVault escrow ${input.organizationId}`,
          { organization: input.organizationName ?? "Mattrax" },
        );

        const pkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);

        return {
          certificatePem: pemEncode("CERTIFICATE", certificate.toSchema().toBER(false)),
          privateKeyPem: pemEncode("PRIVATE KEY", pkcs8),
        };
      },
      catch: () => new EscrowKeyError("The FileVault escrow key could not be generated"),
    });

    return yield* upsert(input.db, input.organizationId, {
      certificatePem,
      sealedPrivateKey: yield* Effect.tryPromise({
        try: () => sealSecret(input.authSecret, privateKeyPem),
        catch: () => new EscrowKeyError("The FileVault escrow private key could not be sealed"),
      }),
      source: "generated",
    });
  });

/**
 * Accept an operator-supplied certificate and private key.
 *
 * The pair is proven to match by wrapping a probe with the certificate and
 * unwrapping it with the key — the same path a real escrowed key takes.
 */
export const uploadTenantEscrowKey = (input: {
  db: EnterpriseDb;
  organizationId: string;
  certificatePem: string;
  privateKeyPem: string;
  authSecret: string;
}): Effect.Effect<EscrowKeyRow, EscrowKeyError | unknown> =>
  Effect.gen(function* () {
    yield* Effect.try({
      try: () => {
        const certificate = pemToCert(input.certificatePem.trim());

        // Apple wraps the key with CMS RSA key transport, so a non-RSA
        // certificate can never be used for escrow.
        if (certificate.subjectPublicKeyInfo.algorithm.algorithmId !== RSA_ENCRYPTION_OID)
          throw new EscrowKeyError("The escrow certificate must use an RSA key");

        return certificate;
      },
      catch: (cause) =>
        cause instanceof EscrowKeyError
          ? cause
          : new EscrowKeyError("The escrow certificate is not a valid PEM certificate"),
    });

    const jwk = yield* importPrivateKeyPem(input.privateKeyPem).pipe(
      Effect.mapError(
        () =>
          new EscrowKeyError(
            "The private key is not an unencrypted PKCS#8 RSA PEM (-----BEGIN PRIVATE KEY-----)",
          ),
      ),
    );

    yield* Effect.tryPromise({
      try: async () => {
        const probe = crypto.getRandomValues(new Uint8Array(32));
        const wrapped = await encryptCmsEnvelopedData(probe, input.certificatePem);
        const unwrapped = await decryptCmsEnvelopedData(wrapped, jwk);

        if (hex(unwrapped) !== hex(probe))
          throw new EscrowKeyError("The escrow certificate and private key do not match");
      },
      catch: (cause) =>
        cause instanceof EscrowKeyError
          ? cause
          : new EscrowKeyError("The escrow certificate and private key do not match"),
    });

    return yield* upsert(input.db, input.organizationId, {
      certificatePem: input.certificatePem.trim(),
      sealedPrivateKey: yield* Effect.tryPromise({
        try: () => sealSecret(input.authSecret, input.privateKeyPem.trim()),
        catch: () => new EscrowKeyError("The FileVault escrow private key could not be sealed"),
      }),
      source: "uploaded",
    });
  });

/** Public description of the tenant's escrow identity (never the key). */
export const escrowKeyInfo = (row: EscrowKeyRow | null) => ({
  configured: row !== null,
  certificatePem: row?.certificatePem ?? null,
  fingerprintSha256: row?.certificateFingerprintSha256 ?? null,
  subject: row?.subject ?? null,
  notAfter: row?.certificateNotAfter ? row.certificateNotAfter.toISOString() : null,
  source: row?.source ?? null,
  createdAt: row?.createdAt ? row.createdAt.toISOString() : null,
  updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
});

/**
 * Return a recovery key an operator can type into Recovery Assistant.
 *
 * A `cms` value is unwrapped with the tenant escrow key. Anything else came
 * from a device that reported the key directly (including rows written before
 * the format column existed) and is returned as-is.
 */
export const revealRecoveryKey = (input: {
  db: EnterpriseDb;
  organizationId: string;
  sealedValue: string;
  format: "plaintext" | "cms";
  authSecret: string;
}): Effect.Effect<string, EscrowKeyError | unknown> =>
  Effect.gen(function* () {
    const secret = yield* Effect.tryPromise({
      try: () => openSecret(input.authSecret, input.sealedValue),
      catch: () => new EscrowKeyError("The escrowed recovery key could not be decrypted"),
    });

    if (input.format !== "cms") return secret;

    const escrow = yield* loadTenantEscrowKey(input.db, input.organizationId);

    if (!escrow)
      return yield* Effect.fail(
        new EscrowKeyError(
          "This recovery key is CMS-wrapped but the tenant has no FileVault escrow key",
        ),
      );

    const privateKeyPem = yield* Effect.tryPromise({
      try: () => openSecret(input.authSecret, escrow.sealedPrivateKey),
      catch: () => new EscrowKeyError("The stored FileVault escrow private key could not be read"),
    });

    const jwk = yield* importPrivateKeyPem(privateKeyPem).pipe(
      Effect.mapError(
        () =>
          new EscrowKeyError(
            "The stored FileVault escrow private key could not be read; re-upload or regenerate it",
          ),
      ),
    );

    const cms = yield* Effect.try({
      try: () => Uint8Array.from(atob(secret.replaceAll(/\s/g, "")), (char) => char.charCodeAt(0)),
      catch: () => new EscrowKeyError("The escrowed recovery key is not valid CMS data"),
    });

    return yield* Effect.tryPromise({
      try: async () => new TextDecoder().decode(await decryptCmsEnvelopedData(cms, jwk)).trim(),
      catch: () =>
        new EscrowKeyError(
          "The escrowed recovery key could not be decrypted with the current tenant escrow key. The key was wrapped for a certificate Mattrax no longer holds; rotate the FileVault key to escrow a new one.",
        ),
    });
  });
