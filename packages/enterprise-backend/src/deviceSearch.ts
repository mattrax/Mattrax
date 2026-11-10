import {
  EnterpriseBadRequest,
  DeviceProtocol,
  DeviceStatus,
  type DeviceSearchQuery,
  type DeviceSearchSort,
  type SortDirection,
} from "@mattrax/enterprise-domain";

type DeviceStatusValue = typeof DeviceStatus.Type;
type DeviceProtocolValue = typeof DeviceProtocol.Type;

export const DEVICE_SEARCH_DEFAULT_LIMIT = 50;
export const DEVICE_SEARCH_MAX_LIMIT = 200;
/** Hard ceiling for CSV exports so a bad request cannot buffer an entire fleet. */
export const DEVICE_EXPORT_MAX_ROWS = 10_000;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type DeviceSearchFilters = {
  readonly q?: string;
  readonly status?: DeviceStatusValue;
  readonly proto?: DeviceProtocolValue;
  readonly groupId?: string;
  /** Only devices whose `lastSeenAt` is strictly before this instant. */
  readonly notSeenBefore?: Date;
  readonly limit: number;
  readonly offset: number;
  readonly sort: DeviceSearchSort;
  readonly direction: SortDirection;
};

/** Coerce a query-string value (or JSON number) into an integer. */
const integer = (value: unknown, fallback: number) => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return fallback;
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

const optionalText = (value: string | undefined) => {
  const text = value?.trim();
  return text ? text : undefined;
};

/**
 * Normalise the raw query parameters into the filters the SQL builder uses.
 *
 * This is deliberately pure (apart from the injected clock) so the parsing and
 * clamping rules can be unit tested without a database.
 */
export const normalizeDeviceSearchQuery = (
  query: DeviceSearchQuery,
  now: Date = new Date(),
): DeviceSearchFilters => {
  const staleDays = query.staleDays === undefined ? undefined : integer(query.staleDays, 0);
  if (staleDays !== undefined && staleDays < 0)
    throw new EnterpriseBadRequest({ message: "staleDays must not be negative" });

  let notSeenBefore: Date | undefined;
  if (query.notSeenSince) {
    const parsed = new Date(query.notSeenSince);
    if (Number.isNaN(parsed.getTime()))
      throw new EnterpriseBadRequest({ message: "notSeenSince must be an ISO timestamp" });
    notSeenBefore = parsed;
  }
  if (staleDays !== undefined && staleDays > 0) {
    const cutoff = new Date(now.getTime() - staleDays * MS_PER_DAY);
    // When both are provided the more recent cutoff is the stricter filter.
    if (!notSeenBefore || cutoff > notSeenBefore) notSeenBefore = cutoff;
  }

  return {
    q: optionalText(query.q),
    status: query.status,
    proto: query.proto,
    groupId: optionalText(query.groupId),
    notSeenBefore,
    limit: clamp(integer(query.limit, DEVICE_SEARCH_DEFAULT_LIMIT), 1, DEVICE_SEARCH_MAX_LIMIT),
    offset: Math.max(integer(query.offset, 0), 0),
    sort: query.sort ?? "name",
    direction: query.direction ?? "asc",
  };
};

const CSV_SPECIAL = /[",\r\n]/;

/** Escape a single RFC 4180 field, doubling embedded quotes. */
export const csvEscape = (value: unknown) => {
  const text = value == null ? "" : String(value);
  return CSV_SPECIAL.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/** Serialise a header and rows using RFC 4180 conventions (CRLF, quoted fields). */
export const toCsv = (
  header: ReadonlyArray<string>,
  rows: Iterable<ReadonlyArray<unknown>>,
): string => {
  const lines = [header.map(csvEscape).join(",")];
  for (const row of rows) lines.push(row.map(csvEscape).join(","));
  return `${lines.join("\r\n")}\r\n`;
};

export const platformLabel = (proto: DeviceProtocolValue) =>
  proto === "apple" ? "Apple" : proto === "win" ? "Windows" : "Android";
