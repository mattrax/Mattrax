import { SubscriptionId } from "@mattrax/crypto";
import { Data, Effect, Option, Schema } from "effect";
import { and, eq, isNull } from "drizzle-orm";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { verifyStripeWebhookSignature } from "@mattrax/effect-stripe";
import { isUniqueViolationForConstraint } from "@mattrax/enterprise-core";
import { Db } from "./db.ts";
import type { ServicesDb } from "./db.ts";
import { servicesSchema as schema } from "./schema.ts";

export type BillingWebhookConfig = {
  readonly webhookSecret?: string;
  readonly deviceMonthlyPriceId?: string;
  /**
   * Called after an event has been applied and committed. The services
   * deployment uses it to push the new entitlement to the application
   * deployment. A failure makes Stripe retry, and the duplicate path below
   * replays the hook without re-applying the event.
   */
  readonly onApplied?: (
    result: { readonly tenantId?: string; readonly licenseId?: string },
    db: ServicesDb,
  ) => Effect.Effect<void, unknown>;
};

export class BillingWebhookError extends Data.TaggedError("BillingWebhookError")<{
  readonly message: string;
  readonly statusCode: number;
}> {}

const fail = (message: string, statusCode = 400) =>
  new BillingWebhookError({ message, statusCode });

const json = (body: Schema.Json, status = 200) => HttpServerResponse.jsonUnsafe(body, { status });

/** Stripe ids are either a bare string or an expanded object with `id`. */
const StripeIdObject = Schema.Struct({ id: Schema.optional(Schema.String) });

const idOf = (value: Schema.Json | undefined): string | undefined => {
  if (Schema.is(Schema.String)(value)) return value.trim() || undefined;

  return Option.getOrUndefined(Schema.decodeUnknownOption(StripeIdObject)(value))?.id;
};

/**
 * The subset of each Stripe resource the webhook reads. Fields stay `unknown`
 * until a Schema narrows them, because a webhook body is untrusted input even
 * after its signature is verified.
 */
type StripeWebhookSubscription = {
  readonly id?: Schema.Json;
  readonly status?: Schema.Json;
  readonly customer?: Schema.Json;
  readonly metadata?: Schema.Json;
  readonly cancel_at_period_end?: Schema.Json;
  readonly start_date?: Schema.Json;
  readonly current_period_start?: Schema.Json;
  readonly current_period_end?: Schema.Json;
  readonly items?: {
    readonly data?: ReadonlyArray<{
      readonly current_period_start?: Schema.Json;
      readonly current_period_end?: Schema.Json;
      readonly price?: { readonly id?: Schema.Json } | null;
    }>;
  } | null;
};

type StripeWebhookInvoice = {
  readonly subscription?: string | StripeWebhookSubscription | null;
  readonly customer?: Schema.Json;
  readonly parent?: {
    readonly subscription_details?: {
      readonly subscription?: Schema.Json;
      readonly metadata?: Schema.Json;
    } | null;
  } | null;
  readonly subscription_details?: {
    readonly subscription?: Schema.Json;
    readonly metadata?: Schema.Json;
  } | null;
};

type StripeWebhookCheckoutSession = {
  readonly mode?: Schema.Json;
  readonly payment_status?: Schema.Json;
  readonly customer?: Schema.Json;
  readonly subscription?: Schema.Json;
  readonly client_reference_id?: Schema.Json;
  readonly metadata?: Schema.Json;
};

type BillingSubscriptionRow = typeof schema.subscription.$inferSelect;
type BillingTenantRow = typeof schema.tenant.$inferSelect;

const TenantMetadata = Schema.Struct({
  organizationId: Schema.optional(Schema.String),
  tenantId: Schema.optional(Schema.String),
  organizationName: Schema.optional(Schema.String),
  tenantName: Schema.optional(Schema.String),
});

const tenantMetadata = (metadata: Schema.Json | undefined) => {
  const decoded = Option.getOrUndefined(Schema.decodeUnknownOption(TenantMetadata)(metadata));

  return {
    id: decoded?.tenantId?.trim() || decoded?.organizationId?.trim() || undefined,
    name: decoded?.tenantName?.trim() || decoded?.organizationName?.trim() || undefined,
  };
};

