import { Cause, Data, Effect, Option, Schema } from "effect";
import { eq } from "drizzle-orm";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { Db } from "@mattrax/enterprise-core";
import { verifyStripeWebhookSignature } from "@mattrax/effect-stripe";
import { schema } from "./schema.ts";
import type { EnterpriseDb } from "./schema.ts";

export type BillingWebhookConfig = {
  readonly webhookSecret?: string;
  readonly deviceMonthlyPriceId?: string;
};

export class BillingWebhookError extends Data.TaggedError("BillingWebhookError")<{
  readonly message: string;
  readonly statusCode: number;
}> {}

const fail = (message: string, statusCode = 400) =>
  new BillingWebhookError({ message, statusCode });

const json = (body: Schema.Json, status = 200) => HttpServerResponse.jsonUnsafe(body, { status });

type StripeIdRef = string | { readonly id?: string | undefined } | null | undefined;

const idOf = (value: StripeIdRef): string | undefined => {
  if (Schema.is(Schema.String)(value)) return value.trim() || undefined;

  return value?.id;
};

const OrganizationMetadata = Schema.Struct({
  organizationId: Schema.optional(Schema.String),
});

const organizationIdFromMetadata = (metadata: Schema.Json | undefined): string | undefined => {
  const value = Option.getOrUndefined(
    Schema.decodeUnknownOption(OrganizationMetadata)(metadata),
  )?.organizationId?.trim();

  return value || undefined;
};

const dateFromUnix = (value: number | undefined): Date | null =>
  value !== undefined && Number.isFinite(value) ? new Date(value * 1000) : null;

const subscriptionPeriod = (subscription: any) => {
  // Stripe moved current period fields onto subscription items in newer API
  // versions; older subscriptions still carry them at the top level.
  const item = subscription.items?.data?.[0];

  return {
    periodStart: dateFromUnix(
      item?.current_period_start ?? subscription.current_period_start ?? subscription.start_date,
    ),
    periodEnd: dateFromUnix(item?.current_period_end ?? subscription.current_period_end),
  };
};

const planFor = (subscription: any, deviceMonthlyPriceId?: string) => {
  const metadataPlan = Option.getOrUndefined(
    Schema.decodeUnknownOption(Schema.String)(subscription.metadata?.plan),
  )?.trim();

  if (metadataPlan) return metadataPlan.slice(0, 255);

  const priceId = subscription.items?.data?.[0]?.price?.id;

  if (deviceMonthlyPriceId && priceId === deviceMonthlyPriceId) return "device";

  return "device";
};

type ResolveOrganizationInput = {
  readonly db: BillingDb;
  readonly metadataOrganizationId?: string;
  readonly customerId?: string;
  readonly now: Date;
};

/**
 * Map a Stripe object to exactly one Mattrax organization. Metadata is
 * authoritative, but it must not conflict with the organization already linked
 * to the Stripe customer. Anything unknown or ambiguous is rejected rather than
 * guessed, so a webhook can never write across tenants.
 */
const resolveOrganization = (input: ResolveOrganizationInput) =>
  Effect.gen(function* () {
    let customerOrganizationId: string | undefined;

    if (input.customerId) {
      const [row] = yield* input.db
        .select({ id: schema.organization.id })
        .from(schema.organization)
        .where(eq(schema.organization.stripeCustomerId, input.customerId))
        .limit(1);

      customerOrganizationId = row?.id;
    }

    if (
      input.metadataOrganizationId &&
      customerOrganizationId &&
      input.metadataOrganizationId !== customerOrganizationId
    )
      return yield* Effect.fail(fail("Stripe object maps to conflicting Mattrax organizations"));

    const organizationId = input.metadataOrganizationId ?? customerOrganizationId;

    if (!organizationId)
      return yield* Effect.fail(fail("Stripe object is not linked to a Mattrax organization"));

    const organization = yield* input.db.query.organization.findFirst({
      where: { id: organizationId },
    });

    if (!organization)
      return yield* Effect.fail(fail("Stripe object references an unknown Mattrax organization"));

    if (
      input.customerId &&
      organization.stripeCustomerId &&
      organization.stripeCustomerId !== input.customerId
    )
      return yield* Effect.fail(
        fail("Stripe customer does not belong to the mapped Mattrax organization"),
      );

    // Persist the customer link when metadata identified the organization, so
    // invoice events (which may only carry a customer id) resolve next time.
    if (input.customerId && organization.stripeCustomerId !== input.customerId) {
      yield* input.db
        .update(schema.organization)
        .set({ stripeCustomerId: input.customerId, updatedAt: input.now })
        .where(eq(schema.organization.id, organization.id));
    }

    return organization;
  });

