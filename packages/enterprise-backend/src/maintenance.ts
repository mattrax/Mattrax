import { Cause, Effect } from "effect";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { Db, schema as s } from "@mattrax/enterprise-core";
import {
  dispatchWebhookEvent,
  pruneWebhookDeliveries,
  retryFailedWebhookDeliveries,
  syncDynamicGroupsForTenant,
} from "@mattrax/management-backend-enterprise";
import { loadCredentialHealth, type CredentialHealth } from "./credentialHealth.ts";
import type { EnterpriseDb } from "./schema.ts";

/** An owner/admin who should receive credential-expiry notifications. */
export type CredentialAlertRecipient = {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly role: string;
};

/**
 * Everything a host needs to notify a tenant about an expiring credential.
 * Recipients are tenant-scoped, deduplicated by email and exclude disabled
 * accounts. They may be empty (for example a tenant without an owner), in
 * which case the host can log instead of sending.
 */
export type CredentialExpiryNotification = {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly threshold: CredentialAlertThreshold;
  readonly health: CredentialHealth;
  /** UTC-date bucket used to dedupe alerts, e.g. `2026-11-10`. */
  readonly day: string;
  readonly recipients: ReadonlyArray<CredentialAlertRecipient>;
};

/**
 * Notification hook. It is deliberately optional: maintenance must stay safe
 * (and useful for self-hosted deployments and tests) when no transport is
 * configured. Failures are logged and swallowed by `runMaintenance`.
 */
export type CredentialExpiryNotifier = (
  notification: CredentialExpiryNotification,
) => Effect.Effect<void, unknown>;

export type MaintenanceOptions = {
  /** Injectable clock for tests. Defaults to `new Date()`. */
  readonly now?: Date;
  /** Devices not seen for this many days are marked unenrolled. Defaults to 30. */
  readonly staleDeviceDays?: number;
  /**
   * Audit entries older than this many days are deleted. Defaults to 365.
   * Set to `0` to disable audit retention (entries are kept indefinitely).
   */
  readonly auditRetentionDays?: number;
  /**
   * Enrollment-attempt diagnostics older than this many days are deleted.
   * Defaults to 30. Set to `0` to keep them indefinitely.
   */
  readonly enrollmentAttemptRetentionDays?: number;
  /**
   * Android Pub/Sub idempotency records older than this many days are deleted.
   * Defaults to 30. Set to `0` to keep them indefinitely.
   */
  readonly androidPubSubRetentionDays?: number;
  /** Disable credential-expiry alerts (for example in tests). Defaults to true. */
  readonly credentialAlerts?: boolean;
  /**
   * Optional delivery hook for new credential-expiry alerts. Called once per
   * tenant/threshold/day, after the deduped audit event is written. Without it
   * maintenance still records the audit event and sends nothing.
   */
  readonly notifyCredentialExpiry?: CredentialExpiryNotifier;
  /** Recompute dynamic group membership. Defaults to true. */
  readonly dynamicGroups?: boolean;
  /**
   * Webhook delivery rows older than this many days are deleted. Defaults to
   * 30. Set to `0` to keep delivery history indefinitely.
   */
  readonly webhookDeliveryRetentionDays?: number;
  /** Retry recent failed webhook deliveries. Defaults to true. */
  readonly webhookRetry?: boolean;
  /** Application secret needed to sign retried deliveries. */
  readonly webhookAuthSecret?: string;
  /** Injected fetch for retry tests. */
  readonly webhookFetch?: typeof globalThis.fetch;
  /** Maximum recorded attempts for a retried delivery. Defaults to 3. */
  readonly webhookMaxAttempts?: number;
};

export type MaintenanceResult = {
  readonly expiredInvitations: number;
  readonly staleDevices: number;
  readonly expiredAuthProofs: number;
  readonly expiredAuthSessions: number;
  readonly purgedAuditEntries: number;
  /** Enrollment-attempt diagnostics deleted this run. */
  readonly purgedEnrollmentAttempts: number;
  /** Android Pub/Sub idempotency records deleted this run. */
  readonly purgedAndroidPubSubMessages: number;
  /** Credential expiry audit events written this run. */
  readonly credentialAlerts: number;
  /** Dynamic groups whose materialised membership was recomputed. */
  readonly dynamicGroupsEvaluated: number;
  /** Webhook delivery rows deleted by retention. */
  readonly purgedWebhookDeliveries: number;
  /** Failed webhook deliveries retried this run. */
  readonly webhookRetries: number;
  readonly webhookRetrySucceeded: number;
  readonly webhookRetryFailed: number;
};

const day = 24 * 60 * 60 * 1000;
const id = () => crypto.randomUUID().replaceAll("-", "").slice(0, 24);

/** Audit action recorded once per organisation per threshold per day. */
export const CREDENTIAL_ALERT_ACTION = "credentials.expiry_warning";

