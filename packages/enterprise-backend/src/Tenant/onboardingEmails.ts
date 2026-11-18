import { and, asc, eq, gte, isNull, lte } from "drizzle-orm";
import { Effect, Ref, Schema } from "effect";
import { schema as s, type EnterpriseDb } from "../schema.ts";
import {
  onboardingFollowUpEmail,
  welcomeEmail,
  type OnboardingFollowUpEmailInput,
  type WelcomeEmailInput,
} from "./onboardingEmail.ts";
import { loadTenantAdminRecipients } from "./maintenance.ts";
import type { EmailAddress, EmailReplyTo, EmailTransport } from "@mattrax/email";

/** Keep the onboarding-specific name while sharing one transport contract. */
export type OnboardingEmailTransport = EmailTransport;

/**
 * `hello@mattrax.cloud` is the sender verified with the email provider, so it
 * is the only address allowed in `From`. The display name and Reply-To carry
 * the human identity.
 */
export const ONBOARDING_EMAIL_FROM = {
  name: "Oscar from Mattrax",
  email: "hello@mattrax.cloud",
} as const;

/** Reply-To default for onboarding mail. Documented in operations config. */
export const DEFAULT_ONBOARDING_REPLY_TO = "oscar@otbeaumont.me";

/** Shown in the email footer when a tenant has no support address. */
export const ONBOARDING_SUPPORT_EMAIL = "hello@mattrax.cloud";

/** Audit action written per recipient so the cross-tenant cooldown can work. */
export const ONBOARDING_FOLLOW_UP_AUDIT_ACTION = "onboarding.follow_up_sent";

const DAY = 24 * 60 * 60 * 1000;

const trimOrigin = (origin: string) => origin.replace(/\/+$/, "");

/** The composer needs a bare address; the transport keeps the display name. */
const replyAddress = (replyTo: EmailReplyTo): string =>
  Schema.is(Schema.String)(replyTo) ? replyTo : replyTo.email;

const firstNameOf = (name: string | null | undefined): string | null => {
  const trimmed = name?.trim();

  return trimmed ? (trimmed.split(/\s+/)[0] ?? null) : null;
};

const EMAIL_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Bounded fan-out when one tenant notifies several admins at once. */
const FOLLOW_UP_RECIPIENT_CONCURRENCY = 2;

/**
 * Configuration problems already reported by this isolate. A malformed
 * deployment value must warn once, not on every send or sweep iteration (and
 * the module never retries the bad value: it always falls back to the default).
 */
const reportedInvalidAddresses = new Set<string>();

const warnInvalidAddressOnce = (variable: string): Effect.Effect<void> =>
  Effect.suspend(() => {
    if (reportedInvalidAddresses.has(variable)) return Effect.void;
    reportedInvalidAddresses.add(variable);

    // Never include the configured value: it is a deployment secret-adjacent
    // address and only the operator needs to know which variable is wrong.
    return Effect.logWarning(
      `${variable} is not a valid email address; using the onboarding default instead`,
    );
  });

/** Resolve a configured address, warning once and falling back when invalid. */
const resolveEmailAddress = (
  value: string | null | undefined,
  fallback: string,
  variable: string,
): Effect.Effect<string> =>
  Effect.gen(function* () {
    const trimmed = value?.trim();

    if (!trimmed) return fallback;

    if (EMAIL_ADDRESS.test(trimmed)) return trimmed;

    yield* warnInvalidAddressOnce(variable);

    return fallback;
  });

/** Resolve a Reply-To, preserving the display-name form when it is valid. */
const resolveReplyTo = (
  value: EmailReplyTo | null | undefined,
  variable: string,
): Effect.Effect<EmailReplyTo> =>
  Effect.gen(function* () {
    if (!value) return DEFAULT_ONBOARDING_REPLY_TO;

    if (Schema.is(Schema.String)(value))
      return yield* resolveEmailAddress(value, DEFAULT_ONBOARDING_REPLY_TO, variable);

    const address = yield* resolveEmailAddress(value.email, DEFAULT_ONBOARDING_REPLY_TO, variable);

    return address === value.email.trim() ? value : address;
  });

