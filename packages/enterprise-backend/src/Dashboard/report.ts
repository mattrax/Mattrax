import { Match, Option, Schema } from "effect";
import { DASHBOARD_REPORT_MAX_RECIPIENTS } from "@mattrax/enterprise-domain";
import type {
  DashboardQueryResponse,
  DashboardReportFormat,
  DashboardReportFrequency,
  DashboardWidgetType,
} from "@mattrax/enterprise-domain";
import { toCsv } from "../Device/deviceSearch.ts";

/**
 * Report rendering.
 *
 * A report is a dashboard snapshot: the caller runs the same widget queries the
 * dashboard uses (see `dashboardQueryForWidget`) and hands the results here.
 * Everything in this module is pure so the CSV/PDF/HTML output and the schedule
 * arithmetic can be unit-tested without a database or a mail provider.
 */

export const REPORT_TIMEZONE = "UTC";

/** Scheduled reports never run more than once per this window per period. */
export const REPORT_RUN_MAX_ATTEMPTS = 3;

/** A claim older than this belongs to a crashed isolate and may be retried. */
export const REPORT_RUN_CLAIM_STALE_MS = 15 * 60 * 1000;

export type ScheduledReportSlot = { readonly period: string; readonly scheduledFor: Date };

const utcHour = (hourUtc: number, date: Date) => {
  const hours = Math.min(Math.max(Math.trunc(hourUtc), 0), 23);

  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hours, 0, 0, 0),
  );
};

const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

/** Monday-based week start, in UTC. */
const startOfUtcWeek = (date: Date) => {
  const day = date.getUTCDay();

  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - ((day + 6) % 7)),
  );
};

const startOfUtcMonth = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

const periodOf = (scheduledFor: Date) => scheduledFor.toISOString().slice(0, 10);

/**
 * The most recent slot at or before `now`, and its period key.
 *
 * Daily periods are the date, weekly periods the Monday date and monthly
 * periods the first of the month, so a retry in the same slot always produces
 * the same key. Weekly reports run on Monday and monthly reports on the 1st.
 */
export const scheduledReportSlot = (
  frequency: DashboardReportFrequency,
  hourUtc: number,
  now: Date,
): ScheduledReportSlot => {
  const today = utcHour(hourUtc, now);

  if (frequency === "daily") {
    const scheduledFor = today.getTime() <= now.getTime() ? today : addDays(today, -1);

    return { period: periodOf(scheduledFor), scheduledFor };
  }

  if (frequency === "weekly") {
    const week = startOfUtcWeek(now);
    const scheduledFor = utcHour(hourUtc, week);

    return scheduledFor.getTime() <= now.getTime()
      ? { period: periodOf(scheduledFor), scheduledFor }
      : {
          period: periodOf(addDays(scheduledFor, -7)),
          scheduledFor: addDays(scheduledFor, -7),
        };
  }

  const month = startOfUtcMonth(now);
  const scheduledFor = utcHour(hourUtc, month);

  if (scheduledFor.getTime() <= now.getTime())
    return { period: periodOf(scheduledFor), scheduledFor };

  const previous = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1));
  const previousSlot = utcHour(hourUtc, previous);

  return {
    period: periodOf(previousSlot),
    scheduledFor: previousSlot,
  };
};

