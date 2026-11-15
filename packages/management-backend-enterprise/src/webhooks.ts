import { Effect, Option, Schema } from "effect";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { Db, schema as s } from "@mattrax/enterprise-core";
import {
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
  WEBHOOK_TEST_EVENT,
  WEBHOOK_TIMESTAMP_HEADER,
  parseWebhookSignatureHeader,
  webhookSignatureMessage,
  webhookUrlProblem,
  type WebhookDeliveryStatus,
  type WebhookEventType,
} from "@mattrax/enterprise-domain";
import { constantTimeEqual, hmacSha256Hex, openSecret } from "@mattrax/crypto";
import { fetchWithTimeout } from "@mattrax/net";

/**
 * Signature, delivery and retry helpers for customer webhooks.
 *
 * Delivery is best-effort by design: a customer endpoint can be slow, broken
 * or hostile, and must never fail the device action that produced the event.
 * Every outbound request has a deadline and every database write is isolated.
 */

export type WebhookEndpointRow = typeof s.webhookEndpoint.$inferSelect;

export type WebhookEventInput = {
  readonly organizationId: string;
  readonly type: WebhookEventType | typeof WEBHOOK_TEST_EVENT;
  /** Target type/id plus small, secret-free context copied from the audit row. */
  readonly data?: Schema.JsonObject;
  readonly id?: string;
  readonly occurredAt?: Date;
};

export const WebhookPayload = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  occurredAt: Schema.String,
  organizationId: Schema.String,
  data: Schema.JsonObject,
});

export type WebhookPayload = typeof WebhookPayload.Type;

export type WebhookDeliveryOptions = {
  /** Application secret used to unseal endpoint signing secrets. */
  readonly authSecret?: string;
  /** Injected for tests; defaults to the runtime `fetch`. */
  readonly fetch?: typeof globalThis.fetch;
  /** Per-attempt deadline. Defaults to 5s. */
  readonly timeoutMs?: number;
  readonly now?: Date;
  /** Endpoint fan-out; defaults to 4. */
  readonly concurrency?: number;
  /** Delivery attempts made in-request. Defaults to 1 (retries are deferred). */
  readonly attempts?: number;
  /**
   * Skip the URL guard. Only tests use this to point at a local mock server;
   * production callers must leave it unset.
   */
  readonly allowUnsafeUrl?: boolean;
};

export type WebhookDeliveryOutcome = {
  readonly status: WebhookDeliveryStatus;
  readonly responseStatus: number | null;
  readonly error: string | null;
  readonly durationMs: number;
};

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_CONCURRENCY = 4;
const MAX_ERROR_LENGTH = 500;
const RETENTION_DAYS = 30;
const MAX_ATTEMPTS = 3;

const newEventId = () => `evt_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;

const truncate = (value: string, max = MAX_ERROR_LENGTH) =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`;

const errorText = (cause: unknown): string => {
  if (cause instanceof Error) {
    const name = cause.name;
    const message = cause.message?.trim();

    if (message) return truncate(`${name}: ${message}`);

    return truncate(name || "Delivery failed");
  }

  const text = Schema.is(Schema.String)(cause) ? cause.trim() : "";

  return truncate(text || "Delivery failed");
};

/** Generate a new `whsec_` signing secret (base64url, 32 random bytes). */
export const generateWebhookSecret = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return `whsec_${btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`;
};

export const webhookSecretPrefix = (secret: string): string => secret.slice(-4);

/** HMAC-SHA256 over `<unix-seconds>.<raw-json-body>`, returned as hex. */
export const signWebhookDelivery = async (
  secret: string,
  timestamp: number,
  body: string,
): Promise<string> => hmacSha256Hex(secret, webhookSignatureMessage(timestamp, body));

/**
 * Verify a customer delivery. Returns false for malformed headers, an
 * out-of-tolerance timestamp, or a signature mismatch. Comparisons are
 * constant-time.
 */
