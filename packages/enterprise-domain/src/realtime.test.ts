import { describe, expect, it } from "vitest";
import {
  REALTIME_INVALIDATION_SCOPES,
  REALTIME_SSE_HEARTBEAT,
  encodeRealtimeSseEvent,
  invalidationScopesForKind,
  parseRealtimeCursor,
  realtimeCursorFrom,
  realtimeEventInsertForAudit,
  realtimeEventsPath,
  realtimeKindForAuditAction,
  realtimeEventFromRow,
  type RealtimeEvent,
} from "./realtime.ts";

const at = new Date("2026-06-01T12:00:00.000Z");

describe("realtimeKindForAuditAction", () => {
  it("maps every protocol ingress action", () => {
    const cases: ReadonlyArray<[string, string]> = [
      ["mdm.checkin", "device.checkin"],
      ["device.enrolled", "device.enrolled"],
      ["device.unenrolled", "device.unenrolled"],
      ["device.deleted", "device.unenrolled"],
      ["device.command_failed", "device.command"],
      ["device.command_not_now", "device.command"],
      ["mdm.command_result", "device.command"],
      ["device.declaration_invalid", "device.declaration"],
      ["mdm.status_report", "device.status"],
      ["mdm.policy_delivered", "device.policy"],
      ["mdm.failure", "device.failure"],
    ];

    for (const [action, kind] of cases) expect(realtimeKindForAuditAction(action)).toBe(kind);
  });

  it("ignores account and unrelated system actions", () => {
    for (const action of [
      "account.signed_in",
      "script.run_succeeded",
      "scep.ca_rotated",
      "tenant.updated",
      "",
    ])
      expect(realtimeKindForAuditAction(action)).toBeUndefined();
  });
});

describe("realtimeEventInsertForAudit", () => {
  it("keeps only the kind, device and protocol", () => {
    expect(
      realtimeEventInsertForAudit({
        action: "mdm.checkin",
        deviceId: "device-1",
        protocol: "apple",
      }),
    ).toEqual({ kind: "device.checkin", deviceId: "device-1", protocol: "apple" });
  });

  it("coerces an unknown protocol and absent device to null", () => {
    expect(
      realtimeEventInsertForAudit({
        action: "device.enrolled",
        deviceId: null,
        protocol: "nonsense",
      }),
    ).toEqual({ kind: "device.enrolled", deviceId: null, protocol: null });
  });

  it("does not publish unrelated actions", () => {
    expect(realtimeEventInsertForAudit({ action: "account.signed_in" })).toBeUndefined();
  });
});

describe("realtimeEventFromRow", () => {
  it("shapes a stored row into the minimal wire event", () => {
    expect(
      realtimeEventFromRow({
        seq: 12,
        kind: "device.command",
        deviceId: "device-1",
        protocol: "win",
        createdAt: at,
      }),
    ).toEqual({
      seq: 12,
      kind: "device.command",
      deviceId: "device-1",
      protocol: "win",
      at: at.toISOString(),
    });
  });

  it("redacts everything that is not on the allowlist", () => {
    // A stored row may one day carry a reason, an actor or a certificate
    // hash. The shaper copies fields explicitly, so none of them can leak.
    const row = {
      seq: 1,
      kind: "device.checkin",
      deviceId: "device-1",
      protocol: "apple",
      createdAt: at,
      metadata: { reason: "secret", checkIns: 12 },
      actorEmail: "owner@example.com",
      ip: "203.0.113.4",
      deviceCertificateFingerprint: "a".repeat(64),
    };

    const wireEvent = realtimeEventFromRow(row);

    expect(wireEvent).toBeDefined();
    expect(Object.keys(wireEvent!).sort()).toEqual(["at", "deviceId", "kind", "protocol", "seq"]);
    expect(JSON.stringify(wireEvent)).not.toContain("owner@example.com");
    expect(JSON.stringify(wireEvent)).not.toContain("203.0.113.4");
    expect(JSON.stringify(wireEvent)).not.toContain("secret");
  });

  it("rejects rows without a known kind, cursor or timestamp", () => {
    expect(realtimeEventFromRow({ seq: 1, kind: "nope", createdAt: at })).toBeUndefined();
    expect(
      realtimeEventFromRow({ seq: 1, kind: "mdm.checkin", createdAt: "not-a-date" }),
    ).toBeUndefined();
    expect(realtimeEventFromRow({ seq: 1.5, kind: "mdm.checkin", createdAt: at })).toBeUndefined();
    expect(realtimeEventFromRow({ seq: -1, kind: "mdm.checkin", createdAt: at })).toBeUndefined();
    expect(realtimeEventFromRow({ seq: null, kind: "mdm.checkin", createdAt: at })).toBeUndefined();
  });

  it("accepts a string timestamp", () => {
    expect(
      realtimeEventFromRow({
        seq: 42,
        kind: "device.checkin",
        createdAt: at.toISOString(),
      }),
    ).toMatchObject({ seq: 42, kind: "device.checkin", deviceId: null, protocol: null });
  });
});

