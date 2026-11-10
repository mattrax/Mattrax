import { describe, expect, it } from "vitest";
import {
  DEVICE_ACTIVITY_DEFAULT_LIMIT,
  DEVICE_ACTIVITY_MAX_LIMIT,
  buildDeviceActivity,
  normalizeDeviceActivityLimit,
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
      status: "succeeded",
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