/** The next slot strictly after `now`, used for the settings panel. */
export const nextScheduledReportSlot = (
  frequency: DashboardReportFrequency,
  hourUtc: number,
  now: Date,
): Date => {
  const slot = scheduledReportSlot(frequency, hourUtc, now);

  if (slot.scheduledFor.getTime() > now.getTime()) return slot.scheduledFor;

  if (frequency === "daily") return addDays(slot.scheduledFor, 1);

  if (frequency === "weekly") return addDays(slot.scheduledFor, 7);

  return new Date(
    Date.UTC(
      slot.scheduledFor.getUTCFullYear(),
      slot.scheduledFor.getUTCMonth() + 1,
      1,
      slot.scheduledFor.getUTCHours(),
      0,
      0,
      0,
    ),
  );
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Normalise the external recipient list: trim, lowercase, drop blanks, dedupe
 * and bound. Returns a problem string rather than throwing so handlers can
 * report it as a 400.
 */
export type ReportEmailNormalization = {
  readonly emails: string[];
  readonly problem: string | null;
};

export const normalizeReportEmails = (emails: ReadonlyArray<string>): ReportEmailNormalization => {
  const normalized: string[] = [];

  for (const value of emails) {
    const email = value.trim().toLowerCase();

    if (!email) continue;

    if (!EMAIL_PATTERN.test(email) || email.length > 320)
      return { emails: [], problem: `${value} is not a valid email address` };

    if (!normalized.includes(email)) normalized.push(email);
  }

  if (normalized.length > DASHBOARD_REPORT_MAX_RECIPIENTS)
    return {
      emails: [],
      problem: `A report can have at most ${DASHBOARD_REPORT_MAX_RECIPIENTS} recipients`,
    };

  return { emails: normalized, problem: null };
};

/** Validate a report's schedule fields; `null` means valid. */
export const reportScheduleProblem = (
  frequency: DashboardReportFrequency,
  hourUtc: number,
): string | null => {
  if (!["daily", "weekly", "monthly"].includes(frequency))
    return "Choose a daily, weekly or monthly schedule";

  if (!Number.isInteger(hourUtc) || hourUtc < 0 || hourUtc > 23)
    return "Choose an hour between 0 and 23 (UTC)";

  return null;
};

export type ReportSection =
  | { readonly kind: "markdown"; readonly title: string; readonly markdown: string }
  | {
      readonly kind: "stat";
      readonly title: string;
      readonly total: number;
      readonly caption: string;
    }
  | {
      readonly kind: "buckets";
      readonly title: string;
      readonly total: number;
      readonly buckets: ReadonlyArray<{ readonly label: string; readonly value: number }>;
    }
  | {
      readonly kind: "table";
      readonly title: string;
      readonly total: number;
      /** Column headers in display order; every row has one cell per column. */
      readonly columns: ReadonlyArray<{ readonly id: string; readonly label: string }>;
      readonly rows: ReadonlyArray<ReadonlyArray<string>>;
    };

export type ReportDocument = {
  readonly title: string;
  readonly tenantName: string;
  readonly generatedAt: Date;
  readonly sections: ReadonlyArray<ReportSection>;
};

const WidgetConfig = Schema.Struct({
  dataset: Schema.optional(Schema.Literals(["devices", "software", "users"])),
  columns: Schema.optional(Schema.Array(Schema.String)),
  label: Schema.optional(Schema.String),
  markdown: Schema.optional(Schema.String),
});

type WidgetOptions = {
  readonly dataset?: "devices" | "software" | "users";
  readonly columns?: ReadonlyArray<string>;
  readonly label?: string;
  readonly markdown?: string;
};

type Column = { readonly id: string; readonly label: string };

const DEVICE_COLUMNS: ReadonlyArray<Column> = [
  { id: "name", label: "Name" },
  { id: "platform", label: "Platform" },
  { id: "osVersion", label: "OS version" },
  { id: "status", label: "Status" },
  { id: "health", label: "Health" },
  { id: "lastSeenAt", label: "Last seen" },
  { id: "enrolledAt", label: "Enrolled" },
  { id: "model", label: "Model" },
  { id: "serial", label: "Serial" },
];

const SOFTWARE_COLUMNS: ReadonlyArray<Column> = [
  { id: "name", label: "Application" },
  { id: "version", label: "Version" },
  { id: "managed", label: "Managed" },
  { id: "deviceCount", label: "Devices" },
  { id: "bundleId", label: "Bundle ID" },
];

const USER_COLUMNS: ReadonlyArray<Column> = [
  { id: "name", label: "Name" },
  { id: "email", label: "Email" },
  { id: "status", label: "Status" },
  { id: "source", label: "Source" },
];

const DEFAULT_COLUMNS = {
  devices: ["name", "platform", "osVersion", "status", "health", "lastSeenAt"],
  software: ["name", "version", "managed", "deviceCount"],
  users: ["name", "email", "status", "source"],
} as const satisfies Record<"devices" | "software" | "users", ReadonlyArray<string>>;

const columnsFor = (
  dataset: "devices" | "software" | "users",
  configured: ReadonlyArray<string> | undefined,
): ReadonlyArray<Column> => {
  const available = Match.value(dataset).pipe(
    Match.when("software", () => SOFTWARE_COLUMNS),
    Match.when("users", () => USER_COLUMNS),
    Match.orElse(() => DEVICE_COLUMNS),
  );

  const ids = configured && configured.length > 0 ? configured : DEFAULT_COLUMNS[dataset];

  return ids
    .map((id) => available.find((column) => column.id === id))
    .filter((column): column is Column => column !== undefined);
};

const platformLabel = (value: string | null | undefined) => {
  switch (value) {
    case "apple":
      return "Apple";
    case "win":
      return "Windows";
    case "android":
      return "Android";
    default:
      return value || "—";
  }
};

/**
 * One cell for a shared dashboard row. Kept explicit rather than indexing the
 * row by string so the report cannot silently render an unknown column.
 */
const rowCell = (row: DashboardQueryResponse["rows"][number], column: string): string => {
  switch (column) {
    case "name":
      return row.name;
    case "platform":
      return platformLabel(row.platform);
    case "osVersion":
      return row.osVersion ?? "";
    case "status":
      return row.status ?? "";
    case "health":
      return row.health ?? "";
    case "lastSeenAt":
      return row.lastSeenAt ?? "";
    case "enrolledAt":
      return row.enrolledAt ?? "";
    case "model":
      return row.model ?? "";
    case "serial":
      return row.serial ?? "";
    case "version":
      return row.version ?? "";
    case "bundleId":
      return row.bundleId ?? "";
    case "email":
      return row.email ?? "";
    case "source":
      return row.source ?? "";
    case "managed":
      return row.managed === null || row.managed === undefined
        ? ""
        : row.managed
          ? "Managed"
          : "Unmanaged";
    case "deviceCount":
      return row.deviceCount === null || row.deviceCount === undefined
        ? ""
        : String(row.deviceCount);
    default:
      return "";
  }
};

/**
 * Turn widget definitions and their query results into report sections.
 * Empty results stay empty: a section with no rows renders an explicit
 * "No rows" line instead of being dropped, so a reader can tell the difference
 * between "nothing matched" and "the widget was never included".
 */
export const buildReportDocument = (input: {
  readonly title: string;
  readonly tenantName: string;
  readonly generatedAt: Date;
  readonly widgets: ReadonlyArray<{
    readonly type: DashboardWidgetType;
    readonly title: string;
    readonly config: unknown;
  }>;
  readonly results: ReadonlyArray<DashboardQueryResponse>;
}): ReportDocument => {
  const sections: ReportSection[] = input.widgets.map((widget, index) => {
    const config: WidgetOptions = Option.getOrElse(
      Schema.decodeUnknownOption(WidgetConfig)(widget.config),
      () => ({}),
    );

    const dataset = config.dataset ?? "devices";
    const result = input.results[index] ?? { total: 0, rows: [], buckets: [] };

    const datasetLabel = Match.value(dataset).pipe(
      Match.when("software", () => "applications"),
      Match.when("users", () => "users"),
      Match.orElse(() => "devices"),
    );

    if (widget.type === "markdown")
      return { kind: "markdown", title: widget.title, markdown: config.markdown ?? "" };

    if (widget.type === "stat")
      return {
        kind: "stat",
        title: widget.title,
        total: result.total,
        caption: config.label ?? datasetLabel,
      };

    if (widget.type === "pie")
      return {
        kind: "buckets",
        title: widget.title,
        total: result.total,
        buckets: result.buckets,
      };

    const columns = columnsFor(dataset, config.columns);

    return {
      kind: "table",
      title: widget.title,
      total: result.total,
      columns,
      rows: result.rows.map((row) => columns.map((column) => rowCell(row, column.id))),
    };
  });

  return {
    title: input.title,
    tenantName: input.tenantName,
    generatedAt: input.generatedAt,
    sections,
  };
};

const reportHeader = (document: ReportDocument): ReadonlyArray<ReadonlyArray<string>> => [
  ["Report", document.title],
  ["Tenant", document.tenantName],
  ["Generated", document.generatedAt.toISOString()],
  ["Timezone", REPORT_TIMEZONE],
];

const markdownToText = (markdown: string) =>
  markdown
    .replaceAll(/!\(\[[^\]]*\]\)\([^)]*\)/g, "")
    .replaceAll(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replaceAll(/^\s{0,3}#{1,6}\s+/gm, "")
    .replaceAll(/[*_`]/g, "")
    .trim();

/**
 * CSV with one labelled section per widget.
 *
 * A wide table cannot share a header row with a pie chart, so each section
 * starts with its own metadata rows and a blank separator. Column order comes
 * from the widget configuration (or the dataset default), never from object
 * iteration order.
 */
export const reportCsv = (document: ReportDocument): string => {
  /** One key/value row; `toCsv` escapes both cells. */
  const meta = (key: string, value: string) => toCsv([key, value], []).trimEnd();
  const lines: string[] = reportHeader(document).map(([key, value]) => meta(key, value));

  for (const section of document.sections) {
    lines.push("", meta("Widget", section.title), meta("Type", section.kind));

    if (section.kind === "markdown") {
      lines.push(meta("Markdown", markdownToText(section.markdown)));

      continue;
    }

    lines.push(meta("Total", String(section.total)));

    if (section.kind === "stat") {
      lines.push(meta("Caption", section.caption));

      continue;
    }

    if (section.kind === "buckets") {
      lines.push(
        toCsv(
          ["Value", "Count"],
          section.buckets.map((bucket) => [bucket.label, bucket.value]),
        ).trimEnd(),
      );

      continue;
    }

    lines.push(
      toCsv(
        section.columns.map((column) => column.label),
        section.rows.map((row) => [...row]),
      ).trimEnd(),
    );
  }

  return `${lines.join("\r\n")}\r\n`;
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/**
 * Print-ready HTML. Used as the email body for every format, and as the
 * attachment when a reader needs something a browser can open directly.
 */
export const reportHtml = (document: ReportDocument): string => {
  const sections = document.sections
    .map((section) => {
      const heading = `<h2>${escapeHtml(section.title)}</h2>`;

      if (section.kind === "markdown")
        return `<section>${heading}<pre class="note">${escapeHtml(markdownToText(section.markdown))}</pre></section>`;

      const total = `<p class="total">Total: <strong>${section.total}</strong></p>`;

      if (section.kind === "stat")
        return `<section>${heading}${total}<p class="caption">${escapeHtml(section.caption)}</p></section>`;

      if (section.kind === "buckets") {
        if (section.buckets.length === 0)
          return `<section>${heading}${total}<p class="empty">No data to chart.</p></section>`;

        const rows = section.buckets
          .map(
            (bucket) =>
              `<tr><th scope="row">${escapeHtml(bucket.label)}</th><td class="num">${bucket.value}</td></tr>`,
          )
          .join("");

        return `<section>${heading}${total}<table>${rows}</table></section>`;
      }

      if (section.rows.length === 0)
        return `<section>${heading}${total}<p class="empty">No rows match this query.</p></section>`;

      const head = section.columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("");

      const body = section.rows
        .map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(value)}</td>`).join("")}</tr>`)
        .join("");

      return `<section>${heading}${total}<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(document.title)}</title>
<style>
  body { font: 13px/normal -apple-system, system-ui, sans-serif; color: #1c1917; margin: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 22px 0 6px; border-bottom: 1px solid #e7e5e4; padding-bottom: 4px; }
  .meta { color: #78716c; font-size: 11px; margin: 0 0 12px; }
  .total { color: #57534e; margin: 0 0 6px; }
  .caption, .empty, .note { color: #78716c; }
  .note { white-space: pre-wrap; font-family: inherit; margin: 0; }
  table { border-collapse: collapse; width: 100%; font-size: 11px; }
  th, td { text-align: left; padding: 3px 6px; border-bottom: 1px solid #f0efee; vertical-align: top; }
  th { color: #78716c; font-weight: 600; }
  td.num, .num { text-align: right; font-variant-numeric: tabular-nums; }
  @media print { body { margin: 0; } section { break-inside: avoid-page; } }
</style>
</head>
<body>
<h1>${escapeHtml(document.title)}</h1>
<p class="meta">${escapeHtml(document.tenantName)} · generated ${escapeHtml(document.generatedAt.toISOString())} (UTC)</p>
${sections}
</body>
</html>`;
};

const pdfText = (value: string) =>
  value
    .replaceAll("–", "-")
    .replaceAll("—", "-")
    .replaceAll("’", "'")
    .replaceAll("‘", "'")
    .replaceAll("“", '"')
    .replaceAll("”", '"')
    .replaceAll("…", "...")
    .replaceAll("•", "-")
    // Core PDF fonts are WinAnsi; anything else becomes a visible placeholder
    // rather than silently corrupting the text stream.
    .replaceAll(/[^\u0020-\u007e]/g, "?");

const pdfEscape = (value: string) =>
  pdfText(value)
    .replaceAll("\\", String.raw`\\`)
    .replaceAll("(", String.raw`\(`)
    .replaceAll(")", String.raw`\)`);

const wrap = (text: string, maxChars: number): string[] => {
  const words = text.split(/\s+/).filter(Boolean);

  if (words.length === 0) return [""];

  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;

    if (candidate.length <= maxChars) {
      line = candidate;

      continue;
    }

    if (line) lines.push(line);

    line = word.slice(0, maxChars);
  }

  if (line) lines.push(line);

  return lines;
};

type PdfLine = { readonly text: string; readonly size: number; readonly bold: boolean };

const pdfLines = (document: ReportDocument): PdfLine[] => {
  const lines: PdfLine[] = [
    { text: document.title, size: 16, bold: true },
    {
      text: `${document.tenantName} - generated ${document.generatedAt.toISOString()} (UTC)`,
      size: 9,
      bold: false,
    },
  ];

  for (const section of document.sections) {
    lines.push({ text: "", size: 6, bold: false }, { text: section.title, size: 12, bold: true });

    if (section.kind === "markdown") {
      for (const line of markdownToText(section.markdown).split("\n"))
        for (const wrapped of wrap(line, 100)) lines.push({ text: wrapped, size: 9, bold: false });

      continue;
    }

    lines.push({ text: `Total: ${section.total}`, size: 9, bold: false });

    if (section.kind === "stat") {
      lines.push({ text: section.caption, size: 9, bold: false });

      continue;
    }

    if (section.kind === "buckets") {
      if (section.buckets.length === 0)
        lines.push({ text: "No data to chart.", size: 9, bold: false });

      for (const bucket of section.buckets)
        lines.push({ text: `${bucket.label}: ${bucket.value}`, size: 9, bold: false });

      continue;
    }

    if (section.rows.length === 0) {
      lines.push({ text: "No rows match this query.", size: 9, bold: false });

      continue;
    }

    const header = section.columns.map((column) => column.label).join(" | ");
    lines.push({ text: header.slice(0, 110), size: 8, bold: true });

    for (const row of section.rows) {
      const text = row.join(" | ");

      for (const wrapped of wrap(text.slice(0, 140), 110))
        lines.push({ text: wrapped, size: 8, bold: false });
    }
  }

  return lines;
};

const PAGE_WIDTH = 595.28;

const PAGE_HEIGHT = 841.89;

const MARGIN = 40;

const LINE_HEIGHT = 12;

const LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - MARGIN * 2) / LINE_HEIGHT) - 1;

/**
 * A small, dependency-free PDF writer.
 *
 * Core fonts only (Helvetica / Helvetica-Bold) and plain text, which is what a
 * report is: headings, counts and tables. It is deliberately not a renderer for
 * charts or embedded images - those are summarised as their underlying numbers.
 * Works in Workers because it writes bytes, not DOM.
 */
export const reportPdf = (document: ReportDocument): Uint8Array => {
  const lines = pdfLines(document);
  const pages: PdfLine[][] = [];

  for (let index = 0; index < lines.length; index += LINES_PER_PAGE)
    pages.push(lines.slice(index, index + LINES_PER_PAGE));

  if (pages.length === 0) pages.push([]);

  const fontRegular = 3;
  const fontBold = 4;
  const objects: string[] = [];
  const pageObjectIds = pages.map((_, index) => 5 + index * 2);
  const contentIds = pages.map((_, index) => 6 + index * 2);

  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[1] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[2] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[3] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";

  pages.forEach((page, index) => {
    const pageId = pageObjectIds[index];
    const contentId = contentIds[index];

    const body = page
      .map((line, lineIndex) => {
        if (!line.text) return "";
        const y = PAGE_HEIGHT - MARGIN - lineIndex * LINE_HEIGHT;

        return `BT /${line.bold ? "F2" : "F1"} ${line.size} Tf 1 0 0 1 ${MARGIN} ${y.toFixed(2)} Tm (${pdfEscape(line.text)}) Tj ET`;
      })
      .join("\n");

    const stream = `${body}\nBT /F1 8 Tf 1 0 0 1 ${MARGIN} 20 Tm (Page ${index + 1} of ${pages.length}) Tj ET`;

    objects[pageId - 1] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId - 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  let file = "%PDF-1.4\n";
  const offsets: number[] = [];

  objects.forEach((object, index) => {
    offsets.push(file.length);
    file += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = file.length;
  file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;

  for (const offset of offsets) file += `${String(offset).padStart(10, "0")} 00000 n \n`;

  file += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return new TextEncoder().encode(file);
};

const slug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 60) || "report";

export type ReportAttachment = {
  readonly filename: string;
  readonly contentType: string;
  /** Base64 so it survives the email outbox JSON unchanged. */
  readonly contentBase64: string;
  readonly sizeBytes: number;
};

const base64 = (bytes: Uint8Array) => {
  let binary = "";

  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));

  return btoa(binary);
};

/** The emailed attachment for one rendered report. */
export const reportAttachment = (
  document: ReportDocument,
  format: DashboardReportFormat,
  period: string,
): ReportAttachment => {
  const name = `${slug(document.title)}-${slug(period) || "report"}`;

  if (format === "pdf") {
    const bytes = reportPdf(document);

    return {
      filename: `${name}.pdf`,
      contentType: "application/pdf",
      contentBase64: base64(bytes),
      sizeBytes: bytes.length,
    };
  }

  const csv = reportCsv(document);
  const bytes = new TextEncoder().encode(csv);

  return {
    filename: `${name}.csv`,
    contentType: "text/csv; charset=utf-8",
    contentBase64: base64(bytes),
    sizeBytes: bytes.length,
  };
};

/** Plain-text email body so a client that strips HTML still shows the report. */
export const reportEmailText = (document: ReportDocument) =>
  [
    `${document.title} - ${document.tenantName}`,
    `Generated ${document.generatedAt.toISOString()} (UTC)`,
    "",
    "The full report is attached.",
    ...document.sections.map((section) =>
      section.kind === "markdown" || section.kind === "stat"
        ? `- ${section.title}: ${section.kind === "stat" ? section.total : "note"}`
        : `- ${section.title}: ${section.total}`,
    ),
  ].join("\n");
