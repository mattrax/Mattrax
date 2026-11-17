import { describe, expect, it } from "vitest";
import type { DeviceSearchQuery } from "@mattrax/enterprise-domain";
import {
  DEVICE_EXPORT_MAX_ROWS,
  DEVICE_SEARCH_DEFAULT_LIMIT,
  DEVICE_SEARCH_MAX_LIMIT,
  csvEscape,
  normalizeDeviceSearchQuery,
  platformLabel,
  toCsv,
} from "../src/Device/deviceSearch.ts";
import { canEnrollDevice } from "../src/Device/enrollmentLimit.ts";

/** Query parameters as a URL delivers them, before the helper coerces them. */
type RawSearchParams = {
  readonly limit?: number | string;
  readonly offset?: number | string;
};

/**
 * Run the normaliser over uncoerced query-string values. The helper accepts
 * numeric strings at runtime (`NumericQueryValue`) even though the declared
 * query type says `number`.
 */
const normalizeRaw = (query: RawSearchParams, now: Date) =>
  // SAFETY: the only fields passed are `limit`/`offset`, which the helper parses
  // through `NumericQueryValue`; the cast widens the declared numeric fields to
  // the string form the HTTP layer can deliver.
  normalizeDeviceSearchQuery(query as DeviceSearchQuery, now);

describe("normalizeDeviceSearchQuery", () => {
  const now = new Date("2026-11-10T12:00:00.000Z");

  it("applies bounded defaults", () => {
    expect(normalizeDeviceSearchQuery({}, now)).toMatchObject({
      limit: DEVICE_SEARCH_DEFAULT_LIMIT,
      offset: 0,
      sort: "name",
      direction: "asc",
    });
    expect(DEVICE_SEARCH_MAX_LIMIT).toBe(200);
    expect(DEVICE_EXPORT_MAX_ROWS).toBe(10_000);
  });

  it("clamps limit and offset", () => {
    expect(normalizeDeviceSearchQuery({ limit: 10_000 }, now).limit).toBe(DEVICE_SEARCH_MAX_LIMIT);
    expect(normalizeDeviceSearchQuery({ limit: 0 }, now).limit).toBe(1);
    expect(normalizeDeviceSearchQuery({ limit: -5 }, now).limit).toBe(1);
    expect(normalizeDeviceSearchQuery({ offset: -20 }, now).offset).toBe(0);
    expect(normalizeDeviceSearchQuery({ offset: 4.9 }, now).offset).toBe(4);
  });

  it("coerces query-string numbers", () => {
    const filters = normalizeRaw({ limit: "25", offset: "50" }, now);

    expect(filters.limit).toBe(25);
    expect(filters.offset).toBe(50);
  });

  it("trims text filters and drops empty ones", () => {
    expect(normalizeDeviceSearchQuery({ q: "  macbook  ", groupId: "  " }, now)).toMatchObject({
      q: "macbook",
      groupId: undefined,
    });
  });

  it("carries the ADE setup filter", () => {
    expect(normalizeDeviceSearchQuery({ setup: "awaiting" }, now).setup).toBe("awaiting");
    expect(normalizeDeviceSearchQuery({ setup: "complete" }, now).setup).toBe("complete");
    expect(normalizeDeviceSearchQuery({}, now).setup).toBeUndefined();
  });

  it("turns staleDays into a cutoff", () => {
    expect(normalizeDeviceSearchQuery({ staleDays: 7 }, now).notSeenBefore?.toISOString()).toBe(
      "2026-11-03T12:00:00.000Z",
    );
  });

  it("treats staleDays=0 as disabled", () => {
    expect(normalizeDeviceSearchQuery({ staleDays: 0 }, now).notSeenBefore).toBeUndefined();
  });

  it("uses the stricter (earlier) cutoff when both are provided", () => {
    // `lastSeenAt < cutoff`: 2026-11-03 matches fewer devices than 2026-11-09.
    expect(
      normalizeDeviceSearchQuery(
        { staleDays: 7, notSeenSince: "2026-11-09T00:00:00.000Z" },
        now,
      ).notSeenBefore?.toISOString(),
    ).toBe("2026-11-03T12:00:00.000Z");
  });

  it("rejects an invalid timestamp and negative staleDays", () => {
    expect(() => normalizeDeviceSearchQuery({ notSeenSince: "nope" }, now)).toThrow(
      /ISO timestamp/,
    );
    expect(() => normalizeDeviceSearchQuery({ staleDays: -1 }, now)).toThrow(/negative/);
  });

  it("passes through status, proto and sort", () => {
    expect(
      normalizeDeviceSearchQuery(
        { status: "enrolled", proto: "apple", sort: "lastSeenAt", direction: "desc" },
        now,
      ),
    ).toMatchObject({
      status: "enrolled",
      proto: "apple",
      sort: "lastSeenAt",
      direction: "desc",
    });
  });
});

