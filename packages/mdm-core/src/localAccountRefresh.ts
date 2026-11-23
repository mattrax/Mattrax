import { and, asc, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { schema as s } from "@mattrax/enterprise-core";
import type { EnterpriseDb } from "@mattrax/enterprise-core";
import { isConfirmedMacOsDevice } from "@mattrax/enterprise-domain";
import { commandDedupeKey, deviceCommandExpiresAt } from "./commands.ts";

/**
 * Scheduled `UserList` refresh.
 *
 * macOS reports local accounts only on request. Waiting for an administrator to
 * press Refresh means an unexpected admin or a stale shared account can stay
 * invisible indefinitely, so the daily maintenance run queues one `UserList`
 * per Mac whose inventory is missing or older than a day. It is rate-limited
 * per device, so a Mac that never answers is not asked on every run.
 */

/** Do not ask the same Mac more than once in this window. */
export const LOCAL_ACCOUNT_REQUEST_INTERVAL_HOURS = 24;

/** An inventory older than this is refreshed by the daily sweep. */
export const LOCAL_ACCOUNT_MAX_AGE_HOURS = 24;

/** Bound per maintenance run. */
export const LOCAL_ACCOUNT_REFRESH_LIMIT = 500;

export type LocalAccountRefreshResult = {
  readonly requested: number;
  readonly skipped: number;
};

/**
 * Whether a Mac needs another `UserList` request. Pure so the schedule can be
 * unit tested without a database.
 */
export const localAccountRefreshDue = (
  device: {
    readonly localAccountsUpdatedAt?: Date | null;
    readonly localAccountsRequestedAt?: Date | null;
  },
  at: Date,
  options: {
    readonly maxAgeHours?: number;
    readonly requestIntervalHours?: number;
  } = {},
): boolean => {
  const requestedAt = device.localAccountsRequestedAt;
  const intervalHours = options.requestIntervalHours ?? LOCAL_ACCOUNT_REQUEST_INTERVAL_HOURS;

  if (requestedAt && at.getTime() - requestedAt.getTime() < intervalHours * 60 * 60 * 1000)
    return false;

  if (!device.localAccountsUpdatedAt) return true;
  const maxAgeHours = options.maxAgeHours ?? LOCAL_ACCOUNT_MAX_AGE_HOURS;

  return at.getTime() - device.localAccountsUpdatedAt.getTime() > maxAgeHours * 60 * 60 * 1000;
};

/**
 * Queue `UserList` for every Mac that needs it. Returns how many were requested
 * and how many candidates were skipped (non-Mac Apple devices are not
 * candidates and are not counted).
 */
export const refreshAppleLocalAccounts = (
  db: EnterpriseDb,
  options: { readonly now: Date; readonly limit?: number; readonly organizationId?: string },
): Effect.Effect<LocalAccountRefreshResult, unknown> =>
  Effect.gen(function* () {
    const now = options.now;
    const limit = options.limit ?? LOCAL_ACCOUNT_REFRESH_LIMIT;

    // Apple implements UserList on macOS only. Scan Apple devices in bounded
    // pages and keep positively identified Macs, so iPhones and unidentified
    // Apple devices cannot consume the limit and starve a Mac fleet. The Mac
    // predicate is shared with the enrolment path.
    const pageSize = 200;
    const due: Array<{
      id: string;
      organizationId: string;
      localAccountsUpdatedAt: Date | null;
      localAccountsRequestedAt: Date | null;
    }> = [];
    let skipped = 0;
    let offset = 0;

    while (due.length < limit) {
      const page = yield* db
        .select({
          id: s.device.id,
          organizationId: s.device.organizationId,
          osEdition: s.device.osEdition,
          model: s.device.model,
          proto: s.device.proto,
        })
        .from(s.device)
        .where(
          and(
            eq(s.device.proto, "apple"),
            eq(s.device.status, "enrolled"),
            options.organizationId
              ? eq(s.device.organizationId, options.organizationId)
              : undefined,
          ),
        )
        .orderBy(asc(s.device.id))
        .offset(offset)
        .limit(pageSize);

      if (page.length === 0) break;
      offset += page.length;

      const appleRows = yield* db
        .select({
          deviceId: s.deviceApple.deviceId,
          localAccountsUpdatedAt: s.deviceApple.localAccountsUpdatedAt,
          localAccountsRequestedAt: s.deviceApple.localAccountsRequestedAt,
        })
        .from(s.deviceApple)
        .where(
          inArray(
            s.deviceApple.deviceId,
            page.map((device) => device.id),
          ),
        );

      const appleByDevice = new Map(appleRows.map((row) => [row.deviceId, row]));

      for (const device of page) {
        if (!isConfirmedMacOsDevice(device)) continue;
        const apple = appleByDevice.get(device.id);

        if (!apple) continue;

        if (localAccountRefreshDue(apple, now))
          due.push({
            id: device.id,
            organizationId: device.organizationId,
            localAccountsUpdatedAt: apple.localAccountsUpdatedAt,
            localAccountsRequestedAt: apple.localAccountsRequestedAt,
          });
        else skipped += 1;

        if (due.length >= limit) break;
      }

      if (page.length < pageSize) break;
    }

    if (due.length === 0) return { requested: 0, skipped };

    const payload = {};

    const dedupeKey = yield* Effect.promise(() => commandDedupeKey("UserList", payload));

    for (const device of due)
      yield* (
        db
          .insert(s.deviceCommand)
          .values({
            id: crypto.randomUUID(),
            organizationId: device.organizationId,
            deviceId: device.id,
            requestType: "UserList",
            payload,
            status: "queued",
            dedupeKey,
            expiresAt: deviceCommandExpiresAt("UserList", now),
            resultStatus: null,
            resultDetail: null,
            createdAt: now,
            updatedAt: now,
          })
          // A check-in may have queued the same request first; leave it alone.
          .onDuplicateKeyUpdate({ set: { requestType: "UserList" } })
      );

    yield* db
      .update(s.deviceApple)
      .set({ localAccountsRequestedAt: now })
      .where(
        inArray(
          s.deviceApple.deviceId,
          due.map((device) => device.id),
        ),
      );

    return { requested: due.length, skipped };
  });
