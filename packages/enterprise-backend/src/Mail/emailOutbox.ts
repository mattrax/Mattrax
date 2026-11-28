import { newId } from "@mattrax/crypto";
import { and, asc, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { ACCOUNT_AUDIT } from "../Account/accountAudit.ts";
import { schema as s } from "../schema.ts";
import type { EnterpriseDb } from "../schema.ts";
import type { EmailTransport, OutboundEmailMessage } from "@mattrax/email";

/**
 * Durable transactional-email outbox.
 *
 * A request renders the message and inserts one row per recipient; nothing in
 * the request path talks to the provider. The cron drains due rows with
 * exponential backoff, a maximum attempt count and a bounded concurrency, so a
 * provider outage delays mail instead of failing a user action or losing it.
 *
 * Rows are claimed with a conditional UPDATE before delivery. A claim is what
 * makes the drain safe to run from several isolates: only the writer that
 * observed `affectedRows === 1` sends. The same claim is why a stuck row can be
 * retried by a later run once its claim is stale.
 *
 * Onboarding mail keeps its own atomic claim-and-send flow (see
 * `onboardingEmails.ts`) because it is at-most-once by design rather than
 * queued work.
 */

/** Templates that can be queued. Kept small so operations sees a known set. */
export const EMAIL_OUTBOX_TEMPLATES = [
  "invitation",
  "ownership_transfer",
  "email_verification",
  "registration_verification",
  "email_change_confirm",
  "email_change_notice",
  "credential_expiry",
  "dashboard_report",
  "approval_request",
  "restricted_software_violation",
] as const;

export type EmailOutboxTemplate = (typeof EMAIL_OUTBOX_TEMPLATES)[number];

/** Deliveries attempted before a row is marked permanently failed. */
export const EMAIL_OUTBOX_MAX_ATTEMPTS = 5;

/** First retry delay; each further attempt doubles it. */
export const EMAIL_OUTBOX_BACKOFF_BASE_MS = 5 * 60 * 1000;

/** Ceiling for the retry delay, regardless of the attempt count. */
export const EMAIL_OUTBOX_MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;

/** How long one isolate may hold a claim before another run can reclaim it. */
export const EMAIL_OUTBOX_CLAIM_STALE_MS = 10 * 60 * 1000;

/** Delivered rows are kept briefly so a retried request dedupes, then purged. */
export const EMAIL_OUTBOX_SENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Permanently failed rows stay long enough to investigate and re-drive. */
export const EMAIL_OUTBOX_FAILED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Audit action written when a message exhausts its attempts. */
export const EMAIL_DELIVERY_FAILED_ACTION = "email.delivery_failed";

export const ACCOUNT_EMAIL_DELIVERY_FAILED_ACTION = ACCOUNT_AUDIT.emailDeliveryFailed;

/** Retry delay after `attempts` failed deliveries (1-based). */
export const emailOutboxBackoffMs = (attempts: number): number =>
  Math.min(
    EMAIL_OUTBOX_MAX_BACKOFF_MS,
    EMAIL_OUTBOX_BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1),
  );

const EmailOutboxPayload = Schema.Struct({
  to: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
  from: Schema.Struct({ name: Schema.String, email: Schema.String }),
  replyTo: Schema.optional(
    Schema.Union([
      Schema.String,
      Schema.Struct({ name: Schema.optional(Schema.String), email: Schema.String }),
    ]),
  ),
  subject: Schema.String,
  text: Schema.optional(Schema.String),
  html: Schema.optional(Schema.String),
  /** Extra MIME headers (for example `OTP-Token`) that must survive a retry. */
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  /** Base64 attachment bodies (scheduled reports). */
  attachments: Schema.optional(
    Schema.Array(
      Schema.Struct({
        filename: Schema.String,
        contentType: Schema.String,
        contentBase64: Schema.String,
      }),
    ),
  ),
});

type EmailOutboxPayload = typeof EmailOutboxPayload.Type;

export type EnqueueEmailInput = {
  readonly recipient: string;
  readonly template: EmailOutboxTemplate;
  /** Fully rendered message; the drain never re-renders or re-reads tenant data. */
  readonly message: OutboundEmailMessage;
  /** Enqueue is idempotent for an existing key and returns `duplicate`. */
  readonly dedupeKey?: string | null;
  readonly organizationId?: string | null;
  readonly subjectAccountId?: string | null;
  readonly now?: Date;
};

