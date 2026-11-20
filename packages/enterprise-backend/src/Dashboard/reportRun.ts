import { Effect, Option, Schema } from "effect";
import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
import {
  DashboardReportFrequency,
  DashboardWidgetType,
  dashboardQueryForWidget,
  type DashboardQueryResponse,
  type DashboardReport,
  type DashboardReportFormat,
  type DashboardReportRecipients,
  type DashboardReportRun as DashboardReportRunInfo,
  type DashboardReportRunStatus,
} from "@mattrax/enterprise-domain";
import { DEFAULT_EMAIL_FROM, type EmailAddress, type EmailTransport } from "@mattrax/email";
import { schema as s, type EnterpriseDb } from "../schema.ts";
import { runDashboardQueryBatch } from "./dashboardQuery.ts";
import {
  buildReportDocument,
  normalizeReportEmails,
  nextScheduledReportSlot,
  REPORT_RUN_CLAIM_STALE_MS,
  REPORT_RUN_MAX_ATTEMPTS,
  reportAttachment,
  reportEmailText,
  reportHtml,
  scheduledReportSlot,
  type ReportDocument,
} from "./report.ts";
import { sendTransactionalEmail } from "../Mail/emailOutbox.ts";

/**
 * Scheduled dashboard reports.
 *
 * A report is a dashboard snapshot rendered to CSV/PDF and queued through the
 * transactional outbox. The period row in `dashboard_report_run` is the
 * idempotency boundary: a unique `(reportId, period)` row is claimed with a
 * compare-and-set before anything is generated, so two cron ticks (or two
 * isolates) cannot email the same digest twice. A failed attempt is retried in
 * the same period by the next maintenance run, and the outbox dedupe key per
 * recipient makes that retry safe even if some mail was already queued.
 */

export const DASHBOARD_REPORT_RUN_RETENTION_DAYS = 180;

const iso = (date: Date | null | undefined) => (date ? date.toISOString() : null);

const reportId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 24);

const frequencyOf = (value: string): DashboardReportFrequency =>
  Schema.is(DashboardReportFrequency)(value) ? value : "daily";

const formatOf = (value: string): DashboardReportFormat =>
  value === "pdf" ? "pdf" : "csv";

const statusOf = (value: string): DashboardReportRunStatus =>
  value === "sending" || value === "queued" || value === "failed" ? value : "pending";

const widgetTypeOf = (value: string): DashboardWidgetType =>
  Schema.is(DashboardWidgetType)(value) ? value : "table";

const describeFailure = (cause: unknown): string => {
  const message = cause instanceof Error ? cause.message : "report generation failed";

  return message.replaceAll(/\s+/g, " ").trim().slice(0, 500) || "report generation failed";
};

export type DashboardReportRow = typeof s.dashboardReport.$inferSelect;

export type DashboardReportRunRow = typeof s.dashboardReportRun.$inferSelect;

