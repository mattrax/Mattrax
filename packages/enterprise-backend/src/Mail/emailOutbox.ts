import { and, asc, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { ACCOUNT_AUDIT } from "../Account/accountAudit.ts";
import { schema as s, type EnterpriseDb } from "../schema.ts";
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

const outboxId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 24);

/**
 * One-line, secret-free failure description. Provider adapters only ever throw
 * a name and status code, and anything else is capped so a stack trace cannot
 * bloat the row.
 */
const describeFailure = (cause: unknown): string => {
  const message = cause instanceof Error ? cause.message : "delivery failed";

  return message.replaceAll(/\s+/g, " ").trim().slice(0, 500) || "delivery failed";
};

/**
 * Insert one message, unless its dedupe key is already present.
 *
 * A lost response can make a client retry the whole request, so a caller that
 * can claim a message passes a key. The pre-flight select answers the common
 * case; the unique index is what makes a concurrent retry safe, and a duplicate
 * insert is reported as `duplicate` rather than an error.
 *
 * Never fails: a delivery queue problem must not fail the request that
 * triggered it. The caller only loses the `emailSent` claim.
 */
export const enqueueEmail = (
  db: EnterpriseDb,
  input: EnqueueEmailInput,
): Effect.Effect<EnqueueEmailOutcome> =>
  Effect.gen(function* () {
    const now = input.now ?? new Date();
    const dedupeKey = input.dedupeKey?.trim() || null;

    if (dedupeKey) {
      const existing = yield* db
        .select({ id: s.emailOutbox.id })
        .from(s.emailOutbox)
        .where(eq(s.emailOutbox.dedupeKey, dedupeKey))
        .limit(1);

      if (existing.length > 0) return "duplicate" as const;
    }

    const register = Effect.gen(function* () {
      yield* db.insert(s.emailOutbox).values({
        id: outboxId(),
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

      return "queued" as const;
    }).pipe(
      Effect.catch((cause) => {
        // MySQL reports a lost unique race as ER_DUP_ENTRY on the dedupe key.
        if (dedupeKey !== null && /duplicate entry/i.test(describeFailure(cause)))
          return Effect.succeed("duplicate" as const);

        return Effect.logError("Transactional email could not be queued", {
          template: input.template,
        }).pipe(Effect.as("failed" as const));
      }),
    );

    return yield* register;
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError("Transactional email could not be queued", {
        template: input.template,
        cause,
      }).pipe(Effect.as("failed" as const)),
    ),
  );

export type TransactionalEmailOutcome = "queued" | "delivered" | "duplicate" | "failed" | "skipped";

export type SendTransactionalEmailInput = EnqueueEmailInput & {
  readonly db: EnterpriseDb;
  /** `undefined` when the deployment has no mailer at all. */
  readonly email: EmailTransport | undefined;
};

/**
 * Route one non-onboarding transactional message.
 *
 * - A real transport queues it in the outbox and answers `queued`.
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

    if (!input.email.local) return yield* enqueueEmail(input.db, input);

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

    const send = (row: OutboxRow) =>
      Effect.gen(function* () {
        const attempts = row.attempts + 1;

        // Claim with a compare-and-set on the attempt count so two isolates
        // that read the same row cannot both deliver it.
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

        const payload = Option.getOrNull(
          Schema.decodeUnknownOption(EmailOutboxPayload)(row.payload),
        );

        const failure = payload
          ? yield* transport.send(payload).pipe(
              Effect.as(null),
              Effect.catch((cause) => Effect.succeed(describeFailure(cause))),
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
            nextAttemptAt: exhausted
              ? now
              : new Date(now.getTime() + emailOutboxBackoffMs(attempts)),
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

    const outcomes = yield* Effect.forEach(rows, send, { concurrency });

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
