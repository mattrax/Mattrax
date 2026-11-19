import { Schema } from "effect";
import { WebhookDeliveryStatus } from "./webhooks.js";
import { NullableString } from "./Errors.js";

export const DuplicateRequest = Schema.Struct({ name: Schema.optional(Schema.String) });

export const IdsRequest = Schema.Array(Schema.String);

export const IdResponse = Schema.Struct({ id: Schema.String });

export const NoContent = Schema.Void;

export const BulkOperationResult = Schema.Struct({
  deleted: Schema.Array(Schema.String),
  failed: Schema.Array(Schema.Struct({ id: Schema.String, reason: Schema.String })),
});

/**
 * Per-row outcome for a bulk update. `updated` contains every requested id the
 * server accepted, including rows that already held the desired value, so a
 * retry is idempotent from the caller's point of view.
 */
export const BulkUpdateResult = Schema.Struct({
  updated: Schema.Array(Schema.String),
  failed: Schema.Array(Schema.Struct({ id: Schema.String, reason: Schema.String })),
});

/** Upper bound for one bulk member request; the dashboard selects client-side. */
export const BULK_MEMBER_LIMIT = 500;

export const PolicyDeploymentInfo = Schema.Struct({
  id: Schema.String,
  version: Schema.Number,
  createdAt: Schema.String,
  createdByAccountId: Schema.optional(NullableString),
});

export const PolicyDeploymentsResponse = Schema.Struct({
  deployments: Schema.Array(PolicyDeploymentInfo),
});

/** A tenant member returned by the command palette's cross-entity search. */

export const WebhookDeliveryQuery = Schema.Struct({
  event: Schema.optional(Schema.String),
  status: Schema.optional(WebhookDeliveryStatus),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
  cursor: Schema.optional(Schema.String),
});

export type WebhookDeliveryQuery = typeof WebhookDeliveryQuery.Type;
