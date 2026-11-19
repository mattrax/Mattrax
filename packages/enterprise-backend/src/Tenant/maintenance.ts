import { Cause, Effect, Exit, Option, Schema } from "effect";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { Db, pruneWindowsFailures, schema as s } from "@mattrax/enterprise-core";
import {
  dispatchWebhookEvent,
  pruneWebhookDeliveries,
  retryFailedWebhookDeliveries,
  refreshAppleSecurityInfo,
  sweepDeviceCommands,
  sweepWindowsStateCommands,
  syncDynamicGroupsForTenant,
  WINDOWS_STATE_COMMAND_RETENTION_DAYS,
} from "@mattrax/mdm-apple";
import { sweepScriptExecutions } from "../Policy/scripts.ts";
import { loadCredentialHealth, type CredentialHealth } from "../Device/credentialHealth.ts";
import {
  sweepCredentialIssuance,
  type DomainCertificateRequester,
} from "../Device/credentialIssuance.ts";
import { purgeExpiredScepCaTrust, rotateDueScepCas } from "../Scep/scepLifecycle.ts";
import {
  runServerCertificateCheck,
  type ServerCertificateProbe,
} from "../Scep/serverCertificate.ts";
import { reconcileSubscriptionSweep } from "@mattrax/enterprise-billing";
import type { PlanLimitsConfig } from "@mattrax/enterprise-core";
import type { ServerCertificateInfo } from "@mattrax/enterprise-domain";
import type { EffectStripeClient } from "@mattrax/effect-stripe";
import { refreshAppleApplicationInventory } from "../Device/appleInventory.ts";
import { syncScheduledVppAssets } from "@mattrax/apple-business-manager";
import { TENANT_DELETION_LOG_RETENTION_DAYS } from "./tenantTeardown.ts";
import { isBuiltInOwnerMember } from "@mattrax/enterprise-identity";
import type { WebhookDeliveryOptions } from "@mattrax/mdm-apple";
import type { EnterpriseDb } from "../schema.ts";
import type { EmailTransport } from "@mattrax/email";
import { drainEmailOutbox, purgeEmailOutbox } from "../Mail/emailOutbox.ts";

/**
 * A tenant owner/admin recipient. Shared by credential-expiry notifications
 * and onboarding email so both apply the same built-in-role and disabled-user
 * rules.
 */