describe("csv", () => {
  it("leaves simple fields untouched", () => {
    expect(csvEscape("MacBook Pro")).toBe("MacBook Pro");
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
    expect(csvEscape(42)).toBe("42");
  });

  it("quotes commas, quotes and newlines per RFC 4180", () => {
    expect(csvEscape("Acme, Inc.")).toBe('"Acme, Inc."');
    expect(csvEscape('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvEscape("line one\nline two")).toBe('"line one\nline two"');
    expect(csvEscape("windows\r\nline")).toBe('"windows\r\nline"');
  });

  it("neutralises spreadsheet formula prefixes", () => {
    for (const value of ["=1+1", "+1", "-2", "@SUM(A1)", "\tpayload"])
      expect(csvEscape(value)).toBe(`'${value}`);
    // CR also forces RFC 4180 quoting.
    expect(csvEscape("\rpayload")).toBe('"\'\rpayload"');
    // A formula-looking value that also needs quoting keeps both protections.
    expect(csvEscape('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
  });

  it("passes the health filter through", () => {
    expect(
      normalizeDeviceSearchQuery({ health: "critical" }, new Date("2026-11-10T12:00:00.000Z"))
        .health,
    ).toBe("critical");
  });

  it("passes the push delivery filter through", () => {
    expect(normalizeDeviceSearchQuery({ push: "failing" }, new Date()).push).toBe("failing");
    expect(normalizeDeviceSearchQuery({ push: "invalid" }, new Date()).push).toBe("invalid");
    expect(normalizeDeviceSearchQuery({}, new Date()).push).toBeUndefined();
  });

  it("writes CRLF rows with a trailing newline", () => {
    expect(
      toCsv(
        ["Name", "Serial"],
        [
          ["Acme, Inc.", 'S"N1'],
          ["Plain", ""],
        ],
      ),
    ).toBe('Name,Serial\r\n"Acme, Inc.","S""N1"\r\nPlain,\r\n');
  });

  it("labels platforms for humans", () => {
    expect(platformLabel("apple")).toBe("Apple");
    expect(platformLabel("win")).toBe("Windows");
    expect(platformLabel("android")).toBe("Android");
  });
});

describe("canEnrollDevice", () => {
  it("treats maxDevices=0 as unlimited", () => {
    expect(canEnrollDevice(0, 0)).toBe(true);
    expect(canEnrollDevice(1, 0)).toBe(true);
    expect(canEnrollDevice(100_000, 0)).toBe(true);
  });

  it("allows exactly maxDevices devices and then blocks", () => {
    expect(canEnrollDevice(0, 1)).toBe(true);
    expect(canEnrollDevice(0, 100)).toBe(true);
    expect(canEnrollDevice(99, 100)).toBe(true);
    expect(canEnrollDevice(100, 100)).toBe(false);
    expect(canEnrollDevice(101, 100)).toBe(false);
  });
});
