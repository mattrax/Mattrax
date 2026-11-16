import { Option, Schema } from "effect";
import { EnterpriseBadRequest, type AuditSearchQuery } from "@mattrax/enterprise-domain";
import { and, desc, eq, gte, like, lt, lte, or, type SQL } from "drizzle-orm";
import type { EnterpriseSchema } from "./schema.ts";
import { toCsv } from "./deviceSearch.ts";

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
  readonly targetType?: string;
  readonly targetId?: string;
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

/** Escape `%`, `_` and `\` so a LIKE pattern is matched literally. */
export const escapeLike = (value: string) =>
  value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");

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
    targetType: optionalText(query.targetType, "targetType"),
    targetId: optionalText(query.targetId, "targetId"),
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
 */
export const auditWhere = (
  schema: EnterpriseSchema,
  organizationId: string,
  filters: AuditSearchFilters,
): SQL => {
  const conditions: [SQL, ...Array<SQL>] = [eq(schema.auditLog.organizationId, organizationId)];

  if (filters.action) conditions.push(eq(schema.auditLog.action, filters.action));

  if (filters.actor) {
    const pattern = `%${escapeLike(filters.actor)}%`;

    const condition = or(
      like(schema.auditLog.actorEmail, pattern),
      like(schema.auditLog.actorUserId, pattern),
    );

    if (condition) conditions.push(condition);
  }

  if (filters.targetType) conditions.push(eq(schema.auditLog.targetType, filters.targetType));

  if (filters.targetId) {
    conditions.push(like(schema.auditLog.targetId, `%${escapeLike(filters.targetId)}%`));
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
  readonly targetType: string;
  readonly targetId: string | null;
  readonly actorUserId: string | null;
  readonly actorEmail: string | null;
  readonly metadata: Schema.Json;
  readonly createdAt: string;
};

const metadataCell = (metadata: Schema.Json | null | undefined) =>
  metadata === null || metadata === undefined ? "" : JSON.stringify(metadata);

/** RFC 4180 CSV with spreadsheet-formula neutralisation applied by `toCsv`. */
export const auditCsv = (entries: ReadonlyArray<AuditExportEntry>) =>
  toCsv(
    ["Time", "Actor", "Action", "Target type", "Target id", "Metadata"],
    entries.map((entry) => [
      entry.createdAt,
      entry.actorEmail ?? SYSTEM_AUDIT_ACTOR,
      entry.action,
      entry.targetType,
      entry.targetId,
      metadataCell(entry.metadata),
    ]),
  );

export const auditJson = (entries: ReadonlyArray<AuditExportEntry>) =>
  `${JSON.stringify(entries, null, 2)}\n`;
