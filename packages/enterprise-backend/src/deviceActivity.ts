import { Option, Schema } from "effect";
import {
  EnterpriseBadRequest,
  deviceCommandStatusLabel,
  normalizeDeviceCommandStatus,
  type DeviceActivityEntry,
} from "@mattrax/enterprise-domain";

export const DEVICE_ACTIVITY_DEFAULT_LIMIT = 50;
export const DEVICE_ACTIVITY_MAX_LIMIT = 200;

/**
 * Coerce the `limit` query parameter. The HTTP layer forwards query strings
 * verbatim in some clients, so accept numeric strings as well as numbers.
 */
const NumericLimit = Schema.Union([Schema.Finite, Schema.FiniteFromString]);

export const normalizeDeviceActivityLimit = (value: number | string | undefined) => {
  const parsed = Option.getOrUndefined(Schema.decodeUnknownOption(NumericLimit)(value));

  return Math.min(
    Math.max(parsed === undefined ? DEVICE_ACTIVITY_DEFAULT_LIMIT : Math.trunc(parsed), 1),
    DEVICE_ACTIVITY_MAX_LIMIT,
  );
};

const iso = (value: Date | string | null | undefined) => {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/** Event id prefixes. Their lexicographic order is the merged tiebreaker. */
export const DEVICE_ACTIVITY_AUDIT_PREFIX = "audit:";
export const DEVICE_ACTIVITY_COMMAND_PREFIX = "command:";

/**
 * Keyset position in the merged feed. `id` is the full event id, so the cursor
 * is self-contained and never depends on how many sources contributed.
 */
export type DeviceActivityCursor = {
  readonly at: Date;
  readonly id: string;
};

const base64UrlEncode = (value: string) => {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

const base64UrlDecode = (value: string) => {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));

  return new TextDecoder().decode(bytes);
};

export const encodeDeviceActivityCursor = (cursor: DeviceActivityCursor) =>
  base64UrlEncode(JSON.stringify({ c: cursor.at.toISOString(), i: cursor.id }));

const DeviceActivityCursorPayload = Schema.Struct({
  c: Schema.optional(Schema.String),
  i: Schema.optional(Schema.String),
});

/** Decode an opaque cursor, rejecting anything this endpoint did not mint. */
export const decodeDeviceActivityCursor = (raw: string): DeviceActivityCursor => {
  try {
    const parsed = Option.getOrUndefined(
      Schema.decodeUnknownOption(DeviceActivityCursorPayload)(JSON.parse(base64UrlDecode(raw))),
    );

    if (parsed?.c !== undefined && parsed.i !== undefined) {
      const at = new Date(parsed.c);

      if (!Number.isNaN(at.getTime()) && parsed.i.length > 0) return { at, id: parsed.i };
    }
  } catch {
    // Fall through to the shared validation error.
  }

  throw new EnterpriseBadRequest({ message: "cursor is invalid" });
};

/**
 * Restrict a database source to rows older than the cursor. A source is keyed
 * by its event timestamp (`createdAt` for audits, `updatedAt` for commands)
 * and ordered `(timestamp desc, id desc)`, matching the merged feed.
 *
 * Event ids start with their source prefix, so the tiebreaker comparison needs
 * the prefix too: when the cursor came from another source, every row of this
 * source at that instant is either entirely before or entirely after it.
 */
export type DeviceActivitySourceKeyset =
  | { readonly at: Date; readonly sameInstant: "all" | "none" }
  | { readonly at: Date; readonly beforeId: string };

export const deviceActivitySourceKeyset = (
  cursor: DeviceActivityCursor,
  prefix: string,
): DeviceActivitySourceKeyset => {
  if (cursor.id.startsWith(prefix))
    return { at: cursor.at, beforeId: cursor.id.slice(prefix.length) };

  const separator = cursor.id.indexOf(":");
  const cursorPrefix = separator === -1 ? cursor.id : cursor.id.slice(0, separator + 1);

  return { at: cursor.at, sameInstant: prefix < cursorPrefix ? "all" : "none" };
};

/** True when an event sorts strictly after (older than) the cursor. */
const afterCursor = (event: DeviceActivityEntry, cursor: DeviceActivityCursor) => {
  const at = Date.parse(event.at);
  const cursorAt = cursor.at.getTime();

  return at < cursorAt || (at === cursorAt && event.id < cursor.id);
};

