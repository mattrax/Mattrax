import { Effect } from "effect";
import { schema as s } from "@mattrax/enterprise-core";
import type { Db } from "@mattrax/enterprise-core";
import { realtimeEventInsertForAudit } from "@mattrax/enterprise-domain";

export type RealtimePublishSource = {
  readonly organizationId: string;
  /** The audit action just written (`mdm.checkin`, `device.enrolled`, ...). */
  readonly action: string;
  readonly deviceId?: string | null;
  readonly protocol?: "apple" | "win" | "android" | null;
  /** Clock of the audit write, so ordering matches what the dashboard sees. */
  readonly now?: Date;
};

/**
 * Append one tenant-scoped invalidation notification.
 *
 * Called from `writeSystemAudit`, which every Apple, Windows and Android
 * ingress already writes for check-in, enrollment, command-result, declaration
 * and status transitions. Publishing here (instead of instrumenting each route)
 * keeps the list of publish points in one place and makes a protocol handler
 * that forgets to publish impossible.
 *
 * Notifications are best-effort: a failed insert must never fail an audit row
 * or a device protocol request, so the error is logged at debug level and
 * swallowed. Callers still `yield*` the effect so tests can observe ordering.
 */
export const publishRealtimeEvent = (db: Db["Service"], source: RealtimePublishSource) =>
  Effect.gen(function* () {
    const insert = realtimeEventInsertForAudit(source);

    if (!insert) return;

    yield* db.insert(s.realtimeEvent).values({
      organizationId: source.organizationId,
      kind: insert.kind,
      deviceId: insert.deviceId,
      protocol: insert.protocol,
      createdAt: source.now ?? new Date(),
    });
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logDebug(`Failed to append realtime event for ${source.action}: ${String(cause)}`),
    ),
  );
