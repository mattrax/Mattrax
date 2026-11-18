import { Effect, Schema } from "effect";
import { Db, schema as s } from "@mattrax/enterprise-core";
import { dispatchWebhookEvent, webhookEventForAuditAction } from "./webhooks.ts";

/**
 * Actor recorded on events that are not initiated by a signed-in user. The
 * audit table keeps `actor_user_id` null and uses this sentinel email so the
 * UI can label the actor "System" without inventing a user row.
 */
export const SYSTEM_AUDIT_ACTOR = "system";

/** Low-cardinality system audit actions. Keep this list stable for filters. */
export const SYSTEM_AUDIT_ACTIONS = {
  deviceEnrolled: "device.enrolled",
  deviceDeleted: "device.deleted",
  deviceAwaitingSetup: "device.awaiting_setup",
  deviceSetupComplete: "device.setup_complete",
  deviceCheckedOut: "device.checked_out",
  deviceReturnToServiceRequested: "device.return_to_service_requested",
  deviceReturnToServiceCompleted: "device.return_to_service_completed",
  commandFailed: "device.command_failed",
  commandNotNow: "device.command_not_now",
  declarationInvalid: "device.declaration_invalid",
  pushInvalidToken: "device.push_invalid_token",
  complianceChanged: "device.compliance_changed",
  deviceUnenrolled: "device.unenrolled",
} as const;

export type SystemAuditEvent = {
  readonly organizationId: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId?: string | null;
  /** Small, secret-free context. Never include tokens, keys or passwords. */
  readonly metadata?: Schema.Json;
};

/**
 * Optional outbound webhook context. Audit writes still succeed when no
 * `AUTH_SECRET` is available (for example audit-only tests): delivery is
 * simply skipped.
 */
export type SystemAuditOptions = {
  readonly authSecret?: string;
  readonly webhookFetch?: typeof globalThis.fetch;
  /** Disable delivery for a specific call site (tests). */
  readonly webhooks?: boolean;
};

const id = () => `sys_${crypto.randomUUID().replaceAll("-", "").slice(0, 21)}`;

/**
 * Write a tenant-scoped audit row without a request context.
 *
 * Device protocol paths must never fail because audit storage is unavailable,
 * so write errors are logged and swallowed. Callers should still `yield*` the
 * effect when ordering matters for tests/telemetry.
 */
export const writeSystemAudit = (
  db: Db["Service"],
  event: SystemAuditEvent,
  options: SystemAuditOptions = {},
) =>
  Effect.gen(function* () {
    yield* db.insert(s.auditLog).values({
      id: id(),
      organizationId: event.organizationId,
      actorAccountId: null,
      actorEmail: SYSTEM_AUDIT_ACTOR,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId ?? null,
      metadata: event.metadata === undefined ? null : event.metadata,
      createdAt: new Date(),
    });

    // Device lifecycle transitions are mirrored to customer webhooks. Only
    // mapped actions are delivered; dispatch swallows every failure so audit
    // writes and device protocol requests keep working when an endpoint is
    // down or the deployment has no signing secret.
    const webhookEvent = webhookEventForAuditAction(event.action);

    if (!webhookEvent || !options.authSecret || options.webhooks === false) return;

    const metadata: Schema.JsonObject = Schema.is(Schema.JsonObject)(event.metadata)
      ? event.metadata
      : event.metadata === undefined
        ? {}
        : { metadata: event.metadata };

    yield* dispatchWebhookEvent(
      db,
      {
        organizationId: event.organizationId,
        type: webhookEvent,
        data: Object.assign(
          { targetType: event.targetType, targetId: event.targetId ?? null },
          metadata,
        ),
      },
      { authSecret: options.authSecret, fetch: options.webhookFetch },
    );
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning(`Failed to write system audit event ${event.action}: ${String(cause)}`),
    ),
  );

const normalizeEnum = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();

/**
 * Apple reports declarations as valid/invalid/unknown. Only a transition into
 * a failure state is interesting; repeated status reports must stay quiet.
 */
export const isDeclarationFailure = (valid: string | null | undefined) => {
  const value = normalizeEnum(valid);

  return value === "invalid" || value === "failed" || value === "error";
};

export const declarationFailedTransition = (
  previousValid: string | null | undefined,
  nextValid: string | null | undefined,
) => isDeclarationFailure(nextValid) && !isDeclarationFailure(previousValid);

/**
 * APNs only flags a token as invalid once it has been rejected. A later failed
 * delivery that is not a token rejection must not repeat the event, and a
 * recovered token re-arms it.
 */
export const pushInvalidTokenTransition = (
  previousCode: string | null | undefined,
  nextCode: string | null | undefined,
) => nextCode === "invalid_token" && previousCode !== "invalid_token";

/**
 * Commands move queued -> sent -> deferred/failed. Record the first time a
 * command reports a deferred/terminal state so check-in retries do not spam.
 */
export const commandFailureTransition = (
  previousStatus: string | null | undefined,
  nextStatus: string | null | undefined,
) => (nextStatus === "failed" || nextStatus === "deferred") && previousStatus !== nextStatus;