/** API projection of a report definition. */
export const dashboardReportInfo = (row: DashboardReportRow): DashboardReport => ({
  id: row.id,
  dashboardId: row.dashboardId,
  name: row.name,
  frequency: frequencyOf(row.frequency),
  hourUtc: row.hourUtc,
  format: formatOf(row.format),
  enabled: row.enabled,
  recipients: {
    memberAccountIds: Array.isArray(row.memberAccountIds) ? row.memberAccountIds : [],
    emails: Array.isArray(row.externalEmails) ? row.externalEmails : [],
  },
  lastPeriod: row.lastPeriod ?? null,
  lastRunAt: iso(row.lastRunAt),
  nextRunAt: iso(row.nextRunAt),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/** API projection of one run attempt. */
export const dashboardReportRunInfo = (row: DashboardReportRunRow): DashboardReportRunInfo => ({
  id: row.id,
  reportId: row.reportId,
  reportName: row.reportName,
  format: formatOf(row.format),
  period: row.period,
  status: statusOf(row.status),
  attempts: row.attempts,
  recipients: Array.isArray(row.recipients) ? row.recipients : [],
  sizeBytes: row.sizeBytes,
  error: row.lastError,
  startedAt: iso(row.startedAt),
  completedAt: iso(row.completedAt),
  createdAt: row.createdAt.toISOString(),
});

export type ReportRecipientResult =
  | { readonly ok: true; readonly recipients: DashboardReportRecipients }
  | { readonly ok: false; readonly problem: string };

/**
 * Validate a recipient list against the tenant.
 *
 * Members must be current memberships; addresses are normalised, deduplicated
 * and bounded. The caller decides whether the actor may add external addresses;
 * this function only checks that they are well formed.
 */
export const validateReportRecipients = (
  db: EnterpriseDb,
  organizationId: string,
  input: DashboardReportRecipients,
): Effect.Effect<ReportRecipientResult, unknown> =>
  Effect.gen(function* () {
    const memberAccountIds = [...new Set(input.memberAccountIds.map((id) => id.trim()))].filter(
      Boolean,
    );

    const normalized = normalizeReportEmails(input.emails);

    if (normalized.problem)
      return { ok: false as const, problem: normalized.problem };

    if (memberAccountIds.length + normalized.emails.length === 0)
      return { ok: false as const, problem: "Add at least one recipient" };

    if (memberAccountIds.length > 0) {
      const members = yield* db
        .select({ accountId: s.member.accountId })
        .from(s.member)
        .where(
          and(
            eq(s.member.organizationId, organizationId),
            inArray(s.member.accountId, memberAccountIds),
          ),
        );

      const allowed = new Set(members.map((member) => member.accountId));

      if (memberAccountIds.some((id) => !allowed.has(id)))
        return {
          ok: false as const,
          problem: "A selected member is no longer part of this tenant",
        };
    }

    return {
      ok: true as const,
      recipients: { memberAccountIds, emails: normalized.emails },
    };
  });

/**
 * Resolve the addresses a report is actually sent to.
 *
 * Membership is re-read at send time, so removing somebody from the tenant
 * stops their reports immediately. Disabled and unverified accounts are
 * skipped: report mail carries tenant data and must not land in an
 * unverified mailbox.
 */
export const resolveReportRecipients = (
  db: EnterpriseDb,
  organizationId: string,
  recipients: DashboardReportRecipients,
): Effect.Effect<string[], unknown> =>
  Effect.gen(function* () {
    const emails = new Set<string>(normalizeReportEmails(recipients.emails).emails);
    const memberAccountIds = [...new Set(recipients.memberAccountIds)];

    if (memberAccountIds.length > 0) {
      const rows = yield* db
        .select({
          email: s.account.email,
          emailVerified: s.account.emailVerified,
          disabled: s.account.disabled,
        })
        .from(s.member)
        .innerJoin(s.account, eq(s.member.accountId, s.account.id))
        .where(
          and(
            eq(s.member.organizationId, organizationId),
            inArray(s.member.accountId, memberAccountIds),
          ),
        );

      for (const row of rows) {
        if (row.disabled || !row.emailVerified) continue;

        emails.add(row.email.trim().toLowerCase());
      }
    }

    return [...emails];
  });

/**
 * Render a dashboard to a report document with the same queries the dashboard
 * page issues. Returns `None` when the dashboard was deleted between the
 * report being queued and the run.
 */
export const loadDashboardReportDocument = (
  db: EnterpriseDb,
  organizationId: string,
  dashboardId: string,
  generatedAt: Date,
): Effect.Effect<Option.Option<ReportDocument>, unknown> =>
  Effect.gen(function* () {
    const [dashboard] = yield* db
      .select()
      .from(s.dashboard)
      .where(and(eq(s.dashboard.id, dashboardId), eq(s.dashboard.organizationId, organizationId)))
      .limit(1);

    if (!dashboard) return Option.none();

    const [organization] = yield* db
      .select()
      .from(s.organization)
      .where(eq(s.organization.id, organizationId))
      .limit(1);

    const widgets = yield* db
      .select()
      .from(s.dashboardWidget)
      .where(eq(s.dashboardWidget.dashboardId, dashboard.id))
      .orderBy(asc(s.dashboardWidget.y), asc(s.dashboardWidget.x));

    const queryable = widgets.filter((widget) => widget.type !== "markdown");
    const empty: DashboardQueryResponse = { total: 0, rows: [], buckets: [] };
    const results: DashboardQueryResponse[] = [];

    if (queryable.length > 0) {
      const batch = yield* runDashboardQueryBatch(
        db,
        organizationId,
        queryable.map((widget) =>
          dashboardQueryForWidget({ type: widgetTypeOf(widget.type), config: widget.config }),
        ),
      );

      let index = 0;

      for (const widget of widgets)
        results.push(widget.type === "markdown" ? empty : (batch.results[index++] ?? empty));
    } else for (let index = 0; index < widgets.length; index += 1) results.push(empty);

    return Option.some(
      buildReportDocument({
        title: dashboard.name,
        tenantName: organization?.name ?? "Tenant",
        generatedAt,
        widgets: widgets.map((widget) => ({
          type: widgetTypeOf(widget.type),
          title: widget.title,
          config: widget.config,
        })),
        results,
      }),
    );
  });

export type ReportRunContext = {
  readonly db: EnterpriseDb;
  readonly email: EmailTransport;
  readonly from?: EmailAddress;
  readonly report: DashboardReportRow;
  /** Period key; scheduled slots are dates, manual runs are `manual:<id>`. */
  readonly period: string;
  readonly now: Date;
};

const failRun = (db: EnterpriseDb, runId: string, cause: unknown) =>
  Effect.gen(function* () {
    yield* db
      .update(s.dashboardReportRun)
      .set({
        status: "failed",
        lastError: describeFailure(cause),
        completedAt: new Date(),
      })
      .where(eq(s.dashboardReportRun.id, runId));
  }).pipe(Effect.catch(() => Effect.void));

/**
 * Claim a run row for this period, or return `null` when another attempt owns
 * it, it already succeeded, or it exhausted its attempts.
 */
const claimRun = (
  db: EnterpriseDb,
  report: DashboardReportRow,
  period: string,
  now: Date,
): Effect.Effect<DashboardReportRunRow | null, unknown> =>
  Effect.gen(function* () {
    const find = () =>
      Effect.gen(function* () {
        const [row] = yield* db
          .select()
          .from(s.dashboardReportRun)
          .where(
            and(
              eq(s.dashboardReportRun.reportId, report.id),
              eq(s.dashboardReportRun.period, period),
            ),
          )
          .limit(1);

        return row;
      });

    let existing = yield* find();

    if (!existing) {
      // A concurrent isolate may have inserted the same period first. The
      // insert failure is deliberately ignored: the re-read plus the
      // compare-and-set below decide which caller proceeds.
      yield* Effect.exit(
        Effect.gen(function* () {
          yield* db.insert(s.dashboardReportRun).values({
            id: reportId(),
            organizationId: report.organizationId,
            reportId: report.id,
            reportName: report.name,
            format: report.format,
            period,
            status: "pending",
            attempts: 0,
            recipients: [],
            sizeBytes: 0,
            lastError: null,
            startedAt: null,
            completedAt: null,
            createdAt: now,
          });
        }),
      );

      existing = yield* find();
    }

    if (!existing) return null;

    if (existing.status === "queued") return null;

    if (existing.attempts >= REPORT_RUN_MAX_ATTEMPTS) return null;

    if (
      existing.status === "sending" &&
      existing.startedAt &&
      now.getTime() - existing.startedAt.getTime() < REPORT_RUN_CLAIM_STALE_MS
    )
      return null;

    const claimed = yield* db
      .update(s.dashboardReportRun)
      .set({
        status: "sending",
        attempts: existing.attempts + 1,
        startedAt: now,
        completedAt: null,
        lastError: null,
        recipients: [],
        sizeBytes: 0,
      })
      .where(
        and(
          eq(s.dashboardReportRun.id, existing.id),
          eq(s.dashboardReportRun.status, existing.status),
          eq(s.dashboardReportRun.attempts, existing.attempts),
        ),
      );

    if (claimed.affectedRows !== 1) return null;

    return {
      ...existing,
      status: "sending" as const,
      attempts: existing.attempts + 1,
      startedAt: now,
    };
  });

/**
 * Generate, attach and queue one claimed run.
 *
 * One outbox message per recipient keeps addresses private and gives every
 * recipient its own retry. The dedupe key is the report + period + address, so
 * re-running a failed period cannot queue a second copy for anybody.
 */
const deliverRun = (context: ReportRunContext, run: DashboardReportRunRow) =>
  Effect.gen(function* () {
    const { db, report, period, now } = context;

    const document = yield* loadDashboardReportDocument(
      db,
      report.organizationId,
      report.dashboardId,
      now,
    );

    if (Option.isNone(document)) {
      yield* failRun(db, run.id, new Error("Dashboard not found"));

      return "failed" as const;
    }

    const recipients = yield* resolveReportRecipients(db, report.organizationId, {
      memberAccountIds: Array.isArray(report.memberAccountIds) ? report.memberAccountIds : [],
      emails: Array.isArray(report.externalEmails) ? report.externalEmails : [],
    });

    if (recipients.length === 0) {
      yield* failRun(db, run.id, new Error("No recipients are available for this report"));

      return "failed" as const;
    }

    const attachment = reportAttachment(document.value, formatOf(report.format), period);
    const subject = `${document.value.title} report - ${document.value.generatedAt.toISOString().slice(0, 10)}`;
    const from = context.from ?? DEFAULT_EMAIL_FROM;

    const outcomes = yield* Effect.forEach(
      recipients,
      (recipient) =>
        sendTransactionalEmail({
          db,
          email: context.email,
          template: "dashboard_report",
          recipient,
          organizationId: report.organizationId,
          dedupeKey: `dashboard_report:${report.id}:${period}:${recipient}`,
          message: {
            to: recipient,
            from,
            subject,
            text: reportEmailText(document.value),
            html: reportHtml(document.value),
            attachments: [
              {
                filename: attachment.filename,
                contentType: attachment.contentType,
                contentBase64: attachment.contentBase64,
              },
            ],
          },
        }),
      { concurrency: 2 },
    );

    const queued = outcomes.filter(
      (outcome) => outcome === "queued" || outcome === "delivered" || outcome === "duplicate",
    ).length;

    if (queued === 0) {
      yield* failRun(db, run.id, new Error("The report could not be queued for any recipient"));

      return "failed" as const;
    }

    const partial = queued < outcomes.length;

    yield* db
      .update(s.dashboardReportRun)
      .set({
        status: "queued",
        recipients,
        sizeBytes: attachment.sizeBytes,
        lastError: partial ? `${outcomes.length - queued} recipient(s) could not be queued` : null,
        completedAt: new Date(),
      })
      .where(eq(s.dashboardReportRun.id, run.id));

    if (!period.startsWith("manual:"))
      yield* db
        .update(s.dashboardReport)
        .set({
          lastPeriod: period,
          lastRunAt: now,
          nextRunAt: nextScheduledReportSlot(
            frequencyOf(report.frequency),
            report.hourUtc,
            now,
          ),
          updatedAt: now,
        })
        .where(eq(s.dashboardReport.id, report.id));
    else
      yield* db
        .update(s.dashboardReport)
        .set({ lastRunAt: now, updatedAt: now })
        .where(eq(s.dashboardReport.id, report.id));

    return "queued" as const;
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.gen(function* () {
        yield* failRun(context.db, run.id, cause);

        return "failed" as const;
      }),
    ),
  );

export type SendReportNowResult =
  | { readonly outcome: "queued"; readonly run: DashboardReportRunInfo }
  | { readonly outcome: "skipped"; readonly run: DashboardReportRunInfo | null }
  | { readonly outcome: "failed"; readonly run: DashboardReportRunInfo | null };

/** Queue one immediate run outside the schedule (Settings → Send now). */
export const sendDashboardReportNow = (
  options: Omit<ReportRunContext, "period">,
): Effect.Effect<SendReportNowResult, unknown> =>
  Effect.gen(function* () {
    const period = `manual:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    // Manual runs are deliberately not retried: the user is waiting and can
    // press the button again. They still claim a row so the attempt is visible
    // in the run history.
    const run = yield* claimRun(options.db, options.report, period, options.now);

    if (!run) return { outcome: "skipped" as const, run: null };

    const outcome = yield* deliverRun({ ...options, period }, run);

    const [row] = yield* options.db
      .select()
      .from(s.dashboardReportRun)
      .where(eq(s.dashboardReportRun.id, run.id))
      .limit(1);

    const info = row ? dashboardReportRunInfo(row) : null;

    if (!info) return { outcome: "skipped" as const, run: null };

    return outcome === "queued"
      ? { outcome: "queued" as const, run: info }
      : { outcome: "failed" as const, run: info };
  });

export type RunScheduledReportsOptions = {
  readonly db: EnterpriseDb;
  readonly email?: EmailTransport | null;
  readonly from?: EmailAddress;
  readonly now?: Date;
  /** Maximum reports examined per run. Defaults to 50. */
  readonly limit?: number;
  /** Restrict to one tenant (tests and manual backfills). */
  readonly organizationId?: string;
};

export type RunScheduledReportsResult = {
  readonly due: number;
  readonly queued: number;
  readonly skipped: number;
  readonly failed: number;
};

/**
 * Generate every report whose latest scheduled slot has not been queued yet.
 *
 * Runs are claimed per `(report, period)`, so an hourly cron tick that fires
 * several times in one hour is a no-op after the first success. A report whose
 * dashboard was deleted, whose recipients all left, or whose render failed is
 * recorded as `failed` and retried by the next tick up to the attempt cap.
 */
export const runScheduledReports = (
  options: RunScheduledReportsOptions,
): Effect.Effect<RunScheduledReportsResult> =>
  Effect.gen(function* () {
    const empty: RunScheduledReportsResult = { due: 0, queued: 0, skipped: 0, failed: 0 };
    const email = options.email;

    if (!email) return empty;

    const now = options.now ?? new Date();
    const limit = options.limit ?? 50;

    const reports = yield* options.db
      .select()
      .from(s.dashboardReport)
      .where(
        options.organizationId
          ? and(
              eq(s.dashboardReport.organizationId, options.organizationId),
              eq(s.dashboardReport.enabled, true),
            )
          : eq(s.dashboardReport.enabled, true),
      )
      .orderBy(asc(s.dashboardReport.createdAt))
      .limit(limit);

    const outcomes = yield* Effect.forEach(
      reports,
      (report) =>
        Effect.gen(function* () {
          const slot = scheduledReportSlot(frequencyOf(report.frequency), report.hourUtc, now);
          const run = yield* claimRun(options.db, report, slot.period, now);

          if (!run) return "skipped" as const;

          return yield* deliverRun(
            {
              db: options.db,
              email,
              from: options.from,
              report,
              period: slot.period,
              now,
            },
            run,
          );
        }).pipe(Effect.catch(() => Effect.succeed("failed" as const))),
      { concurrency: 2 },
    );

    return {
      due: outcomes.length,
      queued: outcomes.filter((outcome) => outcome === "queued").length,
      skipped: outcomes.filter((outcome) => outcome === "skipped").length,
      failed: outcomes.filter((outcome) => outcome === "failed").length,
    };
  }).pipe(Effect.catch(() => Effect.succeed({ due: 0, queued: 0, skipped: 0, failed: 0 })));

/** List recent runs for the report settings panel, newest first. */
export const listDashboardReportRuns = (
  db: EnterpriseDb,
  organizationId: string,
  reportId: string,
  limit = 10,
): Effect.Effect<DashboardReportRunInfo[], unknown> =>
  Effect.gen(function* () {
    const rows = yield* db
      .select()
      .from(s.dashboardReportRun)
      .where(
        and(
          eq(s.dashboardReportRun.organizationId, organizationId),
          eq(s.dashboardReportRun.reportId, reportId),
        ),
      )
      .orderBy(desc(s.dashboardReportRun.createdAt))
      .limit(Math.min(Math.max(limit, 1), 50));

    return rows.map(dashboardReportRunInfo);
  });

/** Delete run history older than the retention window. */
export const purgeDashboardReportRuns = (
  db: EnterpriseDb,
  now: Date = new Date(),
  retentionDays = DASHBOARD_REPORT_RUN_RETENTION_DAYS,
): Effect.Effect<number, unknown> =>
  Effect.gen(function* () {
    if (retentionDays <= 0) return 0;

    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

    const result = yield* db
      .delete(s.dashboardReportRun)
      .where(lt(s.dashboardReportRun.createdAt, cutoff));

    return result.affectedRows ?? 0;
  });
