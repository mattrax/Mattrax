import { describe, expect, it } from "vitest";
import { makeEmailTransport, type OutboundEmailMessage } from "@mattrax/email";
import {
  resolveReportRecipients,
  runScheduledReports,
  validateReportRecipients,
} from "../src/Dashboard/reportRun.ts";
import { makeDb, runEffect } from "./helpers.js";

const now = new Date("2026-11-20T09:00:00.000Z");

const created = new Date("2026-11-01T00:00:00.000Z");

const dashboardRow = {
  id: "dash-1",
  organizationId: "org-1",
  name: "Fleet digest",
  description: null,
  isDefault: true,
  createdByAccountId: null,
  createdAt: created,
  updatedAt: created,
};

type ReportOverrides = {
  id?: string;
  enabled?: boolean;
  memberAccountIds?: string[];
  externalEmails?: string[];
};

const reportRow = (overrides: ReportOverrides = {}) => ({
  id: "report-1",
  organizationId: "org-1",
  dashboardId: "dash-1",
  name: "Weekly fleet",
  frequency: "daily",
  hourUtc: 7,
  format: "csv",
  enabled: true,
  memberAccountIds: [],
  externalEmails: ["ops@example.com"],
  createdByAccountId: null,
  lastPeriod: null,
  lastRunAt: null,
  nextRunAt: null,
  createdAt: created,
  updatedAt: created,
  ...overrides,
});

/** Outbox-backed transport: report mail is queued, never sent inline. */
const transport = () => {
  const sent: OutboundEmailMessage[] = [];

  return {
    sent,
    email: makeEmailTransport(async (message) => {
      sent.push(message);
    }),
  };
};

describe("scheduled dashboard reports", () => {
  it("queues one digest per period and skips a second tick", async () => {
    const db = makeDb({
      dashboard: [dashboardRow],
      dashboard_report: [reportRow()],
    });

    const mail = transport();

    const first = await runEffect(runScheduledReports({ db, email: mail.email, now }));
    expect(first).toEqual({ due: 1, queued: 1, skipped: 0, failed: 0 });
    expect(db.store.email_outbox).toHaveLength(1);
    expect(db.store.email_outbox[0].recipient).toBe("ops@example.com");
    expect(db.store.email_outbox[0].template).toBe("dashboard_report");
    expect(db.store.email_outbox[0].dedupeKey).toBe(
      "dashboard_report:report-1:2026-11-20:ops@example.com",
    );
    expect(db.store.dashboard_report_run[0].status).toBe("queued");
    expect(db.store.dashboard_report_run[0].recipients).toEqual(["ops@example.com"]);
    expect(db.store.dashboard_report[0].lastPeriod).toBe("2026-11-20");
    expect(db.store.dashboard_report[0].nextRunAt).toEqual(new Date("2026-11-21T07:00:00.000Z"));

    // The hourly trigger fires again in the same slot: nothing is generated
    // and no second message is queued.
    const second = await runEffect(runScheduledReports({ db, email: mail.email, now }));
    expect(second).toEqual({ due: 1, queued: 0, skipped: 1, failed: 0 });
    expect(db.store.email_outbox).toHaveLength(1);
    expect(db.store.dashboard_report_run).toHaveLength(1);

    // The attachment is present and named for the period. The outbox payload
    // is written by `sendTransactionalEmail` from this report's attachment.
    // SAFETY: this test owns the only writer of that row.
    const payload = db.store.email_outbox[0].payload as {
      attachments: Array<{ filename: string; contentType: string; contentBase64: string }>;
    };

    expect(payload.attachments[0]?.filename).toBe("fleet-digest-2026-11-20.csv");
  });

  it("retries a failed period without duplicating a queued recipient", async () => {
    const db = makeDb({
      dashboard: [dashboardRow],
      dashboard_report: [
        reportRow({
          memberAccountIds: ["account-1"],
          externalEmails: [],
        }),
      ],
      member: [
        {
          id: "member-1",
          organizationId: "org-1",
          accountId: "account-1",
          role: "admin",
          customRoleId: null,
          createdAt: created,
          updatedAt: created,
        },
      ],
      account: [
        {
          id: "account-1",
          name: "Ops",
          email: "ops@example.com",
          emailVerified: true,
          disabled: false,
        },
      ],
    });

    const mail = transport();

    await runEffect(runScheduledReports({ db, email: mail.email, now }));
    expect(db.store.email_outbox).toHaveLength(1);

    // A crash after queueing (or an unrecorded success) leaves the run failed.
    db.store.dashboard_report_run[0]!.status = "failed";
    db.store.dashboard_report_run[0]!.attempts = 1;

    const retried = await runEffect(runScheduledReports({ db, email: mail.email, now }));

    expect(retried.queued).toBe(1);
    expect(db.store.dashboard_report_run[0]!.status).toBe("queued");
    expect(db.store.dashboard_report_run[0]!.attempts).toBe(2);
    // The dedupe key still matches, so the recipient is never queued twice.
    expect(db.store.email_outbox).toHaveLength(1);
  });

  it("stops retrying after the attempt cap", async () => {
    const db = makeDb({
      dashboard: [dashboardRow],
      dashboard_report: [reportRow()],
    });

    const mail = transport();

    await runEffect(runScheduledReports({ db, email: mail.email, now }));
    db.store.dashboard_report_run[0]!.status = "failed";
    db.store.dashboard_report_run[0]!.attempts = 3;

    const result = await runEffect(runScheduledReports({ db, email: mail.email, now }));
    expect(result).toEqual({ due: 1, queued: 0, skipped: 1, failed: 0 });
    expect(db.store.email_outbox).toHaveLength(1);
  });

  it("ignores paused reports and reports with no dashboard", async () => {
    const db = makeDb({
      dashboard: [],
      dashboard_report: [reportRow({ enabled: false }), reportRow({ id: "report-2" })],
    });

    const mail = transport();

    const result = await runEffect(runScheduledReports({ db, email: mail.email, now }));

    expect(result.due).toBe(1);
    expect(result.queued).toBe(0);
    expect(result.failed).toBe(1);
    expect(db.store.email_outbox).toHaveLength(0);
  });

  it("does nothing without a transport", async () => {
    const db = makeDb({
      dashboard: [dashboardRow],
      dashboard_report: [reportRow()],
    });

    const result = await runEffect(runScheduledReports({ db, email: null, now }));

    expect(result).toEqual({ due: 0, queued: 0, skipped: 0, failed: 0 });
    expect(db.store.dashboard_report_run).toHaveLength(0);
  });
});