export const verifyWebhookSignature = async (input: {
  readonly secret: string;
  readonly body: string;
  readonly signatureHeader: string;
  /** Current unix-seconds; injectable for tests. */
  readonly nowSeconds?: number;
  readonly toleranceSeconds?: number;
}): Promise<boolean> => {
  const parsed = parseWebhookSignatureHeader(input.signatureHeader);

  if (parsed.timestamp === null || parsed.signatures.length === 0) return false;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? WEBHOOK_SIGNATURE_TOLERANCE_SECONDS;

  if (Math.abs(now - parsed.timestamp) > tolerance) return false;
  const expected = await signWebhookDelivery(input.secret, parsed.timestamp, input.body);

  return parsed.signatures.some((signature) => constantTimeEqual(signature, expected));
};

export const buildWebhookPayload = (
  event: WebhookEventInput,
  now = new Date(),
): WebhookPayload => ({
  id: event.id ?? newEventId(),
  type: event.type,
  occurredAt: (event.occurredAt ?? now).toISOString(),
  organizationId: event.organizationId,
  data: event.data ?? {},
});

const eventMatchesFilters = (endpoint: WebhookEndpointRow, type: string): boolean => {
  // A test delivery is explicit and ignores filters.
  if (type === WEBHOOK_TEST_EVENT) return true;
  const filters = endpoint.eventFilters;

  if (!Array.isArray(filters) || filters.length === 0) return true;

  return filters.includes(type);
};

const endpointSummary = (endpoint: WebhookEndpointRow) => ({
  id: endpoint.id,
  url: endpoint.url,
  description: endpoint.description ?? null,
  events: Array.isArray(endpoint.eventFilters) ? endpoint.eventFilters : [],
  enabled: endpoint.enabled,
  secretPrefix: endpoint.secretPrefix ?? null,
  lastDeliveryAt: endpoint.lastDeliveryAt ? new Date(endpoint.lastDeliveryAt).toISOString() : null,
  lastDeliveryStatus: endpoint.lastDeliveryStatus ?? null,
  consecutiveFailures: endpoint.consecutiveFailures ?? 0,
  createdAt: new Date(endpoint.createdAt).toISOString(),
  updatedAt: new Date(endpoint.updatedAt).toISOString(),
});

export const toWebhookEndpointInfo = endpointSummary;

/** A URL is only deliverable when it passes the guard and we have a secret. */
const deliveryUrlProblem = (endpoint: WebhookEndpointRow, allowUnsafeUrl?: boolean) => {
  if (allowUnsafeUrl) return null;

  return webhookUrlProblem(endpoint.url);
};

const postWebhook = async (input: {
  readonly url: string;
  readonly secret: string;
  readonly payload: WebhookPayload;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
}): Promise<{ responseStatus: number; body: string }> => {
  const body = JSON.stringify(input.payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await signWebhookDelivery(input.secret, timestamp, body);

  const response = await fetchWithTimeout(
    input.url,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Mattrax-Webhooks/1",
        [WEBHOOK_EVENT_HEADER]: input.payload.type,
        [WEBHOOK_DELIVERY_HEADER]: input.payload.id,
        [WEBHOOK_TIMESTAMP_HEADER]: String(timestamp),
        [WEBHOOK_SIGNATURE_HEADER]: `t=${timestamp},v1=${signature}`,
      },
      body,
      // Never follow a redirect: a public URL could redirect to an internal
      // address that the static guard cannot see.
      redirect: "error",
    },
    { timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS, fetch: input.fetch },
  );

  // Drain the body so the connection is released; the response text is never
  // stored because it may contain customer data.
  const text = await response.text().catch(() => "");

  return { responseStatus: response.status, body: text };
};