type ApplySubscriptionInput = {
  readonly db: BillingDb;
  readonly subscription: any;
  readonly statusOverride?: string;
  readonly deviceMonthlyPriceId?: string;
  readonly now: Date;
};

const applySubscription = (input: ApplySubscriptionInput) =>
  Effect.gen(function* () {
    const subscription = input.subscription;
    const stripeSubscriptionId = idOf(subscription.id);

    if (!stripeSubscriptionId)
      return yield* Effect.fail(fail("Subscription event is missing a subscription id"));

    const customerId = idOf(subscription.customer);

    const organization = yield* resolveOrganization({
      db: input.db,
      metadataOrganizationId: organizationIdFromMetadata(subscription.metadata),
      customerId,
      now: input.now,
    });

    const [byStripeId] = yield* input.db
      .select()
      .from(schema.subscription)
      .where(eq(schema.subscription.stripeSubscriptionId, stripeSubscriptionId))
      .limit(1);

    if (byStripeId && byStripeId.referenceId !== organization.id)
      return yield* Effect.fail(
        fail("Stripe subscription already belongs to another Mattrax organization"),
      );

    const existing =
      byStripeId ??
      (yield* input.db
        .select()
        .from(schema.subscription)
        .where(eq(schema.subscription.referenceId, organization.id))
        .limit(1))[0];

    const { periodStart, periodEnd } = subscriptionPeriod(subscription);

    const values = {
      plan: planFor(subscription, input.deviceMonthlyPriceId),
      referenceId: organization.id,
      stripeCustomerId: customerId ?? organization.stripeCustomerId ?? null,
      stripeSubscriptionId,
      status:
        input.statusOverride ??
        Option.getOrUndefined(Schema.decodeUnknownOption(Schema.String)(subscription.status)) ??
        "incomplete",
      periodStart,
      periodEnd,
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    };

    if (existing) {
      yield* input.db
        .update(schema.subscription)
        .set({ ...values, updatedAt: input.now })
        .where(eq(schema.subscription.id, existing.id));
    } else {
      yield* input.db.insert(schema.subscription).values({
        id: crypto.randomUUID().replaceAll("-", "").slice(0, 24),
        ...values,
        createdAt: input.now,
        updatedAt: input.now,
      });
    }

    return { organizationId: organization.id, stripeSubscriptionId };
  });

type ApplyInvoiceInput = {
  readonly db: BillingDb;
  readonly invoice: any;
  readonly paymentFailed: boolean;
  readonly deviceMonthlyPriceId?: string;
  readonly now: Date;
};

