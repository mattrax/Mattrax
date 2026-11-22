import { Effect, Option, Schema } from "effect";
import { and, desc, eq, sql } from "drizzle-orm";
import type { AnyColumn, SQL } from "drizzle-orm";
import type { Db } from "@mattrax/enterprise-core";
import { schema as s } from "@mattrax/enterprise-core";
import { publishRealtimeEvent } from "./realtime.ts";
import { dispatchWebhookEvent, webhookEventForAuditAction } from "./webhooks.ts";

/**
 * Actor recorded on events that are not initiated by a signed-in user. The
 * audit table keeps `actor_account_id` null and uses this sentinel email so the
 * UI can label the actor "System" without inventing a user row.
 */
export const SYSTEM_AUDIT_ACTOR = "system";

/**
 * Device/MDM protocol actions. These rows always have the system actor: a
 * device check-in is never attributable to an account, and writing one would
 * let a protocol request impersonate an administrator.
 *
 * `device.*` covers lifecycle and command outcomes; `mdm.*` covers protocol
 * traffic itself.
 */
export const SYSTEM_AUDIT_ACTIONS = {
  // Device lifecycle (state transitions, recorded once per occurrence).
  deviceEnrolled: "device.enrolled",
  deviceDeleted: "device.deleted",
  deviceAwaitingSetup: "device.awaiting_setup",
  deviceSetupComplete: "device.setup_complete",
  deviceCheckedOut: "device.checked_out",
  deviceReturnToServiceRequested: "device.return_to_service_requested",
  deviceReturnToServiceCompleted: "device.return_to_service_completed",
  commandFailed: "device.command_failed",
  commandNotNow: "device.command_not_now",
  deviceNamePushQueued: "device.name_push_queued",
  deviceNamePushSkipped: "device.name_push_skipped",
  declarationInvalid: "device.declaration_invalid",
  pushInvalidToken: "device.push_invalid_token",
  complianceChanged: "device.compliance_changed",
  deviceUnenrolled: "device.unenrolled",

  // MDM ingress.
  /**
   * A device presented a check-in: an Apple MDM check-in (device or user
   * channel), a Windows discovery or management session, or an Android
   * Management notification. Repeated check-ins from the same device fold into
   * one row per fixed time bucket, user principal and presenting identity.
   * `metadata.checkIns`, `metadata.firstSeenAt` and `metadata.lastSeenAt`
   * describe the fold, and `metadata.channels` lists every channel that
   * reported.
   */
  mdmCheckin: "mdm.checkin",
  /**
   * Policy or declaration content was delivered in response to a device
   * request: `DdmSync` declaration items fetched by Apple, legacy profiles
   * queued for an Apple device, a Windows management response carrying policy
   * changes, or an Android policy pushed to Google. One row per delivery that
   * actually changed something; a device polling without a change is only the
   * coalesced `mdm.checkin`.
   */
  mdmPolicyDelivered: "mdm.policy_delivered",
  /**
   * A device reported inventory or declaration status and at least one stored
   * value changed (including a health-level transition). Reports that carry no
   * change stay invisible; the check-in row already proves the device is alive.
   * Android records the status notification it receives (there is no payload
   * diff to compare), so its row means "a report arrived".
   */
  mdmStatusReport: "mdm.status_report",
  /**
   * A command reached a successful terminal state. Failures and deferrals keep
   * the existing `device.command_failed` / `device.command_not_now` actions,
   * so each result produces exactly one row.
   */
  mdmCommandResult: "mdm.command_result",
  /**
   * An MDM request failed after tenant attribution: an unparseable payload, an
   * invalid identity certificate, a SOAP/SyncML fault, a rejected policy, or a
   * failed Android policy sync. `metadata.phase` and `metadata.code` are the
   * machine-readable cause and `metadata.reason` is a bounded, redacted
   * description. No payload body, certificate or token is stored.
   */
  mdmFailure: "mdm.failure",
} as const;

export type AuditCategory = "account" | "mdm" | "system";

export type AuditProtocol = "apple" | "win" | "android";

