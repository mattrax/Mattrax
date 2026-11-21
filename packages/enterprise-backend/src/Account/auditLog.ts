import { Option, Schema } from "effect";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_CATEGORIES,
  AUDIT_PROTOCOLS,
  EnterpriseBadRequest,
} from "@mattrax/enterprise-domain";
import type { AuditSearchQuery } from "@mattrax/enterprise-domain";
import { and, desc, eq, gte, like, lt, lte, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { EnterpriseSchema } from "../schema.ts";
import { toCsv } from "../Device/deviceSearch.ts";

export const AUDIT_SEARCH_DEFAULT_LIMIT = 50;

export const AUDIT_SEARCH_MAX_LIMIT = 200;

/** Hard ceiling for audit exports so a bad request cannot buffer all history. */
export const AUDIT_EXPORT_MAX_ROWS = 10_000;

/** Actor key used for events written without a request context. */
export const SYSTEM_AUDIT_ACTOR = "system";

export type AuditCursor = {
  readonly createdAt: Date;
  readonly id: string;
};

export type DecodedAuditCursor =
  | { readonly kind: "keyset"; readonly createdAt: Date; readonly id: string }
  | { readonly kind: "offset"; readonly offset: number };

export type AuditSearchFilters = {
  readonly action?: string;
  readonly actor?: string;
  readonly actorType?: (typeof AUDIT_ACTOR_TYPES)[number];
  readonly category?: (typeof AUDIT_CATEGORIES)[number];
  readonly targetType?: string;
  readonly targetId?: string;
  readonly deviceId?: string;
  readonly protocol?: (typeof AUDIT_PROTOCOLS)[number];
  /** Free-text match across the identifying columns. */
  readonly q?: string;
  readonly from?: Date;
  readonly to?: Date;
  readonly limit: number;
  readonly offset: number;
  /** Keyset position. Offset cursors are folded into `offset`. */
  readonly cursor?: AuditCursor;
  /** True when the caller is continuing with the legacy offset parameter. */
  readonly offsetPaging: boolean;
};

const NumericQueryValue = Schema.Union([Schema.Finite, Schema.FiniteFromString]);

const integer = (value: number | string | undefined, fallback: number) => {
  const parsed = Option.getOrUndefined(Schema.decodeUnknownOption(NumericQueryValue)(value));

  return parsed === undefined ? fallback : Math.trunc(parsed);
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

const optionalText = (value: string | undefined, field: string) => {
  const text = value?.trim();

  if (!text) return undefined;

  if (text.length > 255)
    throw new EnterpriseBadRequest({ message: `${field} must be 255 characters or fewer` });

  return text;
};

const parseTimestamp = (value: string | undefined, field: string) => {
  if (!value) return undefined;
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime()))
    throw new EnterpriseBadRequest({ message: `${field} must be an ISO timestamp` });

  return parsed;
};

/**
 * Validate a low-cardinality filter against the published enum. An unknown
 * value is a client error rather than an empty result: it usually means a typo
 * or a dashboard sending a stale value.
 */
const optionalEnum = <const Values extends ReadonlyArray<string>>(
  value: string | undefined,
  field: string,
  values: Values,
): Values[number] | undefined => {
  const text = value?.trim();

  if (!text) return undefined;

  // SAFETY: `values` is a readonly tuple of string literals; widening it only
  // lets `includes` accept the arbitrary client string before membership is
  // checked below.
  if (!(values as ReadonlyArray<string>).includes(text))
    throw new EnterpriseBadRequest({
      message: `${field} must be one of ${values.join(", ")}`,
    });

  // SAFETY: the membership check above proved `text` is one of `values`.
  return text;
};

/** Escape `%`, `_` and `\` so a LIKE pattern is matched literally. */
export const escapeLike = (value: string) =>
  value
    .replaceAll("\\", String.raw`\\`)
    .replaceAll("%", String.raw`\%`)
    .replaceAll("_", String.raw`\_`);

const base64UrlEncode = (value: string) => {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

const base64UrlDecode = (value: string) => {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));

  return new TextDecoder().decode(bytes);
};