type AuditRow = {
  readonly id: string;
  readonly action: string;
  readonly actorEmail?: string | null;
  readonly metadata?: Schema.Json;
  readonly createdAt: Date | string;
};

type CommandRow = {
  readonly id: string;
  readonly requestType: string;
  readonly status: string;
  readonly resultStatus?: string | null;
  readonly resultDetail?: string | null;
  readonly createdAt: Date | string;
  readonly updatedAt: Date | string;
  readonly expiresAt?: Date | string | null;
};

type DeclarationRow = {
  readonly identifier: string;
  readonly declarationType: string;
  readonly active: boolean;
  readonly valid: string;
  readonly updatedAt: Date | string;
};

type CertificateRow = {
  readonly serial: string;
  readonly notAfter: Date | string;
  readonly revokedAt?: Date | string | null;
  readonly createdAt: Date | string;
};

type DeviceLifecycle = {
  readonly enrolledAt: Date | string;
  readonly lastSeenAt: Date | string;
  readonly inventoryUpdatedAt?: Date | string | null;
};

export type DeviceActivityInputs = {
  readonly audits: ReadonlyArray<AuditRow>;
  readonly commands: ReadonlyArray<CommandRow>;
  readonly declarations: ReadonlyArray<DeclarationRow>;
  readonly certificates: ReadonlyArray<CertificateRow>;
  readonly device: DeviceLifecycle;
};

const AUDIT_TITLES = {
  "device.updated": "Device details updated",
  "device.action": "Remote action requested",
  "device.unenrolled": "Device unenrolled",
  "device.identity_revoked": "Identity certificates revoked",
  "device.deleted": "Device deleted",
  "device_pre_registration.imported": "Enrollment pre-registration imported",
  "device_pre_registration.updated": "Enrollment pre-registration updated",
} satisfies Record<string, string>;

const AUDIT_TITLE_BY_ACTION = new Map(Object.entries(AUDIT_TITLES));

const AuditMetadata = Schema.Record(Schema.String, Schema.Json);

const trimmed = (value: Schema.Json | null | undefined, limit = 200) => {
  const text = Option.getOrUndefined(Schema.decodeUnknownOption(Schema.String)(value));

  if (text === undefined) return null;
  const normalized = text.replace(/\s+/g, " ").trim();

  return normalized ? normalized.slice(0, limit) : null;
};

/**
 * Build a short, safe audit detail. Only known metadata fields are surfaced;
 * the raw JSON is never echoed so a future audit payload cannot leak a secret
 * into the device timeline.
 */
const auditDetail = (row: AuditRow) => {
  const metadata: Schema.Schema.Type<typeof AuditMetadata> = Option.getOrElse(
    Schema.decodeUnknownOption(AuditMetadata)(row.metadata),
    () => ({}),
  );

  const parts: string[] = [];
  const action = trimmed(metadata.action, 40);

  if (action) parts.push(`Action: ${action}`);

  const rawFields = metadata.fields;

  if (Array.isArray(rawFields)) {
    const fields = rawFields.flatMap((field) => {
      const text = Schema.decodeUnknownOption(Schema.String)(field);

      return Option.isSome(text) ? [text.value] : [];
    });

    if (fields.length > 0) parts.push(`Fields: ${fields.slice(0, 8).join(", ")}`);
  }

  const revokedCertificates = Option.getOrUndefined(
    Schema.decodeUnknownOption(Schema.Number)(metadata.revokedCertificates),
  );

  if (revokedCertificates !== undefined)
    parts.push(`${revokedCertificates} certificate(s) revoked`);
  const actor = trimmed(row.actorEmail, 120);

  if (actor) parts.push(`by ${actor}`);

  return parts.length > 0 ? parts.join(" · ") : null;
};

/**
 * Merge the device-scoped sources into one newest-first feed. Kept pure so the
 * ordering, limit and redaction rules are unit tested without a database.
 *
 * A cursor restricts the result to events strictly older than the keyset
 * position, so the HTTP layer can fetch one bounded window per source instead
 * of re-reading everything above the page.
 */
