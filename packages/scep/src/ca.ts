import { Effect, Option, Schema } from "effect";
import type * as pkijs from "pkijs";
import { ScepError } from "./schema.js";
import { loadPkijs } from "./pkijs.js";
import type { Asn1jsModule, PkijsModule } from "./pkijs.js";
import type { ScepCaScope, ScepRepository, ScepStoredCa } from "./repository.js";
import {
  generateCaKeyPair,
  exportPrivateKeyJwk,
  importPrivateKeyJwk,
  importPrivateKeyPem,
} from "./crypto.js";
import { certToPem, certificateSerialHex, createCaCertificate, pemToCert } from "./pkcs7.js";

/**
 * Per-tenant SCEP CA lifecycle.
 *
 * Each tenant owns exactly one active CA. The repository persists only the
 * certificate and the (sealed) private key; everything else — key generation,
 * the self-signed certificate, importing an operator-supplied CA and rotation —
 * is deterministic and lives here so the hosted and self-hosted paths behave
 * identically.
 */

const CA_COMMON_NAME = "Mattrax SCEP CA";

const CA_ORGANIZATION = "Mattrax";

const BASIC_CONSTRAINTS_OID = "2.5.29.19";

const KEY_USAGE_OID = "2.5.29.15";

const COMMON_NAME_OID = "2.5.4.3";

/**
 * Tenant CA lifetime.
 *
 * The SCEP CA is an *online issuing* CA: it signs every device identity, so it
 * follows issuing-CA guidance (3–5 years) rather than the 10–15 year lifetime
 * common for an offline root, and certainly not an indefinite one. Five years
 * bounds the window in which a leaked key can mint identities, and the
 * automatic rotation below starts a full identity lifetime before expiry so a
 * fleet never has to re-enrol to survive it.
 */
export const SCEP_CA_LIFETIME_DAYS = 5 * 365;

/**
 * How long before expiry a CA is rotated. It is longer than the 365-day device
 * identity lifetime, so every identity issued by the retiring CA can renew
 * during the overlap and still have a CA that signs afterwards.
 */
export const SCEP_CA_ROTATION_LEAD_DAYS = 400;

/** A CA expiring within this window is `warning`; within 30 days, `critical`. */
export const SCEP_CA_WARNING_DAYS = 90;

export const SCEP_CA_CRITICAL_DAYS = 30;

export type ScepLoadedCa = ScepStoredCa & {
  readonly caCert: pkijs.Certificate;
  readonly privateKey: CryptoKey;
};

/** Public, non-secret description of a tenant CA for the dashboard and health. */
export type ScepCaDescription = {
  readonly commonName: string;
  readonly fingerprintSha256: string;
  readonly serialNumber: string;
  readonly notBefore: Date;
  readonly notAfter: Date;
};

/** Expiry/rotation state of a CA certificate. */
export type ScepCaHealth = {
  readonly notAfter: Date;
  /** Whole days until expiry; zero or negative once expired. */
  readonly daysLeft: number;
  /** When automatic rotation should start (null once it is due). */
  readonly rotationDueAt: Date;
  readonly rotationDue: boolean;
  readonly level: "ok" | "warning" | "critical" | "expired";
};

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => new Uint8Array(bytes).buffer;

const AttributeValueBlock = Schema.Struct({ value: Schema.optional(Schema.Unknown) });

const attributeText = (value: pkijs.AttributeValueType): string => {
  const decoded = Schema.decodeUnknownOption(AttributeValueBlock)(value.valueBlock);

  if (Option.isSome(decoded) && Schema.is(Schema.String)(decoded.value.value))
    return decoded.value.value;

  return "";
};

const publicJwk = (jwk: JsonWebKey) => ({ n: jwk.n, e: jwk.e });

const assertCertificateKeyPair = (
  cert: pkijs.Certificate,
  jwk: JsonWebKey,
): Effect.Effect<void, ScepError> =>
  Effect.tryPromise({
    try: async () => {
      const exported = await crypto.subtle.exportKey("jwk", await cert.getPublicKey());

      const keyMatches =
        publicJwk(exported).n === publicJwk(jwk).n && publicJwk(exported).e === publicJwk(jwk).e;

      if (!keyMatches) throw new Error("The SCEP CA private key does not match the certificate");
    },
    catch: (cause) =>
      new ScepError({
        message: `The SCEP CA private key does not match the certificate: ${errorMessage(cause)}`,
        cause,
      }),
  });

