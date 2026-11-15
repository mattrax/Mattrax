import { Option, Schema } from "effect";
import {
  deviceCommandStatusLabel,
  normalizeDeviceCommandStatus,
  type DeviceActivityEntry,
} from "@mattrax/enterprise-domain";

export const DEVICE_ACTIVITY_DEFAULT_LIMIT = 50;
export const DEVICE_ACTIVITY_MAX_LIMIT = 200;

/**
 * Deepest offset the merged feed serves. Each page re-merges the sources from
 * the top, so the cap keeps that window bounded for deliberate deep paging.
 */
export const DEVICE_ACTIVITY_MAX_OFFSET = 5_000;

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

/** Coerce the newest-first page offset; negative and non-numeric values start at 0. */
export const normalizeDeviceActivityOffset = (value: number | string | undefined) => {
  const parsed = Option.getOrUndefined(Schema.decodeUnknownOption(NumericLimit)(value));

  return Math.min(
    Math.max(parsed === undefined ? 0 : Math.trunc(parsed), 0),
    DEVICE_ACTIVITY_MAX_OFFSET,
  );
};

const iso = (value: Date | string | null | undefined) => {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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
 */
export const buildDeviceActivity = (
  inputs: DeviceActivityInputs,
  limit = DEVICE_ACTIVITY_DEFAULT_LIMIT,
): Array<DeviceActivityEntry> => {
  const events: Array<DeviceActivityEntry> = [];

  for (const row of inputs.audits) {
    const at = iso(row.createdAt);

    if (!at) continue;
    events.push({
      id: `audit:${row.id}`,
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
      id: `command:${row.id}`,
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
    .sort((left, right) => {
      const delta = Date.parse(right.at) - Date.parse(left.at);

      return delta !== 0 ? delta : left.id.localeCompare(right.id);
    })
    .slice(0, limit);
};

export type DeviceActivityPage = {
  readonly events: Array<DeviceActivityEntry>;
  readonly hasMore: boolean;
};

/**
 * Slice one newest-first page out of the merged feed. The sources are merged
 * from the top because a page can contain events from any of them; `hasMore`
 * is false once the page reaches `DEVICE_ACTIVITY_MAX_OFFSET`.
 */
export const deviceActivityPage = (
  inputs: DeviceActivityInputs,
  options: { readonly limit: number; readonly offset: number },
): DeviceActivityPage => {
  const { limit, offset } = options;

  if (offset >= DEVICE_ACTIVITY_MAX_OFFSET) return { events: [], hasMore: false };

  // One extra entry tells us whether an older page exists.
  const window = buildDeviceActivity(inputs, offset + limit + 1);

  return {
    events: window.slice(offset, offset + limit),
    hasMore: window.length > offset + limit && offset + limit < DEVICE_ACTIVITY_MAX_OFFSET,
  };
};
