import { Match, Option, Schema } from "effect";
import {
  EnterpriseBadRequest,
  DeviceProtocol,
  DeviceStatus,
  deviceQueryProblem,
  parseDeviceQueryText,
  type DeviceQuery,
  type DeviceSearchQuery,
  type DeviceSearchSort,
  type SortDirection,
} from "@mattrax/enterprise-domain";
import { decodeAttributeFilter } from "../Policy/attributes.ts";

type DeviceStatusValue = typeof DeviceStatus.Type;

type DeviceProtocolValue = typeof DeviceProtocol.Type;

export const DEVICE_SEARCH_DEFAULT_LIMIT = 50;

export const DEVICE_SEARCH_MAX_LIMIT = 200;

/** Hard ceiling for CSV exports so a bad request cannot buffer an entire fleet. */
export const DEVICE_EXPORT_MAX_ROWS = 10_000;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type DeviceHealthFilter = "healthy" | "attention" | "critical" | "unknown" | "stale";

/** APNs delivery state filters for the device list. */
export type DevicePushFilter = "failing" | "invalid";

export type DeviceSearchFilters = {
  readonly q?: string;
  readonly status?: DeviceStatusValue;
  readonly proto?: DeviceProtocolValue;
  readonly groupId?: string;
  /** Only devices whose `lastSeenAt` is strictly before this instant. */
  readonly notSeenBefore?: Date;
  /** Only devices whose derived health rollup matches this level. */
  readonly health?: DeviceHealthFilter;
  /** Only Apple devices whose APNs delivery is failing or has an invalid token. */
  readonly push?: DevicePushFilter;
  /** ADE setup state, from `device_apple.awaiting_configuration`. */
  readonly setup?: "awaiting" | "complete";
  /** Exact attribute filters keyed by registered attribute key. */
  readonly attributes?: Readonly<Record<string, string>>;
  /** Structured device query from a shareable table URL. */
  readonly query?: DeviceQuery;
  readonly limit: number;
  readonly offset: number;
  readonly sort: DeviceSearchSort;
  readonly direction: SortDirection;
};

const NumericQueryValue = Schema.Union([Schema.Finite, Schema.FiniteFromString]);

/** Coerce a query-string value (or JSON number) into an integer. */
const integer = (value: number | string | undefined, fallback: number) => {
  const parsed = Option.getOrUndefined(Schema.decodeUnknownOption(NumericQueryValue)(value));

  return parsed === undefined ? fallback : Math.trunc(parsed);
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

    // `lastSeenAt < cutoff`: an earlier cutoff matches fewer devices, so with
    // both filters the earlier one is the stricter constraint.
    if (!notSeenBefore || cutoff < notSeenBefore) notSeenBefore = cutoff;
  }

  const structured = parseDeviceQueryText(query.query);

  if (structured) {
    const problem = deviceQueryProblem(structured);

    if (problem) throw new EnterpriseBadRequest({ message: problem });
  }

  let attributes: Record<string, string> | undefined;

  try {
    attributes = decodeAttributeFilter(query.attributes);
  } catch (cause) {
    throw new EnterpriseBadRequest({
      message: cause instanceof Error ? cause.message : "Invalid attribute filter",
    });
  }

  const filters: DeviceSearchFilters = {
    q: optionalText(query.q),
    status: query.status,
    proto: query.proto,
    groupId: optionalText(query.groupId),
    notSeenBefore,
    health: query.health,
    push: query.push,
    setup: query.setup,
    attributes: attributes && Object.keys(attributes).length ? attributes : undefined,
    limit: clamp(integer(query.limit, DEVICE_SEARCH_DEFAULT_LIMIT), 1, DEVICE_SEARCH_MAX_LIMIT),
    offset: Math.max(integer(query.offset, 0), 0),
    sort: query.sort ?? "name",
    direction: query.direction ?? "asc",
  };

  return structured ? { ...filters, query: structured } : filters;
};