export type CredentialAlertRecipient = {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly role: string;
  /** `undefined` for callers that only construct notification payloads. */
  readonly emailVerified?: boolean;
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
) => Effect.Effect<void, unknown, Db>;

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
   * Rotate tenant SCEP CAs that have entered their rotation window. Defaults
   * to true; requires `authSecret` to unseal and reseal the CA key.
   */
  readonly scepCaRotation?: boolean;
  /**
   * Public origin whose TLS certificate is reviewed on a schedule (for example
   * `https://e.mattrax.app`). Omit it to skip the probe, which is what a host
   * without an HTTPS origin (local development) does.
   */
  readonly serverCertificateOrigin?: string;
  /** Minimum minutes between origin certificate probes. Defaults to 60. */
  readonly serverCertificateIntervalMinutes?: number;
  /** Injectable TLS probe for tests. */
  readonly serverCertificateProbe?: ServerCertificateProbe;
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
  /**
   * Application secret used to decrypt Apps and Books content tokens for the
   * scheduled licence sync. Without it the sync is skipped (manual sync still
   * works through the API).
   */
  readonly authSecret?: string;
  /** Refresh due Apps and Books assets. Defaults to true. */
  readonly vppSync?: boolean;
  /** Injected fetch for retry tests. */
  readonly webhookFetch?: typeof globalThis.fetch;
  /** Maximum recorded attempts for a retried delivery. Defaults to 3. */
  readonly webhookMaxAttempts?: number;
  /**
   * Transport for the transactional-email outbox. Omit it (or pass `null`) to
   * leave queued mail untouched, which is what a deployment without a mailer
   * wants; the rows stay pending until a transport exists.
   */
  readonly email?: EmailTransport | null;
  /** Maximum outbox deliveries in flight. Defaults to 4. */
  readonly emailOutboxConcurrency?: number;
  /** Attempts before an outbox row is permanently failed. Defaults to 5. */
  readonly emailOutboxMaxAttempts?: number;
  /**
   * Queue the daily Apple `InstalledApplicationList` refresh. Defaults to true;
   * disable it in tests that assert on the command queue.
   */
  readonly applicationInventory?: boolean;
  /**
   * Terminal device-command rows older than this many days are deleted.
   * Defaults to 90. Active commands are never pruned; they expire first.
   * Set to `0` to keep command history indefinitely.
   */
  readonly commandRetentionDays?: number;
  /**
   * Windows policy and inventory command rows older than this many days are
   * deleted. Defaults to `WINDOWS_STATE_COMMAND_RETENTION_DAYS` (30). These
   * rows are regenerated from device state on every check-in, so they are
   * ephemeral delivery bookkeeping rather than an action queue. Set to `0` to
   * keep them indefinitely.
   */
  readonly windowsCommandRetentionDays?: number;
  /**
   * Windows enrollment and management failure history older than this many
   * days is deleted. Defaults to 30 so the diagnostics that explain a failed
   * enrollment outlive a device's first few support cycles but do not grow
   * forever. Set to `0` to keep it indefinitely.
   */
  readonly windowsFailureRetentionDays?: number;
  /**
   * Detect credentials and the deployment domain that have no certificate and
   * trigger issuance. Defaults to true. A missing tenant SCEP CA is generated
   * when the tenant has active devices; a missing APNs certificate starts the
   * manual flow by generating the pending CSR key.
   */
  readonly credentialIssuance?: boolean;
  /**
   * Host hook used to request a certificate for a deployment origin whose TLS
   * probe observed none. Omit it on platforms that renew the origin out of band
   * (Cloudflare, or an operator-managed proxy); the run then only reports it.
   */
  readonly requestDomainCertificate?: DomainCertificateRequester;
  /**
   * Terminal script-execution rows older than this many days are deleted.
   * Defaults to 30. Queued runs expire first; they are never pruned while
   * active. Set to `0` to keep script results indefinitely.
   */
  readonly scriptExecutionRetentionDays?: number;
  /**
   * Completed/failed tenant-teardown journal rows older than this many days are
   * deleted. Defaults to 365 so the operator email in the journal is not kept
   * forever. Set to `0` to keep them indefinitely.
   */
  readonly tenantDeletionLogRetentionDays?: number;
  /**
   * Stripe client used to reconcile subscription seats and customer names.
   * Omit it on deployments without billing, or to skip the billing sweep.
   */
  readonly billing?: {
    readonly stripe: EffectStripeClient;
    readonly deviceMonthlyPriceId?: string;
    readonly planLimits?: PlanLimitsConfig;
  };
};