export type EnqueueEmailOutcome = "queued" | "duplicate" | "failed";

const outboxId = newId;

/**
 * One-line, secret-free failure description. Provider adapters only ever throw
 * a name and status code, and anything else is capped so a stack trace cannot
 * bloat the row.
 */
const describeFailure = (cause: unknown): string => {
  const message = cause instanceof Error ? cause.message : "delivery failed";

  return message.replaceAll(/\s+/g, " ").trim().slice(0, 500) || "delivery failed";
};

/** The queue write's outcome, plus the row a caller may deliver right away. */
type EnqueueEmailRecord = {
  readonly outcome: EnqueueEmailOutcome;
  /** The row this call created, so the caller can try delivery once. */
  readonly id: string | null;
};

/**
 * Insert one message and keep the row id.
 *
 * A lost response can make a client retry the whole request, so a caller that
 * can claim a message passes a key. The pre-flight select answers the common
 * case; the unique index is what makes a concurrent retry safe, and a duplicate
 * insert is reported as `duplicate` rather than an error.
 *
 * Never fails: a delivery queue problem must not fail the request that
 * triggered it. The caller only loses the `emailSent` claim.
 */
const enqueueEmailRecord = (
  db: EnterpriseDb,
  input: EnqueueEmailInput,
): Effect.Effect<EnqueueEmailRecord> =>
  Effect.gen(function* () {
    const now = input.now ?? new Date();
    const dedupeKey = input.dedupeKey?.trim() || null;

    if (dedupeKey) {
      const existing = yield* db
        .select({ id: s.emailOutbox.id })
        .from(s.emailOutbox)
        .where(eq(s.emailOutbox.dedupeKey, dedupeKey))
        .limit(1);

      if (existing.length > 0) return { outcome: "duplicate" as const, id: null };
    }

    const id = outboxId();

    const register: Effect.Effect<EnqueueEmailRecord> = Effect.gen(function* () {
      yield* db.insert(s.emailOutbox).values({
        id,
        organizationId: input.organizationId ?? null,
        subjectAccountId: input.subjectAccountId ?? null,
        recipient: input.recipient,
        template: input.template,
        dedupeKey,
        payload: input.message,
        status: "pending",
        attempts: 0,
        nextAttemptAt: now,
        claimedAt: null,
        lastError: null,
        createdAt: now,
        sentAt: null,
      });

      return { outcome: "queued" as const, id };
    }).pipe(
      Effect.catch((error): Effect.Effect<EnqueueEmailRecord> => {
        // MySQL reports a lost unique race as ER_DUP_ENTRY on the dedupe key.
        if (dedupeKey !== null && /duplicate entry/i.test(describeFailure(error)))
          return Effect.succeed({ outcome: "duplicate" as const, id: null });

        return Effect.logError("Transactional email could not be queued", {
          template: input.template,
        }).pipe(Effect.as({ outcome: "failed" as const, id: null }));
      }),
    );

    return yield* register;
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError("Transactional email could not be queued", {
        template: input.template,
        cause,
      }).pipe(Effect.as({ outcome: "failed" as const, id: null })),
    ),
  );

/**
 * Insert one message, unless its dedupe key is already present.
 *
 * Prefer {@link sendTransactionalEmail}; this is the raw queue write for callers
 * that own delivery themselves.
 */
export const enqueueEmail = (
  db: EnterpriseDb,
  input: EnqueueEmailInput,
): Effect.Effect<EnqueueEmailOutcome> =>
  enqueueEmailRecord(db, input).pipe(Effect.map((record) => record.outcome));

export type TransactionalEmailOutcome = "queued" | "delivered" | "duplicate" | "failed" | "skipped";

export type SendTransactionalEmailInput = EnqueueEmailInput & {
  readonly db: EnterpriseDb;
  /** `undefined` when the deployment has no mailer at all. */
  readonly email: EmailTransport | undefined;
  /**
   * Try the provider once before answering, instead of waiting for the sweep.
   *
   * Verification codes are useless an hour later, so the request that issues one
   * wants the real answer (`delivered`) and the person gets the mail in seconds.
   * The row is still the durable record: a failed attempt backs off and the
   * cron retries, so nothing is lost and the request never fails on the
   * provider.
   */
  readonly deliverNow?: boolean;
};

