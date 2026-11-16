import * as pkijs from "pkijs";
import { Effect } from "effect";
import { eq } from "drizzle-orm";
import {
  certificateMatchesKey,
  importApnsKeyJwk,
  isApnsMdmTopic,
  parseApnsCertificate,
} from "@mattrax/apns";
import { openSecret, pemDecode } from "@mattrax/crypto";
import type {
  ApnsCredentialHealth,
  DeviceCertificateCounts,
  ScepCaCredentialHealth,
  ServerCertificateInfo,
} from "@mattrax/enterprise-domain";
import { schema } from "./schema.ts";
import type { EnterpriseDb } from "./schema.ts";
import { loadScepCaState, type ScepCaState } from "./scepLifecycle.ts";

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

/**
 * The Apple Push Certificates Portal. Renewal is manual because Apple requires
 * the account that created the certificate; the certificate must be renewed in
 * place (not recreated) so push tokens keep working.
 */
export const APNS_RENEWAL_URL = "https://identity.apple.com/pushcert/";

export type CredentialHealth = {
  readonly apns: ApnsCredentialHealth;
  readonly scepCa: ScepCaCredentialHealth;
  readonly deviceCertificates: DeviceCertificateCounts;
  readonly serverCertificate: ServerCertificateInfo;
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
): CredentialInfoLevel => {
  if (!configured) return "missing";

  if (!expiresAt) return "unknown";

  if (expiresAt.getTime() <= now.getTime()) return "expired";
  const daysLeft = daysUntilExpiry(expiresAt, now);

  if (daysLeft <= CREDENTIAL_CRITICAL_DAYS) return "critical";

  if (daysLeft <= CREDENTIAL_WARNING_DAYS) return "warning";

  return "ok";
};

type CredentialInfoLevel = ApnsCredentialHealth["level"];

