import { describe, expect, it } from "vitest";
import {
  DEVICE_ACTIVITY_DEFAULT_LIMIT,
  DEVICE_ACTIVITY_MAX_LIMIT,
  DEVICE_ACTIVITY_MAX_OFFSET,
  buildDeviceActivity,
  deviceActivityPage,
  normalizeDeviceActivityLimit,
  normalizeDeviceActivityOffset,
} from "../src/deviceActivity.js";

const at = (value: string) => new Date(value);

describe("normalizeDeviceActivityLimit", () => {
  it("defaults to 50 and clamps to 200", () => {
    expect(normalizeDeviceActivityLimit(undefined)).toBe(DEVICE_ACTIVITY_DEFAULT_LIMIT);
    expect(normalizeDeviceActivityLimit(0)).toBe(1);
    expect(normalizeDeviceActivityLimit(-10)).toBe(1);
    expect(normalizeDeviceActivityLimit(10_000)).toBe(DEVICE_ACTIVITY_MAX_LIMIT);
    expect(normalizeDeviceActivityLimit(25.9)).toBe(25);
  });

  it("accepts numeric strings", () => {
    expect(normalizeDeviceActivityLimit("17")).toBe(17);
    expect(normalizeDeviceActivityLimit(" nope ")).toBe(DEVICE_ACTIVITY_DEFAULT_LIMIT);
  });
});

describe("buildDeviceActivity", () => {
  const inputs = {
    device: {
      enrolledAt: at("2026-01-01T00:00:00.000Z"),
      lastSeenAt: at("2026-01-05T00:00:00.000Z"),
      inventoryUpdatedAt: at("2026-01-04T00:00:00.000Z"),
    },
    audits: [
      {
        id: "audit-1",
        action: "device.updated",
        actorEmail: "owner@example.com",
        metadata: { fields: ["name", "notes"], secret: "never-print-this" },
        createdAt: at("2026-01-06T00:00:00.000Z"),
      },
    ],
    commands: [
      {
        id: "command-1",
        requestType: "DeviceLock",
        status: "succeeded",
        resultStatus: "Acknowledged",
        resultDetail: null,
        createdAt: at("2026-01-02T00:00:00.000Z"),
        updatedAt: at("2026-01-02T00:05:00.000Z"),
      },
    ],
    declarations: [
      {
        identifier: "com.example.policy",
        declarationType: "configurations",
        active: true,
        valid: "valid",
        updatedAt: at("2026-01-03T00:00:00.000Z"),
      },
    ],
    certificates: [
      {
        serial: "serial-1",
        notAfter: at("2027-01-01T00:00:00.000Z"),
        revokedAt: at("2026-01-07T00:00:00.000Z"),
        createdAt: at("2026-01-01T00:00:00.000Z"),
      },
    ],
  };

  it("merges every source newest first", () => {
    const events = buildDeviceActivity(inputs);
    expect(events.map((event) => event.id)).toEqual([
      "certificate:serial-1:revoked",
      "audit:audit-1",
      "lifecycle:last-seen",
      "lifecycle:inventory",
      "declaration:com.example.policy",
      "command:command-1",
      "certificate:serial-1:issued",
      "lifecycle:enrolled",
    ]);
    expect(events.every((event) => !Number.isNaN(Date.parse(event.at)))).toBe(true);
  });

  it("labels kinds and statuses", () => {
    const events = buildDeviceActivity(inputs);
    expect(events.find((event) => event.kind === "command")).toMatchObject({
      title: "Command: DeviceLock",
      status: "Succeeded",
      detail: "Acknowledged",
    });
    expect(events.find((event) => event.kind === "declaration")).toMatchObject({
      status: "valid",
      detail: "configurations · active",
    });
    expect(events.find((event) => event.kind === "certificate")?.title).toBe(
      "Identity certificate revoked",
    );
  });

  it("shows the command lifecycle and its deadline", () => {
    const events = buildDeviceActivity({
      ...inputs,
      commands: [
        {
          id: "command-expired",
          requestType: "DeviceLock",
          status: "expired",
          resultStatus: "Reconciled",
          resultDetail: "The delivery deadline passed before the device ran it.",
          createdAt: at("2026-01-02T00:00:00.000Z"),
          updatedAt: at("2026-01-02T00:15:00.000Z"),
          expiresAt: at("2026-01-02T00:15:00.000Z"),
        },
        {
          id: "command-queued",
          requestType: "EraseDevice",
          status: "not-now",
          resultStatus: null,
          resultDetail: null,
          createdAt: at("2026-01-03T00:00:00.000Z"),
          updatedAt: at("2026-01-03T00:00:00.000Z"),
          expiresAt: at("2026-01-10T00:00:00.000Z"),
        },
      ],
    });

    expect(events.find((event) => event.id === "command:command-expired")).toMatchObject({
      status: "Expired",
      detail: "Reconciled: The delivery deadline passed before the device ran it.",
    });
    expect(events.find((event) => event.id === "command:command-queued")).toMatchObject({
      // Legacy rows stored Apple's NotNow result as `not-now`.
      status: "Deferred by device",
      detail: "Deadline 2026-01-10T00:00:00.000Z",
    });
  });

  it("only surfaces known audit metadata", () => {
    const audit = buildDeviceActivity(inputs).find((event) => event.kind === "audit");
    expect(audit?.detail).toContain("Fields: name, notes");
    expect(audit?.detail).toContain("by owner@example.com");
    expect(JSON.stringify(audit)).not.toContain("never-print-this");
  });

  it("applies the limit after sorting", () => {
    const events = buildDeviceActivity(inputs, 3);
    expect(events).toHaveLength(3);
    expect(events[0]?.id).toBe("certificate:serial-1:revoked");
    expect(events[2]?.id).toBe("lifecycle:last-seen");
  });

  it("ignores unparseable timestamps", () => {
    const events = buildDeviceActivity({
      ...inputs,
      audits: [
        {
          id: "audit-bad",
          action: "device.updated",
          createdAt: "not-a-date",
        },
      ],
    });

    expect(events.some((event) => event.id === "audit:audit-bad")).toBe(false);
  });
});