export const encodeAuditCursor = (cursor: AuditCursor) =>
  base64UrlEncode(JSON.stringify({ c: cursor.createdAt.toISOString(), i: cursor.id }));

export const encodeAuditOffsetCursor = (offset: number) =>
  base64UrlEncode(JSON.stringify({ o: Math.max(Math.trunc(offset), 0) }));

const AuditCursorPayload = Schema.Struct({
  c: Schema.optional(Schema.String),
  i: Schema.optional(Schema.String),
  o: Schema.optional(Schema.Number),
});

export const decodeAuditCursor = (raw: string): DecodedAuditCursor => {
  try {
    const parsed = Option.getOrUndefined(
      Schema.decodeUnknownOption(AuditCursorPayload)(JSON.parse(base64UrlDecode(raw))),
    );

    if (parsed?.o !== undefined && Number.isInteger(parsed.o) && parsed.o >= 0)
      return { kind: "offset", offset: parsed.o };

    if (parsed?.c !== undefined && parsed.i !== undefined) {
      const createdAt = new Date(parsed.c);

      if (!Number.isNaN(createdAt.getTime())) return { kind: "keyset", createdAt, id: parsed.i };
    }
  } catch {
    // Fall through to the shared validation error.
  }

  throw new EnterpriseBadRequest({ message: "cursor is invalid" });
};

/**
 * Normalise audit filters. Throws `EnterpriseBadRequest` for invalid dates,
 * inverted ranges and malformed cursors so HTTP callers get a 400, not 500.
 */
export const normalizeAuditSearchQuery = (query: AuditSearchQuery): AuditSearchFilters => {
  const from = parseTimestamp(query.from, "from");
  const to = parseTimestamp(query.to, "to");

  if (from && to && from.getTime() > to.getTime())
    throw new EnterpriseBadRequest({ message: "from must not be after to" });

  let cursor: AuditCursor | undefined;
  let offset = Math.max(integer(query.offset, 0), 0);
  let offsetPaging = query.offset !== undefined && !query.cursor;

  if (query.cursor) {
    const decoded = decodeAuditCursor(query.cursor);

    if (decoded.kind === "offset") {
      offset = decoded.offset;
      offsetPaging = true;
    } else {
      cursor = { createdAt: decoded.createdAt, id: decoded.id };
      offset = 0;
    }
  }

  return {
    action: optionalText(query.action, "action"),
    actor: optionalText(query.actor, "actor"),
    actorType: optionalEnum(query.actorType, "actorType", AUDIT_ACTOR_TYPES),
    category: optionalEnum(query.category, "category", AUDIT_CATEGORIES),
    targetType: optionalText(query.targetType, "targetType"),
    targetId: optionalText(query.targetId, "targetId"),
    deviceId: optionalText(query.deviceId, "deviceId"),
    protocol: optionalEnum(query.protocol, "protocol", AUDIT_PROTOCOLS),
    q: optionalText(query.q, "q"),
    from,
    to,
    limit: clamp(integer(query.limit, AUDIT_SEARCH_DEFAULT_LIMIT), 1, AUDIT_SEARCH_MAX_LIMIT),
    offset,
    cursor,
    offsetPaging,
  };
};

/**
 * Tenant-scoped WHERE clause. Action and target columns compare exactly so the
 * `(organizationId, action)` index can be used; actor and free-text target ids
 * use an escaped LIKE on indexed-prefix columns.
 *
 * Category, actor type, protocol and device are equality filters. Free text is
 * the only operator that fans out across columns; it stays inside the tenant
 * and time window, so the scan is bounded by the active filters.
 */
