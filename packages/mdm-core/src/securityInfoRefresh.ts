import { and, eq, inArray, isNull, like, lt, or } from "drizzle-orm";
import { Effect } from "effect";
import { schema as s } from "@mattrax/enterprise-core";
import type { EnterpriseDb } from "@mattrax/enterprise-core";
import { isMacOsDevice } from "@mattrax/enterprise-domain";
import { commandDedupeKey, deviceCommandExpiresAt } from "./commands.ts";

/**
 * Scheduled `SecurityInfo` refresh.
 *
 * A Mac's FileVault personal recovery key is only escrowed when the device
 * answers `SecurityInfo`. Waiting for an administrator to press "Collect
 * security info" means the normal case — FileVault enabled days after
 * enrolment — is a disk Mattrax cannot unlock. This sweep queues a refresh for
 * Macs whose key is missing or whose last answer is stale, bounded per run and
 * rate-limited so a device that never answers is not asked on every run.
 */

/** Do not ask the same device more than once in this window. */
export const SECURITY_INFO_REQUEST_INTERVAL_HOURS = 24;

/**
 * An answer older than this is treated as stale. Apple only re-wraps the key
 * when FileVault rotates it, so this tracks the last confirmation.
 */
export const SECURITY_INFO_MAX_AGE_DAYS = 90;

/** Bound per maintenance run. */
export const SECURITY_INFO_REFRESH_LIMIT = 500;

export type SecurityInfoRefreshResult = {
  readonly requested: number;
  readonly skipped: number;
};

/**
 * Whether a Mac needs another `SecurityInfo` request.
 *
 * Pure so the schedule is unit tested without a database.
 */
export const securityInfoRefreshDue = (
  device: {
    readonly fileVaultEnabled?: boolean | null;
    readonly securityInfoUpdatedAt?: Date | null;
    readonly securityInfoRequestedAt?: Date | null;
    readonly hasRecoveryKey: boolean;
  },
  at: Date,
  options: {
    readonly maxAgeDays?: number;
    readonly requestIntervalHours?: number;
  } = {},
): boolean => {
  const intervalHours = options.requestIntervalHours ?? SECURITY_INFO_REQUEST_INTERVAL_HOURS;

  const requestedAt = device.securityInfoRequestedAt;

  if (requestedAt && at.getTime() - requestedAt.getTime() < intervalHours * 60 * 60 * 1000)
    return false;

  if (!device.hasRecoveryKey) return true;

  if (!device.securityInfoUpdatedAt) return true;

  const maxAgeDays = options.maxAgeDays ?? SECURITY_INFO_MAX_AGE_DAYS;

  return at.getTime() - device.securityInfoUpdatedAt.getTime() > maxAgeDays * 24 * 60 * 60 * 1000;
};

/**
 * Queue `SecurityInfo` for every Mac that needs it. Returns how many were
 * requested and how many candidates were skipped (non-Mac Apple devices are not
 * candidates and are not counted).
 */
export const refreshAppleSecurityInfo = (
  db: EnterpriseDb,
  options: { readonly now: Date; readonly limit?: number; readonly organizationId?: string },
): Effect.Effect<SecurityInfoRefreshResult, unknown> =>
  Effect.gen(function* () {
    const now = options.now;
    const limit = options.limit ?? SECURITY_INFO_REFRESH_LIMIT;

    const staleBefore = new Date(now.getTime() - SECURITY_INFO_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);

    const requestBefore = new Date(
      now.getTime() - SECURITY_INFO_REQUEST_INTERVAL_HOURS * 60 * 60 * 1000,
    );

    const candidates = yield* db
      .select({
        id: s.device.id,
        organizationId: s.device.organizationId,
        osEdition: s.device.osEdition,
        model: s.device.model,
        proto: s.device.proto,
        fileVaultEnabled: s.device.fileVaultEnabled,
        securityInfoUpdatedAt: s.deviceApple.securityInfoUpdatedAt,
        securityInfoRequestedAt: s.deviceApple.securityInfoRequestedAt,
      })
      .from(s.device)
      .innerJoin(s.deviceApple, eq(s.deviceApple.deviceId, s.device.id))
      .where(
        and(
          eq(s.device.proto, "apple"),
          eq(s.device.status, "enrolled"),
          options.organizationId ? eq(s.device.organizationId, options.organizationId) : undefined,
          or(
            isNull(s.deviceApple.securityInfoUpdatedAt),
            lt(s.deviceApple.securityInfoUpdatedAt, staleBefore),
          ),
          or(
            isNull(s.deviceApple.securityInfoRequestedAt),
            lt(s.deviceApple.securityInfoRequestedAt, requestBefore),
          ),
          // Filter Macs before the limit. An iPhone can report FileVault state
          // but never has a recovery key, so letting iOS rows consume the
          // batch starves every Mac on a large tenant.
          or(
            like(s.device.osEdition, "%mac%"),
            like(s.device.model, "%mac%"),
            and(isNull(s.device.osEdition), isNull(s.device.model)),
          ),
        ),
      )
      .limit(limit);

    const macs = candidates.filter((device) => isMacOsDevice(device));

    if (macs.length === 0) return { requested: 0, skipped: 0 };

    const withKeys = yield* db
      .select({ deviceId: s.deviceSecret.deviceId })
      .from(s.deviceSecret)
      .where(
        and(
          inArray(
            s.deviceSecret.deviceId,
            macs.map((device) => device.id),
          ),
          eq(s.deviceSecret.kind, "filevault_recovery_key"),
        ),
      );

    const keyed = new Set(withKeys.map((row) => row.deviceId));

    const due = macs.filter((device) =>
      securityInfoRefreshDue({ ...device, hasRecoveryKey: keyed.has(device.id) }, now),
    );

    const payload = {};

    const dedupeKey = yield* Effect.promise(() => commandDedupeKey("SecurityInfo", payload));

    for (const device of due)
      yield* (
        db
          .insert(s.deviceCommand)
          .values({
            id: crypto.randomUUID(),
            organizationId: device.organizationId,
            deviceId: device.id,
            requestType: "SecurityInfo",
            payload,
            status: "queued",
            dedupeKey,
            expiresAt: deviceCommandExpiresAt("SecurityInfo", now),
            resultStatus: null,
            resultDetail: null,
            createdAt: now,
            updatedAt: now,
          })
          // A check-in may have queued the same request first; leave it alone.
          .onDuplicateKeyUpdate({ set: { requestType: "SecurityInfo" } })
      );

    if (due.length > 0)
      yield* db
        .update(s.deviceApple)
        .set({ securityInfoRequestedAt: now })
        .where(
          inArray(
            s.deviceApple.deviceId,
            due.map((device) => device.id),
          ),
        );

    return { requested: due.length, skipped: candidates.length - due.length };
  });