const DeploymentLicenseMetadata = Schema.Struct({
  deploymentLicenseId: Schema.optional(Schema.String),
});

const deploymentLicenseIdFromMetadata = (metadata: Schema.Json | undefined): string | undefined => {
  const value = Option.getOrUndefined(
    Schema.decodeUnknownOption(DeploymentLicenseMetadata)(metadata),
  )?.deploymentLicenseId?.trim();

  return value || undefined;
};

const findDeploymentLicense = (db: BillingDb, id: string) =>
  Effect.gen(function* () {
    const [license] = yield* db
      .select()
      .from(schema.deploymentLicense)
      .where(eq(schema.deploymentLicense.id, id))
      .limit(1);

    return license;
  });

const StringRecord = Schema.Record(Schema.String, Schema.String);

/** Expand a Stripe metadata field into a string record, ignoring malformed values. */
const metadataRecord = (value: Schema.Json | undefined): Readonly<Record<string, string>> =>
  Option.getOrUndefined(Schema.decodeUnknownOption(StringRecord)(value)) ?? {};

const unixSeconds = (value: Schema.Json | undefined): number | undefined =>
  Schema.is(Schema.Number)(value) ? value : undefined;

const dateFromUnix = (value: Schema.Json | undefined): Date | null => {
  const seconds = unixSeconds(value);

  return seconds !== undefined && Number.isFinite(seconds) ? new Date(seconds * 1000) : null;
};