const auditId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 24);

/**
 * Clear a claim only if it is still ours. A conditional unset keeps a lost
 * hook from clearing a marker claimed by a concurrent request.
 */
const clearWelcomeClaim = (db: EnterpriseDb, userId: string, claimedAt: Date) =>
  db
    .update(s.account)
    .set({ welcomeEmailSentAt: null })
    .where(and(eq(s.account.id, userId), eq(s.account.welcomeEmailSentAt, claimedAt)))
    .pipe(Effect.catchCause(() => Effect.void));

const clearFollowUpClaim = (db: EnterpriseDb, organizationId: string, claimedAt: Date) =>
  db
    .update(s.organization)
    .set({ onboardingFollowUpSentAt: null })
    .where(
      and(
        eq(s.organization.id, organizationId),
        eq(s.organization.onboardingFollowUpSentAt, claimedAt),
      ),
    )
    .pipe(Effect.catchCause(() => Effect.void));

export type WelcomeEmailUser = {
  readonly id: string;
  readonly name?: string | null;
  readonly email: string;
  readonly emailVerified?: boolean | null;
  readonly disabled?: boolean | null;
  readonly source?: string | null;
};

export type SendWelcomeEmailOptions = {
  readonly db: EnterpriseDb;
  readonly user: WelcomeEmailUser;
  readonly email?: OnboardingEmailTransport | null;
  readonly origin: string;
  readonly replyTo?: EmailReplyTo | null;
  readonly supportEmail?: string | null;
  /** Envelope sender; defaults to the hosted onboarding identity. */
  readonly from?: EmailAddress;
  /** Injectable clock for tests. */
  readonly now?: Date;
};

export type WelcomeEmailOutcome = "sent" | "skipped" | "failed";

/**
 * Send the welcome email at most once per account.
 *
 * The marker is claimed with a conditional UPDATE before the provider call.
 * Only the request that observes `affectedRows === 1` sends, so verification
 * retries, concurrent requests and the backstop sweep are all idempotent. A
 * provider failure unsets the marker so a later sweep can retry; verification
 * itself is never failed by this helper.
 *
 * Claim-before-send is deliberate: if the isolate dies between the claim and
 * the provider call the message is lost (at-most-once) rather than duplicated
 * (at-least-once). The backstop sweep therefore cannot recover that narrow
 * window, which is preferable to mailing a customer twice.
 */