const applyInvoice = (input: ApplyInvoiceInput) =>
  Effect.gen(function* () {
    const invoice = input.invoice;

    const embeddedSubscription =
      invoice.subscription === null || Schema.is(Schema.String)(invoice.subscription)
        ? undefined
        : invoice.subscription;

    const stripeSubscriptionId =
      idOf(invoice.subscription) ??
      idOf(invoice.parent?.subscription_details?.subscription) ??
      idOf(invoice.subscription_details?.subscription);

    const metadataOrganizationId =
      organizationIdFromMetadata(embeddedSubscription?.metadata) ??
      organizationIdFromMetadata(invoice.parent?.subscription_details?.metadata) ??
      organizationIdFromMetadata(invoice.subscription_details?.metadata);

    const customerId = idOf(invoice.customer);

    if (embeddedSubscription?.id) {
      // Expanded invoice subscriptions do not always repeat metadata.
      const subscriptionMetadata = { ...embeddedSubscription.metadata };

      if (metadataOrganizationId) subscriptionMetadata.organizationId = metadataOrganizationId;

      return yield* applySubscription({
        db: input.db,
        subscription: {
          ...embeddedSubscription,
          metadata: subscriptionMetadata,
          customer: embeddedSubscription.customer ?? customerId,
        },
        statusOverride: input.paymentFailed
          ? embeddedSubscription.status === "canceled"
            ? "canceled"
            : "past_due"
          : (embeddedSubscription.status ?? "active"),
        deviceMonthlyPriceId: input.deviceMonthlyPriceId,
        now: input.now,
      });
    }

    const organization = yield* resolveOrganization({
      db: input.db,
      metadataOrganizationId,
      customerId,
      now: input.now,
    });

    let existing: any;

    if (stripeSubscriptionId) {
      [existing] = yield* input.db
        .select()
        .from(schema.subscription)
        .where(eq(schema.subscription.stripeSubscriptionId, stripeSubscriptionId))
        .limit(1);
    }

    if (!existing) {
      [existing] = yield* input.db
        .select()
        .from(schema.subscription)
        .where(eq(schema.subscription.referenceId, organization.id))
        .limit(1);
    }

    if (!existing)
      return yield* Effect.fail(fail("Invoice does not match a known Mattrax subscription"));

    // The invoice resolved to one organization but the subscription row it
    // points at belongs to another: refuse rather than write across tenants.
    if (existing.referenceId !== organization.id)
      return yield* Effect.fail(
        fail("Stripe invoice subscription already belongs to another Mattrax organization"),
      );

    yield* input.db
      .update(schema.subscription)
      .set({
        // A late invoice event must not resurrect a canceled subscription.
        status:
          existing.status === "canceled" ? "canceled" : input.paymentFailed ? "past_due" : "active",
        updatedAt: input.now,
      })
      .where(eq(schema.subscription.id, existing.id));

    return { organizationId: organization.id, stripeSubscriptionId };
  });

export type ProcessStripeWebhookInput = BillingWebhookConfig & {
  readonly payload: string;
  readonly signature: string | null;
  readonly db: EnterpriseDb;
  /** Injectable clock for deterministic tests. */
  readonly now?: Date;
};

/**
 * MySQL reports a duplicate unique/primary key as `ER_DUP_ENTRY`/1062. The
 * ledger's primary key is `stripe_event.id`, so a duplicate here means this
 * exact event was already committed by a previous (or concurrent) delivery.
 */
const ErrorDetails = Schema.Struct({
  code: Schema.optional(Schema.String),
  errno: Schema.optional(Schema.Number),
  message: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Unknown),
});

const isDuplicateEventError = (cause: unknown): boolean => {
  const top = Option.getOrUndefined(Schema.decodeUnknownOption(ErrorDetails)(cause));
  const nested = Option.getOrUndefined(Schema.decodeUnknownOption(ErrorDetails)(top?.cause));
  const code = top?.code ?? nested?.code;
  const errno = top?.errno ?? nested?.errno;
  const message = top?.message ?? nested?.message ?? "";

  // The ledger's primary key is the only unique constraint this transaction
  // touches (`subscription` has no unique index), so a duplicate-key driver
  // code identifies this event. Fall back to the message when a driver does
  // not expose the code.
  if (code === "ER_DUP_ENTRY" || errno === 1062) return true;

  return /stripe_event/i.test(message);
};

/** The database surface the apply helpers use; transaction handles included. */
type BillingDb = Pick<EnterpriseDb, "select" | "insert" | "update" | "query">;