export type MaintenanceResult = {
  readonly expiredInvitations: number;
  readonly staleDevices: number;
  readonly expiredAuthSessions: number;
  readonly purgedAuditEntries: number;
  /** Account-scoped audit rows deleted by the same retention window. */
  readonly purgedAccountAuditEntries: number;
  /** Enrollment-attempt diagnostics deleted this run. */
  readonly purgedEnrollmentAttempts: number;
  /** Android Pub/Sub idempotency records deleted this run. */
  readonly purgedAndroidPubSubMessages: number;
  /** Credential expiry audit events written this run. */
  readonly credentialAlerts: number;
  /** Tenant SCEP CAs rotated because they entered the rotation window. */
  readonly scepCaRotated: number;
  /** Tenants whose automatic CA rotation failed; retried next run. */
  readonly scepCaRotationFailed: number;
  /** Retired CA anchors dropped after their trust window closed. */
  readonly purgedScepCaTrust: number;
  /** 1 when this run probed the origin TLS certificate, 0 when throttled/skipped. */
  readonly serverCertificateChecked: number;
  /** Dynamic groups whose materialised membership was recomputed. */
  readonly dynamicGroupsEvaluated: number;
  /** Webhook delivery rows deleted by retention. */
  readonly purgedWebhookDeliveries: number;
  /** Failed webhook deliveries retried this run. */
  readonly webhookRetries: number;
  readonly webhookRetrySucceeded: number;
  readonly webhookRetryFailed: number;
  /** Apple devices whose installed-application inventory was requested. */
  readonly applicationInventoryRefreshes: number;
  /**
   * Macs asked for a fresh `SecurityInfo` report (FileVault key escrow and
   * Activation Lock state). Additive to the maintenance result.
   */
  readonly securityInfoRefreshes: number;
  /** Active commands whose delivery deadline elapsed during this run. */
  readonly expiredCommands: number;
  /** Terminal command rows deleted by retention. */
  readonly purgedCommands: number;
  /** Windows state-generated command rows deleted by retention. */
  readonly purgedWindowsCommands: number;
  /** Windows enrollment/management failure records deleted by retention. */
  readonly purgedWindowsFailures: number;
  /** Tenant SCEP CAs generated because the tenant had none. */
  readonly scepCasIssued: number;
  /** Tenants whose SCEP CA could not be generated; retried next run. */
  readonly scepCasFailed: number;
  /** Active Apple tenants with no APNs certificate. */
  readonly missingApnsCertificates: number;
  /** Pending APNs CSR keys generated for those tenants. */
  readonly apnsCsrsGenerated: number;
  /** 1 when the deployment origin has no observed TLS certificate. */
  readonly missingDomainCertificates: number;
  /** 1 when the origin TLS probe failed; an outage is not a missing certificate. */
  readonly domainCertificateProbeFailed: number;
  /** Origin certificate issuance hooks that completed this run. */
  readonly domainCertificateRequests: number;
  /** Queued script runs whose deadline elapsed during this run. */
  readonly expiredScriptRuns: number;
  /** Terminal script-execution rows deleted by retention. */
  readonly purgedScriptRuns: number;
  /** Completed/failed tenant-teardown journal rows deleted by retention. */
  readonly purgedTenantDeletionLogs: number;
  /** Tenants whose Stripe seat quantity was brought in line this run. */
  readonly billingSeatsUpdated: number;
  /** Tenants checked against Stripe where the quantity already matched. */
  readonly billingSeatsUnchanged: number;
  /** Tenants skipped (no subscription, another price, ended subscription). */
  readonly billingSeatsSkipped: number;
  /** Tenants whose Stripe reconciliation failed; retried next run. */
  readonly billingSeatsFailed: number;
  /** Stripe customer names updated to match a renamed tenant. */
  readonly billingCustomerNamesUpdated: number;
  /** Transactional emails delivered by the outbox drain this run. */
  readonly emailOutboxSent: number;
  /** Rows rescheduled after a provider failure. */
  readonly emailOutboxRetried: number;
  /** Rows that exhausted their attempts and are now permanently failed. */
  readonly emailOutboxFailed: number;
  /** Delivered/failed outbox rows deleted by retention. */
  readonly purgedEmailOutbox: number;
  /** Apps and Books licence pools refreshed by the scheduled sync. */
  readonly vppSynced: number;
  /** Tenants whose Apps and Books sync failed this run. */
  readonly vppFailed: number;
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

const CredentialAlertThresholdSchema = Schema.Literals(["expired", "7d", "30d"]);

const CredentialAlertMetadata = Schema.Struct({
  threshold: Schema.optional(CredentialAlertThresholdSchema),
});

const thresholdFromMetadata = (
  metadata: Schema.Json | null | undefined,
): CredentialAlertThreshold | null => {
  const decoded = Option.getOrUndefined(
    Schema.decodeUnknownOption(CredentialAlertMetadata)(metadata),
  );

  return decoded?.threshold ?? null;
};

const hasAdminRole = (role: string): boolean =>
  role
    .split(",")
    .map((part) => part.trim())
    .includes("admin");

/**
 * An owner/admin derived only from built-in roles. `isBuiltInOwnerMember`
 * enforces the custom-role exclusion for owner authority; the admin branch
 * keeps the existing expiry-notification reach.
 */
const isBuiltInManager = (member: {
  readonly role: string;
  readonly customRoleId?: string | null;
}): boolean =>
  isBuiltInOwnerMember(member) || (member.customRoleId == null && hasAdminRole(member.role));

/**
 * Load the tenant's owner/admin recipients for an expiry notification.
 *
 * Roles are comma-separated (`owner,admin`), so the filter runs in application
 * code rather than as an `IN` predicate that would miss combined roles. Owner
 * authority only comes from a built-in role on a membership without a custom
 * role, matching RBAC. The member and user reads are both tenant/user scoped;
 * disabled users are skipped and recipients are deduplicated by email address.
 */
export const loadTenantAdminRecipients = (
  db: EnterpriseDb,
  organizationId: string,
): Effect.Effect<CredentialAlertRecipient[], unknown> =>
  Effect.gen(function* () {
    const memberRows = yield* db
      .select()
      .from(s.member)
      .where(eq(s.member.organizationId, organizationId));

    const members = memberRows.map((row) =>
      Schema.decodeUnknownSync(
        Schema.Struct({
          accountId: Schema.String,
          role: Schema.String,
          customRoleId: Schema.optional(Schema.NullOr(Schema.String)),
        }),
      )(row),
    );

    const roles = new Map<string, string>();

    for (const member of members) {
      // A custom role is authoritative. Its legacy built-in string must not
      // leak notifications to a delegated member, and owner authority must be
      // the built-in role rather than a custom-role delegation.
      if (!isBuiltInManager(member)) continue;
      roles.set(member.accountId, member.role);
    }

    if (roles.size === 0) return [];

    const userRows = yield* db
      .select()
      .from(s.account)
      .where(inArray(s.account.id, [...roles.keys()]));

    const users = userRows.map((row) =>
      Schema.decodeUnknownSync(
        Schema.Struct({
          id: Schema.String,
          name: Schema.String,
          email: Schema.String,
          disabled: Schema.Boolean,
          emailVerified: Schema.optional(Schema.Boolean),
        }),
      )(row),
    );

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
        emailVerified: user.emailVerified === true,
      });
    }

    return recipients.sort((left, right) => left.email.localeCompare(right.email));
  });