const subscriptionPeriod = (subscription: StripeWebhookSubscription) => {
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

const SubscriptionMetadata = Schema.Struct({
  plan: Schema.optional(Schema.String),
  organizationId: Schema.optional(Schema.String),
  tenantId: Schema.optional(Schema.String),
});

const planFor = (subscription: StripeWebhookSubscription, deviceMonthlyPriceId?: string) => {
  const metadataPlan = Option.getOrUndefined(
    Schema.decodeUnknownOption(SubscriptionMetadata)(subscription.metadata),
  )?.plan?.trim();

  if (metadataPlan) return metadataPlan.slice(0, 255);

  const priceId = subscription.items?.data?.[0]?.price?.id;

  if (deviceMonthlyPriceId && Schema.is(Schema.String)(priceId) && priceId === deviceMonthlyPriceId)
    return "device";

  return "device";
};

const upsertTenant = (input: {
  readonly db: BillingDb;
  readonly id: string;
  readonly name?: string;
  readonly stripeCustomerId?: string | null;
  readonly now: Date;
}) =>
  Effect.gen(function* () {
    const [existing] = yield* input.db
      .select()
      .from(schema.tenant)
      .where(eq(schema.tenant.id, input.id))
      .limit(1);

    if (!existing) {
      yield* input.db.insert(schema.tenant).values({
        id: input.id,
        name: input.name ?? input.id,
        stripeCustomerId: input.stripeCustomerId ?? null,
        createdAt: input.now,
        updatedAt: input.now,
      });

      return {
        id: input.id,
        name: input.name ?? input.id,
        stripeCustomerId: input.stripeCustomerId ?? null,
        entitlementSyncedAt: null,
        createdAt: input.now,
        updatedAt: input.now,
      } satisfies BillingTenantRow;
    }

    const stripeCustomerId = input.stripeCustomerId ?? existing.stripeCustomerId;

    if (input.name !== undefined || stripeCustomerId !== existing.stripeCustomerId) {
      yield* input.db
        .update(schema.tenant)
        .set({
          name: input.name ?? existing.name,
          stripeCustomerId,
          updatedAt: input.now,
        })
        .where(eq(schema.tenant.id, existing.id));
    }

    return {
      ...existing,
      name: input.name ?? existing.name,
      stripeCustomerId,
    } satisfies BillingTenantRow;
  });

type ResolveTenantInput = {
  readonly db: BillingDb;
  readonly metadataTenantId?: string;
  readonly metadataTenantName?: string;
  readonly customerId?: string;
  readonly now: Date;
};

/**
 * Map a Stripe object to exactly one Mattrax tenant. Metadata is
 * authoritative, but it must not conflict with the tenant already linked to
 * the Stripe customer. Anything unknown or ambiguous is rejected rather than
 * guessed, so a webhook can never write across tenants.
 */
const resolveTenant = (input: ResolveTenantInput) =>
  Effect.gen(function* () {
    let customerTenantId: string | undefined;

    if (input.customerId) {
      const [row] = yield* input.db
        .select({ id: schema.tenant.id })
        .from(schema.tenant)
        .where(eq(schema.tenant.stripeCustomerId, input.customerId))
        .limit(1);

      customerTenantId = row?.id;
    }

    if (input.metadataTenantId && customerTenantId && input.metadataTenantId !== customerTenantId)
      return yield* Effect.fail(fail("Stripe object maps to conflicting Mattrax tenants"));

    const tenantId = input.metadataTenantId ?? customerTenantId;

    if (!tenantId)
      return yield* Effect.fail(fail("Stripe object is not linked to a Mattrax tenant"));

    const tenant = yield* upsertTenant({
      db: input.db,
      id: tenantId,
      name: input.metadataTenantName,
      stripeCustomerId: input.customerId,
      now: input.now,
    });

    if (input.customerId && tenant.stripeCustomerId && tenant.stripeCustomerId !== input.customerId)
      return yield* Effect.fail(
        fail("Stripe customer does not belong to the mapped Mattrax tenant"),
      );

    return tenant;
  });

const applyLicenseSubscription = (input: {
  readonly db: BillingDb;
  readonly licenseId: string;
  readonly subscription: StripeWebhookSubscription;
  readonly statusOverride?: string;
  readonly now: Date;
}) =>
  Effect.gen(function* () {
    const subscription = input.subscription;
    const stripeSubscriptionId = idOf(subscription.id);

    if (!stripeSubscriptionId)
      return yield* Effect.fail(fail("Subscription event is missing a subscription id"));

    const customerId = idOf(subscription.customer);
    const license = yield* findDeploymentLicense(input.db, input.licenseId);

    if (!license) return yield* Effect.fail(fail("Subscription references an unknown licence"));

    if (license.stripeCustomerId && customerId && license.stripeCustomerId !== customerId)
      return yield* Effect.fail(fail("Stripe customer does not belong to this licence"));

    const { periodEnd } = subscriptionPeriod(subscription);
    const plan = metadataRecord(subscription.metadata).plan?.trim();

    yield* input.db
      .update(schema.deploymentLicense)
      .set({
        stripeCustomerId: customerId ?? license.stripeCustomerId ?? null,
        stripeSubscriptionId,
        status:
          input.statusOverride ??
          Option.getOrUndefined(Schema.decodeUnknownOption(Schema.String)(subscription.status)) ??
          "incomplete",
        plan: plan ? plan.slice(0, 255) : license.plan,
        periodEnd,
        cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
        updatedAt: input.now,
      })
      .where(eq(schema.deploymentLicense.id, license.id));

    return { licenseId: license.id };
  });

type ApplySubscriptionInput = {
  readonly db: BillingDb;
  readonly subscription: StripeWebhookSubscription;
  readonly statusOverride?: string;
  readonly deviceMonthlyPriceId?: string;
  readonly now: Date;
  /** Only a validated Checkout completion may replace the tenant's subscription. */
  readonly allowReplacement?: boolean;
};

const applySubscription = (input: ApplySubscriptionInput) =>
  Effect.gen(function* () {
    const subscription = input.subscription;
    const stripeSubscriptionId = idOf(subscription.id);

    if (!stripeSubscriptionId)
      return yield* Effect.fail(fail("Subscription event is missing a subscription id"));

    const licenseId = deploymentLicenseIdFromMetadata(subscription.metadata);

    if (licenseId)
      return yield* applyLicenseSubscription({
        db: input.db,
        licenseId,
        subscription,
        statusOverride: input.statusOverride,
        now: input.now,
      });

    const customerId = idOf(subscription.customer);
    const metadata = tenantMetadata(subscription.metadata);

    const tenant = yield* resolveTenant({
      db: input.db,
      metadataTenantId: metadata.id,
      metadataTenantName: metadata.name,
      customerId,
      now: input.now,
    });

    const [byStripeId] = yield* input.db
      .select()
      .from(schema.subscription)
      .where(eq(schema.subscription.stripeSubscriptionId, stripeSubscriptionId))
      .limit(1)
      .for("update");

    if (byStripeId && byStripeId.tenantId !== tenant.id)
      return yield* Effect.fail(
        fail("Stripe subscription already belongs to another Mattrax tenant"),
      );

    let tenantSubscription: BillingSubscriptionRow | undefined;

    if (!byStripeId) {
      [tenantSubscription] = yield* input.db
        .select()
        .from(schema.subscription)
        .where(eq(schema.subscription.tenantId, tenant.id))
        .limit(1)
        .for("update");

      if (tenantSubscription && !input.allowReplacement)
        return yield* Effect.fail(
          fail("Stripe subscription does not match the tenant's current subscription"),
        );
    }

    const existing = byStripeId ?? tenantSubscription;

    if (
      input.allowReplacement &&
      existing &&
      customerId &&
      existing.stripeCustomerId &&
      existing.stripeCustomerId !== customerId
    )
      return yield* Effect.fail(
        fail("Stripe customer does not belong to the subscription being replaced"),
      );

    const { periodStart, periodEnd } = subscriptionPeriod(subscription);

    // `canceled` is terminal for one Stripe subscription id. A stale invoice
    // or checkout event must not resurrect it after `subscription.deleted`.
    // The row lock makes this terminal-state guard and the revision increment
    // one serialized decision for the current Stripe subscription id.
    const status =
      byStripeId?.status === "canceled"
        ? "canceled"
        : (input.statusOverride ??
          Option.getOrUndefined(Schema.decodeUnknownOption(Schema.String)(subscription.status)) ??
          "incomplete");

    const values = {
      plan: planFor(subscription, input.deviceMonthlyPriceId),
      tenantId: tenant.id,
      stripeCustomerId: customerId ?? tenant.stripeCustomerId ?? null,
      stripeSubscriptionId,
      status,
      periodStart,
      periodEnd,
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    };

    if (existing) {
      const updated = yield* input.db
        .update(schema.subscription)
        .set({
          ...values,
          entitlementRevision: existing.entitlementRevision + 1,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(schema.subscription.id, existing.id),
            input.allowReplacement
              ? existing.stripeSubscriptionId === null
                ? isNull(schema.subscription.stripeSubscriptionId)
                : eq(schema.subscription.stripeSubscriptionId, existing.stripeSubscriptionId)
              : eq(schema.subscription.stripeSubscriptionId, stripeSubscriptionId),
          ),
        );

      // The pointer can change while this event is in flight. Never write by
      // local id alone after a replacement has committed.
      if (updated.affectedRows === 0)
        return yield* Effect.fail(fail("Stripe subscription is no longer current for this tenant"));
    } else {
      yield* input.db.insert(schema.subscription).values({
        id: SubscriptionId.make(),
        ...values,
        entitlementRevision: 1,
        createdAt: input.now,
        updatedAt: input.now,
      });
    }

    return { tenantId: tenant.id };
  });

type ApplyInvoiceInput = {
  readonly db: BillingDb;
  readonly invoice: StripeWebhookInvoice;
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

    const metadata = tenantMetadata(
      embeddedSubscription?.metadata ??
        invoice.parent?.subscription_details?.metadata ??
        invoice.subscription_details?.metadata,
    );

    const customerId = idOf(invoice.customer);

    const licenseId =
      deploymentLicenseIdFromMetadata(embeddedSubscription?.metadata) ??
      deploymentLicenseIdFromMetadata(invoice.parent?.subscription_details?.metadata) ??
      deploymentLicenseIdFromMetadata(invoice.subscription_details?.metadata);

    let license = licenseId ? yield* findDeploymentLicense(input.db, licenseId) : undefined;

    if (!license && customerId) {
      [license] = yield* input.db
        .select()
        .from(schema.deploymentLicense)
        .where(eq(schema.deploymentLicense.stripeCustomerId, customerId))
        .limit(1);
    }

    if (license) {
      yield* input.db
        .update(schema.deploymentLicense)
        .set({
          status: input.paymentFailed
            ? license.status === "canceled"
              ? "canceled"
              : "past_due"
            : "active",
          updatedAt: input.now,
        })
        .where(eq(schema.deploymentLicense.id, license.id));

      return { licenseId: license.id };
    }

    if (embeddedSubscription?.id) {
      // Expanded invoice subscriptions do not always repeat metadata.
      const subscriptionMetadata = { ...metadataRecord(embeddedSubscription.metadata) };

      if (metadata.id) subscriptionMetadata.organizationId = metadata.id;
      if (metadata.name) subscriptionMetadata.tenantName = metadata.name;

      const embeddedStatus =
        Option.getOrUndefined(
          Schema.decodeUnknownOption(Schema.String)(embeddedSubscription.status),
        ) ?? "active";

      return yield* applySubscription({
        db: input.db,
        subscription: {
          ...embeddedSubscription,
          metadata: subscriptionMetadata,
          customer: embeddedSubscription.customer ?? customerId,
        },
        statusOverride: input.paymentFailed
          ? embeddedStatus === "canceled"
            ? "canceled"
            : "past_due"
          : embeddedStatus,
        deviceMonthlyPriceId: input.deviceMonthlyPriceId,
        now: input.now,
      });
    }

    const tenant = yield* resolveTenant({
      db: input.db,
      metadataTenantId: metadata.id,
      metadataTenantName: metadata.name,
      customerId,
      now: input.now,
    });

    if (!stripeSubscriptionId)
      return yield* Effect.fail(fail("Invoice does not identify a Stripe subscription"));

    const [existing] = yield* input.db
      .select()
      .from(schema.subscription)
      .where(eq(schema.subscription.stripeSubscriptionId, stripeSubscriptionId))
      .limit(1)
      .for("update");

    if (!existing)
      return yield* Effect.fail(fail("Invoice does not match a known Mattrax subscription"));

    // The invoice resolved to one tenant but the subscription row it points
    // at belongs to another: refuse rather than write across tenants.
    if (existing.tenantId !== tenant.id)
      return yield* Effect.fail(
        fail("Stripe invoice subscription already belongs to another Mattrax tenant"),
      );

    const updated = yield* input.db
      .update(schema.subscription)
      .set({
        // A late invoice event must not resurrect a canceled subscription.
        status:
          existing.status === "canceled" ? "canceled" : input.paymentFailed ? "past_due" : "active",
        entitlementRevision: existing.entitlementRevision + 1,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(schema.subscription.id, existing.id),
          eq(schema.subscription.stripeSubscriptionId, stripeSubscriptionId),
        ),
      );

    if (updated.affectedRows === 0)
      return yield* Effect.fail(fail("Stripe invoice subscription is no longer current"));

    return { tenantId: tenant.id };
  });

