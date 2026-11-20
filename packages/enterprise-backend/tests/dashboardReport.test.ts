import { describe, expect, it } from "vitest";
import {
  buildReportDocument,
  nextScheduledReportSlot,
  normalizeReportEmails,
  reportAttachment,
  reportCsv,
  reportHtml,
  reportPdf,
  reportScheduleProblem,
  scheduledReportSlot,
} from "../src/Dashboard/report.ts";

const document = (options: {
  generatedAt?: Date;
  results?: Parameters<typeof buildReportDocument>[0]["results"];
} = {}) =>
  buildReportDocument({
    title: "Fleet digest",
    tenantName: "Acme",
    generatedAt: options.generatedAt ?? new Date("2026-11-20T08:00:00.000Z"),
    widgets: [
      { type: "stat", title: "Managed devices", config: { dataset: "devices", label: "devices" } },
      {
        type: "pie",
        title: "Fleet by platform",
        config: { dataset: "devices", dimension: "platform" },
      },
      {
        type: "table",
        title: "Attention queue",
        config: { dataset: "devices", columns: ["name", "platform", "osVersion"] },
      },
      {
        type: "table",
        title: "People",
        config: { dataset: "users", columns: ["name", "email", "status", "source"] },
      },
      { type: "markdown", title: "Notes", config: { markdown: "## Hello\n\nAll good." } },
    ],
    results: options.results ?? [
      { total: 12, rows: [], buckets: [] },
      {
        total: 12,
        rows: [],
        buckets: [
          { label: "Apple", value: 9 },
          { label: "Windows", value: 3 },
        ],
      },
      {
        total: 1,
        buckets: [],
        rows: [
          {
            id: "d1",
            name: "O'Brien, Mac",
            platform: "apple",
            osVersion: "14.4",
            status: "enrolled",
            health: "attention",
          },
        ],
      },
      {
        total: 1,
        buckets: [],
        rows: [
          {
            id: "u1",
            name: "Alex",
            email: "alex@example.com",
            status: "Active",
            source: "Manual",
          },
        ],
      },
      { total: 0, rows: [], buckets: [] },
    ],
  });

describe("report schedule slots", () => {
  it("uses the previous daily slot before the scheduled hour", () => {
    const slot = scheduledReportSlot("daily", 7, new Date("2026-11-20T06:59:00.000Z"));

    expect(slot.period).toBe("2026-11-19");
    expect(slot.scheduledFor.toISOString()).toBe("2026-11-19T07:00:00.000Z");
  });

  it("uses today's daily slot at exactly the scheduled hour", () => {
    const slot = scheduledReportSlot("daily", 7, new Date("2026-11-20T07:00:00.000Z"));

    expect(slot.period).toBe("2026-11-20");
    expect(slot.scheduledFor.toISOString()).toBe("2026-11-20T07:00:00.000Z");
  });

  it("reports weekly slots on Monday in UTC", () => {
    // Friday 20 November 2026; the Monday of that week is the 16th.
    const slot = scheduledReportSlot("weekly", 8, new Date("2026-11-20T12:00:00.000Z"));

    expect(slot.period).toBe("2026-11-16");
    expect(slot.scheduledFor.toISOString()).toBe("2026-11-16T08:00:00.000Z");

    // Before Monday's hour the previous Monday is the latest slot.
    const early = scheduledReportSlot("weekly", 8, new Date("2026-11-16T07:59:00.000Z"));
    expect(early.period).toBe("2026-11-09");
  });

  it("reports monthly slots on the 1st and rolls back before the hour", () => {
    const slot = scheduledReportSlot("monthly", 9, new Date("2026-11-01T09:00:00.000Z"));

    expect(slot.period).toBe("2026-11-01");

    const early = scheduledReportSlot("monthly", 9, new Date("2026-11-01T08:59:00.000Z"));
    expect(early.period).toBe("2026-10-01");

    // January rolls back into the previous year.
    expect(scheduledReportSlot("monthly", 0, new Date("2027-01-01T00:00:00.000Z")).period).toBe(
      "2027-01-01",
    );
    expect(scheduledReportSlot("monthly", 9, new Date("2027-01-01T08:00:00.000Z")).period).toBe(
      "2026-12-01",
    );
  });

  it("computes the next slot strictly after now", () => {
    expect(
      nextScheduledReportSlot("daily", 7, new Date("2026-11-20T06:00:00.000Z")).toISOString(),
    ).toBe("2026-11-20T07:00:00.000Z");
    expect(
      nextScheduledReportSlot("daily", 7, new Date("2026-11-20T07:00:00.000Z")).toISOString(),
    ).toBe("2026-11-21T07:00:00.000Z");
    expect(
      nextScheduledReportSlot("weekly", 8, new Date("2026-11-20T12:00:00.000Z")).toISOString(),
    ).toBe("2026-11-23T08:00:00.000Z");
    expect(
      nextScheduledReportSlot("monthly", 9, new Date("2026-11-01T10:00:00.000Z")).toISOString(),
    ).toBe("2026-12-01T09:00:00.000Z");
  });
});

