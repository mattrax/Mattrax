import { Context, Effect, Exit, Layer } from "effect";
import { eq, lt } from "drizzle-orm";
import type { PlanLimitsConfig } from "@mattrax/enterprise-core";
import { DEFAULT_PLAN_NAME, planLimitsFor } from "@mattrax/enterprise-core";
import type {
  EffectStripeClient,
  StripeClientLike,
  StripeCustomer,
  StripeInvoice,
} from "@mattrax/effect-stripe";
import { EnterpriseStripeError } from "@mattrax/enterprise-domain";
import type {
  BillingCheckoutRequest,
  BillingInvoice,
  BillingInvoicesResponse,
  BillingSummary,
} from "@mattrax/enterprise-domain";
import type { ServicesDb } from "./db.ts";
import { servicesSchema as schema } from "./schema.ts";

/**
 * Customer-facing billing for hosted tenants.
 *
 * The services deployment owns the Stripe account, the tenant projection and
 * the subscription rows. The application deployment only reports usage and
 * forwards user actions, so no Stripe secret ever leaves this service.
 */

export type BillingTenant = {
  readonly id: string;
  readonly name: string;
};

/** Everything about usage the application has to supply. */
export type BillingUsage = {
  readonly organizationId?: string;
  /** Enrolled devices; the number of paid seats. */
  readonly deviceCount: number;
  /** Devices in every state, used for limit messaging. */
  readonly devicesUsed?: number;
  /** Tenants owned by the account, used for tenant-limit messaging. */
  readonly tenantCount: number;
};

export type BillingSummaryInput = {
  readonly organizationId: string;
  readonly accountId: string;
  readonly organization: BillingTenant;
  readonly usage: BillingUsage;
};

export type BillingPortalInput = {
  readonly tenantId: string;
  readonly organization: BillingTenant;
  readonly returnUrl?: string | null;
};

export type BillingCheckoutInput = {
  readonly tenantId: string;
  readonly organization: BillingTenant;
  readonly request: BillingCheckoutRequest;
  readonly usage: BillingUsage;
};

export type BillingInvoicesInput = {
  readonly organization: BillingTenant;
};

export type BillingError = EnterpriseStripeError;

export type BillingOperations = {
  readonly summary: (input: BillingSummaryInput) => Effect.Effect<BillingSummary, BillingError>;
  readonly portal: (
    input: BillingPortalInput,
  ) => Effect.Effect<{ readonly url: string }, BillingError>;
  readonly checkout: (
    input: BillingCheckoutInput,
  ) => Effect.Effect<{ readonly url: string; readonly quantity: number }, BillingError>;
  readonly invoices: (
    input: BillingInvoicesInput,
  ) => Effect.Effect<BillingInvoicesResponse, BillingError>;
  /** Report usage. Hosted billing reconciles seats; licence billing stores it. */
  readonly reportUsage: (input: BillingUsage) => Effect.Effect<void, BillingError>;
  /** Best-effort Stripe customer rename when the application tenant changes. */
  readonly renameTenant: (input: {
    readonly tenantId: string;
    readonly name: string;
  }) => Effect.Effect<void, BillingError>;
  /** Fail before a teardown contacts devices when billing cannot be settled. */
  readonly preflightTenantDeletion: (input: {
    readonly tenantId: string;
  }) => Effect.Effect<void, BillingError>;
  /** Cancel a tenant's subscription during teardown. */
  readonly cancelTenant: (input: {
    readonly tenantId: string;
  }) => Effect.Effect<"cancelled" | "at_period_end" | "none", BillingError>;
};

export class BillingService extends Context.Service<BillingService, BillingOperations>()(
  "mattrax/BillingService",
) {}

/** Provide a concrete billing implementation without leaking it into handlers. */
export const BillingServiceLive = (operations: BillingOperations) =>
  Layer.succeed(BillingService, operations);

const iso = (date: Date | number | null | undefined) => {
  if (date == null) return new Date(0).toISOString();

  return (date instanceof Date ? date : new Date(date)).toISOString();
};

const notConfigured = () =>
  new EnterpriseStripeError({ message: "Billing is not configured for this deployment." });

const unavailable = () =>
  new EnterpriseStripeError({ message: "Billing is temporarily unavailable. Try again shortly." });

const dbFailed = () => new EnterpriseStripeError({ message: "Could not load billing details." });

