import { describe, expect, it } from "vitest";
import {
  AUDIT_EXPORT_MAX_ROWS,
  AUDIT_SEARCH_DEFAULT_LIMIT,
  AUDIT_SEARCH_MAX_LIMIT,
  auditCsv,
  decodeAuditCursor,
  encodeAuditCursor,
  encodeAuditOffsetCursor,
  escapeLike,
  normalizeAuditSearchQuery,
} from "../src/Account/auditLog.ts";
import type { AuditExportEntry } from "../src/Account/auditLog.ts";

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
        q: "  203.0.113.9  ",
      }),
    ).toMatchObject({
      action: "device.enrolled",
      actor: undefined,
      targetType: "device",
      targetId: undefined,
      q: "203.0.113.9",
    });
  });

  it("accepts the MDM filters", () => {
    expect(
      normalizeAuditSearchQuery({
        category: "mdm",
        actorType: "system",
        protocol: "apple",
        deviceId: "dev-1",
      }),
    ).toMatchObject({
      category: "mdm",
      actorType: "system",
      protocol: "apple",
      deviceId: "dev-1",
    });
  });

  it("rejects unknown enum filters", () => {
    expect(() => normalizeAuditSearchQuery({ category: "everything" as never })).toThrow(
      /category/,
    );
    expect(() => normalizeAuditSearchQuery({ protocol: "ios" as never })).toThrow(/protocol/);
    expect(() => normalizeAuditSearchQuery({ actorType: "robot" as never })).toThrow(/actorType/);
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
    expect(escapeLike(String.raw`100%_done\now`)).toBe(String.raw`100\%\_done\\now`);
  });
});

describe("audit export", () => {
  const entry = (overrides: Partial<AuditExportEntry> = {}): AuditExportEntry => ({
    id: "audit-1",
    action: "device.enrolled",
    category: "mdm",
    targetType: "device",
    targetId: "device-1",
    actorAccountId: null,
    actorEmail: "owner@example.com",
    actorType: "account",
    ip: null,
    userAgent: null,
    deviceId: null,
    deviceCertificateFingerprint: null,
    deviceCertificateSerial: null,
    principalId: null,
    protocol: null,
    metadata: { serial: "C02A" },
    createdAt: "2026-11-11T10:00:00.000Z",
    ...overrides,
  });

  it("writes RFC 4180 CSV with a header", () => {
    const csv = auditCsv([entry({ actorEmail: "Acme, Inc.", action: 'say "hi"' })]);
    const [header, row] = csv.split("\r\n");
    expect(header).toBe(
      "Time,Actor,Actor type,Category,Action,Target type,Target id,Protocol,Device,IP,Certificate fingerprint,Certificate serial,Principal,User agent,Metadata",
    );
    expect(row).toBe(
      '2026-11-11T10:00:00.000Z,"Acme, Inc.",account,mdm,"say ""hi""",device,device-1,,,,,,,,"{""serial"":""C02A""}"',
    );
  });

  it("exports the MDM enrichment columns", () => {
    const csv = auditCsv([
      entry({
        action: "mdm.checkin",
        category: "mdm",
        actorType: "system",
        actorEmail: "system",
        protocol: "apple",
        deviceId: "dev-9",
        ip: "203.0.113.9",
        deviceCertificateFingerprint: "ab".repeat(32),
        deviceCertificateSerial: "0a1b",
        userAgent: "MDM/1.0",
      }),
    ]);

    const [, row] = csv.split("\r\n");

    expect(row).toContain(
      ",system,system,mdm,mdm.checkin,device,device-1,apple,dev-9,203.0.113.9,",
    );
    expect(row).toContain(",0a1b,,MDM/1.0,");
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