type ApplyCheckoutSessionInput = {
  readonly db: BillingDb;
  readonly session: StripeWebhookCheckoutSession;
  readonly now: Date;
};

/**
 * A completed Checkout Session links the Stripe customer to the tenant and
 * records a provisional subscription row.
 *
 * `checkout.session.completed` and `customer.subscription.created` describe
 * the same purchase. The session event often arrives first and carries the
 * metadata the tenant was created with, so it establishes the link; the
 * subscription event then fills in period dates and the real status. Both
 * writes are upserts keyed by the Stripe subscription id, so the order does not
 * matter and the event ledger still dedupes a redelivery.
 */
const applyCheckoutSession = (input: ApplyCheckoutSessionInput) =>
  Effect.gen(function* () {
    const session = input.session;

    if (session.mode !== "subscription") return { ignored: true as const };

    const stripeSubscriptionId = idOf(session.subscription);

    if (!stripeSubscriptionId)
      return yield* Effect.fail(fail("Completed Checkout Session has no subscription"));

    const licenseId = deploymentLicenseIdFromMetadata(session.metadata);

    if (licenseId) {
      const customerId = idOf(session.customer);
      const license = yield* findDeploymentLicense(input.db, licenseId);

      if (!license) return yield* Effect.fail(fail("Checkout references an unknown licence"));

      // The subscription event already carries the renewal date and real
      // status; a late Checkout redelivery must not replace them.
      if (license.stripeSubscriptionId === stripeSubscriptionId) return { licenseId: license.id };

      yield* input.db
        .update(schema.deploymentLicense)
        .set({
          stripeCustomerId: customerId ?? license.stripeCustomerId ?? null,
          stripeSubscriptionId,
          status: session.payment_status === "unpaid" ? "incomplete" : "active",
          updatedAt: input.now,
        })
        .where(eq(schema.deploymentLicense.id, license.id));

      return { licenseId: license.id };
    }

    const metadata = tenantMetadata(session.metadata);
    const clientReference = Option.getOrUndefined(
      Schema.decodeUnknownOption(Schema.String)(session.client_reference_id),
    )?.trim();

    const referenceId = metadata.id ?? clientReference ?? undefined;

    const plan = metadataRecord(session.metadata).plan?.trim();

    const subscriptionMetadata: Record<string, string> = {};

    if (referenceId) subscriptionMetadata.organizationId = referenceId;
    if (metadata.name) subscriptionMetadata.tenantName = metadata.name;
    if (plan) subscriptionMetadata.plan = plan;

    // Resolve and validate the session's tenant before trusting a subscription
    // id that may already be recorded for a different tenant.
    const tenant = yield* resolveTenant({
      db: input.db,
      metadataTenantId: referenceId,
      metadataTenantName: metadata.name,
      customerId: idOf(session.customer),
      now: input.now,
    });

    const [recorded] = yield* input.db
      .select({ tenantId: schema.subscription.tenantId })
      .from(schema.subscription)
      .where(eq(schema.subscription.stripeSubscriptionId, stripeSubscriptionId))
      .limit(1);

    // `customer.subscription.created/updated` is the higher-fidelity source.
    // If it already recorded this subscription, keep its period and status.
    if (recorded) {
      if (recorded.tenantId !== tenant.id)
        return yield* Effect.fail(
          fail("Stripe subscription already belongs to another Mattrax tenant"),
        );

      return { tenantId: recorded.tenantId };
    }

    return yield* applySubscription({
      db: input.db,
      subscription: {
        id: stripeSubscriptionId,
        customer: session.customer,
        status: session.payment_status === "unpaid" ? "incomplete" : "active",
        metadata: subscriptionMetadata,
        cancel_at_period_end: false,
      },
      now: input.now,
      allowReplacement: true,
    });
  });