const attemptDelivery = async (input: {
  readonly endpoint: WebhookEndpointRow;
  readonly payload: WebhookPayload;
  readonly authSecret: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
  readonly allowUnsafeUrl?: boolean;
}): Promise<WebhookDeliveryOutcome> => {
  const startedAt = Date.now();
  const urlProblem = deliveryUrlProblem(input.endpoint, input.allowUnsafeUrl);

  if (urlProblem) {
    return {
      status: "failed",
      responseStatus: null,
      error: urlProblem,
      durationMs: Date.now() - startedAt,
    };
  }

  let secret: string;

  try {
    secret = await openSecret(input.authSecret, input.endpoint.secret);
  } catch {
    return {
      status: "failed",
      responseStatus: null,
      error: "Signing secret could not be opened",
      durationMs: Date.now() - startedAt,
    };
  }

  try {
    const { responseStatus } = await postWebhook({
      url: input.endpoint.url,
      secret,
      payload: input.payload,
      fetch: input.fetch,
      timeoutMs: input.timeoutMs,
    });

    const ok = responseStatus >= 200 && responseStatus < 300;

    return {
      status: ok ? "succeeded" : "failed",
      responseStatus,
      error: ok ? null : `Endpoint responded with HTTP ${responseStatus}`,
      durationMs: Date.now() - startedAt,
    };
  } catch (cause) {
    return {
      status: "failed",
      responseStatus: null,
      error: errorText(cause),
      durationMs: Date.now() - startedAt,
    };
  }
};

const recordDelivery = (
  db: Db["Service"],
  input: {
    readonly endpoint: WebhookEndpointRow;
    readonly payload: WebhookPayload;
    readonly outcome: WebhookDeliveryOutcome;
    readonly attempt: number;
    readonly now: Date;
  },
) =>
  Effect.gen(function* () {
    yield* db.insert(s.webhookDelivery).values({
      id: `whd_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`,
      endpointId: input.endpoint.id,
      organizationId: input.endpoint.organizationId,
      event: input.payload.type,
      eventId: input.payload.id,
      payload: input.payload,
      status: input.outcome.status,
      attempt: input.attempt,
      responseStatus: input.outcome.responseStatus,
      error: input.outcome.error,
      createdAt: input.now,
    });
    yield* db
      .update(s.webhookEndpoint)
      .set({
        lastDeliveryAt: input.now,
        lastDeliveryStatus: input.outcome.status,
        consecutiveFailures:
          input.outcome.status === "succeeded"
            ? 0
            : Math.max(1, (input.endpoint.consecutiveFailures ?? 0) + 1),
        updatedAt: input.now,
      })
      .where(eq(s.webhookEndpoint.id, input.endpoint.id));
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning(
        `Failed to record webhook delivery for ${input.endpoint.id}: ${String(cause)}`,
      ),
    ),
  );

/**
 * Deliver one event to one endpoint, recording the outcome. Never fails.
 */
const deliverToEndpoint = (
  db: Db["Service"],
  endpoint: WebhookEndpointRow,
  payload: WebhookPayload,
  options: WebhookDeliveryOptions,
) =>
  Effect.gen(function* () {
    if (!options.authSecret) return;
    const now = options.now ?? new Date();
    const attempts = Math.max(1, Math.floor(options.attempts ?? 1));

    let outcome: WebhookDeliveryOutcome = {
      status: "failed",
      responseStatus: null,
      error: "Delivery was not attempted",
      durationMs: 0,
    };

    let usedAttempt = 1;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      usedAttempt = attempt;
      outcome = yield* Effect.promise(() =>
        attemptDelivery({
          endpoint,
          payload,
          authSecret: options.authSecret!,
          fetch: options.fetch,
          timeoutMs: options.timeoutMs,
          allowUnsafeUrl: options.allowUnsafeUrl,
        }),
      );

      if (outcome.status === "succeeded") break;
    }

    yield* recordDelivery(db, { endpoint, payload, outcome, attempt: usedAttempt, now });
  });

/**
 * Deliver an event to every enabled endpoint in the organisation whose filter
 * matches. Endpoint failures are isolated and the effect never fails.
 */