/**
 * Whether the certificate's keyUsage extension permits certificate signing.
 * `undefined` when the extension is absent (RFC 5280 leaves the usage
 * unconstrained), `false` when it is present and keyCertSign is clear.
 */
const certificateSigningPermitted = (
  asn1js: Asn1jsModule,
  cert: pkijs.Certificate,
): boolean | undefined => {
  const extension = cert.extensions?.find((item) => item.extnID === KEY_USAGE_OID);

  if (!extension) return undefined;

  const value = extension.extnValue.valueBlock.valueHexView;

  if (!value) return false;

  const parsed = asn1js.fromBER(toArrayBuffer(value));

  if (parsed.result instanceof Error || !(parsed.result instanceof asn1js.BitString)) return false;

  const bytes = new Uint8Array(parsed.result.valueBlock.valueHexView);

  // BIT STRING bit 5 is keyCertSign (bits are MSB-first).
  return ((bytes[0] ?? 0) & 0x04) !== 0;
};

/** Reject a certificate that cannot sign device identities. */
const assertSigningCa = (
  pkijs: PkijsModule,
  asn1js: Asn1jsModule,
  cert: pkijs.Certificate,
  now = new Date(),
): void => {
  const basicConstraints = cert.extensions?.find(
    (extension) => extension.extnID === BASIC_CONSTRAINTS_OID,
  );

  if (!(basicConstraints?.parsedValue instanceof pkijs.BasicConstraints)) {
    throw new ScepError({
      message: "The supplied SCEP CA certificate is missing the basicConstraints extension",
    });
  }

  if (!basicConstraints.parsedValue.cA) {
    throw new ScepError({ message: "The supplied SCEP CA certificate is not a CA certificate" });
  }

  if (certificateSigningPermitted(asn1js, cert) === false) {
    throw new ScepError({
      message: "The supplied SCEP CA certificate does not permit certificate signing",
    });
  }

  if (cert.notAfter.value.getTime() <= now.getTime()) {
    throw new ScepError({ message: "The supplied SCEP CA certificate has expired" });
  }
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whole days between `now` and `notAfter`, rounded up so a certificate with 29
 * days and 23 hours left reads as 30. Expired certificates return a
 * non-positive number.
 */
export const caDaysUntilExpiry = (notAfter: Date, now: Date): number => {
  const days = Math.ceil((notAfter.getTime() - now.getTime()) / MS_PER_DAY);

  // Normalise JavaScript's negative zero so an expiry within the last
  // millisecond reads as `0`, not `-0`, in health responses.
  return days === 0 ? 0 : days;
};

/**
 * Classify a CA certificate for rotation and alerts. Rotation is due well
 * before the certificate is close to expiry so the overlap window can absorb a
 * full identity lifetime; `warning`/`critical` only appear when automatic
 * rotation has not happened for some reason.
 */
const caExpiryLevel = (daysLeft: number): ScepCaHealth["level"] => {
  if (daysLeft <= 0) return "expired";

  if (daysLeft <= SCEP_CA_CRITICAL_DAYS) return "critical";

  if (daysLeft <= SCEP_CA_WARNING_DAYS) return "warning";

  return "ok";
};

export const scepCaHealth = (
  notAfter: Date,
  now: Date = new Date(),
  options: { readonly rotationLeadDays?: number } = {},
): ScepCaHealth => {
  const rotationLeadDays = options.rotationLeadDays ?? SCEP_CA_ROTATION_LEAD_DAYS;
  const daysLeft = caDaysUntilExpiry(notAfter, now);

  return {
    notAfter,
    daysLeft,
    rotationDueAt: new Date(notAfter.getTime() - rotationLeadDays * MS_PER_DAY),
    rotationDue: daysLeft <= rotationLeadDays,
    level: caExpiryLevel(daysLeft),
  };
};

/**
 * Generate a self-signed tenant CA. The subject carries the tenant id as `OU`
 * so the certificate is self-describing in a device's trust settings.
 */
export const generateScepCa = (
  organizationId: string,
  options: { readonly now?: Date; readonly lifetimeDays?: number } = {},
): Effect.Effect<ScepStoredCa, ScepError> =>
  Effect.gen(function* () {
    const keyPair = yield* generateCaKeyPair();
    const privateKeyJwk = yield* exportPrivateKeyJwk(keyPair.privateKey);
    const notBefore = options.now ?? new Date();

    const notAfter = new Date(
      notBefore.getTime() + (options.lifetimeDays ?? SCEP_CA_LIFETIME_DAYS) * MS_PER_DAY,
    );

    const caCert = yield* Effect.tryPromise({
      try: () =>
        createCaCertificate(keyPair, CA_COMMON_NAME, {
          organization: CA_ORGANIZATION,
          organizationalUnit: organizationId,
          notBefore,
          notAfter,
        }),
      catch: (cause) => new ScepError({ message: "Failed to create CA certificate", cause }),
    });

    return { certPem: certToPem(caCert), privateKeyJwk, source: "generated" as const };
  });

/** Parse the stored PEM key material into usable signing objects. */
export const openScepCa = (
  stored: ScepStoredCa,
  now = new Date(),
): Effect.Effect<ScepLoadedCa, ScepError> =>
  Effect.gen(function* () {
    const caCert = yield* Effect.tryPromise({
      try: () => pemToCert(stored.certPem),
      catch: (cause) => new ScepError({ message: "Stored SCEP CA certificate is invalid", cause }),
    });

    if (caCert.notAfter.value.getTime() <= now.getTime()) {
      return yield* Effect.fail(
        new ScepError({
          message:
            "The tenant SCEP CA certificate has expired. Rotate the CA and re-enroll the affected devices.",
        }),
      );
    }

    const privateKey = yield* importPrivateKeyJwk(stored.privateKeyJwk);

    return { ...stored, caCert, privateKey };
  });

/**
 * Read a tenant's CA, creating it atomically on first use.
 *
 * Two concurrent cold requests both generate a candidate; `saveCa` guarantees
 * only one is persisted and returns the winner, so both callers end up using the
 * same CA and no device identity is issued from a discarded key.
 */
export const ensureScepCa = (
  repository: ScepRepository["Service"],
  scope: ScepCaScope,
): Effect.Effect<ScepLoadedCa, ScepError> =>
  Effect.gen(function* () {
    const existing = yield* repository.getCa(scope);

    if (existing) return yield* openScepCa(existing);

    const candidate = yield* generateScepCa(scope.organizationId);
    const stored = yield* repository.saveCa(scope, candidate);

    return yield* openScepCa(stored);
  });

/**
 * Replace a tenant's CA. Used for importing an operator-supplied CA. Other
 * tenants are untouched because the repository keys every write by organization
 * id. This does **not** retain the previous CA as a trust anchor: an import is a
 * deliberate trust-root change and the caller revokes the identities it
 * invalidates. Use {@link rotateScepCa} for a rotation that a fleet survives.
 */
export const replaceScepCa = (
  repository: ScepRepository["Service"],
  scope: ScepCaScope,
  ca: ScepStoredCa,
): Effect.Effect<ScepLoadedCa, ScepError> =>
  repository.replaceCa(scope, ca).pipe(Effect.flatMap((stored) => openScepCa(stored)));

/**
 * Staged CA rotation: mint a successor CA and keep the previous one as a
 * verification anchor for the identities it already issued.
 *
 * New and renewed identities are signed by the successor, and `GetCACert`
 * returns it, so a profile fetched after rotation trusts only the new CA.
 * Existing devices keep checking in and renewing with identities signed by the
 * retired CA until it expires. No device identity is revoked, so no device has
 * to re-enrol.
 */
export const rotateScepCa = (
  repository: ScepRepository["Service"],
  scope: ScepCaScope,
  options: { readonly now?: Date; readonly lifetimeDays?: number } = {},
): Effect.Effect<ScepLoadedCa, ScepError> =>
  Effect.gen(function* () {
    const now = options.now ?? new Date();

    const candidate = yield* generateScepCa(scope.organizationId, {
      now,
      lifetimeDays: options.lifetimeDays,
    });

    const existing = yield* repository.getCa(scope);

    // A tenant that has never bootstrapped has nothing to overlap with; this is
    // a first-use bootstrap, not a rotation.
    if (!existing) {
      const stored = yield* repository.saveCa(scope, candidate);

      return yield* openScepCa(stored);
    }

    const previous = yield* describeScepCa(existing.certPem);

    const stored = yield* repository.rotateCa(scope, candidate, {
      retiredAt: now,
      // The retired CA remains a valid anchor until it expires: every identity
      // it issued expires no later than that, so trust is never wider than the
      // certificates relying on it.
      trustUntil: previous.notAfter,
    });

    return yield* openScepCa(stored);
  });

/**
 * Validate operator-supplied CA material and convert the key into the stored
 * JWK form. Rejects a non-CA certificate, an expired CA, or a key that does not
 * match the certificate.
 */
export const importScepCa = (input: {
  readonly certificatePem: string;
  readonly privateKeyPem: string;
}): Effect.Effect<ScepStoredCa, ScepError> =>
  Effect.gen(function* () {
    const [pkijs, asn1js] = yield* Effect.promise(() =>
      Promise.all([loadPkijs(), import("asn1js")]),
    );

    const caCert = yield* Effect.tryPromise({
      try: () => pemToCert(input.certificatePem),
      catch: (cause) =>
        new ScepError({
          message: "The supplied SCEP CA certificate is not a valid PEM certificate",
          cause,
        }),
    });

    yield* Effect.try({
      try: () => assertSigningCa(pkijs, asn1js, caCert),
      catch: (cause) =>
        cause instanceof ScepError
          ? cause
          : new ScepError({ message: "The supplied SCEP CA certificate is invalid", cause }),
    });

    const privateKeyJwk = yield* importPrivateKeyPem(input.privateKeyPem);
    yield* assertCertificateKeyPair(caCert, privateKeyJwk);

    // A self-signed CA must actually verify with its own key; an intermediate
    // is accepted as-is and validated by the device's trust store.
    if (caCert.issuer.isEqual(caCert.subject)) {
      const valid = yield* Effect.tryPromise({
        try: () => caCert.verify(),
        catch: (cause) =>
          new ScepError({ message: "The supplied SCEP CA certificate is invalid", cause }),
      });

      if (!valid) {
        return yield* Effect.fail(
          new ScepError({ message: "The supplied SCEP CA certificate is not self-consistent" }),
        );
      }
    }

    return { certPem: certToPem(caCert), privateKeyJwk, source: "imported" as const };
  });

/** SHA-256 of a certificate's DER, lowercase hex. */
export const certificateFingerprintSha256 = (
  certificate: pkijs.Certificate,
): Effect.Effect<string, ScepError> =>
  Effect.tryPromise({
    try: async () => {
      const der = new Uint8Array(certificate.toSchema().toBER(false));
      const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(der));

      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
        "",
      );
    },
    catch: (cause) => new ScepError({ message: "Failed to fingerprint the SCEP CA", cause }),
  });

/** Public description of a stored CA certificate (no key material). */
export const describeScepCa = (certPem: string): Effect.Effect<ScepCaDescription, ScepError> =>
  Effect.gen(function* () {
    const caCert = yield* Effect.tryPromise({
      try: () => pemToCert(certPem),
      catch: (cause) => new ScepError({ message: "Stored SCEP CA certificate is invalid", cause }),
    });

    const fingerprint = yield* certificateFingerprintSha256(caCert);

    const commonName = caCert.subject.typesAndValues.find(
      (attribute) => attribute.type === COMMON_NAME_OID,
    );

    return {
      commonName: commonName ? attributeText(commonName.value) : CA_COMMON_NAME,
      fingerprintSha256: fingerprint,
      serialNumber: certificateSerialHex(caCert),
      notBefore: caCert.notBefore.value,
      notAfter: caCert.notAfter.value,
    };
  });