export const credentialInfo = (configured: boolean, expiresAt: Date | null, now: Date) => ({
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
  readonly caFingerprintSha256?: string | null;
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

  return { total: current.length, expired, expiringSoon, revoked };
};

/**
 * APNs health. Expiry is only half the story: a certificate whose private key
 * is missing or does not match cannot sign a push at all, so that is reported
 * (and escalated) separately from the expiry window.
 */
export const apnsCredentialHealth = async (input: {
  readonly certificatePem: string | null;
  readonly topic: string | null;
  readonly encryptedKey: string | null;
  readonly authSecret?: string;
  readonly now: Date;
}): Promise<ApnsCredentialHealth> => {
  const configured = input.certificatePem !== null;

  const base = credentialInfo(
    configured,
    parseCertificateNotAfter(input.certificatePem),
    input.now,
  );

  if (!configured)
    return {
      ...base,
      commonName: null,
      topic: null,
      keyConfigured: false,
      keyMatchesCertificate: null,
      topicMatchesCertificate: null,
      renewalUrl: APNS_RENEWAL_URL,
    };

  let parsed: ReturnType<typeof parseApnsCertificate> | null = null;

  try {
    parsed = parseApnsCertificate(input.certificatePem!);
  } catch {
    parsed = null;
  }

  const topicMatchesCertificate = parsed
    ? isApnsMdmTopic(parsed.topic) && parsed.topic === input.topic
    : null;

  // No stored key means the certificate itself is the only credential we have;
  // the comparison is impossible rather than failing.
  let keyMatchesCertificate: boolean | null = null;

  if (input.encryptedKey) {
    if (!input.authSecret) {
      keyMatchesCertificate = null;
    } else if (parsed) {
      try {
        const jwk: JsonWebKey = JSON.parse(await openSecret(input.authSecret, input.encryptedKey));

        const privateKey = await importApnsKeyJwk(jwk);
        keyMatchesCertificate = await certificateMatchesKey(parsed.certificate, privateKey);
      } catch {
        // The key exists but cannot be opened: pushes cannot be signed.
        keyMatchesCertificate = false;
      }
    }
  }

  const level =
    base.level === "expired"
      ? "expired"
      : keyMatchesCertificate === false || topicMatchesCertificate === false
        ? "critical"
        : base.level;

  return {
    ...base,
    level,
    commonName: parsed?.commonName ?? null,
    topic: parsed?.topic ?? input.topic,
    keyConfigured: input.encryptedKey !== null,
    keyMatchesCertificate,
    topicMatchesCertificate,
    renewalUrl: APNS_RENEWAL_URL,
  };
};

/**
 * A probe that never completed tells us nothing about the certificate; an
 * untrusted chain is a hard failure even while the date is fine.
 */
const serverCertificateLevel = (
  level: CredentialInfoLevel,
  row: { readonly error: string | null; readonly authorized: boolean },
): CredentialInfoLevel => {
  if (row.error) return "unknown";

  if (level === "expired") return "expired";

  if (row.authorized === false) return "critical";

  return level;
};

/** CredentialInfo-shaped view of the latest origin TLS probe. */
export const serverCertificateInfo = (
  row: {
    readonly origin: string;
    readonly hostname: string;
    readonly checkedAt: Date;
    readonly notBefore: Date | null;
    readonly notAfter: Date | null;
    readonly subject: string | null;
    readonly issuer: string | null;
    readonly authorized: boolean;
    readonly authorizationError: string | null;
    readonly error: string | null;
  } | null,
  now: Date,
): ServerCertificateInfo => {
  if (!row)
    return {
      configured: false,
      expiresAt: null,
      daysLeft: null,
      level: "missing",
      origin: null,
      hostname: null,
      checkedAt: null,
      subject: null,
      issuer: null,
      authorized: null,
      authorizationError: null,
      error: null,
    };

  const base = credentialInfo(true, row.notAfter, now);

  return {
    ...base,
    level: serverCertificateLevel(base.level, row),
    origin: row.origin,
    hostname: row.hostname,
    checkedAt: row.checkedAt.toISOString(),
    subject: row.subject,
    issuer: row.issuer,
    authorized: row.authorized,
    authorizationError: row.authorizationError,
    error: row.error,
  };
};

const scepCaCredentialHealth = (state: ScepCaState, now: Date): ScepCaCredentialHealth => {
  const base = credentialInfo(state.configured, state.health?.notAfter ?? null, now);

  return {
    ...base,
    commonName: state.commonName,
    fingerprintSha256: state.fingerprintSha256,
    source: state.source,
    rotationDue: state.health?.rotationDue ?? false,
    rotationDueAt: state.health?.rotationDueAt.toISOString() ?? null,
    retiring: state.retiring,
    unattributedIdentities: state.unattributedIdentities,
    untrustedIdentities: state.untrustedIdentities,
  };
};

/**
 * Tenant-scoped credential summary. Each tenant has its own SCEP CA, APNs
 * certificate and issued identities, so every value is read for
 * `organizationId` — except the origin certificate, which every tenant shares.
 */
export const loadCredentialHealth = (
  db: EnterpriseDb,
  organizationId: string,
  now: Date = new Date(),
  options: { readonly authSecret?: string } = {},
): Effect.Effect<CredentialHealth, unknown> =>
  Effect.gen(function* () {
    const [apnsRow] = yield* db
      .select()
      .from(schema.applePushCertificate)
      .where(eq(schema.applePushCertificate.organizationId, organizationId))
      .limit(1);

    const certificates = yield* db
      .select()
      .from(schema.scepIssuedCertificate)
      .where(eq(schema.scepIssuedCertificate.organizationId, organizationId));

    const apns = yield* Effect.tryPromise({
      try: () =>
        apnsCredentialHealth({
          certificatePem: apnsRow?.certPem ?? null,
          topic: apnsRow?.topic ?? null,
          encryptedKey: apnsRow?.encryptedKey ?? null,
          authSecret: options.authSecret,
          now,
        }),
      catch: () => new Error("Failed to read APNs credential health"),
    });

    const caState = yield* loadScepCaState(db, organizationId, now, certificates);

    const [serverCertificateRow] = yield* db
      .select()
      .from(schema.serverCertificateHealth)
      .where(eq(schema.serverCertificateHealth.id, "origin"))
      .limit(1);

    return {
      apns,
      scepCa: scepCaCredentialHealth(caState, now),
      deviceCertificates: summarizeDeviceCertificates(certificates, now),
      serverCertificate: serverCertificateInfo(serverCertificateRow ?? null, now),
    };
  });