describe("report recipient validation", () => {
  it("normalises addresses, deduplicates and drops blanks", () => {
    expect(normalizeReportEmails([" Ops@Example.com ", "ops@example.com", "", "a@b.co"])).toEqual({
      emails: ["ops@example.com", "a@b.co"],
      problem: null,
    });
  });

  it("rejects malformed addresses", () => {
    expect(normalizeReportEmails(["not-an-address"]).problem).toMatch(/valid email/);
  });

  it("bounds the recipient count", () => {
    const emails = Array.from({ length: 21 }, (_, index) => `person${index}@example.com`);

    expect(normalizeReportEmails(emails).problem).toMatch(/at most 20/);
  });

  it("validates schedule fields", () => {
    expect(reportScheduleProblem("daily", 0)).toBeNull();
    expect(reportScheduleProblem("weekly", 23)).toBeNull();
    expect(reportScheduleProblem("daily", 24)).toMatch(/hour/);
    // Invalid schedules can arrive from an old client or a script.
    // SAFETY: the function accepts the domain union; this test checks the
    // runtime guard against a value outside it.
    expect(reportScheduleProblem("hourly" as never, 7)).toMatch(/daily/);
  });
});

describe("report CSV", () => {
  it("labels each widget and keeps the configured column order", () => {
    const csv = reportCsv(document());
    const lines = csv.split("\r\n");

    expect(lines[0]).toBe("Report,Fleet digest");
    expect(csv).toContain("Widget,Managed devices");
    expect(csv).toContain("Total,12");

    const header = lines.find((line) => line.startsWith("Name,Platform,OS version"));
    expect(header).toBeDefined();

    const row = lines.find((line) => line.startsWith('"O\'Brien, Mac"'));
    expect(row).toBe('"O\'Brien, Mac",Apple,14.4');

    // User inventory uses its own stable columns.
    expect(csv).toContain("Name,Email,Status,Source");
    expect(csv).toContain("Alex,alex@example.com,Active,Manual");
  });

  it("escapes quotes and newlines and neutralises formulas", () => {
    const value = document({
      results: [
        { total: 1, buckets: [], rows: [] },
        { total: 0, buckets: [], rows: [] },
        {
          total: 1,
          buckets: [],
          rows: [
            {
              id: "d1",
              name: 'A "quoted"\nname',
              platform: "win",
              osVersion: "=1+1",
            },
          ],
        },
        { total: 0, buckets: [], rows: [] },
        { total: 0, buckets: [], rows: [] },
      ],
    });

    const csv = reportCsv(value);

    expect(csv).toContain('"A ""quoted""\nname"');
    expect(csv).toContain("'=1+1");
  });

  it("keeps an empty table visible instead of dropping its section", () => {
    const empty = document({
      results: [
        { total: 0, buckets: [], rows: [] },
        { total: 0, buckets: [], rows: [] },
        { total: 0, buckets: [], rows: [] },
        { total: 0, buckets: [], rows: [] },
        { total: 0, buckets: [], rows: [] },
      ],
    });

    expect(reportCsv(empty)).toContain("Widget,Attention queue");
    expect(reportCsv(empty)).toContain("Total,0");
  });
});

describe("report PDF and HTML", () => {
  it("writes a valid PDF with the title and tables", () => {
    const bytes = reportPdf(document());
    const text = new TextDecoder().decode(bytes);

    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/Type /Catalog");
    expect(text).toContain("(Fleet digest) Tj");
    expect(text).toContain("(Attention queue) Tj");
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("paginates a long report", () => {
    const rows = Array.from({ length: 400 }, (_, index) => ({
      id: `d${index}`,
      name: `Device ${index}`,
      platform: "apple",
      osVersion: "14.4",
    }));

    const bytes = reportPdf(
      document({
        results: [
          { total: 400, buckets: [], rows: [] },
          { total: 0, buckets: [], rows: [] },
          { total: 400, buckets: [], rows },
          { total: 0, buckets: [], rows: [] },
          { total: 0, buckets: [], rows: [] },
        ],
      }),
    );

    const text = new TextDecoder().decode(bytes);

    expect(text).toMatch(/\/Count [2-9]/);
    expect(text).toContain("(Page 2 of");
  });

  it("renders HTML with escaped values and an honest empty state", () => {
    const html = reportHtml(document());

    const empty = reportHtml(
      document({
        results: [
          { total: 0, buckets: [], rows: [] },
          { total: 0, buckets: [], rows: [] },
          { total: 0, buckets: [], rows: [] },
          { total: 0, buckets: [], rows: [] },
          { total: 0, buckets: [], rows: [] },
        ],
      }),
    );

    expect(html).toContain("<h1>Fleet digest</h1>");
    expect(html).toContain("O'Brien");
    expect(empty).toContain("No rows match this query.");
    expect(empty).toContain("No data to chart.");
  });

  it("builds a named attachment with a size", () => {
    const attachment = reportAttachment(document(), "csv", "2026-11-20");

    expect(attachment.filename).toBe("fleet-digest-2026-11-20.csv");
    expect(attachment.contentType).toContain("text/csv");
    expect(attachment.sizeBytes).toBeGreaterThan(0);
    expect(Buffer.from(attachment.contentBase64, "base64").toString("utf8")).toContain(
      "Report,Fleet digest",
    );

    const pdf = reportAttachment(document(), "pdf", "2026-11-20");
    expect(pdf.filename).toBe("fleet-digest-2026-11-20.pdf");
    expect(pdf.contentType).toBe("application/pdf");
  });
});