/**
 * Route one non-onboarding transactional message.
 *
 * - A real transport queues it in the outbox; with `deliverNow` the request
 *   also attempts that row once and answers `delivered` or `failed`.
 * - The local debug mailbox (`email.local`) delivers immediately.
 * - No transport answers `skipped`; callers decide whether that is an error
 *   (verification cannot work without mail) or just a link the admin can copy
 *   (invitations).
 *
 * Delivery failures after this point are retried by the drain and surfaced in
 * the audit stream when they exhaust the attempt cap.
 */
export const sendTransactionalEmail = (
  input: SendTransactionalEmailInput,
): Effect.Effect<TransactionalEmailOutcome> =>
  Effect.gen(function* () {
    if (!input.email) {
      yield* Effect.logWarning(
        "Transactional email skipped: the deployment has no email transport",
        { template: input.template },
      );

      return "skipped" as const;
    }

    if (!input.email.local) {
      const queued = yield* enqueueEmailRecord(input.db, input);

      if (queued.outcome !== "queued" || queued.id === null) return queued.outcome;

      if (!input.deliverNow) return "queued" as const;

      const delivery = yield* deliverQueuedEmail(input.db, input.email, queued.id, {
        now: input.now,
      });

      if (delivery === "sent") return "delivered" as const;

      // The caller asked for the real answer. A failed attempt is reported as
      // `failed` even though the row is still pending for the sweep, so a page
      // can say the mail did not go out instead of leaving someone waiting. The
      // row's `lastError` carries the provider's reason; the log stays
      // address-free.
      yield* Effect.logWarning("Transactional email is queued for retry", {
        template: input.template,
        outcome: delivery,
      });

      return "failed" as const;
    }

    const delivered = yield* input.email.send(input.message).pipe(
      Effect.as(true),
      Effect.catch(() => Effect.succeed(false)),
    );

    if (!delivered) {
      // Never log the message body: it carries one-time links and codes.
      yield* Effect.logError("Transactional email could not be delivered locally", {
        template: input.template,
      });

      return "failed" as const;
    }

    return "delivered" as const;
  });

export type DrainEmailOutboxOptions = {
  readonly db: EnterpriseDb;
  readonly email?: EmailTransport | null;
  readonly now?: Date;
  /** Maximum rows examined per run. Defaults to 50. */
  readonly limit?: number;
  /** Maximum deliveries in flight per run. Defaults to 4. */
  readonly concurrency?: number;
  /** Attempts before a row is permanently failed. Defaults to 5. */
  readonly maxAttempts?: number;
};

export type DrainEmailOutboxResult = {
  readonly due: number;
  readonly sent: number;
  readonly retried: number;
  readonly failed: number;
  readonly skipped: number;
};

const emptyDrainResult = (): DrainEmailOutboxResult => ({
  due: 0,
  sent: 0,
  retried: 0,
  failed: 0,
  skipped: 0,
});

type OutboxRow = {
  readonly id: string;
  readonly organizationId: string | null;
  readonly subjectAccountId: string | null;
  readonly recipient: string;
  readonly template: string;
  readonly attempts: number;
  readonly payload: unknown;
};

/**
 * Record a permanent failure where an administrator will see it: the tenant
 * audit log for tenant-scoped mail, otherwise the account audit stream. The
 * recipient is included because the admin has to know which person missed the
 * message; the provider error is not, because it can echo an address.
 */
const recordPermanentFailure = (
  db: EnterpriseDb,
  row: OutboxRow,
  attempts: number,
  now: Date,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const metadata = {
      template: row.template,
      attempts,
      recipient: row.recipient,
    };

    if (row.organizationId) {
      yield* db.insert(s.auditLog).values({
        id: outboxId(),
        organizationId: row.organizationId,
        actorAccountId: null,
        actorEmail: null,
        actorType: "system",
        category: "system",
        action: EMAIL_DELIVERY_FAILED_ACTION,
        targetType: "email_outbox",
        targetId: row.id,
        metadata,
        createdAt: now,
      });

      return;
    }

    if (!row.subjectAccountId) return;

    yield* db.insert(s.accountAuditLog).values({
      id: outboxId(),
      subjectAccountId: row.subjectAccountId,
      subjectEmail: row.recipient,
      actorAccountId: null,
      actorEmail: null,
      action: ACCOUNT_EMAIL_DELIVERY_FAILED_ACTION,
      targetType: "email_outbox",
      targetId: row.id,
      metadata,
      createdAt: now,
    });
  }).pipe(
    Effect.catchCause(() =>
      Effect.logError("Failed email delivery could not be recorded", {
        template: row.template,
      }),
    ),
  );