export const sendWelcomeEmailOnce = (
  options: SendWelcomeEmailOptions,
): Effect.Effect<WelcomeEmailOutcome> =>
  Effect.gen(function* () {
    const { db, user, email } = options;

    // Manual accounts only: SCIM/Graph users are provisioned by a directory
    // and must never receive a founder welcome.
    if (user.source !== "manual" || user.disabled || !user.emailVerified) return "skipped";

    if (!email) {
      yield* Effect.logWarning("Welcome email skipped: the deployment has no email transport", {
        userId: user.id,
      });

      return "skipped";
    }

    const now = options.now ?? new Date();

    // Validate configuration before claiming: a bad Reply-To would otherwise
    // consume the one-time marker and fail every composition. The fallback is
    // always valid, so this never fails the send.
    const replyTo = yield* resolveReplyTo(options.replyTo, "MATTRAX_ONBOARDING_REPLY_TO");

    const supportEmail = yield* resolveEmailAddress(
      options.supportEmail,
      ONBOARDING_SUPPORT_EMAIL,
      "MATTRAX_ONBOARDING_SUPPORT_EMAIL",
    );

    const claimed = yield* db
      .update(s.account)
      .set({ welcomeEmailSentAt: now })
      .where(
        and(
          eq(s.account.id, user.id),
          isNull(s.account.welcomeEmailSentAt),
          eq(s.account.source, "manual"),
          eq(s.account.emailVerified, true),
          eq(s.account.disabled, false),
        ),
      );

    if (claimed.affectedRows !== 1) return "skipped";

    const origin = trimOrigin(options.origin);
    const dashboardUrl = `${origin}/dashboard`;

    const input: WelcomeEmailInput = {
      firstName: firstNameOf(user.name),
      dashboardUrl,
      enrollUrl: dashboardUrl,
      replyTo: replyAddress(replyTo),
      supportEmail,
    };

    const message = yield* Effect.try({
      try: () => welcomeEmail(input),
      catch: (cause) => cause,
    }).pipe(
      Effect.catchCause(() =>
        clearWelcomeClaim(db, user.id, now).pipe(
          Effect.flatMap(() =>
            Effect.logError("Welcome email could not be composed", { userId: user.id }),
          ),
          Effect.as(null),
        ),
      ),
    );

    if (!message) return "failed";

    const delivered = yield* email
      .send({
        to: user.email,
        from: options.from ?? ONBOARDING_EMAIL_FROM,
        replyTo,
        subject: message.subject,
        text: message.text,
        html: message.html,
      })
      .pipe(
        Effect.as(true),
        Effect.catchCause(() => Effect.succeed(false)),
      );

    if (delivered) return "sent";

    yield* clearWelcomeClaim(db, user.id, now);
    // Never log the message body or any link: it contains a signed-in URL.
    yield* Effect.logError("Welcome email could not be sent", { userId: user.id });

    return "failed";
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError("Welcome email hook failed", cause).pipe(Effect.as("failed" as const)),
    ),
  );

export type WelcomeEmailSweepOptions = {
  readonly db: EnterpriseDb;
  readonly now?: Date;
  readonly email?: OnboardingEmailTransport | null;
  readonly origin: string;
  readonly replyTo?: EmailReplyTo | null;
  readonly supportEmail?: string | null;
  readonly from?: EmailAddress;
  /** Only accounts created this recently are retried. Defaults to 2 days. */
  readonly lookbackDays?: number;
  /** Maximum accounts examined per run. Defaults to 100. */
  readonly limit?: number;
  readonly concurrency?: number;
};

export type WelcomeEmailSweepResult = {
  readonly candidates: number;
  readonly sent: number;
  readonly failed: number;
  readonly skipped: number;
};

/**
 * Backstop for a lost verification hook: recent manual accounts that verified
 * their address but never got the welcome email. Bounded in both time and row
 * count so a sweep can never fan out over the whole user table.
 */
export const runWelcomeEmailSweep = (
  options: WelcomeEmailSweepOptions,
): Effect.Effect<WelcomeEmailSweepResult> =>
  Effect.gen(function* () {
    if (!options.email) {
      yield* Effect.logWarning(
        "Welcome email sweep skipped: the deployment has no email transport",
      );

      return { candidates: 0, sent: 0, failed: 0, skipped: 0 };
    }

    // Validate the configuration up front so a typo is reported by the
    // scheduled job even when this run has no candidates.
    yield* resolveReplyTo(options.replyTo, "MATTRAX_ONBOARDING_REPLY_TO");
    yield* resolveEmailAddress(
      options.supportEmail,
      ONBOARDING_SUPPORT_EMAIL,
      "MATTRAX_ONBOARDING_SUPPORT_EMAIL",
    );

    const now = options.now ?? new Date();
    const lookbackDays = options.lookbackDays ?? 2;
    const limit = options.limit ?? 100;
    const cutoff = new Date(now.getTime() - lookbackDays * DAY);

    const users = yield* options.db
      .select({
        id: s.account.id,
        name: s.account.name,
        email: s.account.email,
        emailVerified: s.account.emailVerified,
        disabled: s.account.disabled,
        source: s.account.source,
      })
      .from(s.account)
      .where(
        and(
          eq(s.account.source, "manual"),
          eq(s.account.emailVerified, true),
          eq(s.account.disabled, false),
          isNull(s.account.welcomeEmailSentAt),
          gte(s.account.createdAt, cutoff),
        ),
      )
      .orderBy(asc(s.account.createdAt))
      .limit(limit);

    const outcomes = yield* Effect.forEach(
      users,
      (user) =>
        sendWelcomeEmailOnce({
          db: options.db,
          user,
          email: options.email,
          origin: options.origin,
          replyTo: options.replyTo,
          supportEmail: options.supportEmail,
          from: options.from,
          now,
        }),
      { concurrency: options.concurrency ?? 4 },
    );

    return {
      candidates: users.length,
      sent: outcomes.filter((outcome) => outcome === "sent").length,
      failed: outcomes.filter((outcome) => outcome === "failed").length,
      skipped: outcomes.filter((outcome) => outcome === "skipped").length,
    };
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError("Welcome email sweep failed", cause).pipe(
        Effect.as({ candidates: 0, sent: 0, failed: 0, skipped: 0 }),
      ),
    ),
  );

