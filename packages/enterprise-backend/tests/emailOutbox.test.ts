import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { Db } from "@mattrax/enterprise-core";
import {
  EMAIL_DELIVERY_FAILED_ACTION,
  EMAIL_OUTBOX_BACKOFF_BASE_MS,
  EMAIL_OUTBOX_CLAIM_STALE_MS,
  EMAIL_OUTBOX_MAX_ATTEMPTS,
  EMAIL_OUTBOX_MAX_BACKOFF_MS,
  drainEmailOutbox,
  emailOutboxBackoffMs,
  enqueueEmail,
  purgeEmailOutbox,
  sendTransactionalEmail,
} from "../src/Mail/emailOutbox.ts";
import { makeEmailTransport } from "@mattrax/enterprise-backend";
import type { OutboundEmailMessage } from "@mattrax/email";
import { runMaintenance } from "../src/Tenant/maintenance.ts";
import { makeDb, runEffect } from "./helpers.js";

const now = new Date("2026-11-16T10:00:00.000Z");

const MINUTE = 60 * 1000;

const message = {
  to: "invitee@example.com",
  from: { name: "Acme", email: "hello@example.com" },
  subject: "Join Acme on Mattrax",
  text: "Accept the invitation",
  html: "<p>Accept the invitation</p>",
};

const enqueue = (
  db: ReturnType<typeof makeDb>,
  overrides: Partial<Parameters<typeof enqueueEmail>[1]> = {},
) =>
  runEffect(
    enqueueEmail(db, {
      recipient: "invitee@example.com",
      template: "invitation",
      message,
      organizationId: "org-1",
      dedupeKey: "invitation:inv-1:1",
      now,
      ...overrides,
    }),
  );

type SeedRow = {
  id: string;
  organizationId: string | null;
  subjectUserId: string | null;
  recipient: string;
  template: string;
  dedupeKey: string;
  payload: OutboundEmailMessage;
  status: string;
  attempts: number;
  nextAttemptAt: Date;
  claimedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  sentAt: Date | null;
};

const record = (overrides: Partial<SeedRow> = {}): SeedRow => ({
  id: "outbox-1",
  organizationId: "org-1",
  subjectUserId: null,
  recipient: "invitee@example.com",
  template: "invitation",
  dedupeKey: "invitation:inv-1:1",
  payload: message,
  status: "pending",
  attempts: 0,
  nextAttemptAt: now,
  claimedAt: null,
  lastError: null,
  createdAt: now,
  sentAt: null,
  ...overrides,
});

describe("email outbox backoff", () => {
  it("doubles from five minutes and caps at six hours", () => {
    expect(EMAIL_OUTBOX_BACKOFF_BASE_MS).toBe(5 * MINUTE);
    expect(emailOutboxBackoffMs(1)).toBe(5 * MINUTE);
    expect(emailOutboxBackoffMs(2)).toBe(10 * MINUTE);
    expect(emailOutboxBackoffMs(3)).toBe(20 * MINUTE);
    expect(emailOutboxBackoffMs(4)).toBe(40 * MINUTE);
    expect(emailOutboxBackoffMs(20)).toBe(EMAIL_OUTBOX_MAX_BACKOFF_MS);
  });
});

describe("email outbox enqueue", () => {
  it("stores a pending row with the rendered message", async () => {
    const db = makeDb();

    await expect(enqueue(db)).resolves.toBe("queued");

    expect(db.store.email_outbox).toHaveLength(1);
    expect(db.store.email_outbox[0]).toMatchObject({
      organizationId: "org-1",
      recipient: "invitee@example.com",
      template: "invitation",
      dedupeKey: "invitation:inv-1:1",
      status: "pending",
      attempts: 0,
      nextAttemptAt: now,
    });
    expect(db.store.email_outbox[0]!.payload).toMatchObject({ subject: "Join Acme on Mattrax" });
  });

  it("dedupes a retried request by its key", async () => {
    const db = makeDb();

    expect(await enqueue(db)).toBe("queued");
    expect(await enqueue(db)).toBe("duplicate");
    expect(db.store.email_outbox).toHaveLength(1);
  });

  it("never fails the request when the queue write fails", async () => {
    const db = makeDb();

    // The fake store exposes the same row array the insert builder pushes to.
    db.store.email_outbox.push = () => {
      throw new Error("database is down");
    };

    await expect(enqueue(db)).resolves.toBe("failed");
  });

  it("delivers inline for a local transport instead of queueing", async () => {
    const db = makeDb();
    const sent: OutboundEmailMessage[] = [];

    const outcome = await runEffect(
      sendTransactionalEmail({
        db,
        email: makeEmailTransport(async (item) => void sent.push(item), { local: true }),
        recipient: "invitee@example.com",
        template: "invitation",
        message,
      }),
    );

    expect(outcome).toBe("delivered");
    expect(sent).toHaveLength(1);
    expect(db.store.email_outbox).toHaveLength(0);
  });

  it("reports skipped when the deployment has no transport", async () => {
    const db = makeDb();

    await expect(
      runEffect(
        sendTransactionalEmail({
          db,
          email: undefined,
          recipient: "invitee@example.com",
          template: "invitation",
          message,
        }),
      ),
    ).resolves.toBe("skipped");
    expect(db.store.email_outbox).toHaveLength(0);
  });
});

