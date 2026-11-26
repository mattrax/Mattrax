import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { DEFAULT_EMAIL_FROM } from "@mattrax/email";
import type { EmailTransport } from "@mattrax/email";
import { dispatchWebhookEvent } from "@mattrax/mdm-core";
import type { EnterpriseDb } from "../schema.ts";
import { schema as s } from "../schema.ts";
import { sendTransactionalEmail } from "./emailOutbox.ts";
import { restrictedSoftwareViolationEmail } from "./restrictedSoftwareEmail.ts";

/**
 * Notify on newly detected restricted-software violations.
 *
 * The inventory path cannot send a webhook or email: those need the signing
 * secret and mail transport, and they must not make a device check-in fail.
 * Violations are therefore written with `notifiedAt = null` and this bounded
 * sweep turns each into a webhook delivery and, when the rule lists recipients,
 * an outbox email. Marking happens only after both attempts so a crashed sweep
 * retries rather than silently dropping the event.
 */

export const RESTRICTED_SOFTWARE_NOTIFICATION_BATCH = 50;

export const notifyRestrictedSoftwareViolations = (input: {
  readonly db: EnterpriseDb;
  readonly authSecret?: string;
  readonly email?: EmailTransport;
  readonly now?: Date;
  readonly limit?: number;
  /** Injected for tests; production uses the runtime fetch. */
  readonly fetch?: typeof globalThis.fetch;
}): Effect.Effect<{ readonly due: number; readonly notified: number }, unknown> =>
  Effect.gen(function* () {
    const now = input.now ?? new Date();

    const violations = yield* input.db
      .select()
      .from(s.restrictedSoftwareViolation)
      .where(isNull(s.restrictedSoftwareViolation.notifiedAt))
      .orderBy(asc(s.restrictedSoftwareViolation.lastDetectedAt))
      .limit(input.limit ?? RESTRICTED_SOFTWARE_NOTIFICATION_BATCH);

    if (violations.length === 0) return { due: 0, notified: 0 };

    // A sweep runs across every tenant. Grouping by organisation keeps each
    // lookup tenant-scoped and avoids returning another tenant's rule names.
    const byOrganization = new Map<string, typeof violations>();

    for (const violation of violations) {
      const list = byOrganization.get(violation.organizationId) ?? [];
      list.push(violation);
      byOrganization.set(violation.organizationId, list);
    }

    let notified = 0;

    for (const [organizationId, organizationViolations] of byOrganization) {
      const ruleIds = [...new Set(organizationViolations.map((row) => row.restrictedSoftwareId))];
      const deviceIds = [...new Set(organizationViolations.map((row) => row.deviceId))];

      const rules = yield* input.db
        .select()
        .from(s.restrictedSoftware)
        .where(
          and(
            eq(s.restrictedSoftware.organizationId, organizationId),
            inArray(s.restrictedSoftware.id, ruleIds),
          ),
        );
      const devices = yield* input.db
        .select({ id: s.device.id, name: s.device.name })
        .from(s.device)
        .where(and(eq(s.device.organizationId, organizationId), inArray(s.device.id, deviceIds)));
      const [organization] = yield* input.db
        .select({
          id: s.organization.id,
          name: s.organization.name,
          displayName: s.organization.displayName,
          supportEmail: s.organization.supportEmail,
        })
        .from(s.organization)
        .where(eq(s.organization.id, organizationId))
        .limit(1);

      const ruleById = new Map(rules.map((rule) => [rule.id, rule]));
      const deviceById = new Map(devices.map((device) => [device.id, device]));
      const tenantName = organization?.displayName || organization?.name || "Mattrax";

      for (const violation of organizationViolations) {
        const rule = ruleById.get(violation.restrictedSoftwareId);
        const device = deviceById.get(violation.deviceId);

        if (!rule || !device) continue;

        const enforcement =
          violation.enforcementState === "enforced"
            ? "Enforced"
            : violation.enforcementState === "pending"
              ? "Enforcement pending"
              : violation.enforcementState === "failed"
                ? "Enforcement failed"
                : "Detection only";

        yield* dispatchWebhookEvent(
          input.db,
          {
            organizationId: violation.organizationId,
            type: "restricted_software.violation",
            data: {
              violationId: violation.id,
              ruleId: rule.id,
              ruleName: rule.name,
              action: rule.action,
              platform: violation.platform,
              matchType: violation.matchType,
              matchValue: rule.matchValue,
              matchedBundleId: violation.matchedBundleId,
              applicationName: violation.applicationName,
              deviceId: device.id,
              deviceName: device.name,
              enforcementState: violation.enforcementState,
              status: violation.status,
              occurrenceCount: violation.occurrenceCount,
              firstDetectedAt: violation.firstDetectedAt.toISOString(),
              lastDetectedAt: violation.lastDetectedAt.toISOString(),
            },
          },
          { authSecret: input.authSecret, now, fetch: input.fetch },
        );

        const recipients = Option.getOrElse(
          Schema.decodeUnknownOption(Schema.Array(Schema.String))(rule.notificationEmails),
          () => [],
        );

        if (input.email && recipients.length > 0) {
          const message = restrictedSoftwareViolationEmail({
            tenantName,
            ruleName: rule.name,
            action: rule.action,
            platform: violation.platform,
            deviceName: device.name,
            deviceId: device.id,
            applicationName: violation.applicationName,
            matchedBundleId: violation.matchedBundleId,
            matchType: violation.matchType,
            matchValue: rule.matchValue,
            enforcementLabel: enforcement,
            enforcementDetail: violation.enforcementDetail ?? "",
            detectedAt: violation.lastDetectedAt,
            supportEmail: organization?.supportEmail ?? null,
          });

          yield* Effect.forEach(
            recipients,
            (recipient) =>
              sendTransactionalEmail({
                db: input.db,
                email: input.email,
                template: "restricted_software_violation",
                recipient,
                organizationId: violation.organizationId,
                dedupeKey: `restricted-software:${violation.id}:${violation.lastDetectedAt.getTime()}`,
                message: {
                  to: recipient,
                  from: DEFAULT_EMAIL_FROM,
                  subject: message.subject,
                  text: message.text,
                  html: message.html,
                },
              }),
            { concurrency: 2, discard: true },
          );
        }

        yield* input.db
          .update(s.restrictedSoftwareViolation)
          .set({ notifiedAt: now })
          .where(eq(s.restrictedSoftwareViolation.id, violation.id));

        notified += 1;
      }
    }

    return { due: violations.length, notified };
  });