export const buildDeviceActivity = (
  inputs: DeviceActivityInputs,
  limit = DEVICE_ACTIVITY_DEFAULT_LIMIT,
  cursor?: DeviceActivityCursor,
): Array<DeviceActivityEntry> => {
  const events: Array<DeviceActivityEntry> = [];

  for (const row of inputs.audits) {
    const at = iso(row.createdAt);

    if (!at) continue;
    events.push({
      id: `${DEVICE_ACTIVITY_AUDIT_PREFIX}${row.id}`,
      kind: "audit",
      title: AUDIT_TITLE_BY_ACTION.get(row.action) ?? row.action,
      detail: auditDetail(row),
      status: null,
      at,
    });
  }

  for (const row of inputs.commands) {
    const at = iso(row.updatedAt) ?? iso(row.createdAt);

    if (!at) continue;

    const status = normalizeDeviceCommandStatus(row.status);

    const result = [trimmed(row.resultStatus, 80), trimmed(row.resultDetail, 160)]
      .filter(Boolean)
      .join(": ");

    const deadline = iso(row.expiresAt);

    events.push({
      id: `${DEVICE_ACTIVITY_COMMAND_PREFIX}${row.id}`,
      kind: "command",
      title: `Command: ${row.requestType}`,
      // The timeline shows the human lifecycle, not the stored column value.
      detail: result || (deadline ? `Deadline ${deadline}` : null),
      status: deviceCommandStatusLabel(status),
      at,
    });
  }

  for (const row of inputs.declarations) {
    const at = iso(row.updatedAt);

    if (!at) continue;
    events.push({
      id: `declaration:${row.identifier}`,
      kind: "declaration",
      title: `Declaration ${row.identifier}`,
      detail: `${row.declarationType} · ${row.active ? "active" : "inactive"}`,
      status: row.valid,
      at,
    });
  }

  for (const row of inputs.certificates) {
    const issuedAt = iso(row.createdAt);

    if (issuedAt)
      events.push({
        id: `certificate:${row.serial}:issued`,
        kind: "certificate",
        title: "Identity certificate issued",
        detail: `Serial ${row.serial}`,
        status: "issued",
        at: issuedAt,
      });
    const revokedAt = iso(row.revokedAt);

    if (revokedAt)
      events.push({
        id: `certificate:${row.serial}:revoked`,
        kind: "certificate",
        title: "Identity certificate revoked",
        detail: `Serial ${row.serial}`,
        status: "revoked",
        at: revokedAt,
      });
  }

  const lifecycle: Array<[string, string, Date | string | null | undefined]> = [
    ["enrolled", "Device enrolled", inputs.device.enrolledAt],
    ["last-seen", "Last check-in", inputs.device.lastSeenAt],
    ["inventory", "Inventory updated", inputs.device.inventoryUpdatedAt],
  ];

  for (const [key, title, value] of lifecycle) {
    const at = iso(value);

    if (at)
      events.push({
        id: `lifecycle:${key}`,
        kind: "lifecycle",
        title,
        detail: null,
        status: null,
        at,
      });
  }

  return events
    .filter((event) => cursor === undefined || afterCursor(event, cursor))
    .sort((left, right) => {
      const delta = Date.parse(right.at) - Date.parse(left.at);

      if (delta !== 0) return delta;

      // The id is the deterministic tiebreaker and part of the keyset cursor.
      return left.id < right.id ? 1 : left.id > right.id ? -1 : 0;
    })
    .slice(0, limit);
};

export type DeviceActivityPage = {
  readonly events: Array<DeviceActivityEntry>;
  readonly hasMore: boolean;
  readonly nextCursor?: string;
};

/**
 * Slice one newest-first page out of the merged feed. The caller supplies a
 * bounded window per database source (one extra row to detect `hasMore`), so
 * this function only merges, filters in-memory sources by the cursor and
 * encodes the position of the last returned event.
 */
export const deviceActivityPage = (
  inputs: DeviceActivityInputs,
  options: { readonly limit: number; readonly cursor?: DeviceActivityCursor },
): DeviceActivityPage => {
  const { limit, cursor } = options;

  // One extra entry tells us whether an older page exists.
  const window = buildDeviceActivity(inputs, limit + 1, cursor);
  const events = window.slice(0, limit);
  const last = events.at(-1);

  if (window.length <= limit || !last) return { events, hasMore: false };

  return {
    events,
    hasMore: true,
    nextCursor: encodeDeviceActivityCursor({ at: new Date(last.at), id: last.id }),
  };
};