describe("report recipient validation", () => {
  const db = makeDb({
    member: [
      {
        id: "member-1",
        organizationId: "org-1",
        accountId: "account-1",
        role: "admin",
        customRoleId: null,
        createdAt: created,
        updatedAt: created,
      },
    ],
    account: [
      {
        id: "account-1",
        name: "Ops",
        email: "ops@example.com",
        emailVerified: true,
        disabled: false,
      },
      {
        id: "account-2",
        name: "Unverified",
        email: "unverified@example.com",
        emailVerified: false,
        disabled: false,
      },
    ],
  });

  it("accepts current members and normalises external addresses", async () => {
    const result = await runEffect(
      validateReportRecipients(db, "org-1", {
        memberAccountIds: ["account-1", "account-1"],
        emails: [" Security@Example.com "],
      }),
    );

    expect(result).toEqual({
      ok: true,
      recipients: {
        memberAccountIds: ["account-1"],
        emails: ["security@example.com"],
      },
    });
  });

  it("rejects a member from another tenant", async () => {
    const result = await runEffect(
      validateReportRecipients(db, "org-2", {
        memberAccountIds: ["account-1"],
        emails: [],
      }),
    );

    expect(result.ok).toBe(false);

    if (!result.ok) expect(result.problem).toMatch(/no longer part of this tenant/);
  });

  it("rejects an empty recipient list and bad addresses", async () => {
    const empty = await runEffect(
      validateReportRecipients(db, "org-1", { memberAccountIds: [], emails: [] }),
    );

    expect(empty.ok).toBe(false);

    const bad = await runEffect(
      validateReportRecipients(db, "org-1", { memberAccountIds: [], emails: ["nope"] }),
    );

    expect(bad.ok).toBe(false);
  });

  it("skips disabled and unverified members when resolving", async () => {
    const recipients = await runEffect(
      resolveReportRecipients(db, "org-1", {
        memberAccountIds: ["account-1", "account-2", "account-3"],
        emails: ["external@example.com"],
      }),
    );

    expect(recipients).toEqual(["external@example.com", "ops@example.com"]);
  });
});