describe("normalizeDeviceActivityOffset", () => {
  it("starts at zero and clamps to the deepest page", () => {
    expect(normalizeDeviceActivityOffset(undefined)).toBe(0);
    expect(normalizeDeviceActivityOffset(-10)).toBe(0);
    expect(normalizeDeviceActivityOffset(25.9)).toBe(25);
    expect(normalizeDeviceActivityOffset(10_000_000)).toBe(DEVICE_ACTIVITY_MAX_OFFSET);
  });

  it("accepts numeric strings", () => {
    expect(normalizeDeviceActivityOffset("50")).toBe(50);
    expect(normalizeDeviceActivityOffset(" nope ")).toBe(0);
  });
});

describe("deviceActivityPage", () => {
  /** `audits` audit rows plus the two lifecycle entries every device has. */
  const feed = (audits: number) => ({
    device: {
      enrolledAt: at("2026-01-01T00:00:00.000Z"),
      lastSeenAt: at("2026-01-01T00:00:00.000Z"),
    },
    audits: Array.from({ length: audits }, (_, index) => ({
      id: `audit-${String(index).padStart(3, "0")}`,
      action: "device.updated",
      // Newer than the lifecycle rows, and newest first as the query returns them.
      createdAt: new Date(Date.UTC(2026, 0, 2, 0, 0, audits - index)),
    })),
    commands: [],
    declarations: [],
    certificates: [],
  });

  it("returns a full first page and reports that more exist", () => {
    const page = deviceActivityPage(feed(10), { limit: 4, offset: 0 });

    expect(page.events).toHaveLength(4);
    expect(page.events[0]?.id).toBe("audit:audit-000");
    expect(page.hasMore).toBe(true);
  });

  it("walks the feed without gaps or repeats", () => {
    const inputs = feed(10);
    const first = deviceActivityPage(inputs, { limit: 4, offset: 0 });
    const second = deviceActivityPage(inputs, { limit: 4, offset: 4 });
    const third = deviceActivityPage(inputs, { limit: 4, offset: 8 });

    const ids = [...first.events, ...second.events, ...third.events].map((event) => event.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(12);
    expect(second.hasMore).toBe(true);
    expect(third.hasMore).toBe(false);
    expect(third.events.map((event) => event.id)).toEqual([
      "audit:audit-008",
      "audit:audit-009",
      "lifecycle:enrolled",
      "lifecycle:last-seen",
    ]);
  });

  it("returns an empty final page past the end of the feed", () => {
    const page = deviceActivityPage(feed(3), { limit: 10, offset: 50 });

    expect(page.events).toEqual([]);
    expect(page.hasMore).toBe(false);
  });

  it("stops at the maximum offset instead of paging forever", () => {
    const page = deviceActivityPage(feed(5), { limit: 50, offset: DEVICE_ACTIVITY_MAX_OFFSET });

    expect(page).toEqual({ events: [], hasMore: false });
  });
});