describe("parseRealtimeCursor", () => {
  it("treats missing and blank cursors as absent", () => {
    for (const value of [undefined, null, "", "   "])
      expect(parseRealtimeCursor(value)).toEqual({ kind: "none" });
  });

  it("accepts a non-negative safe integer", () => {
    expect(parseRealtimeCursor("0")).toEqual({ kind: "valid", cursor: 0 });
    expect(parseRealtimeCursor(" 17 ")).toEqual({ kind: "valid", cursor: 17 });
    expect(parseRealtimeCursor(String(Number.MAX_SAFE_INTEGER))).toEqual({
      kind: "valid",
      cursor: Number.MAX_SAFE_INTEGER,
    });
  });

  it("rejects anything that is not a bounded digit string", () => {
    for (const value of [
      "-1",
      "1.5",
      "1e3",
      "0x10",
      "17abc",
      "99999999999999999999",
      "9007199254740992",
      "1 2",
    ])
      expect(parseRealtimeCursor(value), value).toEqual({ kind: "invalid" });
  });

  it("prefers Last-Event-ID over the query parameter", () => {
    expect(realtimeCursorFrom({ header: "9", query: "3" })).toEqual({ kind: "valid", cursor: 9 });
    expect(realtimeCursorFrom({ header: null, query: "3" })).toEqual({ kind: "valid", cursor: 3 });
    expect(realtimeCursorFrom({ header: "", query: "" })).toEqual({ kind: "none" });
    expect(realtimeCursorFrom({ header: "bad", query: "3" })).toEqual({ kind: "invalid" });
  });
});

describe("invalidation scopes", () => {
  it("covers every event kind", () => {
    const kinds = [
      "device.checkin",
      "device.enrolled",
      "device.unenrolled",
      "device.lifecycle",
      "device.command",
      "device.declaration",
      "device.status",
      "device.policy",
      "device.failure",
    ] as const;

    for (const kind of kinds) {
      const scopes = invalidationScopesForKind(kind);

      expect(scopes.length).toBeGreaterThan(0);

      for (const scope of scopes) expect(REALTIME_INVALIDATION_SCOPES).toContain(scope);
    }
  });

  it("always refreshes the device itself and a command result refreshes activity", () => {
    expect(invalidationScopesForKind("device.checkin")).toContain("device");
    expect(invalidationScopesForKind("device.checkin")).toContain("fleet");
    expect(invalidationScopesForKind("device.command")).toContain("activity");
    expect(invalidationScopesForKind("device.enrolled")).toContain("enrollment");
    expect(invalidationScopesForKind("device.declaration")).toContain("declarations");
  });
});

describe("SSE framing", () => {
  const event: RealtimeEvent = {
    seq: 7,
    kind: "device.checkin",
    deviceId: "device-1",
    protocol: "apple",
    at: at.toISOString(),
  };

  it("writes the cursor as the SSE id and the event as JSON data", () => {
    const frame = encodeRealtimeSseEvent(event);

    expect(frame).toBe(`id: 7\ndata: ${JSON.stringify(event)}\n\n`);
    expect(frame.endsWith("\n\n")).toBe(true);
    expect(frame).not.toContain("event:");
  });

  it("exports a comment heartbeat that is not parsed as an event", () => {
    expect(REALTIME_SSE_HEARTBEAT.startsWith(":")).toBe(true);
    expect(REALTIME_SSE_HEARTBEAT.endsWith("\n\n")).toBe(true);
  });

  it("builds a tenant-scoped path with an encoded id", () => {
    expect(realtimeEventsPath("tenant-1")).toBe("/api/v1/tenants/tenant-1/realtime");
    expect(realtimeEventsPath("a/b")).toBe("/api/v1/tenants/a%2Fb/realtime");
  });
});