export type SystemAuditEvent = {
  readonly organizationId: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId?: string | null;
  /** Small, secret-free context. Never include tokens, keys or passwords. */
  readonly metadata?: Schema.Json;
  /** Stream this row belongs to. System writes are MDM by default. */
  readonly category?: AuditCategory;
  /** Internal device row; lets the device page and filters bind the event. */
  readonly deviceId?: string | null;
  readonly protocol?: AuditProtocol;
  /** Verified client address; the caller applies the trust policy. */
  readonly ip?: string | null;
  readonly userAgent?: string | null;
  /** SHA-256 hex of the mTLS identity certificate. Never the PEM. */
  readonly certificateFingerprint?: string | null;
  readonly certificateSerial?: string | null;
  /**
   * Who on the device reported: an Apple user-channel id on a Shared iPad or
   * Mac login. Part of the check-in fold key, so two users never share a row.
   */
  readonly principalId?: string | null;
  /**
   * Fold repeats of this action for the same target into the current bucket.
   * Only check-ins should set this.
   */
  readonly coalesce?: boolean;
};

/**
 * Optional outbound webhook context. Audit writes still succeed when no
 * `AUTH_SECRET` is available (for example audit-only tests): delivery is
 * simply skipped.
 */
export type SystemAuditOptions = {
  readonly authSecret?: string;
  readonly webhookFetch?: typeof globalThis.fetch;
  /** Disable delivery for a specific call site (tests). */
  readonly webhooks?: boolean;
  /**
   * How long a check-in bucket lasts. Defaults to 15 minutes; `0` disables
   * coalescing (every occurrence appends). Buckets are aligned to the epoch,
   * not to the first event, so a continuous poller rolls over on time.
   */
  readonly coalesceWindowMs?: number;
  /** Injectable clock for deterministic tests. */
  readonly now?: Date;
};

/**
 * Default category for a system-actor action.
 *
 * The classifier is shared by new writes, the migration backfill and its test,
 * so a row written by the protocol paths and a row backfilled from history
 * always agree. `enrollment.*` is device-facing (the answers arrive from a
 * device or its pre-registration), while Android tenant connection events and
 * background work (`script.run_*`, SCEP rotation, delivery failures) stay
 * `system`.
 */
export const defaultAuditCategory = (action: string): AuditCategory => {
  if (action.startsWith("device.") || action.startsWith("mdm.") || action.startsWith("enrollment."))
    return "mdm";

  return "system";
};

/**
 * Default fold window for device check-ins.
 *
 * Fifteen minutes matches the normal Apple/Windows poll cadence with room for
 * retries, so a fleet check-in storm becomes one row per device per window
 * instead of one row per request. State changes are never coalesced.
 */
export const DEFAULT_AUDIT_CHECKIN_COALESCE_WINDOW_MS = 15 * 60 * 1_000;

/**
 * Fixed start of the bucket containing `at`.
 *
 * Coalescing must not slide: if the stored timestamp moved on every fold, a
 * continuously checking-in device would keep one row forever. The bucket start
 * is derived from the wall clock instead, so a device produces at most one
 * check-in row per window. Timestamps are therefore stable per row and may
 * repeat across a principal/identity split in the same bucket; keyset
 * pagination already breaks ties on `(createdAt, id)`, and retention measures
 * the bucket (at most one window behind the event), not the last fold.
 */
export const auditCoalesceBucketStart = (at: Date, windowMs: number): Date =>
  new Date(Math.floor(at.getTime() / windowMs) * windowMs);

/** Maximum length of each stored audit string. Matches the schema columns. */
const AUDIT_TEXT_LIMITS = {
  ip: 64,
  userAgent: 512,
  certificateFingerprint: 64,
  certificateSerial: 128,
} as const;

const bound = (value: string | null | undefined, limit: number): string | null => {
  const text = value?.trim();

  return text ? text.slice(0, limit) : null;
};

const id = () => `sys_${crypto.randomUUID().replaceAll("-", "").slice(0, 21)}`;

const jsonObject = (value: Schema.Json | null | undefined): Schema.JsonObject =>
  Schema.is(Schema.JsonObject)(value) ? value : {};

const stringArray = (value: Schema.Json | undefined): ReadonlyArray<string> =>
  Array.isArray(value)
    ? value.filter((item): item is string => Schema.is(Schema.String)(item)).slice(0, 4)
    : [];

const checkInCount = (metadata: Schema.JsonObject): number => {
  const value = metadata["checkIns"];

  return Schema.is(Schema.Number)(value) && Number.isFinite(value) && value > 0
    ? Math.min(Math.trunc(value), Number.MAX_SAFE_INTEGER - 1)
    : 1;
};

/**
 * Build the metadata for the first occurrence of a folded check-in. The row's
 * `createdAt` is the bucket start, so the actual first event time lives here.
 */