export const auditWhere = (
  schema: EnterpriseSchema,
  organizationId: string,
  filters: AuditSearchFilters,
): SQL => {
  const conditions: [SQL, ...Array<SQL>] = [eq(schema.auditLog.organizationId, organizationId)];

  if (filters.action) conditions.push(eq(schema.auditLog.action, filters.action));

  if (filters.category) conditions.push(eq(schema.auditLog.category, filters.category));

  if (filters.actorType) conditions.push(eq(schema.auditLog.actorType, filters.actorType));

  if (filters.protocol) conditions.push(eq(schema.auditLog.protocol, filters.protocol));

  if (filters.deviceId) conditions.push(eq(schema.auditLog.deviceId, filters.deviceId));

  if (filters.actor) {
    const pattern = `%${escapeLike(filters.actor)}%`;

    const condition = or(
      like(schema.auditLog.actorEmail, pattern),
      like(schema.auditLog.actorAccountId, pattern),
    );

    if (condition) conditions.push(condition);
  }

  if (filters.targetType) conditions.push(eq(schema.auditLog.targetType, filters.targetType));

  if (filters.targetId) {
    conditions.push(like(schema.auditLog.targetId, `%${escapeLike(filters.targetId)}%`));
  }

  if (filters.q) {
    const pattern = `%${escapeLike(filters.q)}%`;

    const condition = or(
      like(schema.auditLog.action, pattern),
      like(schema.auditLog.actorEmail, pattern),
      like(schema.auditLog.targetId, pattern),
      like(schema.auditLog.deviceId, pattern),
      like(schema.auditLog.ip, pattern),
      like(schema.auditLog.deviceCertificateFingerprint, pattern),
      like(schema.auditLog.deviceCertificateSerial, pattern),
    );

    if (condition) conditions.push(condition);
  }

  if (filters.from) conditions.push(gte(schema.auditLog.createdAt, filters.from));

  if (filters.to) conditions.push(lte(schema.auditLog.createdAt, filters.to));

  if (filters.cursor) {
    // Keyset pagination is stable even when rows share a millisecond: order by
    // (createdAt desc, id desc), so the next page starts strictly after both.
    const condition = or(
      lt(schema.auditLog.createdAt, filters.cursor.createdAt),
      and(
        eq(schema.auditLog.createdAt, filters.cursor.createdAt),
        lt(schema.auditLog.id, filters.cursor.id),
      ),
    );

    if (condition) conditions.push(condition);
  }

  return and(...conditions) ?? conditions[0];
};

/** Newest first, with the primary key as a deterministic tiebreaker. */
export const auditOrder = (schema: EnterpriseSchema) => [
  desc(schema.auditLog.createdAt),
  desc(schema.auditLog.id),
];

export type AuditExportEntry = {
  readonly id: string;
  readonly action: string;
  readonly category: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly actorAccountId: string | null;
  readonly actorEmail: string | null;
  readonly actorType: string;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly deviceId: string | null;
  readonly deviceCertificateFingerprint: string | null;
  readonly deviceCertificateSerial: string | null;
  readonly principalId: string | null;
  readonly protocol: string | null;
  readonly metadata: Schema.Json;
  readonly createdAt: string;
};

const metadataCell = (metadata: Schema.Json | null | undefined) =>
  metadata === null || metadata === undefined ? "" : JSON.stringify(metadata);

const cell = (value: string | null | undefined) => value ?? "";

/**
 * RFC 4180 CSV with spreadsheet-formula neutralisation applied by `toCsv`.
 *
 * Actor type and category make the system actor explicit (`system` is not an
 * email anyone can own). The certificate columns are a hash and serial, never
 * PEM material, and the IP is the verified client address.
 */
export const auditCsv = (entries: ReadonlyArray<AuditExportEntry>) =>
  toCsv(
    [
      "Time",
      "Actor",
      "Actor type",
      "Category",
      "Action",
      "Target type",
      "Target id",
      "Protocol",
      "Device",
      "IP",
      "Certificate fingerprint",
      "Certificate serial",
      "Principal",
      "User agent",
      "Metadata",
    ],
    entries.map((entry) => [
      entry.createdAt,
      entry.actorEmail ?? SYSTEM_AUDIT_ACTOR,
      entry.actorType,
      entry.category,
      entry.action,
      entry.targetType,
      entry.targetId,
      cell(entry.protocol),
      cell(entry.deviceId),
      cell(entry.ip),
      cell(entry.deviceCertificateFingerprint),
      cell(entry.deviceCertificateSerial),
      cell(entry.principalId),
      cell(entry.userAgent),
      metadataCell(entry.metadata),
    ]),
  );

export const auditJson = (entries: ReadonlyArray<AuditExportEntry>) =>
  `${JSON.stringify(entries, null, 2)}\n`;
