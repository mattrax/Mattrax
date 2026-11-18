import { Effect, Exit } from "effect";
import { and, desc, eq, gt, gte, lte } from "drizzle-orm";
import { schema as s } from "@mattrax/enterprise-core";
import {
  SCEP_CA_ROTATION_LEAD_DAYS,
  describeScepCa,
  rotateScepCa,
  scepCaHealth,
  type ScepCaDescription,
  type ScepCaHealth,
} from "@mattrax/scep";
import { ScepRepositoryLive } from "@mattrax/mdm-apple";
import type { EnterpriseDb } from "../schema.ts";

/**
 * SCEP CA lifecycle: trust-anchor discovery, rotation and overlap accounting.
 *
 * Rotation is staged rather than destructive. Every identity issued before a
 * rotation keeps working (the retired CA certificate stays a verification
 * anchor until it expires), while new and renewed identities are signed by the
 * successor CA. Nothing here revokes a device identity, so no device has to
 * re-enrol to survive a rotation.
 */

/** The columns of an issued identity the overlap accounting needs. */
export type ScepIssuedIdentity = {
  readonly notAfter: Date;
  readonly revokedAt?: Date | null;
  readonly caFingerprintSha256?: string | null;
};

export type ScepRetiredCaState = {
  readonly fingerprintSha256: string;
  readonly source: "generated" | "imported";
  readonly retiredAt: string;
  readonly trustUntil: string;
  readonly notAfter: string;
  /** Whole days until the anchor is dropped from the trust list. */
  readonly daysUntilUntrusted: number;
  /** Active identities still chained to this CA. */
  readonly identities: number;
};

export type ScepCaState = {
  readonly configured: boolean;
  readonly source: "generated" | "imported" | null;
  readonly commonName: string | null;
  readonly fingerprintSha256: string | null;
  readonly serialNumber: string | null;
  readonly notBefore: string | null;
  readonly notAfter: string | null;
  readonly createdAt: string | null;
  readonly rotatedAt: string | null;
  readonly health: ScepCaHealth | null;
  /** Retired CAs still accepted for identities issued before rotation. */
  readonly retiring: ReadonlyArray<ScepRetiredCaState>;
  /**
   * Active identities with no recorded issuing CA. They were issued before
   * rotation history existed; the retiring anchors above still verify them.
   */
  readonly unattributedIdentities: number;
  /** Active identities whose issuing CA is no longer a trust anchor. */
  readonly untrustedIdentities: number;
};

