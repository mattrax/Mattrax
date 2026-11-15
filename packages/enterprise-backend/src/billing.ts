import { Effect, Exit } from "effect";
import { and, count, eq, isNotNull } from "drizzle-orm";
import type { PlanLimitsConfig } from "@mattrax/enterprise-core";
import { planForOrganization, planLimitsFor } from "@mattrax/enterprise-core";
import type { EffectStripeClient } from "@mattrax/effect-stripe";
import type { EnterpriseDb, EnterpriseOrganization } from "./schema.ts";
import { schema } from "./schema.ts";

/**
 * Seat reconciliation for the per-device plan.
 *
 * Stripe is never the source of truth for how many devices a tenant has: the
 * `device` table is. One seat is one device the tenant is being billed for,
 * which is exactly the count shown as `billableDevices` — devices in the
 * `enrolled` state. A row that was checked out, wiped or deleted keeps its
 * history but no longer costs a seat.
 *
 * The subscription row is authoritative for the plan name, so the plan's own
 * device limit caps the quantity: a tenant is never billed for more seats than
 * the plan it is on allows, even when rows predate a lowered limit.
 */

/** Devices that cost a seat: enrolled only, not enrolling or retired. */
export const billableDeviceCount = (db: EnterpriseDb, organizationId: string) =>
  Effect.gen(function* () {
    const [row] = yield* db
      .select({ value: count() })
      .from(schema.device)
      .where(
        and(eq(schema.device.organizationId, organizationId), eq(schema.device.status, "enrolled")),
      );

    return row?.value ?? 0;
  });

/**
 * Stripe statuses where a quantity update is meaningless or rejected: the
 * subscription is gone and a late quantity write must not resurrect it.
 */
const TERMINAL_STATUSES = new Set(["canceled", "incomplete_expired"]);

export type SeatReconcileSkipReason =
  | "no_subscription"
  | "no_stripe_subscription"
  | "subscription_ended"
  | "price_not_configured"
  | "not_per_device";

export type SeatReconcileResult =
  | { readonly status: "skipped"; readonly reason: SeatReconcileSkipReason }
  | { readonly status: "unchanged"; readonly quantity: number }
  | { readonly status: "updated"; readonly quantity: number; readonly previous: number };

export type ReconcileSeatsInput = {
  readonly db: EnterpriseDb;
  readonly stripe: EffectStripeClient;
  readonly organizationId: string;
  /** Price that the seat quantity applies to; omit to skip reconciliation. */
  readonly deviceMonthlyPriceId?: string;
  /** Deployment plan catalogue, used to cap the paid quantity. */
  readonly planLimits?: PlanLimitsConfig;
};

/**
 * Make Stripe's subscription quantity match the tenant's enrolled devices.
 *
 * Quantity changes never prorate (`proration_behavior: "none"`): a fleet that
 * enrols and retires devices throughout the month settles on the next
 * renewal instead of emitting a stream of credit notes. A no-op when nothing
 * changed, so it is safe to call after any device lifecycle change and in the
 * nightly sweep.
 */
export const reconcileSubscriptionQuantity = (input: ReconcileSeatsInput) =>
  Effect.gen(function* () {
    if (!input.deviceMonthlyPriceId)
      return { status: "skipped", reason: "price_not_configured" } as const;

    const [subscription] = yield* input.db
      .select()
      .from(schema.subscription)
      .where(eq(schema.subscription.referenceId, input.organizationId))
      .limit(1);

    if (!subscription) return { status: "skipped", reason: "no_subscription" } as const;

    if (!subscription.stripeSubscriptionId)
      return { status: "skipped", reason: "no_stripe_subscription" } as const;

    if (TERMINAL_STATUSES.has(subscription.status))
      return { status: "skipped", reason: "subscription_ended" } as const;

    const remote = yield* input.stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
    const item = remote.items?.data[0];

    if (!item?.id) return { status: "skipped", reason: "not_per_device" } as const;

    if (item.price?.id !== input.deviceMonthlyPriceId)
      return { status: "skipped", reason: "not_per_device" } as const;

    const plan = yield* planForOrganization({
      db: input.db,
      organizationId: input.organizationId,
      config: input.planLimits,
    });

    const limit = planLimitsFor(input.planLimits, plan).devices;
    const billable = yield* billableDeviceCount(input.db, input.organizationId);
    const quantity = limit === null ? billable : Math.min(billable, limit);

    if ((item.quantity ?? 0) === quantity) return { status: "unchanged", quantity } as const;

    yield* input.stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      items: [{ id: item.id, quantity }],
      proration_behavior: "none",
    });

    return { status: "updated", quantity, previous: item.quantity ?? 0 } as const;
  });