const applyVerifiedEvent = (
  input: Omit<ProcessStripeWebhookInput, "db"> & { readonly db: BillingDb },
  event: { readonly type: string; readonly data: { readonly object: any } },
  now: Date,
) => {
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
      return applySubscription({
        db: input.db,
        subscription: event.data.object,
        deviceMonthlyPriceId: input.deviceMonthlyPriceId,
        now,
      });
    case "customer.subscription.deleted":
      return applySubscription({
        db: input.db,
        subscription: event.data.object,
        statusOverride: "canceled",
        deviceMonthlyPriceId: input.deviceMonthlyPriceId,
        now,
      });
    case "invoice.paid":
    case "invoice.payment_succeeded":
      return applyInvoice({
        db: input.db,
        invoice: event.data.object,
        paymentFailed: false,
        deviceMonthlyPriceId: input.deviceMonthlyPriceId,
        now,
      });
    case "invoice.payment_failed":
      return applyInvoice({
        db: input.db,
        invoice: event.data.object,
        paymentFailed: true,
        deviceMonthlyPriceId: input.deviceMonthlyPriceId,
        now,
      });
    default:
      return Effect.succeed({ ignored: true as const });
  }
};

/**
 * Verify and apply one Stripe event.
 *
 * The event id is written to `stripe_event` in the same transaction as the
 * subscription/invoice writes. A redelivery (including two isolates handling
 * the same event concurrently) loses the primary-key race and is skipped
 * instead of re-applying. A failed apply rolls the marker back, so Stripe's
 * retry can still succeed; a committed marker means the event was fully
 * applied.
 */
export const processStripeWebhook = (input: ProcessStripeWebhookInput) =>
  Effect.gen(function* () {
    if (!input.webhookSecret)
      return yield* Effect.fail(fail("Billing webhook is not configured for this deployment", 503));

    if (!input.signature) return yield* Effect.fail(fail("Missing Stripe-Signature header"));

    const event = yield* verifyStripeWebhookSignature(
      input.payload,
      input.signature,
      input.webhookSecret,
    ).pipe(Effect.mapError(() => fail("Invalid Stripe signature")));

    const now = input.now ?? new Date();
    const eventId = event.id.trim().slice(0, 255);

    if (!eventId) return yield* Effect.fail(fail("Stripe event is missing an id"));

    const outcome = yield* input.db
      .transaction((tx) =>
        Effect.gen(function* () {
          yield* tx.insert(schema.stripeEvent).values({
            id: eventId,
            type: event.type,
            organizationId: null,
            receivedAt: now,
          });

          const applied = yield* applyVerifiedEvent(
            { ...input, db: tx },
            { type: event.type, data: { object: event.data.object } },
            now,
          );

          if ("organizationId" in applied)
            yield* tx
              .update(schema.stripeEvent)
              .set({ organizationId: applied.organizationId })
              .where(eq(schema.stripeEvent.id, eventId));

          return applied;
        }),
      )
      .pipe(
        Effect.catchCause((cause) =>
          isDuplicateEventError(Cause.squash(cause))
            ? Effect.succeed({ duplicate: true as const })
            : Effect.failCause(cause),
        ),
      );

    return outcome;
  });

/**
 * Raw route layer. It is mounted inside the API's handler layer (before the
 * Effect HttpApi routes) and needs `Db` from the surrounding app layer.
 */
export const billingWebhookRoutes = (config: BillingWebhookConfig) =>
  HttpRouter.add("POST", "/api/v1/billing/webhook", (request) =>
    Effect.gen(function* () {
      const db = yield* Db;
      const signatureHeader = request.headers["stripe-signature"];

      const signature = Array.isArray(signatureHeader)
        ? (signatureHeader[0] ?? null)
        : (signatureHeader ?? null);

      return yield* Effect.gen(function* () {
        const body = yield* request.text.pipe(
          Effect.mapError(() => fail("Could not read the webhook request body", 500)),
        );

        return yield* processStripeWebhook({
          db,
          payload: body,
          signature,
          webhookSecret: config.webhookSecret,
          deviceMonthlyPriceId: config.deviceMonthlyPriceId,
        });
      }).pipe(
        Effect.as(json({ received: true })),
        Effect.tapError((error) => Effect.logWarning(`Stripe webhook rejected: ${error.message}`)),
        Effect.catchTag("BillingWebhookError", (error) =>
          Effect.succeed(json({ error: error.message }, error.statusCode)),
        ),
        Effect.catchCause((cause) =>
          Effect.logError("Stripe webhook processing failed", cause).pipe(
            Effect.as(json({ error: "Webhook processing failed" }, 500)),
          ),
        ),
      );
    }),
  );