export const dispatchWebhookEvent = (
  db: Db["Service"],
  event: WebhookEventInput,
  options: WebhookDeliveryOptions = {},
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (!options.authSecret) return;
    const payload = buildWebhookPayload(event, options.now);

    const endpoints = (yield* db
      .select()
      .from(s.webhookEndpoint)
      .where(
        and(
          eq(s.webhookEndpoint.organizationId, event.organizationId),
          eq(s.webhookEndpoint.enabled, true),
        ),
      ));

    const matching = endpoints.filter((endpoint) => eventMatchesFilters(endpoint, payload.type));

    if (matching.length === 0) return;
    yield* Effect.forEach(
      matching,
      (endpoint) => deliverToEndpoint(db, endpoint, payload, options),
      {
        concurrency: Math.max(1, Math.floor(options.concurrency ?? DEFAULT_CONCURRENCY)),
        discard: true,
      },
    );
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning(`Webhook dispatch failed for ${event.type}: ${String(cause)}`),
    ),
  );

/**
 * Send an explicit test delivery. Unlike `dispatchWebhookEvent`, this returns
 * the outcome so the dashboard can show it immediately.
 */
export const sendTestWebhook = (
  db: Db["Service"],
  endpoint: WebhookEndpointRow,
  options: WebhookDeliveryOptions = {},
): Effect.Effect<WebhookDeliveryOutcome> =>
  Effect.gen(function* () {
    const now = options.now ?? new Date();

    const payload = buildWebhookPayload(
      {
        organizationId: endpoint.organizationId,
        type: WEBHOOK_TEST_EVENT,
        data: {
          message: "This is a test delivery from Mattrax",
          targetType: "webhook_endpoint",
          targetId: endpoint.id,
        },
        id: newEventId(),
      },
      now,
    );

    if (!options.authSecret) {
      const outcome: WebhookDeliveryOutcome = {
        status: "failed",
        responseStatus: null,
        error: "Webhook signing is not configured on this deployment",
        durationMs: 0,
      };

      yield* recordDelivery(db, { endpoint, payload, outcome, attempt: 1, now });

      return outcome;
    }

    const outcome = yield* Effect.promise(() =>
      attemptDelivery({
        endpoint,
        payload,
        authSecret: options.authSecret!,
        fetch: options.fetch,
        timeoutMs: options.timeoutMs,
        allowUnsafeUrl: options.allowUnsafeUrl,
      }),
    );

    yield* recordDelivery(db, { endpoint, payload, outcome, attempt: 1, now });

    return outcome;
  });

export type WebhookRetryOptions = WebhookDeliveryOptions & {
  /** Attempts already recorded on the row may not exceed this. Defaults to 3. */
  readonly maxAttempts?: number;
  /** Rows examined per maintenance run. Defaults to 100. */
  readonly limit?: number;
  /** Only retry rows younger than this. Defaults to 24 hours. */
  readonly maxAgeHours?: number;
};

export type WebhookRetryResult = {
  readonly retried: number;
  readonly succeeded: number;
  readonly failed: number;
};

/**
 * Retry recent failed deliveries a bounded number of times. Called by daily
 * maintenance; never throws.
 */