type TrustRow = {
  readonly fingerprintSha256: string;
  readonly source: string;
  readonly retiredAt: Date;
  readonly trustUntil: Date;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const daysUntil = (date: Date, now: Date) =>
  Math.ceil((date.getTime() - now.getTime()) / MS_PER_DAY);

const iso = (date: Date | null | undefined) => (date ? date.toISOString() : null);

const isActiveIdentity = (identity: ScepIssuedIdentity, now: Date) =>
  !identity.revokedAt && identity.notAfter.getTime() > now.getTime();

/**
 * Pure overlap accounting, shared by the credential-health endpoint and the
 * SCEP identity endpoint.
 */
export const scepCaStateFromRows = (input: {
  readonly current: {
    readonly source: string;
    readonly createdAt: Date;
    readonly rotatedAt: Date | null;
  } | null;
  readonly description: ScepCaDescription | null;
  readonly trust: ReadonlyArray<TrustRow>;
  /** Retired certificates' own expiry, keyed by fingerprint. */
  readonly retiredNotAfter: ReadonlyMap<string, Date>;
  readonly identities: ReadonlyArray<ScepIssuedIdentity>;
  readonly now: Date;
  readonly rotationLeadDays?: number;
}): ScepCaState => {
  const { current, description, trust, retiredNotAfter, identities, now } = input;
  const active = identities.filter((identity) => isActiveIdentity(identity, now));

  const counts = new Map<string, number>();

  for (const identity of active) {
    const fingerprint = identity.caFingerprintSha256;

    if (!fingerprint) continue;
    counts.set(fingerprint, (counts.get(fingerprint) ?? 0) + 1);
  }

  const retiring = trust
    .filter(
      (row) =>
        row.trustUntil.getTime() > now.getTime() &&
        row.fingerprintSha256 !== description?.fingerprintSha256,
    )
    .map((row) => {
      const notAfter = retiredNotAfter.get(row.fingerprintSha256) ?? row.trustUntil;

      return {
        fingerprintSha256: row.fingerprintSha256,
        source: row.source === "imported" ? ("imported" as const) : ("generated" as const),
        retiredAt: row.retiredAt.toISOString(),
        trustUntil: row.trustUntil.toISOString(),
        notAfter: notAfter.toISOString(),
        daysUntilUntrusted: daysUntil(notAfter, now),
        identities: counts.get(row.fingerprintSha256) ?? 0,
      };
    });

  const trusted = new Set(
    trust
      .filter((row) => row.trustUntil.getTime() > now.getTime())
      .map((row) => row.fingerprintSha256),
  );

  if (description) trusted.add(description.fingerprintSha256);

  return {
    configured: current !== null,
    source: current ? (current.source === "imported" ? "imported" : "generated") : null,
    commonName: description?.commonName ?? null,
    fingerprintSha256: description?.fingerprintSha256 ?? null,
    serialNumber: description?.serialNumber ?? null,
    notBefore: iso(description?.notBefore),
    notAfter: iso(description?.notAfter),
    createdAt: iso(current?.createdAt),
    rotatedAt: iso(current?.rotatedAt),
    health: description
      ? scepCaHealth(description.notAfter, now, { rotationLeadDays: input.rotationLeadDays })
      : null,
    retiring,
    unattributedIdentities: active.filter((identity) => !identity.caFingerprintSha256).length,
    untrustedIdentities: active.filter(
      (identity) =>
        identity.caFingerprintSha256 != null && !trusted.has(identity.caFingerprintSha256),
    ).length,
  };
};

const describeRetired = (
  rows: ReadonlyArray<{ readonly certPem: string; readonly fingerprintSha256: string }>,
) =>
  Effect.forEach(rows, (row) =>
    describeScepCa(row.certPem).pipe(
      Effect.map((description) => [row.fingerprintSha256, description.notAfter] as const),
      // A malformed historical certificate must not hide the rest of the state;
      // its own trust window still bounds how long it is accepted.
      Effect.catch(() => Effect.succeed(null)),
    ),
  ).pipe(
    Effect.map((entries) => {
      const notAfter = new Map<string, Date>();

      for (const entry of entries) if (entry) notAfter.set(entry[0], entry[1]);

      return notAfter;
    }),
  );

/**
 * Load a tenant's CA, retired anchors and overlap accounting.
 *
 * `identities` can be supplied by a caller that already selected the tenant's
 * issued certificates (credential health does) to avoid a duplicate query.
 */
export const loadScepCaState = (
  db: EnterpriseDb,
  organizationId: string,
  now: Date = new Date(),
  identities?: ReadonlyArray<ScepIssuedIdentity>,
): Effect.Effect<ScepCaState, unknown> =>
  Effect.gen(function* () {
    const [current] = yield* db
      .select()
      .from(s.scepCa)
      .where(eq(s.scepCa.organizationId, organizationId))
      .limit(1);

    const trust = yield* db
      .select()
      .from(s.scepCaTrust)
      .where(eq(s.scepCaTrust.organizationId, organizationId))
      .orderBy(desc(s.scepCaTrust.retiredAt));

    const issued =
      identities ??
      (yield* db
        .select({
          notAfter: s.scepIssuedCertificate.notAfter,
          revokedAt: s.scepIssuedCertificate.revokedAt,
          caFingerprintSha256: s.scepIssuedCertificate.caFingerprintSha256,
        })
        .from(s.scepIssuedCertificate)
        .where(eq(s.scepIssuedCertificate.organizationId, organizationId)));

    if (!current)
      return scepCaStateFromRows({
        current: null,
        description: null,
        trust,
        retiredNotAfter: new Map(),
        identities: issued,
        now,
      });

    const description = yield* describeScepCa(current.certPem).pipe(
      Effect.catch(() => Effect.succeed(null)),
    );

    return scepCaStateFromRows({
      current,
      description,
      trust,
      retiredNotAfter: yield* describeRetired(trust),
      identities: issued,
      now,
    });
  });

/** Public certificates that may verify a device identity, current CA first. */
export const loadTrustedScepCaCertificates = (
  db: EnterpriseDb,
  organizationId: string,
  now: Date = new Date(),
): Effect.Effect<ReadonlyArray<string>, unknown> =>
  Effect.gen(function* () {
    const [current] = yield* db
      .select({ certPem: s.scepCa.certPem })
      .from(s.scepCa)
      .where(eq(s.scepCa.organizationId, organizationId))
      .limit(1);

    const retired = yield* db
      .select({ certPem: s.scepCaTrust.certPem })
      .from(s.scepCaTrust)
      .where(
        and(eq(s.scepCaTrust.organizationId, organizationId), gt(s.scepCaTrust.trustUntil, now)),
      )
      .orderBy(desc(s.scepCaTrust.retiredAt));

    return [...(current ? [current.certPem] : []), ...retired.map((row) => row.certPem)];
  });

export type ScepCaRotationSweepResult = {
  /** Tenants with a CA that were examined. */
  readonly checked: number;
  readonly rotated: number;
  readonly failed: number;
};

/**
 * Rotate every tenant CA that has entered its rotation window.
 *
 * Runs per tenant and isolates failures: one tenant's broken key material must
 * not stop another tenant from rotating. Each rotation is audited with the
 * fingerprints and overlap window so the change is explicit after the fact.
 */
export const rotateDueScepCas = (
  db: EnterpriseDb,
  options: {
    readonly now?: Date;
    readonly authSecret?: string;
    readonly lifetimeDays?: number;
    readonly leadDays?: number;
    /** Disable audit writes in tests that do not care about them. */
    readonly audit?: boolean;
  } = {},
): Effect.Effect<ScepCaRotationSweepResult, unknown> =>
  Effect.gen(function* () {
    const now = options.now ?? new Date();
    const leadDays = options.leadDays ?? SCEP_CA_ROTATION_LEAD_DAYS;

    const rows = yield* db
      .select({ organizationId: s.scepCa.organizationId, certPem: s.scepCa.certPem })
      .from(s.scepCa);

    let rotated = 0;
    let failed = 0;

    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    /**
     * Record a failed rotation once per tenant per UTC day. A CA that could not
     * be rotated is otherwise only visible in logs until the expiry alert fires,
     * which is far too late for an operator to act.
     */
    const recordFailure = (organizationId: string, reason: string, detail?: string) =>
      Effect.gen(function* () {
        if (options.audit === false) return;

        const [recent] = yield* db
          .select({ id: s.auditLog.id })
          .from(s.auditLog)
          .where(
            and(
              eq(s.auditLog.organizationId, organizationId),
              eq(s.auditLog.action, "scep_ca.rotation_failed"),
              gte(s.auditLog.createdAt, dayStart),
            ),
          )
          .limit(1);

        if (recent) return;

        yield* db.insert(s.auditLog).values({
          id: `sys_${crypto.randomUUID().replaceAll("-", "").slice(0, 21)}`,
          organizationId,
          actorAccountId: null,
          actorEmail: "system",
          action: "scep_ca.rotation_failed",
          targetType: "scep_ca",
          targetId: null,
          metadata: detail ? { reason, detail } : { reason },
          createdAt: now,
        });
      });

    for (const row of rows) {
      const description = yield* describeScepCa(row.certPem).pipe(
        Effect.catch(() => Effect.succeed(null)),
      );

      if (
        !description ||
        !scepCaHealth(description.notAfter, now, { rotationLeadDays: leadDays }).rotationDue
      )
        continue;

      if (!options.authSecret) {
        yield* Effect.logError(
          "SCEP CA rotation skipped: AUTH_SECRET is not configured",
          row.organizationId,
        );
        yield* recordFailure(row.organizationId, "auth_secret_missing");
        failed += 1;
        continue;
      }

      const exit = yield* Effect.exit(
        rotateScepCa(
          ScepRepositoryLive.make(db, { authSecret: options.authSecret }),
          { organizationId: row.organizationId },
          { now, lifetimeDays: options.lifetimeDays },
        ),
      );

      if (Exit.isFailure(exit)) {
        yield* Effect.logError("SCEP CA rotation failed", row.organizationId, exit.cause);
        yield* recordFailure(row.organizationId, "rotation_failed");
        failed += 1;
        continue;
      }

      const rotatedDescription = yield* describeScepCa(exit.value.certPem).pipe(
        Effect.catch(() => Effect.succeed(null)),
      );

      if (options.audit !== false) {
        yield* db.insert(s.auditLog).values({
          id: `sys_${crypto.randomUUID().replaceAll("-", "").slice(0, 21)}`,
          organizationId: row.organizationId,
          actorAccountId: null,
          actorEmail: "system",
          action: "scep_ca.auto_rotated",
          targetType: "scep_ca",
          targetId: null,
          metadata: {
            reason: "rotation_due",
            previousFingerprintSha256: description.fingerprintSha256,
            fingerprintSha256: rotatedDescription?.fingerprintSha256 ?? null,
            previousNotAfter: description.notAfter.toISOString(),
            // The previous CA stays a trust anchor until its own expiry, which
            // is what gives every identity it issued time to renew.
            overlapUntil: description.notAfter.toISOString(),
          },
          createdAt: now,
        });
      }

      rotated += 1;
    }

    return { checked: rows.length, rotated, failed };
  });

/**
 * Drop retired anchors whose trust window has closed. Their identities have
 * expired by construction, so no live device loses a verification path.
 */
export const purgeExpiredScepCaTrust = (
  db: EnterpriseDb,
  now: Date = new Date(),
): Effect.Effect<number, unknown> =>
  Effect.gen(function* () {
    const expired = yield* db
      .select({ id: s.scepCaTrust.id })
      .from(s.scepCaTrust)
      .where(lte(s.scepCaTrust.trustUntil, now));

    if (expired.length === 0) return 0;

    yield* db.delete(s.scepCaTrust).where(lte(s.scepCaTrust.trustUntil, now));

    return expired.length;
  });
