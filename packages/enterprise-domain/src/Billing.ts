import { Schema } from "effect";

export const BillingPortalRequest = Schema.Struct({ returnUrl: Schema.String });

export const BillingPortalResponse = Schema.Struct({ url: Schema.String });

/** A Checkout Session redirect that buys the per-device plan. */
export const BillingCheckoutRequest = Schema.Struct({
  /**
   * Free-trial length in days. Stripe caps trials at 730 days; omitting the
   * field starts the subscription without a trial.
   */
  trialDays: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 730 }))),
});

export type BillingCheckoutRequest = typeof BillingCheckoutRequest.Type;

export const BillingCheckoutResponse = Schema.Struct({
  /** Stripe-hosted Checkout URL the browser is redirected to. */
  url: Schema.String,
});

export const BillingInvoiceStatus = Schema.Literals([
  "draft",
  "open",
  "paid",
  "uncollectible",
  "void",
]);

/** One Stripe invoice, restated without internal Stripe identifiers. */
export const BillingInvoice = Schema.Struct({
  id: Schema.String,
  number: Schema.NullOr(Schema.String),
  status: Schema.NullOr(BillingInvoiceStatus),
  /** Minor units in the invoice currency (for example cents). */
  total: Schema.Number,
  amountDue: Schema.Number,
  amountPaid: Schema.Number,
  currency: Schema.String,
  createdAt: Schema.String,
  periodStart: Schema.NullOr(Schema.String),
  periodEnd: Schema.NullOr(Schema.String),
  hostedInvoiceUrl: Schema.NullOr(Schema.String),
  pdfUrl: Schema.NullOr(Schema.String),
});

export type BillingInvoice = typeof BillingInvoice.Type;

export const BillingInvoicesResponse = Schema.Struct({
  invoices: Schema.Array(BillingInvoice),
});

export type BillingInvoicesResponse = typeof BillingInvoicesResponse.Type;

/**
 * Delivery history filters. `event` is a webhook event name (or
 * `webhook.test`); `status` narrows to succeeded/failed. The list is always
 * scoped to the endpoint and the 30-day retention window.
 */