const CSV_SPECIAL = /[",\r\n]/;

/**
 * Leading characters Excel/Sheets interpret as a formula (or as a way to break
 * out of a cell). Prefixing with an apostrophe keeps the value literal.
 */
const CSV_FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** Escape a single RFC 4180 field, doubling embedded quotes. */
export const csvEscape = (value: Schema.Json | undefined) => {
  const raw = value == null ? "" : String(value);
  const text = CSV_FORMULA_PREFIX.test(raw) ? `'${raw}` : raw;

  return CSV_SPECIAL.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/** Serialise a header and rows using RFC 4180 conventions (CRLF, quoted fields). */
export const toCsv = (
  header: ReadonlyArray<string>,
  rows: Iterable<ReadonlyArray<Schema.Json | undefined>>,
): string => {
  const lines = [header.map(csvEscape).join(",")];

  for (const row of rows) lines.push(row.map(csvEscape).join(","));

  return `${lines.join("\r\n")}\r\n`;
};

export const platformLabel = (proto: DeviceProtocolValue) =>
  Match.value(proto).pipe(
    Match.when("apple", () => "Apple"),
    Match.when("win", () => "Windows"),
    Match.orElse(() => "Android"),
  );

const DEVICE_PROTOCOLS: ReadonlyArray<DeviceProtocolValue> = ["apple", "win", "android"];

/**
 * Statuses the table renders. Kept in the same order as the `device.status`
 * column enum in the schema.
 */
const DEVICE_SEARCH_STATUSES: ReadonlyArray<DeviceStatusValue> = [
  "enrolling",
  "enrolled",
  "unenrolling",
  "unenrolled",
];

/**
 * Protos whose human-readable platform label matches the query text.
 *
 * The column stores `apple`/`win`/`android`, but the device table shows
 * `Apple`/`Windows`/`Android`, so a raw `LIKE` on the column would never find
 * "windows" (or would find "win" only by accident). Matching the label keeps
 * search consistent with what the table displays.
 */
export const deviceSearchPlatforms = (text: string): DeviceProtocolValue[] => {
  const needle = text.trim().toLowerCase();

  if (!needle) return [];

  return DEVICE_PROTOCOLS.filter((proto) => platformLabel(proto).toLowerCase().includes(needle));
};

/** Statuses whose stored value contains the query text, mirroring the column. */
export const deviceSearchStatuses = (text: string): DeviceStatusValue[] => {
  const needle = text.trim().toLowerCase();

  if (!needle) return [];

  return DEVICE_SEARCH_STATUSES.filter((status) => status.includes(needle));
};

const MONTH_WORDS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

const MONTH_ABBREVIATIONS = MONTH_WORDS.map((month) => month.slice(0, 3));

/** Only real four-digit years count as a date; `2`, `26` and `4` do not. */
const TIMESTAMP_YEAR_QUERY = /^(?:19|20)\d{2}$/;

/** `2026`, `2026-11`, `2026-11-10`, `2026-11-10 05:06`. */
const TIMESTAMP_ISO_QUERY = /^\d{4}-\d{1,2}(?:-\d{1,2})?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/;

/** `10/11` or `10/11/2026`, either day-first or month-first. */
const TIMESTAMP_SLASH_QUERY = /^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?$/;

const TIMESTAMP_TIME_QUERY = /^\d{1,2}:\d{2}(?::\d{2})?$/;

/** `nov`, `november`, `nov 2026`, `4 nov 2026`, `nov 4 2026`. */
const TIMESTAMP_MONTH_QUERY = new RegExp(
  `^(?:(?:\\d{1,2}\\s+)?(?:${[...MONTH_ABBREVIATIONS, ...MONTH_WORDS].join("|")})(?:\\s+\\d{1,2})?(?:\\s+\\d{2,4})?)$`,
  "i",
);

/**
 * MySQL `date_format` patterns a timestamp query is matched against.
 *
 * Timestamps are stored as UTC `datetime` values. Formatting them in SQL keeps
 * the search set-based (no per-device scan, no id list) and lets month names
 * and slash-separated dates be matched without knowing the reader's locale.
 * `%e`/`%c` are the unpadded day/month, so both `4/3/2026` and `04/03/2026`
 * forms match.
 */
const ISO_TIMESTAMP_FORMATS = ["%Y-%m-%d %H:%i"];

const TIME_TIMESTAMP_FORMATS = ["%H:%i"];

/** Both day-first and month-first, because `10/11/2026` is ambiguous. */
const SLASH_TIMESTAMP_FORMATS = ["%e/%c/%Y", "%d/%m/%Y", "%c/%e/%Y", "%m/%d/%Y"];

const MONTH_TIMESTAMP_FORMATS = ["%e %b %Y", "%e %M %Y", "%b %e %Y", "%M %e %Y"];

/**
 * The timestamp representations a free-text query asks for, or `[]` when it is
 * an ordinary name/serial/model search.
 *
 * Detection is deliberately narrow: bare numbers are only dates when they are
 * a real four-digit year. This keeps a query like "26" from matching every
 * device with a 2026 timestamp.
 */
export const deviceSearchTimestampFormats = (text: string): ReadonlyArray<string> => {
  const value = text.trim();

  if (!value) return [];

  if (TIMESTAMP_YEAR_QUERY.test(value) || TIMESTAMP_ISO_QUERY.test(value))
    return ISO_TIMESTAMP_FORMATS;

  if (TIMESTAMP_TIME_QUERY.test(value)) return TIME_TIMESTAMP_FORMATS;

  if (TIMESTAMP_SLASH_QUERY.test(value)) return SLASH_TIMESTAMP_FORMATS;

  if (TIMESTAMP_MONTH_QUERY.test(value)) return MONTH_TIMESTAMP_FORMATS;

  return [];
};

/** Whether the query asks for a timestamp representation at all. */
export const isDeviceTimestampSearch = (text: string): boolean =>
  deviceSearchTimestampFormats(text).length > 0;