const initialCheckInMetadata = (
  metadata: Schema.Json | undefined,
  now: Date,
): Schema.JsonObject => {
  const next = jsonObject(metadata);
  const channels = stringArray(next["channels"]);

  return {
    ...next,
    firstSeenAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    checkIns: 1,
    ...(channels.length > 0 ? { channels } : {}),
  };
};

/**
 * Build the metadata for a folded check-in. The row describes the latest
 * occurrence; `firstSeenAt` keeps when the bucket's first check-in happened and
 * `channels` accumulates every channel (Apple device/user, Windows, Android)
 * that reported into it.
 */
const coalescedMetadata = (input: {
  readonly existing: Schema.Json | null | undefined;
  readonly existingCreatedAt: Date;
  readonly next: Schema.Json | undefined;
  readonly now: Date;
  readonly incomingChannels: ReadonlyArray<string>;
}): Schema.JsonObject => {
  const existing = jsonObject(input.existing);
  const next = jsonObject(input.next);

  const channels = [
    ...new Set([...stringArray(existing["channels"]), ...input.incomingChannels]),
  ].slice(0, 4);

  const firstSeenAt = Schema.is(Schema.String)(existing["firstSeenAt"])
    ? existing["firstSeenAt"]
    : input.existingCreatedAt.toISOString();

  return {
    ...next,
    firstSeenAt,
    lastSeenAt: input.now.toISOString(),
    checkIns: checkInCount(existing) + 1,
    ...(channels.length > 0 ? { channels } : {}),
  };
};

/** `col = value`, or `col IS NULL` when the fold key is absent. */
const sameOrAbsent = (column: AnyColumn, value: string | null | undefined): SQL =>
  value === null || value === undefined ? sql`${column} is null` : eq(column, value);

/**
 * Write a tenant-scoped audit row without a request context.
 *
 * Device protocol paths must never fail because audit storage is unavailable,
 * so write errors are logged and swallowed. Callers should still `yield*` the
 * effect when ordering matters for tests/telemetry.
 *
 * Coalescing is one extra read on the check-in paths only. The fold key is the
 * organisation, action, target, system actor, **fixed time bucket**, device
 * principal and presenting identity (certificate fingerprint/serial and IP).
 * A continuous check-in therefore produces one row per bucket, two users on
 * one device never share a row, and a certificate or address change starts a
 * new row instead of being hidden by the old one.
 */
