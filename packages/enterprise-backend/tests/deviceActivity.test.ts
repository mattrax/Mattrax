import { describe, expect, it } from "vitest";
import {
  DEVICE_ACTIVITY_AUDIT_PREFIX,
  DEVICE_ACTIVITY_COMMAND_PREFIX,
  DEVICE_ACTIVITY_DEFAULT_LIMIT,
  DEVICE_ACTIVITY_MAX_LIMIT,
  buildDeviceActivity,
  decodeDeviceActivityCursor,
  deviceActivityPage,
  deviceActivitySourceKeyset,
  encodeDeviceActivityCursor,
  normalizeDeviceActivityLimit,
  type DeviceActivityPage,
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
      "lifecycle:enrolled",
      "certificate:serial-1:issued",
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

describe("activity cursor", () => {
  it("round-trips an opaque position", () => {
    const cursor = { at: at("2026-01-02T03:04:05.678Z"), id: "audit:abc" };
    const encoded = encodeDeviceActivityCursor(cursor);

    expect(encoded).not.toContain(":");
    expect(decodeDeviceActivityCursor(encoded)).toEqual(cursor);
  });

  it("rejects a malformed cursor", () => {
    expect(() => decodeDeviceActivityCursor("not-a-cursor")).toThrow();
    expect(() =>
      decodeDeviceActivityCursor(
        encodeDeviceActivityCursor({
          at: at("2026-01-02T03:04:05.678Z"),
          id: "",
        }),
      ),
    ).toThrow();
  });

  it("restricts each source by its event timestamp and id", () => {
    const cursor = { at: at("2026-01-02T03:04:05.678Z"), id: "audit:abc" };

    expect(deviceActivitySourceKeyset(cursor, DEVICE_ACTIVITY_AUDIT_PREFIX)).toEqual({
      at: cursor.at,
      beforeId: "abc",
    });
    // A cursor from a source that sorts later includes every row at that
    // instant; one from an earlier source includes none.
    expect(deviceActivitySourceKeyset(cursor, DEVICE_ACTIVITY_COMMAND_PREFIX)).toEqual({
      at: cursor.at,
      sameInstant: "none",
    });
    expect(
      deviceActivitySourceKeyset(
        { at: cursor.at, id: "command:abc" },
        DEVICE_ACTIVITY_AUDIT_PREFIX,
      ),
    ).toEqual({ at: cursor.at, sameInstant: "all" });
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

  const cursorOf = (page: DeviceActivityPage) =>
    page.nextCursor ? decodeDeviceActivityCursor(page.nextCursor) : undefined;

  it("returns a full first page and reports that more exist", () => {
    const page = deviceActivityPage(feed(10), { limit: 4 });

    expect(page.events).toHaveLength(4);
    expect(page.events[0]?.id).toBe("audit:audit-000");
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBeDefined();
  });

  it("walks the feed with a cursor without gaps or repeats", () => {
    const inputs = feed(10);
    const first = deviceActivityPage(inputs, { limit: 4 });
    const second = deviceActivityPage(inputs, { limit: 4, cursor: cursorOf(first) });
    const third = deviceActivityPage(inputs, { limit: 4, cursor: cursorOf(second) });

    const ids = [...first.events, ...second.events, ...third.events].map((event) => event.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(12);
    expect(second.hasMore).toBe(true);
    expect(third.hasMore).toBe(false);
    expect(third.nextCursor).toBeUndefined();
    expect(third.events.map((event) => event.id)).toEqual([
      "audit:audit-008",
      "audit:audit-009",
      "lifecycle:last-seen",
      "lifecycle:enrolled",
    ]);
  });

  it("pages events that share one instant exactly once", () => {
    const inputs = {
      ...feed(0),
      audits: Array.from({ length: 5 }, (_, index) => ({
        id: `same-${index}`,
        action: "device.updated",
        createdAt: at("2026-01-03T00:00:00.000Z"),
      })),
    };

    const first = deviceActivityPage(inputs, { limit: 3 });
    const second = deviceActivityPage(inputs, { limit: 3, cursor: cursorOf(first) });
    const third = deviceActivityPage(inputs, { limit: 3, cursor: cursorOf(second) });
    const ids = [...first.events, ...second.events, ...third.events].map((event) => event.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      "audit:same-4",
      "audit:same-3",
      "audit:same-2",
      "audit:same-1",
      "audit:same-0",
      "lifecycle:last-seen",
      "lifecycle:enrolled",
    ]);
    expect(third.hasMore).toBe(false);
  });

  it("returns an empty final page past the end of the feed", () => {
    const inputs = feed(2);
    const first = deviceActivityPage(inputs, { limit: 3 });
    const second = deviceActivityPage(inputs, { limit: 10, cursor: cursorOf(first) });
    const last = second.events.at(-1)!;

    const page = deviceActivityPage(inputs, {
      limit: 10,
      cursor: { at: new Date(last.at), id: last.id },
    });

    expect(first.hasMore).toBe(true);
    expect(second.events).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    expect(page.events).toEqual([]);
    expect(page.hasMore).toBe(false);
  });
});
