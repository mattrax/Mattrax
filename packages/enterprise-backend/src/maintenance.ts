import { Effect } from "effect";
import { and, eq, inArray, lt } from "drizzle-orm";
import { Db, schema as s } from "@mattrax/enterprise-core";

export type MaintenanceOptions = {
  /** Injectable clock for tests. Defaults to `new Date()`. */
  readonly now?: Date;
  /** Devices not seen for this many days are marked unenrolled. Defaults to 30. */
  readonly staleDeviceDays?: number;
  /**
   * Audit entries older than this many days are deleted. Defaults to 365.
   * Set to `0` to disable audit retention (entries are kept indefinitely).
   */
  readonly auditRetentionDays?: number;
};

export type MaintenanceResult = {
  readonly expiredInvitations: number;
  readonly staleDevices: number;
  readonly expiredAuthProofs: number;
  readonly expiredAuthSessions: number;
  readonly purgedAuditEntries: number;
};

const day = 24 * 60 * 60 * 1000;

/**
 * Idempotent scheduled maintenance shared by the Cloud Worker cron trigger and
 * any other host that owns an Enterprise database (for example a future
 * self-hosted mttx deployment with the Enterprise schema).
 *
 * Every step is safe to run repeatedly: expired invitations only move from
 * `pending` to `expired`, stale devices only move from `enrolled` to
 * `unenrolled`, and the deletion cutoffs use the provided clock.
 */
export const runMaintenance = (
  options: MaintenanceOptions = {},
): Effect.Effect<MaintenanceResult, any, Db> =>
  Effect.gen(function* () {
    const db = yield* Db;
    const now = options.now ?? new Date();
    const staleDeviceDays = options.staleDeviceDays ?? 30;
    const auditRetentionDays = options.auditRetentionDays ?? 365;

    const result: {
      -readonly [K in keyof MaintenanceResult]: MaintenanceResult[K];
    } = {
      expiredInvitations: 0,
      staleDevices: 0,
      expiredAuthProofs: 0,
      expiredAuthSessions: 0,
      purgedAuditEntries: 0,
    };

    // 1. Expire pending invitations whose acceptance window has closed.
    const expiredInvitations = yield* db
      .select({ id: s.invitation.id })
      .from(s.invitation)
      .where(and(eq(s.invitation.status, "pending"), lt(s.invitation.expiresAt, now)));
    if (expiredInvitations.length > 0) {
      yield* db
        .update(s.invitation)
        .set({ status: "expired", updatedAt: now })
        .where(
          inArray(
            s.invitation.id,
            expiredInvitations.map((row) => row.id),
          ),
        );
      result.expiredInvitations = expiredInvitations.length;
    }

    // 2. Mark stale enrolled devices. Unenrolling (rather than deleting) keeps
    //    inventory and audit history intact and lets an operator re-enrol.
    if (staleDeviceDays > 0) {
      const staleCutoff = new Date(now.getTime() - staleDeviceDays * day);
      const staleDevices = yield* db
        .select({ id: s.device.id })
        .from(s.device)
        .where(and(eq(s.device.status, "enrolled"), lt(s.device.lastSeenAt, staleCutoff)));
      if (staleDevices.length > 0) {
        yield* db
          .update(s.device)
          .set({ status: "unenrolled" })
          .where(
            inArray(
              s.device.id,
              staleDevices.map((row) => row.id),
            ),
          );
        result.staleDevices = staleDevices.length;
      }
    }

    // 3. Purge expired auth proofs and sessions. The auth tables are owned by
    //    `@yielded/auth`, so they are referenced through the shared schema
    //    aliases rather than duplicated table definitions. Their expiry columns
    //    are BIGINT epoch milliseconds, not DATETIME, so compare with millis.
    const nowMillis = now.getTime();
    const expiredProofs = yield* db
      .select({ proofId: s.authProofs.proofId })
      .from(s.authProofs)
      .where(lt(s.authProofs.expiresAt, nowMillis));
    if (expiredProofs.length > 0) {
      yield* db.delete(s.authProofs).where(lt(s.authProofs.expiresAt, nowMillis));
      result.expiredAuthProofs = expiredProofs.length;
    }

    const expiredSessions = yield* db
      .select({ sessionId: s.authSessions.sessionId })
      .from(s.authSessions)
      .where(lt(s.authSessions.expiresAt, nowMillis));
    if (expiredSessions.length > 0) {
      yield* db.delete(s.authSessions).where(lt(s.authSessions.expiresAt, nowMillis));
      result.expiredAuthSessions = expiredSessions.length;
    }

    // 4. Audit retention. Opt out with `auditRetentionDays: 0`.
    if (auditRetentionDays > 0) {
      const auditCutoff = new Date(now.getTime() - auditRetentionDays * day);
      const staleAudit = yield* db
        .select({ id: s.auditLog.id })
        .from(s.auditLog)
        .where(lt(s.auditLog.createdAt, auditCutoff));
      if (staleAudit.length > 0) {
        yield* db.delete(s.auditLog).where(lt(s.auditLog.createdAt, auditCutoff));
        result.purgedAuditEntries = staleAudit.length;
      }
    }

    return result;
  });