export type RunOnboardingEmailsOptions = {
  readonly db: EnterpriseDb;
  readonly now?: Date;
  readonly email?: OnboardingEmailTransport | null;
  readonly origin: string;
  readonly replyTo?: EmailReplyTo | null;
  readonly supportEmail?: string | null;
  readonly from?: EmailAddress;
  /** Days after tenant creation before the follow-up is eligible. Defaults to 7. */
  readonly followUpDays?: number;
  /** Extra days after `followUpDays` that stay eligible. Defaults to 7. */
  readonly windowDays?: number;
  /**
   * Ignore tenants created before this date, so enabling the feature does not
   * mail every historical tenant. Defaults to no extra floor; the window
   * floor still applies.
   */
  readonly since?: Date | null;
  /** Per-user cooldown across tenants in days. `0` disables it. Defaults to 7. */
  readonly cooldownDays?: number;
  /**
   * Maximum tenants examined per run. Defaults to 200 so a large deployment
   * cannot fan one cron tick out over the whole organization table.
   */
  readonly limit?: number;
  readonly concurrency?: number;
};

export type OnboardingEmailRunResult = {
  readonly candidates: number;
  readonly sent: number;
  readonly suppressed: number;
  readonly noRecipients: number;
  readonly skipped: number;
  readonly failed: number;
};

const emptyOnboardingResult = (): OnboardingEmailRunResult => ({
  candidates: 0,
  sent: 0,
  suppressed: 0,
  noRecipients: 0,
  skipped: 0,
  failed: 0,
});

type OrganizationCandidate = {
  readonly id: string;
  readonly name: string;
  readonly displayName: string | null;
  readonly supportEmail: string | null;
  readonly createdAt: Date;
};

/**
 * Send the one-week onboarding follow-up to tenants that were created in the
 * eligibility window and have not enrolled a device.
 *
 * This is deliberately conservative: a tenant is suppressed as soon as there
 * is an enrolled device, a recently-created enrolling device (the user is
 * mid-flow) or a successful enrollment attempt. ABM/Autopilot pre-registrations
 * are not devices and do not suppress the email.
 *
 * Delivery is one message per verified recipient, each addressed only to that
 * person so admins never see each other's addresses. The tenant marker is
 * claimed once, before any provider call, for the same at-most-once trade-off
 * as the welcome email: an isolate that dies after the claim but before the
 * send loses that tenant's follow-up rather than duplicating it.
 *
 * The cross-tenant cooldown is derived from audit rows written after each
 * successful delivery, so it depends on `MAINTENANCE_AUDIT_RETENTION_DAYS`
 * (default 365) staying comfortably above the cooldown window. Trimming audit
 * retention below the cooldown would let a recently-contacted owner receive
 * another tenant's follow-up.
 */