const outboxRowColumns = {
  id: s.emailOutbox.id,
  organizationId: s.emailOutbox.organizationId,
  subjectAccountId: s.emailOutbox.subjectAccountId,
  recipient: s.emailOutbox.recipient,
  template: s.emailOutbox.template,
  attempts: s.emailOutbox.attempts,
  payload: s.emailOutbox.payload,
};

type DeliverOutboxRowOptions = {
  readonly now: Date;
  readonly maxAttempts: number;
  readonly staleCutoff: Date;
};

/**
 * Claim and deliver one row, recording the outcome on the row itself.
 *
 * The claim is a compare-and-set on the attempt count, so a request that tries
 * a row inline and the cron that later finds it cannot both send it.
 */
const deliverOutboxRow = (
  db: EnterpriseDb,
  transport: EmailTransport,
  row: OutboxRow,
  options: DeliverOutboxRowOptions,
): Effect.Effect<"sent" | "retried" | "failed" | "skipped"> =>
  Effect.gen(function* () {
    const { now, maxAttempts, staleCutoff } = options;
    const attempts = row.attempts + 1;

    const claimed = yield* db
      .update(s.emailOutbox)
      .set({ claimedAt: now, attempts })
      .where(
        and(
          eq(s.emailOutbox.id, row.id),
          eq(s.emailOutbox.attempts, row.attempts),
          eq(s.emailOutbox.status, "pending"),
          or(isNull(s.emailOutbox.claimedAt), lt(s.emailOutbox.claimedAt, staleCutoff)),
        ),
      );

    if (claimed.affectedRows !== 1) return "skipped" as const;

    const payload = Option.getOrNull(Schema.decodeUnknownOption(EmailOutboxPayload)(row.payload));

    const failure = payload
      ? yield* transport.send(payload).pipe(
          Effect.as(null),
          Effect.catch((error) => Effect.succeed(describeFailure(error))),
        )
      : "stored message could not be read";

    if (failure === null) {
      yield* db
        .update(s.emailOutbox)
        .set({
          status: "sent",
          claimedAt: null,
          lastError: null,
          sentAt: now,
        })
        .where(eq(s.emailOutbox.id, row.id));

      return "sent" as const;
    }

    const exhausted = attempts >= maxAttempts;

    yield* db
      .update(s.emailOutbox)
      .set({
        status: exhausted ? "failed" : "pending",
        claimedAt: null,
        lastError: failure,
        nextAttemptAt: exhausted ? now : new Date(now.getTime() + emailOutboxBackoffMs(attempts)),
      })
      .where(eq(s.emailOutbox.id, row.id));

    if (exhausted) yield* recordPermanentFailure(db, row, attempts, now);

    return exhausted ? ("failed" as const) : ("retried" as const);
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError("Email outbox delivery failed", {
        template: row.template,
        cause,
      }).pipe(Effect.as("retried" as const)),
    ),
  );

/**
 * Try one freshly queued row now.
 *
 * A verification code that waits for the sweep is useless, so the request that
 * issued it attempts delivery before answering. This is not a second delivery
 * path: the same claim, backoff and audit apply, and a failure simply leaves the
 * row for the cron.
 */
export const deliverQueuedEmail = (
  db: EnterpriseDb,
  email: EmailTransport | undefined,
  id: string,
  options: { readonly now?: Date; readonly maxAttempts?: number } = {},
): Effect.Effect<"sent" | "retried" | "failed" | "skipped"> =>
  Effect.gen(function* () {
    if (!email) return "skipped" as const;

    const now = options.now ?? new Date();

    const rows = yield* db
      .select(outboxRowColumns)
      .from(s.emailOutbox)
      .where(and(eq(s.emailOutbox.id, id), eq(s.emailOutbox.status, "pending")))
      .limit(1);

    const row = rows[0];

    if (!row) return "skipped" as const;

    return yield* deliverOutboxRow(db, email, row, {
      now,
      maxAttempts: Math.max(1, options.maxAttempts ?? EMAIL_OUTBOX_MAX_ATTEMPTS),
      staleCutoff: new Date(now.getTime() - EMAIL_OUTBOX_CLAIM_STALE_MS),
    });
  }).pipe(
    // A database hiccup must not fail the request that already queued the
    // message; the cron still owns the row.
    Effect.catchCause((cause) =>
      Effect.logError("Queued email could not be delivered immediately", { cause }).pipe(
        Effect.as("skipped" as const),
      ),
    ),
  );

