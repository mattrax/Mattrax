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
    pkijs.setEngine("WebCrypto", crypto, crypto.subtle);
  }
}

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A credential inside this window is shown as a warning. */
export const CREDENTIAL_WARNING_DAYS = 30;

/** A credential inside this window is shown as critical. */
export const CREDENTIAL_CRITICAL_DAYS = 7;

/** Legacy, device-unscoped certificates this far past expiry are history. */
export const CERTIFICATE_HISTORY_GRACE_DAYS = 30;

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

export type DeviceCertificateRecord = {
  readonly notAfter: Date;
  readonly revokedAt?: Date | null;
  /** Internal device id; absent on legacy or non-device-scoped rows. */
  readonly deviceId?: string | null;
  readonly createdAt?: Date | null;
};

/**
 * Only the most recent identity per device describes the device's current
 * credential health. Older rows are renewal history and must not inflate the
 * expired/expiring counts on the dashboard.
 */
const certificateTime = (certificate: DeviceCertificateRecord): number => {
  const createdAt = certificate.createdAt?.getTime();

  if (createdAt !== undefined && Number.isFinite(createdAt)) return createdAt;

  return certificate.notAfter.getTime();
};

export const latestDeviceCertificates = (
  certificates: ReadonlyArray<DeviceCertificateRecord>,
): DeviceCertificateRecord[] => {
  const latest = new Map<string, DeviceCertificateRecord>();
  const unscoped: DeviceCertificateRecord[] = [];

  for (const certificate of certificates) {
    if (!certificate.deviceId) {
      unscoped.push(certificate);
      continue;
    }

    const existing = latest.get(certificate.deviceId);

    if (!existing || certificateTime(certificate) >= certificateTime(existing))
      latest.set(certificate.deviceId, certificate);
  }

  return [...unscoped, ...latest.values()];
};

/** Count device identity certificates by expiry/revocation state. */
export const summarizeDeviceCertificates = (
  certificates: ReadonlyArray<DeviceCertificateRecord>,
  now: Date,
): DeviceCertificateCounts => {
  const current = latestDeviceCertificates(certificates).filter(
    (certificate) =>
      // Device-scoped rows are already one-per-device; legacy rows have no
      // device id, so drop only those that expired long enough ago to be
      // renewal history rather than a current identity.
      Boolean(certificate.deviceId) ||
      certificate.notAfter.getTime() >= now.getTime() - CERTIFICATE_HISTORY_GRACE_DAYS * MS_PER_DAY,
  );

  const cutoff = new Date(now.getTime() + CREDENTIAL_WARNING_DAYS * MS_PER_DAY);
  let expiringSoon = 0;
  let expired = 0;
  let revoked = 0;

  for (const certificate of current) {
    if (certificate.revokedAt) {
      revoked += 1;
      continue;
    }

    if (certificate.notAfter.getTime() <= now.getTime()) expired += 1;
    else if (certificate.notAfter.getTime() <= cutoff.getTime()) expiringSoon += 1;
  }

  return { total: current.length, expiringSoon, expired, revoked };
};

/**
 * Tenant-scoped credential summary. Each tenant has its own SCEP CA, APNs
 * certificate and issued identities, so every value is read for
 * `organizationId`.
 */
export const loadCredentialHealth = (
  db: EnterpriseDb,
  organizationId: string,
  now: Date = new Date(),
): Effect.Effect<CredentialHealth, unknown> =>
  Effect.gen(function* () {
    const [apnsRow] = yield* db
      .select()
      .from(schema.applePushCertificate)
      .where(eq(schema.applePushCertificate.organizationId, organizationId))
      .limit(1);

    const [caRow] = yield* db
      .select()
      .from(schema.scepCa)
      .where(eq(schema.scepCa.organizationId, organizationId))
      .limit(1);

    const certificates = yield* db
      .select()
      .from(schema.scepIssuedCertificate)
      .where(eq(schema.scepIssuedCertificate.organizationId, organizationId));

    return {
      apns: credentialInfo(Boolean(apnsRow), parseCertificateNotAfter(apnsRow?.certPem), now),
      scepCa: credentialInfo(Boolean(caRow), parseCertificateNotAfter(caRow?.certPem), now),
      deviceCertificates: summarizeDeviceCertificates(certificates, now),
    };
  });
