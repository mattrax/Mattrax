import { describe, expect, it } from "vitest";
import {
  evaluateDeviceQuery,
  formatDeviceQueryText,
  parseDeviceQueryText,
  type DeviceQuery,
  type DeviceQueryDevice,
} from "./deviceQuery.ts";

const now = new Date("2026-05-20T12:00:00.000Z");

const device = (overrides: Partial<DeviceQueryDevice> = {}): DeviceQueryDevice => ({
  name: "Alice's MacBook",
  proto: "apple",
  osVersion: "14.4.1",
  model: "MacBookPro18,3",
  serial: "C02ABC123",
  assetTag: "AT-100",
  status: "enrolled",
  batteryHealth: "Normal",
  osEdition: "macOS Sonoma",
  lastSeenAt: new Date("2026-05-10T12:00:00.000Z"),
  enrolledAt: new Date("2026-01-01T12:00:00.000Z"),
  fileVaultStatus: "enabled",
  fileVaultEnabled: true,
  health: { level: "attention", stale: false },
  applications: [
    { bundleId: "com.apple.Safari", name: "Safari" },
    { bundleId: "com.microsoft.Word", name: "Microsoft Word" },
  ],
  ...overrides,
});

describe("device query", () => {
  it("evaluates platform, version, days and application conditions", () => {
    expect(
      evaluateDeviceQuery({ all: [{ field: "platform", value: "apple" }] }, device(), { now }),
    ).toBe(true);
    expect(
      evaluateDeviceQuery({ all: [{ field: "osVersion", op: "gte", value: "14.4" }] }, device(), {
        now,
      }),
    ).toBe(true);
    expect(
      evaluateDeviceQuery({ all: [{ field: "staleDays", op: "gte", value: 5 }] }, device(), {
        now,
      }),
    ).toBe(true);
    expect(
      evaluateDeviceQuery({ all: [{ field: "enrolledDays", op: "gte", value: 200 }] }, device(), {
        now,
      }),
    ).toBe(false);
    expect(
      evaluateDeviceQuery(
        { all: [{ field: "application", op: "has", value: "com.apple.Safari" }] },
        device(),
        { now },
      ),
    ).toBe(true);
    expect(
      evaluateDeviceQuery(
        { all: [{ field: "application", op: "lacks", value: "com.apple.Safari" }] },
        device(),
        { now },
      ),
    ).toBe(false);
  });

  it("combines all, any and none lists", () => {
    const query: DeviceQuery = {
      all: [{ field: "platform", value: "apple" }],
      any: [
        { field: "health", op: "eq", value: "attention" },
        { field: "health", op: "eq", value: "critical" },
      ],
      none: [{ field: "status", op: "ne", value: "enrolled" }],
    };

    expect(evaluateDeviceQuery(query, device(), { now })).toBe(true);
    expect(evaluateDeviceQuery(query, device({ status: "unenrolled" }), { now })).toBe(false);
  });

  it("negates the stale health condition", () => {
    const stale = device({ health: { level: "critical", stale: true } });
    const fresh = device({ health: { level: "attention", stale: false } });

    expect(
      evaluateDeviceQuery({ all: [{ field: "health", op: "ne", value: "stale" }] }, stale, {
        now,
      }),
    ).toBe(false);
    expect(
      evaluateDeviceQuery({ all: [{ field: "health", op: "ne", value: "stale" }] }, fresh, {
        now,
      }),
    ).toBe(true);
  });

  it("filters MIA separately from stale", () => {
    const mia = device({ health: { level: "missing", stale: true } });
    const staleOnly = device({ health: { level: "attention", stale: true } });

    expect(
      evaluateDeviceQuery({ all: [{ field: "health", value: "missing" }] }, mia, { now }),
    ).toBe(true);
    expect(
      evaluateDeviceQuery({ all: [{ field: "health", value: "missing" }] }, staleOnly, { now }),
    ).toBe(false);

    // The stale filter stays the broad "not checking in" filter.
    expect(evaluateDeviceQuery({ all: [{ field: "health", value: "stale" }] }, mia, { now })).toBe(
      true,
    );
    expect(
      evaluateDeviceQuery({ all: [{ field: "health", value: "stale" }] }, staleOnly, { now }),
    ).toBe(true);

    expect(
      evaluateDeviceQuery({ all: [{ field: "health", op: "ne", value: "missing" }] }, mia, { now }),
    ).toBe(false);
  });

  it("round-trips a shareable URL query", () => {
    const query = parseDeviceQueryText(
      'platform is apple and osVersion at least 14.4 and model contains "MacBook Pro" and staleDays at least 14',
    );

    expect(query).not.toBeNull();
    expect(query!.all).toHaveLength(4);
    expect(evaluateDeviceQuery(query, device({ model: "MacBook Pro 16" }), { now })).toBe(false);
    const text = formatDeviceQueryText(query);
    expect(parseDeviceQueryText(text)).toEqual(query);
  });

  it("round-trips the MIA health filter", () => {
    const query = parseDeviceQueryText("health is missing");

    expect(query).not.toBeNull();
    expect(formatDeviceQueryText(query)).toBe("health is missing");
    expect(parseDeviceQueryText(formatDeviceQueryText(query))).toEqual(query);
  });

  it("ignores clauses it cannot understand instead of failing the page", () => {
    expect(parseDeviceQueryText("nonsense is what")).toBeNull();
    expect(parseDeviceQueryText("platform is apple and nonsense is what")?.all).toHaveLength(1);
  });

  it("matches only Windows devices on activation state", () => {
    const windows = (status: string | null) =>
      device({ proto: "win", osEdition: "Windows 11 Pro", windowsActivationStatus: status });

    expect(
      evaluateDeviceQuery(
        { all: [{ field: "activation", value: "activated" }] },
        windows("activated"),
        {
          now,
        },
      ),
    ).toBe(true);
    expect(
      evaluateDeviceQuery(
        { all: [{ field: "activation", op: "ne", value: "activated" }] },
        windows("not-activated"),
        { now },
      ),
    ).toBe(true);
    // A Windows device that has not reported activation is unknown, not "not
    // activated".
    expect(
      evaluateDeviceQuery({ all: [{ field: "activation", value: "unknown" }] }, windows(null), {
        now,
      }),
    ).toBe(true);
    expect(
      evaluateDeviceQuery({ all: [{ field: "activation", value: "activated" }] }, windows(null), {
        now,
      }),
    ).toBe(false);
  });

  it("never matches a non-Windows device on activation", () => {
    for (const value of ["activated", "not-activated", "unknown"] as const)
      expect(
        evaluateDeviceQuery(
          { all: [{ field: "activation", value }] },
          device({ proto: "apple", windowsActivationStatus: null }),
          { now },
        ),
      ).toBe(false);

    // `ne` must not accidentally select a platform that cannot report it.
    expect(
      evaluateDeviceQuery(
        { all: [{ field: "activation", op: "ne", value: "unknown" }] },
        device({ proto: "android", windowsActivationStatus: null }),
        { now },
      ),
    ).toBe(false);
  });

  it("round-trips an activation clause through the URL text", () => {
    const query = parseDeviceQueryText("activation is not-activated");

    expect(query).toEqual({
      version: 1,
      all: [{ field: "activation", op: "eq", value: "not-activated" }],
    });
    expect(formatDeviceQueryText(query)).toBe("activation is not-activated");
    expect(parseDeviceQueryText(formatDeviceQueryText(query))).toEqual(query);
    expect(parseDeviceQueryText("activation is not activated")?.all?.[0]).toMatchObject({
      field: "activation",
      op: "ne",
      value: "activated",
    });
    expect(parseDeviceQueryText("activation is something-else")).toBeNull();
  });
});