export const runOnboardingEmails = (
  options: RunOnboardingEmailsOptions,
): Effect.Effect<OnboardingEmailRunResult> =>
  Effect.gen(function* () {
    const { db, email } = options;

    if (!email) {
      yield* Effect.logWarning(
        "Onboarding follow-up skipped: the deployment has no email transport",
      );

      return emptyOnboardingResult();
    }

    const now = options.now ?? new Date();
    const followUpDays = options.followUpDays ?? 7;
    const windowDays = options.windowDays ?? 7;
    const cooldownDays = options.cooldownDays ?? 7;
    const limit = options.limit ?? 200;

    const replyTo = yield* resolveReplyTo(options.replyTo, "MATTRAX_ONBOARDING_REPLY_TO");

    const fallbackSupportEmail = yield* resolveEmailAddress(
      options.supportEmail,
      ONBOARDING_SUPPORT_EMAIL,
      "MATTRAX_ONBOARDING_SUPPORT_EMAIL",
    );

    const upper = new Date(now.getTime() - followUpDays * DAY);
    const windowFloor = new Date(now.getTime() - (followUpDays + windowDays) * DAY);

    const floor =
      options.since && options.since.getTime() > windowFloor.getTime()
        ? options.since
        : windowFloor;

    const organizations = yield* db
      .select({
        id: s.organization.id,
        name: s.organization.name,
        displayName: s.organization.displayName,
        supportEmail: s.organization.supportEmail,
        createdAt: s.organization.createdAt,
      })
      .from(s.organization)
      .where(
        and(
          isNull(s.organization.onboardingFollowUpSentAt),
          lte(s.organization.createdAt, upper),
          gte(s.organization.createdAt, floor),
        ),
      )
      .orderBy(asc(s.organization.createdAt))
      // Bounded: a backlog is drained over successive daily runs, not one tick.
      .limit(limit);

    /**
     * Users contacted within the cooldown, loaded once per run. They are
     * reserved atomically through a Ref before a tenant claims its marker, so
     * two tenants that share an owner cannot both send when they are processed
     * concurrently (`concurrency > 1`). Failed deliveries release the
     * reservation so a later tenant in the same run can still reach the user.
     *
     * This preload reads `audit_log` for the cooldown window; the
     * `audit_log_actor_action_idx` index covers `(actor_user_id, action,
     * created_at)` and the cooldown depends on those rows surviving audit
     * retention.
     */
    const cooldownCutoff = cooldownDays > 0 ? new Date(now.getTime() - cooldownDays * DAY) : null;

    const preloadedCooldown = cooldownCutoff
      ? (yield* db
          .select({ actorAccountId: s.auditLog.actorAccountId })
          .from(s.auditLog)
          .where(
            and(
              eq(s.auditLog.action, ONBOARDING_FOLLOW_UP_AUDIT_ACTION),
              gte(s.auditLog.createdAt, cooldownCutoff),
            ),
          ))
          .map((row) => row.actorAccountId)
          .filter((value): value is string => typeof value === "string")
      : [];

    const cooldown = yield* Ref.make(new Set(preloadedCooldown));

    const reserveRecipients = <Recipient extends { readonly userId: string }>(
      recipients: ReadonlyArray<Recipient>,
    ): Effect.Effect<ReadonlyArray<Recipient> | null> =>
      cooldownCutoff
        ? Ref.modify(cooldown, (cooledDown) => {
            const available = recipients.filter((recipient) => !cooledDown.has(recipient.userId));

            if (available.length === 0) return [null, cooledDown] as const;

            const next = new Set(cooledDown);

            for (const recipient of available) next.add(recipient.userId);

            return [available, next] as const;
          })
        : Effect.succeed(recipients);

    const releaseRecipients = <Recipient extends { readonly userId: string }>(
      recipients: ReadonlyArray<Recipient>,
    ): Effect.Effect<void> =>
      cooldownCutoff
        ? Ref.update(cooldown, (cooledDown) => {
            const next = new Set(cooledDown);

            for (const recipient of recipients) next.delete(recipient.userId);

            return next;
          })
        : Effect.void;

    const processOrganization = (organization: OrganizationCandidate) =>
      Effect.gen(function* () {
        const activeDevice = yield* db
          .select({ id: s.device.id })
          .from(s.device)
          .where(and(eq(s.device.organizationId, organization.id), eq(s.device.status, "enrolled")))
          .limit(1);

        if (activeDevice.length > 0) return "suppressed";

        // A device created in the last day means enrollment is in progress;
        // `enrolledAt` is the row's creation time for an enrolling device.
        const enrollingCutoff = new Date(now.getTime() - DAY);

        const recentEnrolling = yield* db
          .select({ id: s.device.id })
          .from(s.device)
          .where(
            and(
              eq(s.device.organizationId, organization.id),
              eq(s.device.status, "enrolling"),
              gte(s.device.enrolledAt, enrollingCutoff),
            ),
          )
          .limit(1);

        if (recentEnrolling.length > 0) return "suppressed";

        const successfulAttempt = yield* db
          .select({ id: s.enrollmentAttempt.id })
          .from(s.enrollmentAttempt)
          .where(
            and(
              eq(s.enrollmentAttempt.organizationId, organization.id),
              eq(s.enrollmentAttempt.outcome, "ok"),
            ),
          )
          .limit(1);

        if (successfulAttempt.length > 0) return "suppressed";

        const admins = yield* loadTenantAdminRecipients(db, organization.id);

        const verifiedRecipients = admins.filter((recipient) => recipient.emailVerified);

        if (verifiedRecipients.length === 0) {
          yield* Effect.logWarning("Onboarding follow-up skipped: no verified recipients", {
            organizationId: organization.id,
          });

          return "noRecipients";
        }

        // Reserve cooldown-covered users atomically before the tenant claim so
        // two tenants sharing an owner cannot both send in this run, even when
        // organizations are processed concurrently.
        const recipients = yield* reserveRecipients(verifiedRecipients);

        if (!recipients || recipients.length === 0) {
          yield* Effect.logWarning("Onboarding follow-up skipped: every recipient is in cooldown", {
            organizationId: organization.id,
          });

          return "noRecipients";
        }

        const claimed = yield* db
          .update(s.organization)
          .set({ onboardingFollowUpSentAt: now })
          .where(
            and(
              eq(s.organization.id, organization.id),
              isNull(s.organization.onboardingFollowUpSentAt),
            ),
          );

        if (claimed.affectedRows !== 1) {
          yield* releaseRecipients(recipients);

          return "skipped";
        }

        const origin = trimOrigin(options.origin);
        const tenantName = organization.displayName?.trim() || organization.name;

        const daysSinceCreation = Math.max(
          1,
          Math.floor((now.getTime() - organization.createdAt.getTime()) / DAY),
        );

        const sendToRecipient = (recipient: (typeof verifiedRecipients)[number]) =>
          Effect.gen(function* () {
            const input: OnboardingFollowUpEmailInput = {
              firstName: firstNameOf(recipient.name),
              tenantName,
              dashboardUrl: `${origin}/t/${organization.id}/devices`,
              enrollUrl: `${origin}/t/${organization.id}/enrollment`,
              replyTo: replyAddress(replyTo),
              supportEmail: organization.supportEmail ?? fallbackSupportEmail,
              daysSinceCreation,
            };

            const message = yield* Effect.try({
              try: () => onboardingFollowUpEmail(input),
              catch: (cause) => cause,
            }).pipe(
              Effect.catchCause(() =>
                Effect.logError("Onboarding follow-up could not be composed", {
                  organizationId: organization.id,
                  userId: recipient.userId,
                }).pipe(Effect.as(null)),
              ),
            );

            if (!message) return { recipient, delivered: false } as const;

            const delivered = yield* email
              .send({
                // One message per recipient: no admin sees another's address.
                to: recipient.email,
                from: options.from ?? ONBOARDING_EMAIL_FROM,
                replyTo,
                subject: message.subject,
                text: message.text,
                html: message.html,
              })
              .pipe(
                Effect.as(true),
                Effect.catchCause(() => Effect.succeed(false)),
              );

            if (!delivered) {
              yield* Effect.logError("Onboarding follow-up could not be sent", {
                organizationId: organization.id,
                userId: recipient.userId,
              });

              return { recipient, delivered: false } as const;
            }

            return { recipient, delivered: true } as const;
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.logError("Onboarding follow-up recipient failed", {
                organizationId: organization.id,
                userId: recipient.userId,
                cause,
              }).pipe(Effect.as({ recipient, delivered: false } as const)),
            ),
          );

        const outcomes = yield* Effect.forEach(recipients, sendToRecipient, {
          concurrency: FOLLOW_UP_RECIPIENT_CONCURRENCY,
        });

        const delivered = outcomes.filter((outcome) => outcome.delivered);

        const undelivered = outcomes
          .filter((outcome) => !outcome.delivered)
          .map((outcome) => outcome.recipient);

        if (delivered.length === 0) {
          // Nothing was sent, so the reservation and the tenant claim are
          // released and a later bounded sweep can retry the tenant.
          yield* releaseRecipients(recipients);
          yield* clearFollowUpClaim(db, organization.id, now);
          yield* Effect.logError("Onboarding follow-up could not be sent", {
            organizationId: organization.id,
            recipients: recipients.length,
          });

          return "failed";
        }

        // Only users who actually missed this message stay available to other
        // tenants in the same run; a partial failure never clears the claim.
        yield* releaseRecipients(undelivered);

        if (undelivered.length > 0)
          yield* Effect.logWarning("Onboarding follow-up partially delivered", {
            organizationId: organization.id,
            delivered: delivered.length,
            undelivered: undelivered.length,
          });

        // Record who received it so another tenant owned by the same person
        // observes the cooldown. A ledger failure must not fail the send.
        yield* Effect.forEach(
          delivered,
          (outcome) =>
            Effect.gen(function* () {
              yield* db.insert(s.auditLog).values({
                id: auditId(),
                organizationId: organization.id,
                actorAccountId: outcome.recipient.userId,
                actorEmail: outcome.recipient.email,
                action: ONBOARDING_FOLLOW_UP_AUDIT_ACTION,
                targetType: "organization",
                targetId: organization.id,
                metadata: { daysSinceCreation },
                createdAt: now,
              });
            }),
          { concurrency: 2, discard: true },
        ).pipe(
          Effect.catchCause(() =>
            Effect.logWarning("Onboarding follow-up cooldown record failed", {
              organizationId: organization.id,
            }),
          ),
        );

        return "sent";
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logError("Onboarding follow-up failed", {
            organizationId: organization.id,
            cause,
          }).pipe(Effect.as("failed" as const)),
        ),
      );

    const outcomes = yield* Effect.forEach(organizations, processOrganization, {
      concurrency: options.concurrency ?? 4,
    });

    return {
      candidates: organizations.length,
      sent: outcomes.filter((outcome) => outcome === "sent").length,
      suppressed: outcomes.filter((outcome) => outcome === "suppressed").length,
      noRecipients: outcomes.filter((outcome) => outcome === "noRecipients").length,
      skipped: outcomes.filter((outcome) => outcome === "skipped").length,
      failed: outcomes.filter((outcome) => outcome === "failed").length,
    };
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError("Onboarding follow-up sweep failed", cause).pipe(
        Effect.as(emptyOnboardingResult()),
      ),
    ),
  );
