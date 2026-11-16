import { Effect, Option, Schema } from "effect";
import { and, desc, eq, gte, lt, or } from "drizzle-orm";
import {
  EnterpriseBadRequest,
  EnterpriseNotFound,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_TEST_EVENT,
  type WebhookDeliveryDetail,
  type WebhookDeliveryInfo,
  type WebhookDeliveryQuery,
} from "@mattrax/enterprise-domain";
import { WEBHOOK_DELIVERY_RETENTION_DAYS } from "@mattrax/management-backend-enterprise";
// The audit log and delivery history share the same `(createdAt, id)` keyset
// cursor encoding, so there is one implementation to keep correct.
import { decodeAuditCursor, encodeAuditCursor } from "./auditLog.ts";
import type { EnterpriseDb } from "./schema.ts";
import { schema } from "./schema.ts";

/**
 * Delivery history for the dashboard.
 *
 * Rows are deleted after `WEBHOOK_DELIVERY_RETENTION_DAYS`, so the window is
 * part of the query: a request can never page past the point where maintenance
 * removed the rows. Paging is keyset on `(created_at, id)` and every query is
 * scoped to the organisation *and* the endpoint, so one tenant can never read
 * another's deliveries by guessing ids.
 */

export const WEBHOOK_DELIVERY_PAGE_DEFAULT = 25;

export const WEBHOOK_DELIVERY_PAGE_MAX = 100;

const KNOWN_EVENTS = new Set<string>([...WEBHOOK_EVENT_TYPES, WEBHOOK_TEST_EVENT]);

export type NormalizedWebhookDeliveryQuery = {
  readonly limit: number;
  readonly event?: string;
  readonly status?: "succeeded" | "failed";
  readonly cursor?: { readonly createdAt: Date; readonly id: string };
  /** Oldest row the retention window can still hold. */
  readonly since: Date;
};

export const normalizeWebhookDeliveryQuery = (
  query: WebhookDeliveryQuery | undefined,
  now: Date,
): NormalizedWebhookDeliveryQuery => {
  const event = query?.event?.trim();

  if (event && !KNOWN_EVENTS.has(event))
    throw new EnterpriseBadRequest({ message: "event is not a known webhook event" });

  const cursor = query?.cursor ? decodeAuditCursor(query.cursor) : undefined;

  if (cursor && cursor.kind !== "keyset")
    throw new EnterpriseBadRequest({ message: "cursor is invalid" });

  return {
    // The HTTP contract already bounds `limit`; clamp again so a direct caller
    // cannot ask one endpoint's whole history in a single query.
    limit: Math.min(
      Math.max(query?.limit ?? WEBHOOK_DELIVERY_PAGE_DEFAULT, 1),
      WEBHOOK_DELIVERY_PAGE_MAX,
    ),
    event: event || undefined,
    status: query?.status,
    cursor: cursor ? { createdAt: cursor.createdAt, id: cursor.id } : undefined,
    since: new Date(now.getTime() - WEBHOOK_DELIVERY_RETENTION_DAYS * 24 * 60 * 60 * 1000),
  };
};

const iso = (value: Date | string): string =>
  (value instanceof Date ? value : new Date(value)).toISOString();

export const webhookDeliveryInfo = (
  row: Pick<
    typeof schema.webhookDelivery.$inferSelect,
    | "id"
    | "endpointId"
    | "event"
    | "eventId"
    | "status"
    | "attempt"
    | "responseStatus"
    | "error"
    | "createdAt"
  >,
): WebhookDeliveryInfo => ({
  id: row.id,
  endpointId: row.endpointId,
  event: row.event,
  eventId: row.eventId ?? null,
  status: row.status,
  attempt: row.attempt,
  responseStatus: row.responseStatus ?? null,
  error: row.error ?? null,
  createdAt: iso(row.createdAt),
});

/** The signed payload exactly as it was delivered, plus the response fields. */
export const webhookDeliveryDetail = (
  row: typeof schema.webhookDelivery.$inferSelect,
): WebhookDeliveryDetail => ({
  ...webhookDeliveryInfo(row),
  payload: Option.getOrNull(Schema.decodeUnknownOption(Schema.Json)(row.payload)),
});

export type ListWebhookDeliveriesInput = {
  readonly db: EnterpriseDb;
  readonly organizationId: string;
  readonly endpointId: string;
  readonly query?: WebhookDeliveryQuery;
  /** Injectable clock so the retention window is deterministic in tests. */
  readonly now?: Date;
};

export const listWebhookDeliveries = (input: ListWebhookDeliveriesInput) =>
  Effect.gen(function* () {
    const filters = yield* Effect.try({
      try: () => normalizeWebhookDeliveryQuery(input.query, input.now ?? new Date()),
      catch: (cause) =>
        cause instanceof EnterpriseBadRequest
          ? cause
          : new EnterpriseBadRequest({ message: "Invalid delivery query" }),
    });

    const cursor = filters.cursor;
    // Fetch one extra row to detect more pages without a second count.
    const window = filters.limit + 1;

    const before = cursor
      ? or(
          lt(schema.webhookDelivery.createdAt, cursor.createdAt),
          and(
            eq(schema.webhookDelivery.createdAt, cursor.createdAt),
            lt(schema.webhookDelivery.id, cursor.id),
          ),
        )
      : undefined;

    const rows = yield* input.db
      .select()
      .from(schema.webhookDelivery)
      .where(
        and(
          eq(schema.webhookDelivery.organizationId, input.organizationId),
          eq(schema.webhookDelivery.endpointId, input.endpointId),
          gte(schema.webhookDelivery.createdAt, filters.since),
          filters.event ? eq(schema.webhookDelivery.event, filters.event) : undefined,
          filters.status ? eq(schema.webhookDelivery.status, filters.status) : undefined,
          before,
        ),
      )
      .orderBy(desc(schema.webhookDelivery.createdAt), desc(schema.webhookDelivery.id))
      .limit(window);

    const hasMore = rows.length > filters.limit;
    const page = hasMore ? rows.slice(0, filters.limit) : rows;
    const last = page[page.length - 1];

    return {
      deliveries: page.map(webhookDeliveryInfo),
      nextCursor:
        hasMore && last ? encodeAuditCursor({ createdAt: last.createdAt, id: last.id }) : null,
    };
  });

export type LoadWebhookDeliveryInput = {
  readonly db: EnterpriseDb;
  readonly organizationId: string;
  readonly endpointId: string;
  readonly deliveryId: string;
};

export const loadWebhookDelivery = (input: LoadWebhookDeliveryInput) =>
  Effect.gen(function* () {
    const [row] = yield* input.db
      .select()
      .from(schema.webhookDelivery)
      .where(
        and(
          eq(schema.webhookDelivery.id, input.deliveryId),
          eq(schema.webhookDelivery.organizationId, input.organizationId),
          eq(schema.webhookDelivery.endpointId, input.endpointId),
        ),
      )
      .limit(1);

    if (!row) return yield* Effect.fail(new EnterpriseNotFound({ message: "Delivery not found" }));

    return row;
  });
