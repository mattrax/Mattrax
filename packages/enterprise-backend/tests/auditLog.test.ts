import { describe, expect, it } from "vitest";
import {
  type AuditExportEntry,
  AUDIT_EXPORT_MAX_ROWS,
  AUDIT_SEARCH_DEFAULT_LIMIT,
  AUDIT_SEARCH_MAX_LIMIT,
  auditCsv,
  decodeAuditCursor,
  encodeAuditCursor,
  encodeAuditOffsetCursor,
  escapeLike,
  normalizeAuditSearchQuery,
} from "../src/auditLog.js";

describe("normalizeAuditSearchQuery", () => {
  it("applies bounded defaults", () => {
    expect(normalizeAuditSearchQuery({})).toMatchObject({
      limit: AUDIT_SEARCH_DEFAULT_LIMIT,
      offset: 0,
      offsetPaging: false,
      cursor: undefined,
    });
    expect(AUDIT_SEARCH_DEFAULT_LIMIT).toBe(50);
    expect(AUDIT_SEARCH_MAX_LIMIT).toBe(200);
    expect(AUDIT_EXPORT_MAX_ROWS).toBe(10_000);
  });

  it("clamps limit and offset", () => {
    expect(normalizeAuditSearchQuery({ limit: 10_000 }).limit).toBe(AUDIT_SEARCH_MAX_LIMIT);
    expect(normalizeAuditSearchQuery({ limit: 0 }).limit).toBe(1);
    expect(normalizeAuditSearchQuery({ limit: -5 }).limit).toBe(1);
    expect(normalizeAuditSearchQuery({ offset: -20 }).offset).toBe(0);
    expect(normalizeAuditSearchQuery({ offset: 4.9 }).offset).toBe(4);
    expect(normalizeAuditSearchQuery({ offset: 4 }).offsetPaging).toBe(true);
  });

  it("trims text filters and drops empty ones", () => {
    expect(
      normalizeAuditSearchQuery({
        action: "  device.enrolled  ",
        actor: " ",
        targetType: "device",
        targetId: "",
      }),
    ).toMatchObject({
      action: "device.enrolled",
      actor: undefined,
      targetType: "device",
      targetId: undefined,
    });
  });

  it("rejects over-long filters", () => {
    expect(() => normalizeAuditSearchQuery({ action: "x".repeat(256) })).toThrow(/255 characters/);
  });

  it("accepts inclusive ISO dates", () => {
    const filters = normalizeAuditSearchQuery({
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-31T23:59:59.999Z",
    });

    expect(filters.from?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(filters.to?.toISOString()).toBe("2026-01-31T23:59:59.999Z");
  });

  it("rejects invalid dates and inverted ranges", () => {
    expect(() => normalizeAuditSearchQuery({ from: "not-a-date" })).toThrow(/ISO timestamp/);
    expect(() => normalizeAuditSearchQuery({ to: "2026-13-40" })).toThrow(/ISO timestamp/);
    expect(() =>
      normalizeAuditSearchQuery({
        from: "2026-02-01T00:00:00.000Z",
        to: "2026-01-01T00:00:00.000Z",
      }),
    ).toThrow(/must not be after/);
  });
});

describe("audit cursors", () => {
  it("round-trips a keyset cursor", () => {
    const cursor = { createdAt: new Date("2026-11-11T10:00:00.123Z"), id: "audit-42" };
    const decoded = decodeAuditCursor(encodeAuditCursor(cursor));
    expect(decoded).toMatchObject({ kind: "keyset", id: "audit-42" });
    expect(decoded.kind === "keyset" && decoded.createdAt.toISOString()).toBe(
      "2026-11-11T10:00:00.123Z",
    );
  });

  it("round-trips an offset cursor", () => {
    expect(decodeAuditCursor(encodeAuditOffsetCursor(120))).toEqual({
      kind: "offset",
      offset: 120,
    });
  });

  it("folds a keyset cursor into the query and ignores offset", () => {
    const filters = normalizeAuditSearchQuery({
      cursor: encodeAuditCursor({ createdAt: new Date("2026-11-11T10:00:00.000Z"), id: "x" }),
      offset: 900,
    });

    expect(filters.offset).toBe(0);
    expect(filters.offsetPaging).toBe(false);
    expect(filters.cursor?.id).toBe("x");
  });

  it("folds an offset cursor into offset paging", () => {
    const filters = normalizeAuditSearchQuery({ cursor: encodeAuditOffsetCursor(40) });
    expect(filters.offset).toBe(40);
    expect(filters.offsetPaging).toBe(true);
    expect(filters.cursor).toBeUndefined();
  });

  it("rejects malformed cursors", () => {
    expect(() => normalizeAuditSearchQuery({ cursor: "not-base64" })).toThrow(/cursor/);
    expect(() => normalizeAuditSearchQuery({ cursor: btoa(JSON.stringify({ o: -1 })) })).toThrow(
      /cursor/,
    );
  });
});

describe("escapeLike", () => {
  it("escapes wildcards and the escape character", () => {
    expect(escapeLike("100%_done\\now")).toBe("100\\%\\_done\\\\now");
  });
});

describe("audit export", () => {
  const entry = (overrides: Partial<AuditExportEntry> = {}): AuditExportEntry => ({
    id: "audit-1",
    action: "device.enrolled",
    targetType: "device",
    targetId: "device-1",
    actorUserId: null,
    actorEmail: "owner@example.com",
    metadata: { serial: "C02A" },
    createdAt: "2026-11-11T10:00:00.000Z",
    ...overrides,
  });

  it("writes RFC 4180 CSV with a header", () => {
    const csv = auditCsv([entry({ actorEmail: "Acme, Inc.", action: 'say "hi"' })]);
    const [header, row] = csv.split("\r\n");
    expect(header).toBe("Time,Actor,Action,Target type,Target id,Metadata");
    expect(row).toBe(
      '2026-11-11T10:00:00.000Z,"Acme, Inc.","say ""hi""",device,device-1,"{""serial"":""C02A""}"',
    );
  });

  it("neutralises spreadsheet formula prefixes", () => {
    const csv = auditCsv([
      entry({ actorEmail: '=HYPERLINK("https://evil.example")', targetId: "+1" }),
    ]);

    expect(csv).toContain(`"'=HYPERLINK(""https://evil.example"")"`);
    expect(csv).toContain(",'+1,");
    expect(csv).not.toContain(",=HYPERLINK");
  });

  it("renders System for a null actor", () => {
    expect(auditCsv([entry({ actorEmail: null })])).toContain(",system,");
  });
});