export type CredentialAlertThreshold = "expired" | "7d" | "30d";

/** UTC-date bucket used to dedupe credential alerts, e.g. `2026-11-10`. */
export const credentialAlertDay = (now: Date): string => now.toISOString().slice(0, 10);

/** Start of the UTC day, so date-bucket alerts do not drift across midnight. */
export const startOfUtcDay = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

const alertThreshold = (health: CredentialHealth): CredentialAlertThreshold | null => {
  const credentials = [health.apns, health.scepCa];
  if (credentials.some((credential) => credential.level === "expired")) return "expired";
  if (credentials.some((credential) => credential.level === "critical")) return "7d";
  if (credentials.some((credential) => credential.level === "warning")) return "30d";
  return null;
};

const thresholdFromMetadata = (metadata: unknown): CredentialAlertThreshold | null => {
  if (typeof metadata !== "object" || metadata === null) return null;
  const value = (metadata as Record<string, unknown>).threshold;
  return value === "expired" || value === "7d" || value === "30d" ? value : null;
};

const isOwnerOrAdmin = (role: string): boolean =>
  role
    .split(",")
    .map((part) => part.trim())
    .some((part) => part === "owner" || part === "admin");

/**
 * Load the tenant's owner/admin recipients for an expiry notification.
 *
 * Roles are comma-separated (`owner,admin`), so the filter runs in application
 * code rather than as an `IN` predicate that would miss combined roles. The
 * member and user reads are both tenant/user scoped; disabled users are
 * skipped and recipients are deduplicated by email address.
 */
export const loadCredentialAlertRecipients = (
  db: EnterpriseDb,
  organizationId: string,
): Effect.Effect<CredentialAlertRecipient[], unknown> =>
  Effect.gen(function* () {
    const members = (yield* db
      .select()
      .from(s.member)
      .where(eq(s.member.organizationId, organizationId))) as Array<{
      userId: string;
      role: string;
    }>;
    const roles = new Map<string, string>();
    for (const member of members) {
      if (!isOwnerOrAdmin(member.role)) continue;
      roles.set(member.userId, member.role);
    }
    if (roles.size === 0) return [];

    const users = (yield* db
      .select()
      .from(s.user)
      .where(inArray(s.user.id, [...roles.keys()]))) as Array<{
      id: string;
      name: string;
      email: string;
      disabled: boolean;
    }>;

    const seen = new Set<string>();
    const recipients: CredentialAlertRecipient[] = [];
    for (const user of users) {
      if (user.disabled) continue;
      const email = user.email.trim();
      const key = email.toLowerCase();
      if (!email || seen.has(key)) continue;
      seen.add(key);
      recipients.push({
        userId: user.id,
        name: user.name,
        email,
        role: roles.get(user.id) ?? "",
      });
    }
    return recipients.sort((left, right) => left.email.localeCompare(right.email));
  });

/**
 * Idempotent scheduled maintenance shared by the Cloud Worker cron trigger and
 * any other host that owns an Enterprise database (for example a future
 * self-hosted mttx deployment with the Enterprise schema).
 *
 * Every step is safe to run repeatedly: expired invitations only move from
 * `pending` to `expired`, stale devices only move from `enrolled` to
 * `unenrolled`, and the deletion cutoffs use the provided clock.
 */