/** Backwards-compatible name used by credential-expiry notifications. */
export const loadCredentialAlertRecipients = loadTenantAdminRecipients;

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
): Effect.Effect<MaintenanceResult, unknown, Db> =>
  Effect.gen(function* () {
    const db = yield* Db;
    const now = options.now ?? new Date();
    const staleDeviceDays = options.staleDeviceDays ?? 30;
    const auditRetentionDays = options.auditRetentionDays ?? 365;
    const enrollmentAttemptRetentionDays = options.enrollmentAttemptRetentionDays ?? 30;
    const androidPubSubRetentionDays = options.androidPubSubRetentionDays ?? 30;
    const webhookDeliveryRetentionDays = options.webhookDeliveryRetentionDays ?? 30;
    const commandRetentionDays = options.commandRetentionDays ?? 90;

    const tenantDeletionLogRetentionDays =
      options.tenantDeletionLogRetentionDays ?? TENANT_DELETION_LOG_RETENTION_DAYS;

    /** Latest origin observation, reused by the missing-certificate sweep. */
    let serverCertificateState: ServerCertificateInfo | null = null;

    const result = {
      expiredInvitations: 0,
      staleDevices: 0,
      expiredAuthSessions: 0,
      purgedAuditEntries: 0,
      purgedAccountAuditEntries: 0,
      purgedEnrollmentAttempts: 0,
      purgedAndroidPubSubMessages: 0,
      credentialAlerts: 0,
      scepCaRotated: 0,
      scepCaRotationFailed: 0,
      purgedScepCaTrust: 0,
      serverCertificateChecked: 0,
      dynamicGroupsEvaluated: 0,
      purgedWebhookDeliveries: 0,
      webhookRetries: 0,
      webhookRetrySucceeded: 0,
      webhookRetryFailed: 0,
      applicationInventoryRefreshes: 0,
      securityInfoRefreshes: 0,
      expiredCommands: 0,
      purgedCommands: 0,
      purgedWindowsCommands: 0,
      purgedWindowsFailures: 0,
      scepCasIssued: 0,
      scepCasFailed: 0,
      missingApnsCertificates: 0,
      apnsCsrsGenerated: 0,
      missingDomainCertificates: 0,
      domainCertificateProbeFailed: 0,
      domainCertificateRequests: 0,
      expiredScriptRuns: 0,
      purgedScriptRuns: 0,
      purgedTenantDeletionLogs: 0,
      billingSeatsUpdated: 0,
      billingSeatsUnchanged: 0,
      billingSeatsSkipped: 0,
      billingSeatsFailed: 0,
      billingCustomerNamesUpdated: 0,
      emailOutboxSent: 0,
      emailOutboxRetried: 0,
      emailOutboxFailed: 0,
      purgedEmailOutbox: 0,
      vppSynced: 0,
      vppFailed: 0,
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

      const staleDeviceRows = yield* db
        .select({ id: s.device.id, organizationId: s.device.organizationId })
        .from(s.device)
        .where(and(eq(s.device.status, "enrolled"), lt(s.device.lastSeenAt, staleCutoff)));

      const staleDevices = staleDeviceRows.map((row) =>
        Schema.decodeUnknownSync(
          Schema.Struct({ id: Schema.String, organizationId: Schema.String }),
        )(row),
      );

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
                now,
                authSecret: options.webhookAuthSecret,
                fetch: options.webhookFetch,
              } satisfies WebhookDeliveryOptions,
            ),
          { concurrency: 4, discard: true },
        );
      }
    }

    // 3. Purge expired auth sessions. The auth tables are owned by
    //    `@yielded/auth`, so they are referenced through the shared schema
    //    aliases rather than duplicated table definitions. Their expiry columns
    //    are BIGINT epoch milliseconds, not DATETIME, so compare with millis.
    const nowMillis = now.getTime();

    const expiredSessions = yield* db
      .select({ sessionId: s.authSessions.sessionId })
      .from(s.authSessions)
      .where(lt(s.authSessions.expiresAt, nowMillis));

    if (expiredSessions.length > 0) {
      yield* db.delete(s.authSessions).where(lt(s.authSessions.expiresAt, nowMillis));
      result.expiredAuthSessions = expiredSessions.length;

      // Session descriptors live in an application table with no foreign key
      // to the library-owned session row, so they are removed with the
      // sessions they describe. Explicit revocation removes its own row; this
      // covers natural expiry. Chunked so one sweep cannot exceed the query
      // parameter budget.
      const expiredIds = expiredSessions.map((row) => row.sessionId);

      for (let offset = 0; offset < expiredIds.length; offset += 500)
        yield* db
          .delete(s.accountSessionContext)
          .where(
            inArray(s.accountSessionContext.sessionId, expiredIds.slice(offset, offset + 500)),
          );
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

      // The account stream uses the same retention setting: one privacy policy
      // covers every audit record the deployment keeps.
      const staleAccountAudit = yield* db
        .select({ id: s.accountAuditLog.id })
        .from(s.accountAuditLog)
        .where(lt(s.accountAuditLog.createdAt, auditCutoff));

      if (staleAccountAudit.length > 0) {
        yield* db.delete(s.accountAuditLog).where(lt(s.accountAuditLog.createdAt, auditCutoff));
        result.purgedAccountAuditEntries = staleAccountAudit.length;
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

    // 5c. Windows enrollment/management failure history is diagnostic, not an
    //     audit log: keep it for the same month as enrollment attempts. A
    //     device that never enrolled has no other durable trace of why.
    result.purgedWindowsFailures = yield* pruneWindowsFailures(db, {
      now,
      retentionDays: options.windowsFailureRetentionDays,
    });

    // 5d. SCEP CA lifecycle. A CA inside its rotation window is replaced by a
    //     successor: the successor signs new and renewed identities, and the
    //     previous CA stays a verification anchor until it expires. No identity
    //     is revoked, so a fleet survives the rotation without re-enrolling.
    //     Runs before the credential alerts so they describe the new state.
    if (options.scepCaRotation !== false) {
      const rotation = yield* rotateDueScepCas(db, {
        now,
        authSecret: options.authSecret,
      }).pipe(
        Effect.catch((cause) =>
          Effect.sync(() => {
            console.error("SCEP CA rotation sweep failed", cause);

            return { checked: 0, rotated: 0, failed: 0 };
          }),
        ),
      );

      result.scepCaRotated = rotation.rotated;
      result.scepCaRotationFailed = rotation.failed;
      result.purgedScepCaTrust = yield* purgeExpiredScepCaTrust(db, now).pipe(
        Effect.catch(() => Effect.succeed(0)),
      );
    }

    // 5d. Review the deployment origin's TLS certificate. The probe is
    //     throttled, so the hourly cron can call it unconditionally while a
    //     manual daily run reuses a fresh observation. A failure is recorded
    //     rather than thrown: the rest of maintenance must still run.
    if (options.serverCertificateOrigin) {
      const check = yield* runServerCertificateCheck(db, {
        origin: options.serverCertificateOrigin,
        now,
        intervalMinutes: options.serverCertificateIntervalMinutes,
        probe: options.serverCertificateProbe,
      }).pipe(
        Effect.catch((cause) =>
          Effect.sync(() => {
            console.error("Origin TLS certificate check failed", cause);

            return { checked: false, state: null };
          }),
        ),
      );

      result.serverCertificateChecked = check.checked ? 1 : 0;
      serverCertificateState = check.state;
    }

    // 5e. Missing-certificate issuance. A tenant with active devices but no
    //     SCEP CA cannot sign an enrolment profile or issue a device identity,
    //     so generate it here instead of waiting for the first device request.
    //     A missing APNs certificate starts its manual flow by generating the
    //     pending CSR key; Apple still has to sign the certificate. An origin
    //     with no observed certificate is handed to the host's issuance hook.
    //     Runs before the credential alerts so they describe the repaired state;
    //     failures are isolated per tenant and retried by the next run. The
    //     whole step is bounded and exited here so a hanging host hook cannot
    //     abort the rest of maintenance (including the Windows sweep below).
    if (options.credentialIssuance !== false) {
      const issuanceExit = yield* Effect.suspend(() =>
        sweepCredentialIssuance(db, {
          now,
          authSecret: options.authSecret,
          domain:
            options.serverCertificateOrigin && serverCertificateState
              ? { origin: options.serverCertificateOrigin, state: serverCertificateState }
              : undefined,
          requestDomainCertificate: options.requestDomainCertificate,
        }),
      ).pipe(Effect.timeout("30 seconds"), Effect.exit);

      if (Exit.isFailure(issuanceExit)) {
        yield* Effect.logError("Credential issuance sweep failed", issuanceExit.cause);
      } else {
        const issuance = issuanceExit.value;

        result.scepCasIssued = issuance.scepCasIssued;
        result.scepCasFailed = issuance.scepCasFailed;
        result.missingApnsCertificates = issuance.missingApnsCertificates;
        result.apnsCsrsGenerated = issuance.apnsCsrsGenerated;
        result.missingDomainCertificates = issuance.missingDomainCertificates;
        result.domainCertificateProbeFailed = issuance.domainCertificateProbeFailed;
        result.domainCertificateRequests = issuance.domainCertificateRequests;
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

      const organizationRows = yield* db
        .select({ id: s.organization.id, name: s.organization.name })
        .from(s.organization);

      const organizations = organizationRows.map((row) =>
        Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String, name: Schema.String }))(row),
      );

      for (const organization of organizations) {
        const existingAlerts = yield* db
          .select()
          .from(s.auditLog)
          .where(
            and(
              eq(s.auditLog.organizationId, organization.id),
              eq(s.auditLog.action, CREDENTIAL_ALERT_ACTION),
              gte(s.auditLog.createdAt, alertCutoff),
            ),
          );

        const alerted = new Set<string>();

        for (const entry of existingAlerts) {
          const createdAt =
            entry.createdAt instanceof Date ? entry.createdAt : new Date(entry.createdAt);

          if (Number.isNaN(createdAt.getTime()) || createdAt < alertCutoff) continue;

          const metadata = Option.getOrUndefined(
            Schema.decodeUnknownOption(Schema.Json)(entry.metadata),
          );

          const threshold = thresholdFromMetadata(metadata);

          if (threshold) alerted.add(threshold);
        }

        const health = yield* loadCredentialHealth(db, organization.id, now, {
          authSecret: options.authSecret,
        });

        const threshold = alertThreshold(health);

        if (!threshold || alerted.has(threshold)) continue;
        yield* db.insert(s.auditLog).values({
          id: id(),
          organizationId: organization.id,
          actorAccountId: null,
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
            serverCertificate: health.serverCertificate,
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

    // 6b. Drain the transactional-email outbox. Queued invitations,
    //     verification codes and alerts are retried here with exponential
    //     backoff; a row that exhausts its attempts is marked failed and
    //     written to the tenant (or account) audit stream. Without a transport
    //     the rows stay pending, so enabling a mailer later delivers them.
    if (options.email) {
      const outbox = yield* drainEmailOutbox({
        db,
        email: options.email,
        now,
        concurrency: options.emailOutboxConcurrency,
        maxAttempts: options.emailOutboxMaxAttempts,
      });

      result.emailOutboxSent = outbox.sent;
      result.emailOutboxRetried = outbox.retried;
      result.emailOutboxFailed = outbox.failed;
      result.purgedEmailOutbox = yield* purgeEmailOutbox(db, { now });
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

    // 9. Apple installed-application inventory. iOS and macOS only report their
    //    applications on request, so the daily sweep queues one
    //    `InstalledApplicationList` per device whose inventory is missing or
    //    older than a day. Devices with a refresh already in flight are left
    //    alone. The sweep runs last, so a failure here still leaves the
    //    retention, alerting and webhook work above completed.
    if (options.applicationInventory !== false) {
      result.applicationInventoryRefreshes = yield* refreshAppleApplicationInventory(db, { now });
    }

    // 9b. FileVault escrow freshness. A Mac's personal recovery key is only
    //    written when FileVault is enabled, which is normally after enrolment.
    //    Ask any Mac whose key is missing or whose security report is stale for
    //    a new `SecurityInfo`, rate-limited per device.
    if (options.applicationInventory !== false) {
      const securityInfo = yield* refreshAppleSecurityInfo(db, { now });

      result.securityInfoRefreshes = securityInfo.requested;
    }

    // 9c. Apps and Books licence pools. Apple's counts change when licences are
    //     purchased, returned or revoked elsewhere, and the manual sync button
    //     is easy to forget. Tenants are refreshed at most once a day; a failed
    //     sync is recorded on the token row and retried by the next run.
    if (options.vppSync !== false && options.authSecret) {
      const vpp = yield* syncScheduledVppAssets({
        db,
        authSecret: options.authSecret,
        now,
      });

      result.vppSynced = vpp.synced;
      result.vppFailed = vpp.failed;
    }

    // 10. Command queue housekeeping. Android commands are issued directly and
    //     rely on a Pub/Sub notification to become terminal; if that never
    //     arrives the row would stay `sent` forever. The sweep applies every
    //     command's delivery deadline regardless of platform, then prunes
    //     terminal history past retention. Idempotent and bounded.
    const commands = yield* sweepDeviceCommands(db, {
      now,
      retentionDays: commandRetentionDays,
    });

    result.expiredCommands = commands.expired;
    result.purgedCommands = commands.pruned;

    // 10a. Windows policy/inventory rows are regenerated from device state on
    //      every check-in and are written without an expiry, so the generic
    //      sweep above never classifies them as terminal. Prune them by age
    //      with their own bound; a returning device gets a fresh row.
    const windowsCommands = yield* sweepWindowsStateCommands(db, {
      now,
      retentionDays: options.windowsCommandRetentionDays ?? WINDOWS_STATE_COMMAND_RETENTION_DAYS,
    });

    result.purgedWindowsCommands = windowsCommands.pruned;

    // 10b. Script queue housekeeping. A manual run that no device collected
    //      before its deadline must not fire weeks later, and script output can
    //      be large, so terminal results are pruned on the same schedule.
    const scriptRuns = yield* sweepScriptExecutions(db, {
      now,
      retentionDays: options.scriptExecutionRetentionDays,
    });

    result.expiredScriptRuns = scriptRuns.expired;
    result.purgedScriptRuns = scriptRuns.pruned;

    // 11. Tenant-teardown journal retention. The journal carries the operator
    //     email that requested the deletion and survives the tenant row, so it
    //     must not be kept forever.
    if (tenantDeletionLogRetentionDays > 0) {
      const cutoff = new Date(now.getTime() - tenantDeletionLogRetentionDays * day);

      const staleJournals = yield* db
        .select({ id: s.tenantDeletion.id })
        .from(s.tenantDeletion)
        .where(
          and(
            inArray(s.tenantDeletion.status, ["completed", "failed"]),
            lt(s.tenantDeletion.updatedAt, cutoff),
          ),
        )
        .limit(5_000);

      if (staleJournals.length > 0)
        yield* db.delete(s.tenantDeletion).where(
          inArray(
            s.tenantDeletion.id,
            staleJournals.map((row) => row.id),
          ),
        );

      result.purgedTenantDeletionLogs = staleJournals.length;
    }

    // 12. Billing seats. Devices enrol through the protocol layer, which has
    //     no Stripe client, so this sweep is what keeps the paid quantity equal
    //     to the fleet a tenant actually has. It also retries a customer rename
    //     whose inline Stripe update failed. Runs after the stale-device sweep
    //     above so retired devices are already out of the count.
    if (options.billing) {
      const billing = yield* reconcileSubscriptionSweep({
        db,
        stripe: options.billing.stripe,
        deviceMonthlyPriceId: options.billing.deviceMonthlyPriceId,
        planLimits: options.billing.planLimits,
      });

      result.billingSeatsUpdated = billing.updated;
      result.billingSeatsUnchanged = billing.unchanged;
      result.billingSeatsSkipped = billing.skipped;
      result.billingSeatsFailed = billing.failed;
      result.billingCustomerNamesUpdated = billing.customerNamesUpdated;
    }

    return result;
  });
