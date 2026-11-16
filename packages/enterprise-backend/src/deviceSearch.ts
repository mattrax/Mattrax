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
import { decodeAttributeFilter } from "./attributes.ts";

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
