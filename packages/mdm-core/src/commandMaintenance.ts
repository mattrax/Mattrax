import { and, inArray, lt } from "drizzle-orm";
import { schema as s } from "@mattrax/enterprise-core";
import type { EnterpriseDb } from "@mattrax/enterprise-core";
import { Effect } from "effect";
import {
  ACTIVE_COMMAND_STATUSES,
  COMMAND_EXPIRED_DETAIL,
  RECONCILED_RESULT_STATUS,
  commandIsExpired,
} from "./commands.ts";

/**
 * Housekeeping for the imperative command queue.
 *
 * Commands are delivered on a best-effort basis, so a device can go away with
 * work still `sent` (Android has no other delivery record), or a check-in can
 * be lost after the server marked a command delivered. The daily sweep makes
 * the deadline authoritative even when no device ever checks in again, and
 * keeps the table from growing without bound on long-lived tenants.
 */

/** Terminal command rows older than this are pruned by the daily sweep. */
export const DEVICE_COMMAND_RETENTION_DAYS = 90;

/** Bound per run so one tenant with a large backlog cannot stall the cron. */
const SWEEP_LIMIT = 5_000;

export type CommandSweepResult = {
  readonly expired: number;
  readonly pruned: number;
};

/**
 * Expire every active command whose delivery budget elapsed, then delete
 * terminal rows past retention. Both steps are idempotent and tenant-scoped by
 * the row's own organization id, so the sweep can run across the deployment.
 */
export const sweepDeviceCommands = (
  db: EnterpriseDb,
  options: { readonly now: Date; readonly retentionDays?: number },
): Effect.Effect<CommandSweepResult, unknown> =>
  Effect.gen(function* () {
    const now = options.now;
    const retentionDays = options.retentionDays ?? DEVICE_COMMAND_RETENTION_DAYS;

    const active = yield* db
      .select()
      .from(s.deviceCommand)
      .where(inArray(s.deviceCommand.status, [...ACTIVE_COMMAND_STATUSES]))
      .limit(SWEEP_LIMIT);

    const expiredIds = active.filter((row) => commandIsExpired(row, now)).map((row) => row.id);

    if (expiredIds.length > 0)
      yield* db
        .update(s.deviceCommand)
        .set({
          status: "expired",
          dedupeKey: null,
          resultStatus: RECONCILED_RESULT_STATUS,
          resultDetail: COMMAND_EXPIRED_DETAIL,
          updatedAt: now,
        })
        .where(inArray(s.deviceCommand.id, expiredIds));

    if (retentionDays <= 0) return { expired: expiredIds.length, pruned: 0 };

    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

    const prunable = yield* db
      .select({ id: s.deviceCommand.id })
      .from(s.deviceCommand)
      .where(
        and(
          lt(s.deviceCommand.updatedAt, cutoff),
          // Active work is never pruned; the expiry pass above handles it.
          inArray(s.deviceCommand.status, ["succeeded", "failed", "expired", "cancelled"]),
        ),
      )
      .limit(SWEEP_LIMIT);

    if (prunable.length > 0)
      yield* db.delete(s.deviceCommand).where(
        inArray(
          s.deviceCommand.id,
          prunable.map((row) => row.id),
        ),
      );

    return { expired: expiredIds.length, pruned: prunable.length };
  });
