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

  it("ignores clauses it cannot understand instead of failing the page", () => {
    expect(parseDeviceQueryText("nonsense is what")).toBeNull();
    expect(parseDeviceQueryText("platform is apple and nonsense is what")?.all).toHaveLength(1);
  });
});