const asBillingError = <A, R>(effect: Effect.Effect<A, unknown, R>) =>
  effect.pipe(
    Effect.mapError((cause) => (cause instanceof EnterpriseStripeError ? cause : dbFailed())),
  );

const httpsLinkOrNull = (value: string | null | undefined): string | null => {
  if (!value) return null;

  try {
    const url = new URL(value);

    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
};

const billingInvoice = (invoice: StripeInvoice): BillingInvoice => ({
  id: invoice.id,
  number: invoice.number ?? null,
  status: invoice.status ?? null,
  total: invoice.total ?? 0,
  amountDue: invoice.amount_due ?? 0,
  amountPaid: invoice.amount_paid ?? 0,
  currency: invoice.currency ?? "usd",
  createdAt: new Date((invoice.created ?? 0) * 1000).toISOString(),
  periodStart: invoice.period_start ? new Date(invoice.period_start * 1000).toISOString() : null,
  periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000).toISOString() : null,
  hostedInvoiceUrl: httpsLinkOrNull(invoice.hosted_invoice_url),
  pdfUrl: httpsLinkOrNull(invoice.invoice_pdf),
});

/** Subscription states that no longer grant their stored plan. */
const DOWNGRADED_STATUSES = new Set(["canceled", "incomplete_expired", "unpaid"]);
const TERMINAL_STATUSES = new Set(["canceled", "incomplete_expired"]);

const effectivePlan = (
  plan: string | null | undefined,
  status: string | null | undefined,
  config?: PlanLimitsConfig,
) => {
  const fallback = config?.defaultPlan ?? DEFAULT_PLAN_NAME;
  const normalizedStatus = status?.trim().toLowerCase();

  if (!plan?.trim()) return fallback;
  if (normalizedStatus && DOWNGRADED_STATUSES.has(normalizedStatus)) return fallback;

  return plan.trim();
};

export type StripeBillingOptions = {
  readonly db: ServicesDb;
  readonly origin: string;
  readonly stripe?: EffectStripeClient;
  readonly deviceMonthlyPriceId?: string;
  readonly planLimits?: PlanLimitsConfig;
};

const ensureTenant = (db: ServicesDb, tenant: BillingTenant) =>
  Effect.gen(function* () {
    const [existing] = yield* db
      .select()
      .from(schema.tenant)
      .where(eq(schema.tenant.id, tenant.id))
      .limit(1);

    const now = new Date();

    if (!existing) {
      yield* db.insert(schema.tenant).values({
        id: tenant.id,
        name: tenant.name,
        stripeCustomerId: null,
        createdAt: now,
        updatedAt: now,
      });

      return { id: tenant.id, name: tenant.name, stripeCustomerId: null };
    }

    if (existing.name !== tenant.name) {
      yield* db
        .update(schema.tenant)
        .set({ name: tenant.name, updatedAt: now })
        .where(eq(schema.tenant.id, tenant.id));

      return { ...existing, name: tenant.name };
    }

    return existing;
  });

const upsertUsage = (db: ServicesDb, usage: BillingUsage) =>
  Effect.gen(function* () {
    if (!usage.organizationId) return;

    const now = new Date();
    const values = {
      tenantId: usage.organizationId,
      billableDevices: Math.max(0, Math.floor(usage.deviceCount)),
      devicesUsed: Math.max(0, Math.floor(usage.devicesUsed ?? usage.deviceCount)),
      tenantCount: Math.max(0, Math.floor(usage.tenantCount)),
      reportedAt: now,
    };

    yield* db.insert(schema.tenantUsage).values(values).onDuplicateKeyUpdate({ set: values });
  });

/** The plan and status that the application caches for limit checks. */
export const tenantEntitlement = (db: ServicesDb, tenantId: string) =>
  Effect.gen(function* () {
    const [subscription] = yield* db
      .select({
        plan: schema.subscription.plan,
        status: schema.subscription.status,
        revision: schema.subscription.entitlementRevision,
      })
      .from(schema.subscription)
      .where(eq(schema.subscription.tenantId, tenantId))
      .limit(1);

    return subscription;
  });

const tenantUsage = (db: ServicesDb, tenantId: string) =>
  Effect.gen(function* () {
    const [row] = yield* db
      .select()
      .from(schema.tenantUsage)
      .where(eq(schema.tenantUsage.tenantId, tenantId))
      .limit(1);

    return row;
  });

