import * as pkijs from "pkijs";
import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { pemDecode } from "@mattrax/crypto";
import type { CredentialInfo, DeviceCertificateCounts } from "@mattrax/enterprise-domain";
import { schema } from "./schema.ts";
import type { EnterpriseDb } from "./schema.ts";

// pkijs needs a WebCrypto engine before it can parse certificates. The APNs
// helper does the same dance, but this module must stand alone (maintenance
// imports it without the APNs service).
if (typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined") {
  try {
    pkijs.getEngine();
  } catch {
    pkijs.setEngine("WebCrypto", crypto as unknown as Crypto, crypto.subtle);
  }
}

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A credential inside this window is shown as a warning. */
export const CREDENTIAL_WARNING_DAYS = 30;
/** A credential inside this window is shown as critical. */
export const CREDENTIAL_CRITICAL_DAYS = 7;

export type CredentialHealth = {
  readonly apns: CredentialInfo;
  readonly scepCa: CredentialInfo;
  readonly deviceCertificates: DeviceCertificateCounts;
};

/**
 * Parse any PEM certificate's `notAfter` without validating its chain or
 * subject. Returns null for malformed input so a historical/rotated
 * certificate never breaks the dashboard or the maintenance job.
 */
export const parseCertificateNotAfter = (pem: string | null | undefined): Date | null => {
  if (!pem) return null;
  try {
    const der = pemDecode("CERTIFICATE", pem);
    const certificate = pkijs.Certificate.fromBER(der);
    const value = certificate.notAfter?.value;
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
    return value;
  } catch {
    return null;
  }
};

/**
 * Whole days between `now` and `notAfter`, rounded up so a certificate with
 * 29 days and 23 hours left reads as 30. Expired certificates return a
 * non-positive number.
 */
export const daysUntilExpiry = (notAfter: Date, now: Date): number =>
  Math.ceil((notAfter.getTime() - now.getTime()) / MS_PER_DAY);

/** Classify a credential for badges and alerts. */
export const credentialLevel = (
  configured: boolean,
  expiresAt: Date | null,
  now: Date,
): CredentialInfo["level"] => {
  if (!configured) return "missing";
  if (!expiresAt) return "unknown";
  if (expiresAt.getTime() <= now.getTime()) return "expired";
  const daysLeft = daysUntilExpiry(expiresAt, now);
  if (daysLeft <= CREDENTIAL_CRITICAL_DAYS) return "critical";
  if (daysLeft <= CREDENTIAL_WARNING_DAYS) return "warning";
  return "ok";
};

export const credentialInfo = (
  configured: boolean,
  expiresAt: Date | null,
  now: Date,
): CredentialInfo => ({
  configured,
  expiresAt: expiresAt ? expiresAt.toISOString() : null,
  daysLeft: expiresAt ? daysUntilExpiry(expiresAt, now) : null,
  level: credentialLevel(configured, expiresAt, now),
});

/** Count device identity certificates by expiry/revocation state. */
export const summarizeDeviceCertificates = (
  certificates: ReadonlyArray<{ notAfter: Date; revokedAt?: Date | null }>,
  now: Date,
): DeviceCertificateCounts => {
  const cutoff = new Date(now.getTime() + CREDENTIAL_WARNING_DAYS * MS_PER_DAY);
  let expiringSoon = 0;
  let expired = 0;
  let revoked = 0;
  for (const certificate of certificates) {
    if (certificate.revokedAt) {
      revoked += 1;
      continue;
    }
    if (certificate.notAfter.getTime() <= now.getTime()) expired += 1;
    else if (certificate.notAfter.getTime() <= cutoff.getTime()) expiringSoon += 1;
  }
  return { total: certificates.length, expiringSoon, expired, revoked };
};

/**
 * Tenant-scoped credential summary. The SCEP CA is deployment-wide, so it is
 * reported on every tenant (it still affects every tenant's devices) while the
 * APNs certificate and issued identities are scoped to `organizationId`.
 */
export const loadCredentialHealth = (
  db: EnterpriseDb,
  organizationId: string,
  now: Date = new Date(),
): Effect.Effect<CredentialHealth, unknown> =>
  Effect.gen(function* () {
    const [apnsRow] = (yield* db
      .select()
      .from(schema.applePushCertificate)
      .where(eq(schema.applePushCertificate.organizationId, organizationId))
      .limit(1)) as Array<{ certPem: string }>;
    const [caRow] = (yield* db
      .select()
      .from(schema.scepCa)
      .where(eq(schema.scepCa.id, 1))
      .limit(1)) as Array<{ certPem: string }>;
    const certificates = (yield* db
      .select()
      .from(schema.scepIssuedCertificate)
      .where(eq(schema.scepIssuedCertificate.organizationId, organizationId))) as Array<{
      notAfter: Date;
      revokedAt: Date | null;
    }>;

    return {
      apns: credentialInfo(Boolean(apnsRow), parseCertificateNotAfter(apnsRow?.certPem), now),
      scepCa: credentialInfo(Boolean(caRow), parseCertificateNotAfter(caRow?.certPem), now),
      deviceCertificates: summarizeDeviceCertificates(certificates, now),
    };
  });