describe("email outbox drain", () => {
  it("sends a due row and marks it delivered", async () => {
    const db = makeDb({ email_outbox: [record()] });
    const sent: OutboundEmailMessage[] = [];

    const result = await runEffect(
      drainEmailOutbox({
        db,
        email: makeEmailTransport(async (item) => void sent.push(item)),
        now: new Date(now.getTime() + 1000),
      }),
    );

    expect(result).toMatchObject({ due: 1, sent: 1, retried: 0, failed: 0 });
    expect(sent[0]).toMatchObject({ to: "invitee@example.com", subject: "Join Acme on Mattrax" });
    expect(db.store.email_outbox[0]).toMatchObject({ status: "sent", attempts: 1 });
    expect(db.store.email_outbox[0]!.sentAt).toEqual(new Date(now.getTime() + 1000));
  });

  it("reschedules a failed delivery with backoff and purges delivered rows later", async () => {
    const db = makeDb({ email_outbox: [record()] });

    const email = makeEmailTransport(async () => {
      throw new Error("Resend rejected the message with status 503");
    });

    const first = await runEffect(
      drainEmailOutbox({ db, email, now: new Date(now.getTime() + MINUTE) }),
    );

    expect(first).toMatchObject({ due: 1, sent: 0, retried: 1 });
    expect(db.store.email_outbox[0]).toMatchObject({
      status: "pending",
      attempts: 1,
      lastError: "Resend rejected the message with status 503",
    });
    expect(db.store.email_outbox[0]!.nextAttemptAt).toEqual(new Date(now.getTime() + 6 * MINUTE));

    // Not due yet: the backoff is real, not a same-run retry loop.
    expect(
      await runEffect(drainEmailOutbox({ db, email, now: new Date(now.getTime() + 2 * MINUTE) })),
    ).toMatchObject({ due: 0 });

    // Due after the backoff: the second attempt halves the remaining attempts.
    expect(
      await runEffect(drainEmailOutbox({ db, email, now: new Date(now.getTime() + 7 * MINUTE) })),
    ).toMatchObject({ due: 1, retried: 1 });
    expect(db.store.email_outbox[0]).toMatchObject({ attempts: 2 });
  });

  it("marks a permanently failed row and audits it once", async () => {
    const db = makeDb({
      email_outbox: [record({ attempts: EMAIL_OUTBOX_MAX_ATTEMPTS - 1 })],
    });

    const result = await runEffect(
      drainEmailOutbox({
        db,
        email: makeEmailTransport(async () => {
          throw new Error("provider down");
        }),
        now: new Date(now.getTime() + MINUTE),
      }),
    );

    expect(result).toMatchObject({ sent: 0, failed: 1 });
    expect(db.store.email_outbox[0]).toMatchObject({
      status: "failed",
      attempts: EMAIL_OUTBOX_MAX_ATTEMPTS,
    });
    expect(db.store.audit_log).toHaveLength(1);
    expect(db.store.audit_log[0]).toMatchObject({
      organizationId: "org-1",
      action: EMAIL_DELIVERY_FAILED_ACTION,
      targetType: "email_outbox",
      targetId: "outbox-1",
      metadata: {
        template: "invitation",
        attempts: EMAIL_OUTBOX_MAX_ATTEMPTS,
        recipient: "invitee@example.com",
      },
    });

    // A failed row is terminal: a later run does not retry or re-audit it.
    expect(
      await runEffect(
        drainEmailOutbox({
          db,
          email: makeEmailTransport(async () => undefined),
          now: new Date(now.getTime() + 60 * MINUTE),
        }),
      ),
    ).toMatchObject({ due: 0 });
    expect(db.store.audit_log).toHaveLength(1);
  });

  it("does not deliver a row another isolate has claimed", async () => {
    const db = makeDb({
      email_outbox: [record({ claimedAt: new Date(now.getTime() - MINUTE) })],
    });

    const sent: string[] = [];

    const result = await runEffect(
      drainEmailOutbox({
        db,
        email: makeEmailTransport(async () => void sent.push("sent")),
        now: new Date(now.getTime() + MINUTE),
      }),
    );

    expect(result.due).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("reclaims a stale claim", async () => {
    const db = makeDb({
      email_outbox: [
        record({ claimedAt: new Date(now.getTime() - EMAIL_OUTBOX_CLAIM_STALE_MS - MINUTE) }),
      ],
    });

    const sent: string[] = [];

    const result = await runEffect(
      drainEmailOutbox({
        db,
        email: makeEmailTransport(async () => void sent.push("sent")),
        now: new Date(now.getTime() + MINUTE),
      }),
    );

    expect(result).toMatchObject({ due: 1, sent: 1 });
    expect(sent).toHaveLength(1);
  });

  it("bounds concurrency across due rows", async () => {
    const rows = Array.from({ length: 6 }, (_, index) =>
      record({ id: `outbox-${index}`, dedupeKey: `invitation:${index}` }),
    );

    const db = makeDb({ email_outbox: rows });

    let inFlight = 0;
    let peak = 0;

    const result = await runEffect(
      drainEmailOutbox({
        db,
        concurrency: 2,
        now: new Date(now.getTime() + MINUTE),
        email: makeEmailTransport(async () => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 5));
          inFlight -= 1;
        }),
      }),
    );

    expect(result).toMatchObject({ due: 6, sent: 6 });
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("leaves rows pending when the deployment has no transport", async () => {
    const db = makeDb({ email_outbox: [record()] });

    expect(
      await runEffect(drainEmailOutbox({ db, email: null, now: new Date(now.getTime() + MINUTE) })),
    ).toMatchObject({ due: 0, sent: 0 });
    expect(db.store.email_outbox[0]).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("purges delivered and failed rows after their retention windows", async () => {
    const db = makeDb({
      email_outbox: [
        record({
          id: "old-sent",
          status: "sent",
          createdAt: new Date(now.getTime() - 8 * 24 * 60 * MINUTE),
        }),
        record({ id: "recent-sent", status: "sent", createdAt: new Date(now.getTime() - MINUTE) }),
        record({
          id: "old-failed",
          status: "failed",
          createdAt: new Date(now.getTime() - 31 * 24 * 60 * MINUTE),
        }),
        record({ id: "pending", status: "pending" }),
      ],
    });

    expect(await runEffect(purgeEmailOutbox(db, { now }))).toBe(2);
    expect(db.store.email_outbox.map((row: { id: string }) => row.id).sort()).toEqual([
      "pending",
      "recent-sent",
    ]);
  });
});

describe("maintenance drains the outbox", () => {
  it("delivers queued mail during the daily run and records the counts", async () => {
    const db = makeDb({ email_outbox: [record()] });
    const sent: string[] = [];

    const result = await runEffect(
      runMaintenance({
        now: new Date(now.getTime() + MINUTE),
        auditRetentionDays: 0,
        credentialAlerts: false,
        dynamicGroups: false,
        email: makeEmailTransport(async () => void sent.push("sent")),
      }).pipe(Effect.provideService(Db, db)),
    );

    expect(result.emailOutboxSent).toBe(1);
    expect(result.emailOutboxRetried).toBe(0);
    expect(result.emailOutboxFailed).toBe(0);
    expect(sent).toHaveLength(1);
    expect(db.store.email_outbox[0]).toMatchObject({ status: "sent" });
  });

  it("leaves queued mail untouched without a transport", async () => {
    const db = makeDb({ email_outbox: [record()] });

    const result = await runEffect(
      runMaintenance({
        now: new Date(now.getTime() + MINUTE),
        auditRetentionDays: 0,
        credentialAlerts: false,
        dynamicGroups: false,
      }).pipe(Effect.provideService(Db, db)),
    );

    expect(result.emailOutboxSent).toBe(0);
    expect(db.store.email_outbox[0]).toMatchObject({ status: "pending", attempts: 0 });
  });
});