export const makeStripeBillingService = ({
  db,
  origin,
  stripe,
  deviceMonthlyPriceId,
  planLimits,
}: StripeBillingOptions): BillingOperations => {
  const tenantBillingUrl = (tenantId: string) =>
    `${origin.replace(/\/+$/, "")}/t/${encodeURIComponent(tenantId)}/settings/billing`;

  const sameOriginReturnUrl = (tenantId: string, candidate: string | null | undefined) => {
    const fallback = tenantBillingUrl(tenantId);

    if (!candidate) return fallback;

    try {
      const base = new URL(origin);
      const url = new URL(candidate, base);

      return url.origin === base.origin ? url.toString() : fallback;
    } catch {
      return fallback;
    }
  };

  const ensureStripeCustomer = (tenant: BillingTenant) =>
    Effect.gen(function* () {
      if (!stripe) return yield* Effect.fail(notConfigured());

      const stored = yield* ensureTenant(db, tenant);

      if (stored.stripeCustomerId) return stored.stripeCustomerId;

      // Search is the cheap path. Some Stripe accounts/API versions reject
      // search, so fall back to a single bounded page instead of iterating the
      // entire customer list.
      const search = yield* Effect.exit(
        stripe.customers.search({
          query: `metadata["organizationId"]:"${tenant.id}" AND metadata["customerType"]:"organization"`,
          limit: 1,
        }),
      );

      let stripeCustomer: StripeCustomer | undefined = Exit.isSuccess(search)
        ? search.value.data[0]
        : undefined;

      if (!stripeCustomer && Exit.isFailure(search)) {
        const page = yield* stripe
          .effect((client: StripeClientLike) => client.customers.list({ limit: 100 }))
          .pipe(Effect.mapError(() => unavailable()));

        stripeCustomer = page.data.find(
          (customer: StripeCustomer) =>
            customer.metadata?.organizationId === tenant.id &&
            customer.metadata?.customerType === "organization",
        );
      }

      stripeCustomer ??= yield* stripe.customers
        .create({
          name: tenant.name,
          metadata: { organizationId: tenant.id, customerType: "organization" },
        })
        .pipe(Effect.mapError(() => unavailable()));

      yield* db
        .update(schema.tenant)
        .set({ stripeCustomerId: stripeCustomer.id, updatedAt: new Date() })
        .where(eq(schema.tenant.id, tenant.id))
        .pipe(Effect.mapError(() => dbFailed()));

      return stripeCustomer.id;
    });

  const reconcileSeats = (tenantId: string) =>
    Effect.gen(function* () {
      if (!stripe || !deviceMonthlyPriceId) return;

      const [subscription] = yield* db
        .select()
        .from(schema.subscription)
        .where(eq(schema.subscription.tenantId, tenantId))
        .limit(1);

      if (!subscription?.stripeSubscriptionId) return;
      if (TERMINAL_STATUSES.has(subscription.status)) return;

      const remote = yield* stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
      const item = remote.items?.data[0];

      if (!item?.id || item.price?.id !== deviceMonthlyPriceId) return;

      const usage = yield* tenantUsage(db, tenantId);
      const billable = usage?.billableDevices ?? 0;
      const plan = effectivePlan(subscription.plan, subscription.status, planLimits);
      const limit = planLimitsFor(planLimits, plan).devices;
      const quantity = limit === null ? billable : Math.min(billable, limit);

      if ((item.quantity ?? 0) !== quantity)
        yield* stripe.subscriptions.update(subscription.stripeSubscriptionId, {
          items: [{ id: item.id, quantity }],
          proration_behavior: "none",
        });
    });

  const summary: BillingOperations["summary"] = ({ organizationId, organization, usage }) =>
    asBillingError(
      Effect.gen(function* () {
        yield* ensureTenant(db, organization);
        yield* upsertUsage(db, { ...usage, organizationId });

        const [subscription] = yield* db
          .select()
          .from(schema.subscription)
          .where(eq(schema.subscription.tenantId, organizationId))
          .limit(1);

        const stored = yield* tenantUsage(db, organizationId);
        const plan = effectivePlan(subscription?.plan, subscription?.status, planLimits);
        const deviceLimit = planLimitsFor(planLimits, plan).devices;
        const tenantLimit = planLimitsFor(planLimits, plan).tenants;
        const devicesUsed = Math.max(0, usage.devicesUsed ?? 0);
        const billableDevices = Math.max(0, usage.deviceCount);
        const tenantsUsed = Math.max(0, usage.tenantCount);

        return {
          plan,
          status: subscription?.status,
          billableDevices: stored?.billableDevices ?? billableDevices,
          deviceLimit,
          tenantLimit,
          devicesUsed,
          tenantsUsed,
          overDeviceLimit: deviceLimit !== null && devicesUsed > deviceLimit,
          overTenantLimit: tenantLimit !== null && tenantsUsed > tenantLimit,
          limitsConfigured: Boolean(planLimits?.configured),
          subscriptionId: subscription?.stripeSubscriptionId ?? null,
          periodEnd: subscription?.periodEnd ? iso(subscription.periodEnd) : null,
          cancelAtPeriodEnd: Boolean(subscription?.cancelAtPeriodEnd),
          configured: Boolean(stripe),
        };
      }),
    );

  return {
    summary,

    portal: ({ tenantId, organization, returnUrl }) =>
      asBillingError(
        Effect.gen(function* () {
          if (!stripe) return yield* Effect.fail(notConfigured());

          const customer = yield* ensureStripeCustomer(organization);

          const result = yield* stripe.billingPortal.sessions
            .create({
              customer,
              return_url: sameOriginReturnUrl(tenantId, returnUrl),
            })
            .pipe(Effect.mapError(() => unavailable()));

          const url = httpsLinkOrNull(result.url);

          if (!url) return yield* Effect.fail(unavailable());

          return { url };
        }),
      ),

    checkout: ({ tenantId, organization, request, usage }) =>
      asBillingError(
        Effect.gen(function* () {
          if (!stripe || !deviceMonthlyPriceId) return yield* Effect.fail(notConfigured());

          const customer = yield* ensureStripeCustomer(organization);

          // Checkout requires a positive quantity. A tenant buying the plan with
          // no enrolled devices starts with one seat and the next reconciliation
          // moves it to the real fleet size.
          const quantity = Math.max(1, Math.floor(usage.deviceCount));

          const returnUrl = tenantBillingUrl(tenantId);

          const metadata = {
            organizationId: organization.id,
            organizationName: organization.name,
            plan: "device",
          };

          const subscriptionData =
            request.trialDays === undefined
              ? { metadata }
              : { metadata, trial_period_days: request.trialDays };

          const session = yield* stripe.checkout.sessions
            .create({
              mode: "subscription",
              customer,
              client_reference_id: organization.id,
              success_url: `${returnUrl}?checkout=success`,
              cancel_url: `${returnUrl}?checkout=cancelled`,
              line_items: [{ price: deviceMonthlyPriceId, quantity }],
              metadata,
              subscription_data: subscriptionData,
              allow_promotion_codes: true,
            })
            .pipe(Effect.mapError(() => unavailable()));

          const url = httpsLinkOrNull(session.url);

          if (!url) return yield* Effect.fail(unavailable());

          return { url, quantity };
        }),
      ),

    invoices: ({ organization }) =>
      asBillingError(
        Effect.gen(function* () {
          if (!stripe) return yield* Effect.fail(notConfigured());

          const [tenant] = yield* db
            .select({ stripeCustomerId: schema.tenant.stripeCustomerId })
            .from(schema.tenant)
            .where(eq(schema.tenant.id, organization.id))
            .limit(1);

          // No customer means nothing was ever purchased, so there are no
          // invoices to ask Stripe about.
          if (!tenant?.stripeCustomerId) return { invoices: [] };

          const page = yield* stripe.invoices
            .list({ customer: tenant.stripeCustomerId, limit: 24 })
            .pipe(Effect.mapError(() => unavailable()));

          return { invoices: page.data.map(billingInvoice) };
        }),
      ),

    reportUsage: (usage) =>
      asBillingError(
        Effect.gen(function* () {
          if (!usage.organizationId) return;

          yield* upsertUsage(db, usage);

          if (stripe && deviceMonthlyPriceId)
            yield* reconcileSeats(usage.organizationId).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning(`Billing seat reconciliation failed: ${String(cause)}`),
              ),
            );
        }),
      ),

    renameTenant: ({ tenantId, name }) =>
      asBillingError(
        Effect.gen(function* () {
          const [tenant] = yield* db
            .select()
            .from(schema.tenant)
            .where(eq(schema.tenant.id, tenantId))
            .limit(1);

          if (!tenant) return;

          yield* db
            .update(schema.tenant)
            .set({ name, updatedAt: new Date() })
            .where(eq(schema.tenant.id, tenantId));

          if (!stripe || !tenant.stripeCustomerId) return;

          yield* stripe.customers
            .update(tenant.stripeCustomerId, { name })
            .pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning(
                  `Stripe customer rename failed for ${tenantId}: ${String(cause)}`,
                ),
              ),
            );
        }),
      ),

    preflightTenantDeletion: ({ tenantId }) =>
      asBillingError(
        Effect.gen(function* () {
          const [subscription] = yield* db
            .select({ stripeSubscriptionId: schema.subscription.stripeSubscriptionId })
            .from(schema.subscription)
            .where(eq(schema.subscription.tenantId, tenantId))
            .limit(1);

          if (subscription?.stripeSubscriptionId && !stripe)
            return yield* Effect.fail(notConfigured());
        }),
      ),

    cancelTenant: ({ tenantId }) =>
      asBillingError(
        Effect.gen(function* () {
          const [subscription] = yield* db
            .select()
            .from(schema.subscription)
            .where(eq(schema.subscription.tenantId, tenantId))
            .limit(1);

          if (!subscription?.stripeSubscriptionId) return "none" as const;

          if (!stripe) return yield* Effect.fail(notConfigured());

          const cancelled = yield* stripe.subscriptions
            .cancel(subscription.stripeSubscriptionId)
            .pipe(
              // Stripe keeps cancelled subscriptions readable; a missing one means a
              // previous attempt already removed it.
              Effect.catchIf(
                (cause) => cause.statusCode === 404 || cause.code === "resource_missing",
                () => Effect.succeed(null),
              ),
            );

          return cancelled?.cancel_at_period_end
            ? ("at_period_end" as const)
            : ("cancelled" as const);
        }),
      ),
  };
};

