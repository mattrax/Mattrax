import { Context, Effect, Exit, Layer } from "effect";
import { and, count, eq } from "drizzle-orm";
import type { PlanLimitsConfig } from "@mattrax/enterprise-core";
import {
  countOrganizationDevices,
  deviceLimitForOrganization,
  tenantLimitForAccount,
} from "@mattrax/enterprise-core";
import type {
  EffectStripeClient,
  StripeClientLike,
  StripeCustomer,
  StripeInvoice,
} from "@mattrax/effect-stripe";
import {
  EnterpriseDbError,
  EnterpriseStripeError,
  type BillingCheckoutRequest,
  type BillingInvoice,
  type BillingInvoicesResponse,
  type BillingSummary,
} from "@mattrax/enterprise-domain";
import { billableDeviceCount, type EnterpriseOrganization } from "./billing.ts";
import type { EnterpriseDb } from "@mattrax/enterprise-core";
import { schema } from "@mattrax/enterprise-core";

/**
 * Customer-facing billing, independent of the deployment model.
 *
 * Hosted Mattrax bills each tenant through the vendor's Stripe account. A
 * self-hosted deployment bills the operator for the whole deployment and
 * forwards the same operations to the cloud billing API. Handlers depend on
 * this service only; neither implementation leaks into the HTTP layer.
 */

export type BillingTenant = Pick<EnterpriseOrganization, "id" | "name" | "stripeCustomerId">;

export type BillingSummaryInput = {
  readonly organizationId: string;
  readonly userId: string;
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
};

export type BillingInvoicesInput = {
  readonly organization: BillingTenant;
};

export type BillingUsageInput = {
  readonly deviceCount: number;
  readonly tenantCount: number;
};

export type BillingError = EnterpriseStripeError | EnterpriseDbError;

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
  /** Report deployment usage. Hosted billing reconciles per tenant instead. */
  readonly reportUsage: (input: BillingUsageInput) => Effect.Effect<void, BillingError>;
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

const dbFailed = () => new EnterpriseDbError({ message: "Could not load billing details." });

const hostedBillingUrl = (value: string | null | undefined): string | null => {
  if (!value) return null;

  try {
    const url = new URL(value);

    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
};

const httpsLinkOrNull = (value: string | null | undefined): string | null =>
  hostedBillingUrl(value);

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

export type StripeBillingOptions = {
  readonly db: EnterpriseDb;
  readonly origin: string;
  readonly stripe?: EffectStripeClient;
  readonly deviceMonthlyPriceId?: string;
  readonly planLimits?: PlanLimitsConfig;
};

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

  const ensureStripeCustomer = (organization: BillingTenant) =>
    Effect.gen(function* () {
      if (!stripe) return yield* Effect.fail(notConfigured());

      if (organization.stripeCustomerId) return organization.stripeCustomerId;

      // Search is the cheap path. Some Stripe accounts/API versions reject
      // search, so fall back to a single bounded page instead of iterating the
      // entire customer list.
      const search = yield* Effect.exit(
        stripe.customers.search({
          query: `metadata["organizationId"]:"${organization.id}" AND metadata["customerType"]:"organization"`,
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
            customer.metadata?.organizationId === organization.id &&
            customer.metadata?.customerType === "organization",
        );
      }

      stripeCustomer ??= yield* stripe.customers
        .create({
          name: organization.name,
          metadata: { organizationId: organization.id, customerType: "organization" },
        })
        .pipe(Effect.mapError(() => unavailable()));

      yield* db
        .update(schema.organization)
        .set({ stripeCustomerId: stripeCustomer.id })
        .where(eq(schema.organization.id, organization.id))
        .pipe(Effect.mapError(() => dbFailed()));

      return stripeCustomer.id;
    });

  return {
    summary: ({ organizationId, userId }) =>
      Effect.gen(function* () {
        const [subscription] = yield* db
          .select()
          .from(schema.subscription)
          .where(eq(schema.subscription.referenceId, organizationId))
          .limit(1)
          .pipe(Effect.mapError(() => dbFailed()));

        const [devices] = yield* db
          .select({ value: count() })
          .from(schema.device)
          .where(
            and(
              eq(schema.device.organizationId, organizationId),
              eq(schema.device.status, "enrolled"),
            ),
          )
          .pipe(Effect.mapError(() => dbFailed()));

        const planLimitDbError = () => dbFailed();

        const devicesUsed = yield* countOrganizationDevices(db, organizationId).pipe(
          Effect.mapError(planLimitDbError),
        );

        const deviceStatus = yield* deviceLimitForOrganization({
          db,
          organizationId,
          config: planLimits,
        }).pipe(Effect.mapError(planLimitDbError));

        const tenantStatus = yield* tenantLimitForAccount({
          db,
          userId,
          config: planLimits,
        }).pipe(Effect.mapError(planLimitDbError));

        return {
          plan: deviceStatus.plan,
          status: subscription?.status,
          billableDevices: devices?.value ?? 0,
          deviceLimit: deviceStatus.limit,
          tenantLimit: tenantStatus.limit,
          devicesUsed,
          tenantsUsed: tenantStatus.used,
          overDeviceLimit: deviceStatus.overLimit,
          overTenantLimit: tenantStatus.overLimit,
          limitsConfigured: Boolean(planLimits?.configured),
          subscriptionId: subscription?.stripeSubscriptionId ?? null,
          periodEnd: subscription?.periodEnd ? iso(subscription.periodEnd) : null,
          cancelAtPeriodEnd: Boolean(subscription?.cancelAtPeriodEnd),
          configured: Boolean(stripe),
        };
      }),

    portal: ({ tenantId, organization, returnUrl }) =>
      Effect.gen(function* () {
        if (!stripe) return yield* Effect.fail(notConfigured());

        const customer = yield* ensureStripeCustomer(organization);

        const result = yield* stripe.billingPortal.sessions
          .create({
            customer,
            return_url: sameOriginReturnUrl(tenantId, returnUrl),
          })
          .pipe(Effect.mapError(() => unavailable()));

        const url = hostedBillingUrl(result.url);

        if (!url) return yield* Effect.fail(unavailable());

        return { url };
      }),

    checkout: ({ tenantId, organization, request }) =>
      Effect.gen(function* () {
        if (!stripe || !deviceMonthlyPriceId) return yield* Effect.fail(notConfigured());

        const customer = yield* ensureStripeCustomer(organization);

        const billable = yield* billableDeviceCount(db, organization.id).pipe(
          Effect.mapError(() => dbFailed()),
        );

        // Checkout requires a positive quantity. A tenant buying the plan with
        // no enrolled devices starts with one seat and the next reconciliation
        // moves it to the real fleet size.
        const quantity = Math.max(1, billable);

        const returnUrl = tenantBillingUrl(tenantId);

        const metadata = {
          organizationId: organization.id,
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

        const url = hostedBillingUrl(session.url);

        if (!url) return yield* Effect.fail(unavailable());

        return { url, quantity };
      }),

    invoices: ({ organization }) =>
      Effect.gen(function* () {
        if (!stripe) return yield* Effect.fail(notConfigured());

        // No customer means nothing was ever purchased, so there are no
        // invoices to ask Stripe about.
        if (!organization.stripeCustomerId) return { invoices: [] };

        const page = yield* stripe.invoices
          .list({ customer: organization.stripeCustomerId, limit: 24 })
          .pipe(Effect.mapError(() => unavailable()));

        return { invoices: page.data.map(billingInvoice) };
      }),

    reportUsage: () => Effect.void,
  };
};