export type ProcessStripeWebhookInput = BillingWebhookConfig & {
  readonly payload: string;
  readonly signature: string | null;
  readonly db: ServicesDb;
  /** Injectable clock for deterministic tests. */
  readonly now?: Date;
};

/** Only the ledger insert can claim an event id for this transaction. */
const isDuplicateEventError = (cause: unknown): boolean => {
  return (
    isUniqueViolationForConstraint(cause, "services_stripe_event.PRIMARY") ||
    isUniqueViolationForConstraint(cause, "PRIMARY")
  );
};

/** The database surface the apply helpers use; transaction handles included. */
type BillingDb = Pick<ServicesDb, "select" | "insert" | "update">;

/**
 * SAFETY: the signature over this payload was verified, and the switch below
 * discriminates on `event.type`, which names the Stripe resource carried in
 * `data.object`. The SDK types that field as the union of every resource, so a
 * narrower per-event type is only available by asserting at this boundary.
 */
const eventObject = <T>(event: { readonly data: { readonly object: unknown } }): T =>
  event.data.object as T;

const applyVerifiedEvent = (
  input: Omit<ProcessStripeWebhookInput, "db"> & { readonly db: BillingDb },
  event: { readonly type: string; readonly data: { readonly object: unknown } },
  now: Date,
) => {
  switch (event.type) {
    case "checkout.session.completed":
      return applyCheckoutSession({
        db: input.db,
        session: eventObject<StripeWebhookCheckoutSession>(event),
        now,
      });
    case "customer.subscription.created":
    case "customer.subscription.updated":
      return applySubscription({
        db: input.db,
        subscription: eventObject<StripeWebhookSubscription>(event),
        deviceMonthlyPriceId: input.deviceMonthlyPriceId,
        now,
      });
    case "customer.subscription.deleted":
      return applySubscription({
        db: input.db,
        subscription: eventObject<StripeWebhookSubscription>(event),
        statusOverride: "canceled",
        deviceMonthlyPriceId: input.deviceMonthlyPriceId,
        now,
      });
    case "invoice.paid":
    case "invoice.payment_succeeded":
      return applyInvoice({
        db: input.db,
        invoice: eventObject<StripeWebhookInvoice>(event),
        paymentFailed: false,
        deviceMonthlyPriceId: input.deviceMonthlyPriceId,
        now,
      });
    case "invoice.payment_failed":
      return applyInvoice({
        db: input.db,
        invoice: eventObject<StripeWebhookInvoice>(event),
        paymentFailed: true,
        deviceMonthlyPriceId: input.deviceMonthlyPriceId,
        now,
      });
    default:
      return Effect.succeed({ ignored: true as const });
  }
};

