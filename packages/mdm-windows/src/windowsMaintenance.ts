import { and, inArray, lt } from "drizzle-orm";
import { Effect } from "effect";
import { schema as s, type EnterpriseDb } from "@mattrax/enterprise-core";
import { WINDOWS_STATE_COMMAND_REQUEST_TYPES } from "./windowsCommands.ts";

/**
 * Retention for Windows state-generated `device_command` rows.
 *
 * Policy `Replace`/`Delete` and inventory `Get` rows are not an operator action
 * queue: they are rebuilt from device state on the next check-in, and their ids
 * are deterministic per device and OMA-URI. They are written as `sent` with no
 * delivery deadline, so the generic command sweep — which only expires commands
 * with a budget and prunes terminal history — never removes them. Without a
 * window a long-lived Windows fleet accumulates one row for every policy setting
 * and inventory item it has ever received, until the device itself is deleted.
 *
 * A month is deliberately conservative: a device that has not refreshed a row
 * in that time has been offline long enough that the row is only history, and a
 * returning device simply gets a fresh row with the same id. Unlike an
 * imperative command, pruning a state row cannot lose work.
 */
export const WINDOWS_STATE_COMMAND_RETENTION_DAYS = 30;

/**
 * Bound per daily run so a deployment with a large backlog cannot stall the
 * maintenance cron. Remaining rows are picked up by the next run.
 */
export const WINDOWS_STATE_COMMAND_PRUNE_LIMIT = 5_000;

export type WindowsStateCommandSweepResult = {
  /** State-command rows deleted by this run. */
  readonly pruned: number;
};

/**
 * Delete Windows policy/inventory command rows older than the retention window.
 *
 * Age is measured from `updatedAt`, so a row that is still being re-delivered or
 * acknowledged stays. Status is deliberately ignored: these rows never become
 * terminal as a group, and a `sent` row older than the window can only belong to
 * a device that stopped checking in. The sweep is idempotent and bounded.
 */
export const sweepWindowsStateCommands = (
  db: EnterpriseDb,
  options: {
    readonly now: Date;
    /** Defaults to `WINDOWS_STATE_COMMAND_RETENTION_DAYS`; `0` keeps history. */
    readonly retentionDays?: number;
    /** Test/operator override for the per-run bound. */
    readonly limit?: number;
  },
): Effect.Effect<WindowsStateCommandSweepResult, unknown> =>
  Effect.gen(function* () {
    const retentionDays = options.retentionDays ?? WINDOWS_STATE_COMMAND_RETENTION_DAYS;

    if (retentionDays <= 0) return { pruned: 0 };

    const cutoff = new Date(options.now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

    const prunable = yield* db
      .select({ id: s.deviceCommand.id })
      .from(s.deviceCommand)
      .where(
        and(
          inArray(s.deviceCommand.requestType, [...WINDOWS_STATE_COMMAND_REQUEST_TYPES]),
          lt(s.deviceCommand.updatedAt, cutoff),
        ),
      )
      .limit(options.limit ?? WINDOWS_STATE_COMMAND_PRUNE_LIMIT);

    if (prunable.length === 0) return { pruned: 0 };

    yield* db.delete(s.deviceCommand).where(
      inArray(
        s.deviceCommand.id,
        prunable.map((row) => row.id),
      ),
    );

    return { pruned: prunable.length };
  });