/**
 * Drain due rows. Every row is claimed before delivery and every outcome is
 * recorded on the row itself, so a crash costs at most one stale claim.
 */
export const drainEmailOutbox = (
  options: DrainEmailOutboxOptions,
): Effect.Effect<DrainEmailOutboxResult> =>
  Effect.gen(function* () {
    const { db } = options;

    if (!options.email) {
      yield* Effect.logWarning("Email outbox drain skipped: the deployment has no email transport");

      return emptyDrainResult();
    }

    const transport = options.email;
    const now = options.now ?? new Date();
    const limit = options.limit ?? 50;
    const concurrency = Math.max(1, options.concurrency ?? 4);
    const maxAttempts = Math.max(1, options.maxAttempts ?? EMAIL_OUTBOX_MAX_ATTEMPTS);
    const staleCutoff = new Date(now.getTime() - EMAIL_OUTBOX_CLAIM_STALE_MS);

    const rows = yield* db
      .select({
        id: s.emailOutbox.id,
        organizationId: s.emailOutbox.organizationId,
        subjectAccountId: s.emailOutbox.subjectAccountId,
        recipient: s.emailOutbox.recipient,
        template: s.emailOutbox.template,
        attempts: s.emailOutbox.attempts,
        payload: s.emailOutbox.payload,
      })
      .from(s.emailOutbox)
      .where(
        and(
          eq(s.emailOutbox.status, "pending"),
          lte(s.emailOutbox.nextAttemptAt, now),
          or(isNull(s.emailOutbox.claimedAt), lt(s.emailOutbox.claimedAt, staleCutoff)),
        ),
      )
      .orderBy(asc(s.emailOutbox.nextAttemptAt))
      .limit(limit);

    const outcomes = yield* Effect.forEach(
      rows,
      (row) => deliverOutboxRow(db, transport, row, { now, maxAttempts, staleCutoff }),
      { concurrency },
    );

    return {
      due: rows.length,
      sent: outcomes.filter((outcome) => outcome === "sent").length,
      retried: outcomes.filter((outcome) => outcome === "retried").length,
      failed: outcomes.filter((outcome) => outcome === "failed").length,
      skipped: outcomes.filter((outcome) => outcome === "skipped").length,
    };
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError("Email outbox drain failed", cause).pipe(Effect.as(emptyDrainResult())),
    ),
  );

/**
 * Delete delivered rows after the dedupe window and failed rows after the
 * investigation window. Pending work is never purged.
 */
export const purgeEmailOutbox = (
  db: EnterpriseDb,
  options: { readonly now?: Date } = {},
): Effect.Effect<number> =>
  Effect.gen(function* () {
    const now = options.now ?? new Date();
    const sentCutoff = new Date(now.getTime() - EMAIL_OUTBOX_SENT_RETENTION_MS);
    const failedCutoff = new Date(now.getTime() - EMAIL_OUTBOX_FAILED_RETENTION_MS);

    const staleSent = yield* db
      .select({ id: s.emailOutbox.id })
      .from(s.emailOutbox)
      .where(and(eq(s.emailOutbox.status, "sent"), lt(s.emailOutbox.createdAt, sentCutoff)));

    if (staleSent.length > 0)
      yield* db.delete(s.emailOutbox).where(
        inArray(
          s.emailOutbox.id,
          staleSent.map((row) => row.id),
        ),
      );

    const staleFailed = yield* db
      .select({ id: s.emailOutbox.id })
      .from(s.emailOutbox)
      .where(and(eq(s.emailOutbox.status, "failed"), lt(s.emailOutbox.createdAt, failedCutoff)));

    if (staleFailed.length > 0)
      yield* db.delete(s.emailOutbox).where(
        inArray(
          s.emailOutbox.id,
          staleFailed.map((row) => row.id),
        ),
      );

    return staleSent.length + staleFailed.length;
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError("Email outbox purge failed", cause).pipe(Effect.as(0)),
    ),
  );
