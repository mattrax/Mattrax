import { Schema } from "effect";

/**
 * Realtime invalidation events.
 *
 * The dashboard does not mirror MDM state in the browser; it caches it with
 * TanStack Query. A device check-in, enrollment, command result or declaration
 * status change therefore only needs to tell open tabs which queries became
 * stale. This module owns the wire shape, the audit-action mapping, cursor
 * parsing and the invalidation scopes, so the API, the MDM backends and the web
 * client agree on one vocabulary.
 */

export const REALTIME_EVENT_KINDS = [
  /** A device presented a check-in (Apple device/user, Windows, Android). */
  "device.checkin",
  /** A device completed enrollment. */
  "device.enrolled",
  /** A device was unenrolled or deleted. */
  "device.unenrolled",
  /** Setup Assistant, checkout or Return to Service lifecycle transition. */
  "device.lifecycle",
  /** A remote command reached a terminal, deferred or failed state. */
  "device.command",
  /** A declaration became invalid (Apple DDM). */
  "device.declaration",
  /** Inventory, compliance or declaration status was reported. */
  "device.status",
  /** Policy or declaration content was delivered. */
  "device.policy",
  /** A device-scoped management request failed. */
  "device.failure",
] as const;

export type RealtimeEventKind = (typeof REALTIME_EVENT_KINDS)[number];

export const RealtimeEventKind: Schema.Codec<RealtimeEventKind> =
  Schema.Literals(REALTIME_EVENT_KINDS);

export const REALTIME_PROTOCOLS = ["apple", "win", "android"] as const;

export type RealtimeProtocol = (typeof REALTIME_PROTOCOLS)[number];

export const RealtimeProtocol: Schema.Codec<RealtimeProtocol> = Schema.Literals(REALTIME_PROTOCOLS);

/**
 * Which cached query families an event invalidates.
 *
 * The client maps these to concrete `enterpriseKeys`; keeping the scopes in the
 * domain layer means a new event kind cannot silently forget the fleet summary
 * or the device activity feed.
 */
export const REALTIME_INVALIDATION_SCOPES = [
  /** One device's detail, health, commands, declarations and policy. */
  "device",
  /** Tenant-wide device lists, health rollup and dashboard queries. */
  "fleet",
  /** Activity feeds and the tenant audit search. */
  "activity",
  /** Remote command history (part of the device detail prefix). */
  "commands",
  /** Declaration and effective-policy views. */
  "declarations",
  /** Enrollment attempts and pre-registrations. */
  "enrollment",
] as const;

export type RealtimeInvalidationScope = (typeof REALTIME_INVALIDATION_SCOPES)[number];

/**
 * The audit actions written by the Apple, Windows and Android ingress paths.
 *
 * Publishing is driven from `writeSystemAudit`, which is the one write every
 * protocol already performs for each of these transitions. That keeps the
 * publish points in the shared backend rather than duplicating a hook into
 * every route.
 */
const AUDIT_ACTION_KINDS = new Map<string, RealtimeEventKind>([
  ["mdm.checkin", "device.checkin"],

  ["device.enrolled", "device.enrolled"],
  ["device.unenrolled", "device.unenrolled"],
  ["device.deleted", "device.unenrolled"],

  ["device.awaiting_setup", "device.lifecycle"],
  ["device.setup_complete", "device.lifecycle"],
  ["device.checked_out", "device.lifecycle"],
  ["device.return_to_service_requested", "device.lifecycle"],
  ["device.return_to_service_completed", "device.lifecycle"],
  ["device.push_invalid_token", "device.failure"],

  ["device.command_failed", "device.command"],
  ["device.command_not_now", "device.command"],
  ["mdm.command_result", "device.command"],

  ["device.declaration_invalid", "device.declaration"],

  ["mdm.status_report", "device.status"],
  ["device.compliance_changed", "device.status"],

  ["mdm.policy_delivered", "device.policy"],

  ["mdm.failure", "device.failure"],
]);

/** The event kind for an audit action, or undefined for unrelated actions. */
export const realtimeKindForAuditAction = (action: string): RealtimeEventKind | undefined =>
  AUDIT_ACTION_KINDS.get(action);

const SCOPES_BY_KIND: Readonly<
  Record<RealtimeEventKind, ReadonlyArray<RealtimeInvalidationScope>>
> = {
  "device.checkin": ["device", "fleet", "activity"],
  "device.enrolled": ["device", "fleet", "activity", "enrollment"],
  "device.unenrolled": ["device", "fleet", "activity"],
  "device.lifecycle": ["device", "fleet", "activity"],
  "device.command": ["device", "commands", "activity"],
  "device.declaration": ["device", "declarations"],
  "device.status": ["device", "declarations", "fleet"],
  "device.policy": ["device", "declarations"],
  "device.failure": ["device", "fleet", "activity"],
};

export const invalidationScopesForKind = (
  kind: RealtimeEventKind,
): ReadonlyArray<RealtimeInvalidationScope> => SCOPES_BY_KIND[kind];

/**
 * One notification sent to the browser.
 *
 * Deliberately minimal: a kind, the device it concerns and the protocol. Audit
 * metadata (reasons, actors, addresses, certificate hashes, user agents) never
 * crosses this boundary, and there is no free-form payload to leak a secret
 * through.
 */