export type StripeWebhookOutcome = {
  readonly tenantId?: string;
  readonly licenseId?: string;
  readonly ignored?: boolean;
  readonly duplicate?: boolean;
};

const syncApplied = (
  input: ProcessStripeWebhookInput,
  result: { readonly tenantId?: string; readonly licenseId?: string },
) => (input.onApplied ? input.onApplied(result, input.db).pipe(Effect.asVoid) : Effect.void);

/**
 * Verify and apply one Stripe event.
 *
 * The event id is written to `services_stripe_event` in the same transaction as the
 * subscription/invoice writes. A redelivery (including two instances handling
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

    const outcome = yield* input.db.transaction((tx: BillingDb) =>
      Effect.gen(function* () {
        const marker = yield* Effect.gen(function* () {
          yield* tx.insert(schema.stripeEvent).values({
            id: eventId,
            type: event.type,
            tenantId: null,
            licenseId: null,
            receivedAt: now,
          });

          return { inserted: true as const };
        }).pipe(
          Effect.catchCause((cause) =>
            isDuplicateEventError(cause)
              ? Effect.succeed({ duplicate: true as const })
              : Effect.failCause(cause),
          ),
        );

        // A redelivery loses the primary-key race before any billing writes
        // run. Other failures, including later writes in this transaction,
        // must propagate so Stripe retries the event.
        if ("duplicate" in marker) return marker;

        const applied = yield* applyVerifiedEvent(
          { ...input, db: tx },
          { type: event.type, data: { object: event.data.object } },
          now,
        );

        if ("tenantId" in applied && applied.tenantId)
          yield* tx
            .update(schema.stripeEvent)
            .set({ tenantId: applied.tenantId })
            .where(eq(schema.stripeEvent.id, eventId));

        if ("licenseId" in applied && applied.licenseId)
          yield* tx
            .update(schema.stripeEvent)
            .set({ licenseId: applied.licenseId })
            .where(eq(schema.stripeEvent.id, eventId));

        return applied;
      }),
    );

    if ("duplicate" in outcome) {
      const [recorded] = yield* input.db
        .select({ tenantId: schema.stripeEvent.tenantId, licenseId: schema.stripeEvent.licenseId })
        .from(schema.stripeEvent)
        .where(eq(schema.stripeEvent.id, eventId))
        .limit(1);

      if (recorded?.tenantId) yield* syncApplied(input, { tenantId: recorded.tenantId });
      if (recorded?.licenseId) yield* syncApplied(input, { licenseId: recorded.licenseId });

      return { duplicate: true } satisfies StripeWebhookOutcome;
    }

    if ("ignored" in outcome) return { ignored: true } satisfies StripeWebhookOutcome;

    if ("tenantId" in outcome && outcome.tenantId) {
      yield* syncApplied(input, { tenantId: outcome.tenantId });

      return { tenantId: outcome.tenantId } satisfies StripeWebhookOutcome;
    }

    if ("licenseId" in outcome && outcome.licenseId) {
      yield* syncApplied(input, { licenseId: outcome.licenseId });

      return { licenseId: outcome.licenseId } satisfies StripeWebhookOutcome;
    }

    return { ignored: true } satisfies StripeWebhookOutcome;
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof BillingWebhookError ? cause : fail("Webhook processing failed", 500),
    ),
  );

/**
 * Raw route layer. It is mounted inside the services handler layer and needs
 * `Db` from the surrounding app layer.
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
          onApplied: config.onApplied,
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