export const runMaintenance = (
  options: MaintenanceOptions = {},
): Effect.Effect<MaintenanceResult, any, Db> =>
  Effect.gen(function* () {
    const db = yield* Db;
    const now = options.now ?? new Date();
    const staleDeviceDays = options.staleDeviceDays ?? 30;
    const auditRetentionDays = options.auditRetentionDays ?? 365;
    const enrollmentAttemptRetentionDays = options.enrollmentAttemptRetentionDays ?? 30;
    const androidPubSubRetentionDays = options.androidPubSubRetentionDays ?? 30;
    const webhookDeliveryRetentionDays = options.webhookDeliveryRetentionDays ?? 30;

    const result: {
      -readonly [K in keyof MaintenanceResult]: MaintenanceResult[K];
    } = {
      expiredInvitations: 0,
      staleDevices: 0,
      expiredAuthProofs: 0,
      expiredAuthSessions: 0,
      purgedAuditEntries: 0,
      purgedEnrollmentAttempts: 0,
      purgedAndroidPubSubMessages: 0,
      credentialAlerts: 0,
      dynamicGroupsEvaluated: 0,
      purgedWebhookDeliveries: 0,
      webhookRetries: 0,
      webhookRetrySucceeded: 0,
      webhookRetryFailed: 0,
    };

    // 1. Expire pending invitations whose acceptance window has closed.
    const expiredInvitations = yield* db
      .select({ id: s.invitation.id })
      .from(s.invitation)
      .where(and(eq(s.invitation.status, "pending"), lt(s.invitation.expiresAt, now)));
    if (expiredInvitations.length > 0) {
      yield* db
        .update(s.invitation)
        .set({ status: "expired", updatedAt: now })
        .where(
          inArray(
            s.invitation.id,
            expiredInvitations.map((row) => row.id),
          ),
        );
      result.expiredInvitations = expiredInvitations.length;
    }

    // 2. Mark stale enrolled devices. Unenrolling (rather than deleting) keeps
    //    inventory and audit history intact and lets an operator re-enrol.
    if (staleDeviceDays > 0) {
      const staleCutoff = new Date(now.getTime() - staleDeviceDays * day);
      const staleDevices = (yield* db
        .select({ id: s.device.id, organizationId: s.device.organizationId })
        .from(s.device)
        .where(
          and(eq(s.device.status, "enrolled"), lt(s.device.lastSeenAt, staleCutoff)),
        )) as Array<{
        id: string;
        organizationId: string;
      }>;
      if (staleDevices.length > 0) {
        yield* db
          .update(s.device)
          .set({ status: "unenrolled" })
          .where(
            inArray(
              s.device.id,
              staleDevices.map((row) => row.id),
            ),
          );
        result.staleDevices = staleDevices.length;
        // Staleness is a real unenrollment transition, so it is a webhook
        // event too. Dispatch is bounded and never fails maintenance.
        yield* Effect.forEach(
          staleDevices,
          (device) =>
            dispatchWebhookEvent(
              db,
              {
                organizationId: device.organizationId,
                type: "device.unenrolled",
                data: {
                  reason: "stale",
                  targetType: "device",
                  targetId: device.id,
                },
              },
              {
                ...(options.webhookAuthSecret ? { authSecret: options.webhookAuthSecret } : {}),
                ...(options.webhookFetch ? { fetch: options.webhookFetch } : {}),
                now,
              },
            ),
          { concurrency: 4, discard: true },
        );
      }
    }

    // 3. Purge expired auth proofs and sessions. The auth tables are owned by
    //    `@yielded/auth`, so they are referenced through the shared schema
    //    aliases rather than duplicated table definitions. Their expiry columns
    //    are BIGINT epoch milliseconds, not DATETIME, so compare with millis.
    const nowMillis = now.getTime();
    const expiredProofs = yield* db
      .select({ proofId: s.authProofs.proofId })
      .from(s.authProofs)
      .where(lt(s.authProofs.expiresAt, nowMillis));
    if (expiredProofs.length > 0) {
      yield* db.delete(s.authProofs).where(lt(s.authProofs.expiresAt, nowMillis));
      result.expiredAuthProofs = expiredProofs.length;
    }

    const expiredSessions = yield* db
      .select({ sessionId: s.authSessions.sessionId })
      .from(s.authSessions)
      .where(lt(s.authSessions.expiresAt, nowMillis));
    if (expiredSessions.length > 0) {
      yield* db.delete(s.authSessions).where(lt(s.authSessions.expiresAt, nowMillis));
      result.expiredAuthSessions = expiredSessions.length;
    }

    // 4. Audit retention. Opt out with `auditRetentionDays: 0`.
    if (auditRetentionDays > 0) {
      const auditCutoff = new Date(now.getTime() - auditRetentionDays * day);
      const staleAudit = yield* db
        .select({ id: s.auditLog.id })
        .from(s.auditLog)
        .where(lt(s.auditLog.createdAt, auditCutoff));
      if (staleAudit.length > 0) {
        yield* db.delete(s.auditLog).where(lt(s.auditLog.createdAt, auditCutoff));
        result.purgedAuditEntries = staleAudit.length;
      }
    }

    // 5. Enrollment-attempt diagnostics are only useful for a short window.
    if (enrollmentAttemptRetentionDays > 0) {
      const attemptCutoff = new Date(now.getTime() - enrollmentAttemptRetentionDays * day);
      const staleAttempts = yield* db
        .select({ id: s.enrollmentAttempt.id })
        .from(s.enrollmentAttempt)
        .where(lt(s.enrollmentAttempt.createdAt, attemptCutoff));
      if (staleAttempts.length > 0) {
        yield* db
          .delete(s.enrollmentAttempt)
          .where(lt(s.enrollmentAttempt.createdAt, attemptCutoff));
        result.purgedEnrollmentAttempts = staleAttempts.length;
      }
    }

    // 5b. Android Pub/Sub deliveries are deduped by message id; the ledger
    //     only needs to outlive Pub/Sub's redelivery window.
    if (androidPubSubRetentionDays > 0) {
      const androidCutoff = new Date(now.getTime() - androidPubSubRetentionDays * day);
      const staleMessages = yield* db
        .select({ messageId: s.androidPubSubMessage.messageId })
        .from(s.androidPubSubMessage)
        .where(lt(s.androidPubSubMessage.receivedAt, androidCutoff));
      if (staleMessages.length > 0) {
        yield* db
          .delete(s.androidPubSubMessage)
          .where(lt(s.androidPubSubMessage.receivedAt, androidCutoff));
        result.purgedAndroidPubSubMessages = staleMessages.length;
      }
    }

    // 6. Credential expiry warnings. APNs and SCEP CA expiries are otherwise
    //    only visible on one settings page, so write one audit event per
    //    organisation per threshold per UTC day. The audit trail itself is the
    //    dedupe store, which avoids a dedicated alert table. The lookup is
    //    scoped to one organisation and the current day so it can use the
    //    `(organization_id, action)` / `(organization_id, created_at)` indexes
    //    instead of scanning every tenant's alert history. A new alert is also
    //    handed to the optional notifier; delivery never affects the run.
    if (options.credentialAlerts !== false) {
      const alertDay = credentialAlertDay(now);
      const alertCutoff = startOfUtcDay(now);
      const organizations = (yield* db
        .select({ id: s.organization.id, name: s.organization.name })
        .from(s.organization)) as Array<{ id: string; name: string }>;
      for (const organization of organizations) {
        const existingAlerts = (yield* db
          .select()
          .from(s.auditLog)
          .where(
            and(
              eq(s.auditLog.organizationId, organization.id),
              eq(s.auditLog.action, CREDENTIAL_ALERT_ACTION),
              gte(s.auditLog.createdAt, alertCutoff),
            ),
          )) as Array<{
          metadata: unknown;
          createdAt: Date;
        }>;
        const alerted = new Set<string>();
        for (const entry of existingAlerts) {
          const createdAt =
            entry.createdAt instanceof Date ? entry.createdAt : new Date(entry.createdAt);
          if (Number.isNaN(createdAt.getTime()) || createdAt < alertCutoff) continue;
          const threshold = thresholdFromMetadata(entry.metadata);
          if (threshold) alerted.add(threshold);
        }

        const health = yield* loadCredentialHealth(db, organization.id, now);
        const threshold = alertThreshold(health);
        if (!threshold || alerted.has(threshold)) continue;
        yield* db.insert(s.auditLog).values({
          id: id(),
          organizationId: organization.id,
          actorUserId: null,
          actorEmail: null,
          action: CREDENTIAL_ALERT_ACTION,
          targetType: "organization",
          targetId: organization.id,
          metadata: {
            threshold,
            day: alertDay,
            apns: health.apns,
            scepCa: health.scepCa,
            deviceCertificates: health.deviceCertificates,
          },
          createdAt: now,
        });
        result.credentialAlerts += 1;

        if (options.notifyCredentialExpiry) {
          const recipients = yield* loadCredentialAlertRecipients(db, organization.id);
          const notification: CredentialExpiryNotification = {
            organizationId: organization.id,
            organizationName: organization.name,
            threshold,
            health,
            day: alertDay,
            recipients,
          };
          // A notification transport is best-effort: log and keep going so a
          // mail outage cannot abort the rest of maintenance.
          yield* Effect.suspend(() => options.notifyCredentialExpiry!(notification)).pipe(
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.failCause(cause)
                : Effect.sync(() =>
                    console.error(
                      "Credential expiry notification failed",
                      organization.id,
                      threshold,
                      cause,
                    ),
                  ),
            ),
          );
        }
      }
    }

    // 7. Webhook delivery retention and bounded retries. Retention runs even
    //    when no signing secret is configured; retries are skipped without one.
    if (webhookDeliveryRetentionDays > 0)
      result.purgedWebhookDeliveries = yield* pruneWebhookDeliveries(db, {
        now,
        retentionDays: webhookDeliveryRetentionDays,
      });
    if (options.webhookRetry !== false && options.webhookAuthSecret) {
      const retried = yield* retryFailedWebhookDeliveries(db, {
        now,
        authSecret: options.webhookAuthSecret,
        fetch: options.webhookFetch,
        maxAttempts: options.webhookMaxAttempts,
      });
      result.webhookRetries = retried.retried;
      result.webhookRetrySucceeded = retried.succeeded;
      result.webhookRetryFailed = retried.failed;
    }

    // 8. Recompute dynamic group membership. Rules can depend on last-seen age
    //    and inventory health, so daily maintenance is the backstop even when a
    //    device never checks in again. Tenant-scoped: one pass per tenant.
    if (options.dynamicGroups !== false) {
      const organizations = yield* db.select({ id: s.organization.id }).from(s.organization);
      for (const organization of organizations) {
        const evaluated = yield* syncDynamicGroupsForTenant(db, organization.id, { now });
        result.dynamicGroupsEvaluated += evaluated.length;
      }
    }

    return result;
  });