export type RealtimeEvent = {
  /** Monotonic cursor; also the SSE `id:` field. */
  readonly seq: number;
  readonly kind: RealtimeEventKind;
  readonly deviceId: string | null;
  readonly protocol: RealtimeProtocol | null;
  readonly at: string;
};

// SAFETY: `Schema.Struct` for this field set produces exactly the declared
// shape, the same annotation pattern the audit schemas use.
export const RealtimeEvent: Schema.Codec<RealtimeEvent> = Schema.Struct({
  seq: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  kind: RealtimeEventKind,
  deviceId: Schema.NullOr(Schema.String),
  protocol: Schema.NullOr(RealtimeProtocol),
  at: Schema.String,
}) as Schema.Codec<RealtimeEvent>;

/**
 * The stored append-only row, before shaping.
 *
 * `seq` is a `mode: "number"` bigint column, so Drizzle hands back a JS
 * number. Runs are individually readable; a connection cursor is never
 * compared beyond a safe integer.
 */
export type RealtimeEventRow = {
  readonly seq: number | null | undefined;
  readonly kind: string | null | undefined;
  readonly deviceId?: string | null;
  readonly protocol?: string | null;
  readonly createdAt: Date | string;
};

const protocolOf = (value: string | null | undefined): RealtimeProtocol | null =>
  value === "apple" || value === "win" || value === "android" ? value : null;

const kindOf = (value: string | null | undefined): RealtimeEventKind | undefined =>
  REALTIME_EVENT_KINDS.find((kind) => kind === value);

const isoOf = (value: Date | string): string | null => {
  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/**
 * Shape a stored row into the wire event.
 *
 * Every field is copied explicitly, so a future column (an actor, a reason, a
 * certificate hash) cannot start streaming because it happened to sit on the
 * row. Returns undefined for rows that predate a kind or cannot be decoded.
 */
export const realtimeEventFromRow = (row: RealtimeEventRow): RealtimeEvent | undefined => {
  const kind = kindOf(row.kind);

  if (!kind) return undefined;

  const seq = row.seq;

  if (seq === null || seq === undefined || !Number.isSafeInteger(seq) || seq < 0) return undefined;

  const at = isoOf(row.createdAt);

  if (!at) return undefined;

  return {
    seq,
    kind,
    deviceId: row.deviceId ?? null,
    protocol: protocolOf(row.protocol),
    at,
  };
};

/**
 * The minimal insert an audit write contributes. Kept next to the shaping rule
 * so the columns written and the fields streamed cannot drift apart.
 */
export type RealtimeEventInsert = {
  readonly kind: RealtimeEventKind;
  readonly deviceId: string | null;
  readonly protocol: RealtimeProtocol | null;
};

export const realtimeEventInsertForAudit = (input: {
  readonly action: string;
  readonly deviceId?: string | null;
  readonly protocol?: string | null;
}): RealtimeEventInsert | undefined => {
  const kind = realtimeKindForAuditAction(input.action);

  if (!kind) return undefined;

  return {
    kind,
    deviceId: input.deviceId ?? null,
    protocol: protocolOf(input.protocol),
  };
};

export type RealtimeCursorResult =
  | { readonly kind: "none" }
  | { readonly kind: "valid"; readonly cursor: number }
  | { readonly kind: "invalid" };

const CURSOR_PATTERN = /^\d{1,16}$/;

/**
 * Parse one cursor source.
 *
 * Cursors are non-negative integers bounded to a JavaScript safe integer: the
 * value is compared against a `bigint` sequence, never interpolated into SQL.
 * A malformed cursor is rejected rather than treated as "start from now", so a
 * buggy client cannot silently skip an unbounded backlog.
 */
export const parseRealtimeCursor = (value: string | null | undefined): RealtimeCursorResult => {
  const trimmed = value?.trim();

  if (!trimmed) return { kind: "none" };

  if (!CURSOR_PATTERN.test(trimmed)) return { kind: "invalid" };

  const parsed = Number(trimmed);

  return Number.isSafeInteger(parsed) ? { kind: "valid", cursor: parsed } : { kind: "invalid" };
};

/**
 * Resolve the resume point. `Last-Event-ID` is what the browser sends after a
 * dropped stream; `?after=` is the explicit reconnect used by our subscriber
 * (which owns its own backoff instead of EventSource's default retry).
 */
export const realtimeCursorFrom = (input: {
  readonly header?: string | null;
  readonly query?: string | null;
}): RealtimeCursorResult => {
  const header = parseRealtimeCursor(input.header);

  if (header.kind !== "none") return header;

  return parseRealtimeCursor(input.query);
};

/** The authenticated stream path for one tenant. Shared by server and client. */
export const realtimeEventsPath = (tenantId: string): string =>
  `/api/v1/tenants/${encodeURIComponent(tenantId)}/realtime`;

export const REALTIME_SSE_CONTENT_TYPE = "text/event-stream; charset=utf-8";

/** A comment frame keeps proxies and the browser from treating the stream as idle. */
export const REALTIME_SSE_HEARTBEAT = ": keep-alive\n\n";

/**
 * Encode one event as SSE. The kind is carried in the JSON `data` rather than
 * an `event:` name so the browser needs one listener, not one per kind.
 */
export const encodeRealtimeSseEvent = (event: RealtimeEvent): string =>
  `id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`;