export type SubscriptionSweepResult = {
  /** Tenants with a Stripe subscription examined this run. */
  readonly checked: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly skipped: number;
  readonly failed: number;
  /** Stripe customer names brought back in line with the tenant name. */
  readonly customerNamesUpdated: number;
};

export type SubscriptionSweepInput = {
  readonly db: EnterpriseDb;
  readonly stripe: EffectStripeClient;
  readonly deviceMonthlyPriceId?: string;
  readonly planLimits?: PlanLimitsConfig;
  /** Tenants examined per run. Defaults to 1000. */
  readonly limit?: number;
};

const DEFAULT_SWEEP_LIMIT = 1_000;

/**
 * Nightly backstop for the seat quantity and the Stripe customer name.
 *
 * Unenrolment and deletion reconcile inline; this sweep catches everything the
 * request path cannot (a new enrolment, a device that stopped reporting, a
 * rename whose Stripe update failed, a subscription changed in the Stripe
 * dashboard). The tenant set is bounded and one tenant's Stripe failure never
 * stops the sweep; the failure count is reported.
 */
export const reconcileSubscriptionSweep = (input: SubscriptionSweepInput) =>
  Effect.gen(function* () {
    const result = {
      checked: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      failed: 0,
      customerNamesUpdated: 0,
    };

    const organizations = yield* input.db
      .select()
      .from(schema.organization)
      .where(isNotNull(schema.organization.stripeCustomerId))
      .orderBy(schema.organization.createdAt)
      .limit(Math.max(1, Math.floor(input.limit ?? DEFAULT_SWEEP_LIMIT)));

    for (const organization of organizations) {
      const outcome = yield* reconcileSubscriptionQuantity({
        db: input.db,
        stripe: input.stripe,
        organizationId: organization.id,
        deviceMonthlyPriceId: input.deviceMonthlyPriceId,
        planLimits: input.planLimits,
      }).pipe(Effect.exit);

      if (Exit.isFailure(outcome)) {
        result.failed += 1;
        yield* Effect.logWarning(
          `Billing seat reconciliation failed for ${organization.id}: ${String(outcome.cause)}`,
        );
        continue;
      }

      const value = outcome.value;

      if (value.status !== "skipped") result.checked += 1;

      if (value.status === "updated") result.updated += 1;
      else if (value.status === "unchanged") result.unchanged += 1;
      else result.skipped += 1;

      const renamed = yield* syncStripeCustomerName({
        db: input.db,
        stripe: input.stripe,
        organization,
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning(
            `Stripe customer name sync failed for ${organization.id}: ${String(cause)}`,
          ).pipe(Effect.as(false)),
        ),
      );

      if (renamed) result.customerNamesUpdated += 1;
    }

    return result;
  });

export type SyncCustomerNameInput = {
  readonly db: EnterpriseDb;
  readonly stripe: EffectStripeClient;
  readonly organization: Pick<EnterpriseOrganization, "id" | "name" | "stripeCustomerId">;
};

/**
 * Keep the Stripe customer name equal to the tenant name. A rename updates the
 * customer inline; this comparison is the sweep's retry so a Stripe outage does
 * not leave a stale name forever. Returns whether an update was sent.
 */
export const syncStripeCustomerName = (input: SyncCustomerNameInput) =>
  Effect.gen(function* () {
    if (!input.organization.stripeCustomerId) return false;

    const customer = yield* input.stripe.customers.retrieve(input.organization.stripeCustomerId);

    if (customer.name === input.organization.name) return false;

    yield* input.stripe.customers.update(input.organization.stripeCustomerId, {
      name: input.organization.name,
    });

    return true;
  });
