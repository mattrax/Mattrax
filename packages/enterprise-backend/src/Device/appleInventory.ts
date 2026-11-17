/**
 * Apple installed-application inventory scheduling.
 *
 * iOS and macOS only report installed applications in response to an
 * `InstalledApplicationList` command, so the inventory is either collected
 * manually from the device page or by the daily maintenance sweep below. The
 * pure scheduling decision is separated from the database write so the cadence
 * can be tested without a store.
 */

import { Effect } from "effect";
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { schema } from "@mattrax/enterprise-core";
import {
  APPLE_APPLICATION_INVENTORY_PAYLOAD,
  commandDedupeKey,
  commandIsExpired,
  deviceCommandExpiresAt,
} from "@mattrax/mdm-apple";
import type { EnterpriseDb } from "../schema.ts";

const DAY = 24 * 60 * 60 * 1000;

/** Inventory older than this is refreshed by the maintenance sweep. */
export const APPLE_APPLICATION_INVENTORY_REFRESH_MS = DAY;

/** Request type of the class `InstalledApplicationList` query. */
export const APPLE_APPLICATION_INVENTORY_REQUEST_TYPE = "InstalledApplicationList";

/**
 * The installed-application query used at enrolment and by the daily sweep.
 * Re-exported for callers that only depend on this module.
 */
export { APPLE_APPLICATION_INVENTORY_PAYLOAD };

/** Commands that have not finished yet: queueing another refresh would double up. */
const IN_FLIGHT_COMMAND_STATUSES = ["queued", "sent", "deferred"] as const;

/** Per-run bound so one large tenant cannot monopolise the daily cron. */
export const APPLE_APPLICATION_INVENTORY_SWEEP_LIMIT = 500;

/**
 * Whether an Apple device's installed-application inventory should be
 * refreshed. Unenrolled devices are skipped: their inventory cannot change and
 * the command would never be collected.
 */
export const appleApplicationInventoryDue = (input: {
  readonly proto: "apple" | "win" | "android";
  readonly status: "enrolling" | "enrolled" | "unenrolling" | "unenrolled";
  readonly lastUpdatedAt?: Date | string | null;
  readonly now: Date;
  readonly refreshMs?: number;
}): boolean => {
  if (input.proto !== "apple" || input.status !== "enrolled") return false;

  if (!input.lastUpdatedAt) return true;

  const updatedAt =
    input.lastUpdatedAt instanceof Date ? input.lastUpdatedAt : new Date(input.lastUpdatedAt);

  if (!Number.isFinite(updatedAt.getTime())) return true;

  return (
    input.now.getTime() - updatedAt.getTime() >=
    (input.refreshMs ?? APPLE_APPLICATION_INVENTORY_REFRESH_MS)
  );
};

/**
 * Queue the daily inventory refresh for every Apple device whose inventory is
 * missing or stale.
 *
 * Tenant-safe by construction: the device query is scoped to Apple devices that
 * are still enrolled, the in-flight check reads only those device ids, and the
 * insert stamps each row with the owning organization. Devices with a refresh
 * already queued or in flight are skipped rather than queued twice.
 */
export const refreshAppleApplicationInventory = (
  db: EnterpriseDb,
  options: { readonly now: Date; readonly refreshMs?: number; readonly limit?: number },
): Effect.Effect<number, unknown> =>
  Effect.gen(function* () {
    const refreshMs = options.refreshMs ?? APPLE_APPLICATION_INVENTORY_REFRESH_MS;
    const cutoff = new Date(options.now.getTime() - refreshMs);

    const devices = yield* db
      .select({
        id: schema.device.id,
        organizationId: schema.device.organizationId,
        applicationsUpdatedAt: schema.device.applicationsUpdatedAt,
      })
      .from(schema.device)
      .where(
        and(
          eq(schema.device.proto, "apple"),
          eq(schema.device.status, "enrolled"),
          or(
            isNull(schema.device.applicationsUpdatedAt),
            lt(schema.device.applicationsUpdatedAt, cutoff),
          ),
        ),
      )
      .limit(options.limit ?? APPLE_APPLICATION_INVENTORY_SWEEP_LIMIT);

    if (devices.length === 0) return 0;
    const deviceIds = devices.map((device) => device.id);

    const pending = yield* db
      .select({
        id: schema.deviceCommand.id,
        deviceId: schema.deviceCommand.deviceId,
        requestType: schema.deviceCommand.requestType,
        status: schema.deviceCommand.status,
        createdAt: schema.deviceCommand.createdAt,
        updatedAt: schema.deviceCommand.updatedAt,
        expiresAt: schema.deviceCommand.expiresAt,
      })
      .from(schema.deviceCommand)
      .where(
        and(
          inArray(schema.deviceCommand.deviceId, deviceIds),
          eq(schema.deviceCommand.requestType, APPLE_APPLICATION_INVENTORY_REQUEST_TYPE),
          inArray(schema.deviceCommand.status, [...IN_FLIGHT_COMMAND_STATUSES]),
        ),
      );

    // A row still marked queued after its budget elapsed is not in flight; the
    // sweep has not reached it yet, and treating it as pending would suppress
    // the refresh forever.
    const alreadyQueued = new Set(
      pending.filter((row) => !commandIsExpired(row, options.now)).map((row) => row.deviceId),
    );

    const due = devices.filter((device) => !alreadyQueued.has(device.id));

    if (due.length === 0) return 0;

    const rows = yield* Effect.promise(() =>
      Promise.all(
        due.map(async (device) => ({
          id: crypto.randomUUID().replaceAll("-", "").slice(0, 24),
          organizationId: device.organizationId,
          deviceId: device.id,
          requestType: APPLE_APPLICATION_INVENTORY_REQUEST_TYPE,
          payload: APPLE_APPLICATION_INVENTORY_PAYLOAD,
          status: "queued" as const,
          dedupeKey: await commandDedupeKey(
            APPLE_APPLICATION_INVENTORY_REQUEST_TYPE,
            APPLE_APPLICATION_INVENTORY_PAYLOAD,
          ),
          expiresAt: deviceCommandExpiresAt(APPLE_APPLICATION_INVENTORY_REQUEST_TYPE, options.now),
          createdAt: options.now,
          updatedAt: options.now,
        })),
      ),
    );

    // The unique (device_id, dedupe_key) index makes a concurrent sweep safe:
    // the loser's insert is a no-op and the winner's command is delivered.
    yield* db
      .insert(schema.deviceCommand)
      .values(rows)
      .onDuplicateKeyUpdate({ set: { id: sql`id` } });

    return rows.length;
  });