export const writeSystemAudit = (
  db: Db["Service"],
  event: SystemAuditEvent,
  options: SystemAuditOptions = {},
) =>
  Effect.gen(function* () {
    const now = options.now ?? new Date();
    const window = options.coalesceWindowMs ?? DEFAULT_AUDIT_CHECKIN_COALESCE_WINDOW_MS;

    const coalesceTargetId =
      event.coalesce === true && window > 0 && event.targetId ? event.targetId : null;

    const bucketStart = coalesceTargetId === null ? now : auditCoalesceBucketStart(now, window);

    const ip = bound(event.ip, AUDIT_TEXT_LIMITS.ip);

    const certificateFingerprint = bound(
      event.certificateFingerprint?.toLowerCase(),
      AUDIT_TEXT_LIMITS.certificateFingerprint,
    );

    const certificateSerial = bound(
      event.certificateSerial?.toLowerCase(),
      AUDIT_TEXT_LIMITS.certificateSerial,
    );

    const principalId = bound(event.principalId, 255);

    const values = {
      organizationId: event.organizationId,
      actorAccountId: null,
      actorEmail: SYSTEM_AUDIT_ACTOR,
      actorType: "system" as const,
      category: event.category ?? defaultAuditCategory(event.action),
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId ?? null,
      metadata: event.metadata === undefined ? null : event.metadata,
      ip,
      userAgent: bound(event.userAgent, AUDIT_TEXT_LIMITS.userAgent),
      deviceId: event.deviceId ?? null,
      deviceCertificateFingerprint: certificateFingerprint,
      deviceCertificateSerial: certificateSerial,
      protocol: event.protocol ?? null,
      principalId,
      createdAt: bucketStart,
    };

    const previous =
      coalesceTargetId !== null
        ? (yield* db
            .select()
            .from(s.auditLog)
            .where(
              and(
                eq(s.auditLog.organizationId, event.organizationId),
                eq(s.auditLog.action, event.action),
                eq(s.auditLog.targetType, event.targetType),
                eq(s.auditLog.targetId, coalesceTargetId),
                eq(s.auditLog.actorType, "system"),
                // The exact bucket, not a moving window: a device that keeps
                // checking in rolls over to a new row when the bucket ends.
                eq(s.auditLog.createdAt, bucketStart),
                sameOrAbsent(s.auditLog.principalId, principalId),
                sameOrAbsent(s.auditLog.deviceCertificateFingerprint, certificateFingerprint),
                sameOrAbsent(s.auditLog.deviceCertificateSerial, certificateSerial),
                sameOrAbsent(s.auditLog.ip, ip),
              ),
            )
            .orderBy(desc(s.auditLog.id))
            .limit(1))[0]
        : undefined;

    if (previous) {
      const previousMetadata = Option.getOrUndefined(
        Schema.decodeUnknownOption(Schema.Json)(previous.metadata),
      );

      yield* db
        .update(s.auditLog)
        .set({
          ...values,
          metadata: coalescedMetadata({
            existing: previousMetadata,
            existingCreatedAt: previous.createdAt,
            next: event.metadata,
            now,
            incomingChannels: stringArray(jsonObject(event.metadata)["channels"]),
          }),
        })
        .where(eq(s.auditLog.id, previous.id));
    } else {
      yield* db.insert(s.auditLog).values({
        id: id(),
        ...values,
        metadata:
          coalesceTargetId === null ? values.metadata : initialCheckInMetadata(event.metadata, now),
      });
    }

    // Tell open dashboards which cached queries became stale. Every protocol
    // ingress already writes one of the mapped audit actions, so this is the
    // single publish point for check-ins, enrollments, command results,
    // declarations and status changes. Failed notification writes are
    // swallowed: the audit row is the record, the event is only a hint.
    yield* publishRealtimeEvent(db, {
      organizationId: event.organizationId,
      action: event.action,
      deviceId: event.deviceId,
      protocol: event.protocol,
      now,
    });

    // Device lifecycle transitions are mirrored to customer webhooks. Only
    // mapped actions are delivered; dispatch swallows every failure so audit
    // writes and device protocol requests keep working when an endpoint is
    // down or the deployment has no signing secret.
    const webhookEvent = webhookEventForAuditAction(event.action);

    if (!webhookEvent || !options.authSecret || options.webhooks === false) return;

    const metadata: Schema.JsonObject = Schema.is(Schema.JsonObject)(event.metadata)
      ? event.metadata
      : event.metadata === undefined
        ? {}
        : { metadata: event.metadata };

    yield* dispatchWebhookEvent(
      db,
      {
        organizationId: event.organizationId,
        type: webhookEvent,
        data: Object.assign(
          { targetType: event.targetType, targetId: event.targetId ?? null },
          metadata,
        ),
      },
      { authSecret: options.authSecret, fetch: options.webhookFetch },
    );
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning(`Failed to write system audit event ${event.action}: ${String(cause)}`),
    ),
  );

const normalizeEnum = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();

/**
 * Apple reports declarations as valid/invalid/unknown. Only a transition into
 * a failure state is interesting; repeated status reports must stay quiet.
 */
export const isDeclarationFailure = (valid: string | null | undefined) => {
  const value = normalizeEnum(valid);

  return value === "invalid" || value === "failed" || value === "error";
};

export const declarationFailedTransition = (
  previousValid: string | null | undefined,
  nextValid: string | null | undefined,
) => isDeclarationFailure(nextValid) && !isDeclarationFailure(previousValid);

/**
 * APNs only flags a token as invalid once it has been rejected. A later failed
 * delivery that is not a token rejection must not repeat the event, and a
 * recovered token re-arms it.
 */
export const pushInvalidTokenTransition = (
  previousCode: string | null | undefined,
  nextCode: string | null | undefined,
) => nextCode === "invalid_token" && previousCode !== "invalid_token";

/**
 * Commands move queued -> sent -> deferred/failed. Record the first time a
 * command reports a deferred/terminal state so check-in retries do not spam.
 */
export const commandFailureTransition = (
  previousStatus: string | null | undefined,
  nextStatus: string | null | undefined,
) => (nextStatus === "failed" || nextStatus === "deferred") && previousStatus !== nextStatus;

/**
 * A bounded, redacted reason for a failed MDM request.
 *
 * Fault messages can echo device payloads. This strips PEM blocks and long
 * opaque runs (certificates, tokens, base64 bodies), collapses whitespace and
 * caps the result, so a failure row is useful without becoming a secret leak.
 */
export const describeAuditFailure = (message: string, limit = 300): string =>
  message
    .replaceAll(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, "[redacted]")
    .replaceAll(/\b[A-Za-z0-9+/=_-]{64,}\b/g, "[redacted]")
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, limit);