export const retryFailedWebhookDeliveries = (
  db: Db["Service"],
  options: WebhookRetryOptions = {},
): Effect.Effect<WebhookRetryResult> =>
  Effect.gen(function* () {
    const result = { retried: 0, succeeded: 0, failed: 0 };

    if (!options.authSecret) return result;
    const now = options.now ?? new Date();
    const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? MAX_ATTEMPTS));
    const limit = Math.max(1, Math.floor(options.limit ?? 100));
    const cutoff = new Date(now.getTime() - (options.maxAgeHours ?? 24) * 60 * 60 * 1000);

    const rows = (yield* db
      .select()
      .from(s.webhookDelivery)
      .where(
        and(
          eq(s.webhookDelivery.status, "failed"),
          lt(s.webhookDelivery.attempt, maxAttempts),
          gte(s.webhookDelivery.createdAt, cutoff),
        ),
      )
      .orderBy(asc(s.webhookDelivery.createdAt))
      .limit(limit));

    yield* Effect.forEach(
      rows,
      (row) =>
        Effect.gen(function* () {
          const [endpoint] = (yield* db
            .select()
            .from(s.webhookEndpoint)
            .where(
              and(
                eq(s.webhookEndpoint.id, row.endpointId),
                eq(s.webhookEndpoint.organizationId, row.organizationId),
              ),
            )
            .limit(1));

          if (!endpoint || !endpoint.enabled) return;
          const payload = Schema.decodeUnknownOption(WebhookPayload)(row.payload);

          if (Option.isNone(payload)) return;
          result.retried += 1;

          const outcome = yield* Effect.promise(() =>
            attemptDelivery({
              endpoint,
              payload: payload.value,
              authSecret: options.authSecret!,
              fetch: options.fetch,
              timeoutMs: options.timeoutMs,
              allowUnsafeUrl: options.allowUnsafeUrl,
            }),
          );

          const attempt = row.attempt + 1;

          if (outcome.status === "succeeded") result.succeeded += 1;
          else result.failed += 1;
          yield* db
            .update(s.webhookDelivery)
            .set({
              status: outcome.status,
              attempt,
              responseStatus: outcome.responseStatus,
              error: outcome.error,
            })
            .where(eq(s.webhookDelivery.id, row.id));
          yield* db
            .update(s.webhookEndpoint)
            .set({
              lastDeliveryAt: now,
              lastDeliveryStatus: outcome.status,
              consecutiveFailures:
                outcome.status === "succeeded"
                  ? 0
                  : Math.max(1, (endpoint.consecutiveFailures ?? 0) + 1),
              updatedAt: now,
            })
            .where(eq(s.webhookEndpoint.id, endpoint.id));
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning(`Webhook retry failed for ${row.id}: ${String(cause)}`),
          ),
        ),
      {
        concurrency: Math.max(1, Math.floor(options.concurrency ?? DEFAULT_CONCURRENCY)),
        discard: true,
      },
    );

    return result;
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning(`Webhook retry pass failed: ${String(cause)}`).pipe(
        Effect.as({ retried: 0, succeeded: 0, failed: 0 }),
      ),
    ),
  );

/** Delete delivery rows older than the retention window. Returns the count. */
export const pruneWebhookDeliveries = (
  db: Db["Service"],
  options: { readonly now?: Date; readonly retentionDays?: number } = {},
): Effect.Effect<number> =>
  Effect.gen(function* () {
    const retentionDays = options.retentionDays ?? RETENTION_DAYS;

    if (retentionDays <= 0) return 0;
    const now = options.now ?? new Date();
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

    const stale = (yield* db
      .select({ id: s.webhookDelivery.id })
      .from(s.webhookDelivery)
      .where(lt(s.webhookDelivery.createdAt, cutoff)));

    if (stale.length === 0) return 0;
    yield* db.delete(s.webhookDelivery).where(lt(s.webhookDelivery.createdAt, cutoff));

    return stale.length;
  }).pipe(Effect.catchCause(() => Effect.succeed(0)));

export const WEBHOOK_DELIVERY_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;
export const WEBHOOK_MAX_RETRY_ATTEMPTS = MAX_ATTEMPTS;
export const WEBHOOK_DELIVERY_RETENTION_DAYS = RETENTION_DAYS;

/**
 * Map the low-cardinality system audit action to the public webhook event.
 * Actions that are not customer-facing deliberately have no mapping.
 */
export const webhookEventForAuditAction = (action: string): WebhookEventType | null => {
  switch (action) {
    case "device.enrolled":
      return "device.enrolled";
    case "device.checked_out":
    // Administrative deletion is a removal from the tenant's fleet even
    // though no checkout was received.
    case "device.deleted":
      return "device.unenrolled";
    case "device.command_failed":
      return "device.command_failed";
    case "device.declaration_invalid":
      return "device.declaration_invalid";
    case "device.push_invalid_token":
      return "device.push_invalid_token";
    case "device.compliance_changed":
      return "device.compliance_changed";
    default:
      return null;
  }
};