/**
 * Nightly backstop for the paid seat quantity and the Stripe customer name.
 * The application reports usage throughout the day; this sweep catches a
 * report that was lost and repairs names after a Stripe outage.
 */
export const reconcileSubscriptionSweep = (input: {
  readonly db: ServicesDb;
  readonly stripe: EffectStripeClient;
  readonly deviceMonthlyPriceId?: string;
  readonly planLimits?: PlanLimitsConfig;
  readonly limit?: number;
}) =>
  Effect.gen(function* () {
    const result = {
      checked: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      failed: 0,
    };

    const rows = yield* input.db
      .select({ tenantId: schema.subscription.tenantId })
      .from(schema.subscription)
      .limit(Math.max(1, Math.floor(input.limit ?? 1_000)));

    const service = makeStripeBillingService({
      db: input.db,
      origin: "https://services.mattrax.app",
      stripe: input.stripe,
      deviceMonthlyPriceId: input.deviceMonthlyPriceId,
      planLimits: input.planLimits,
    });

    for (const row of rows) {
      result.checked += 1;

      const [usage] = yield* input.db
        .select()
        .from(schema.tenantUsage)
        .where(eq(schema.tenantUsage.tenantId, row.tenantId))
        .limit(1);

      const outcome = yield* service
        .reportUsage({
          organizationId: row.tenantId,
          deviceCount: usage?.billableDevices ?? 0,
          devicesUsed: usage?.devicesUsed ?? 0,
          tenantCount: usage?.tenantCount ?? 0,
        })
        .pipe(Effect.exit);

      if (Exit.isFailure(outcome)) result.failed += 1;
      else result.updated += 1;
    }

    return result;
  });

/** Prune the Stripe event ledger. It only needs to outlive Stripe's retries. */
export const pruneStripeEvents = (db: ServicesDb, cutoff: Date, limit = 5_000) =>
  Effect.gen(function* () {
    const stale = yield* db
      .select({ id: schema.stripeEvent.id })
      .from(schema.stripeEvent)
      .where(lt(schema.stripeEvent.receivedAt, cutoff))
      .limit(limit);

    if (stale.length === 0) return 0;

    for (const row of stale)
      yield* db.delete(schema.stripeEvent).where(eq(schema.stripeEvent.id, row.id));

    return stale.length;
  });

export type { BillingInvoicesResponse, BillingSummary };
