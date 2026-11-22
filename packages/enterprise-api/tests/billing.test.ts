import { describe, expect, it } from "vitest";
import { makeEffectStripeClient } from "@mattrax/effect-stripe";
import { makeStripeBillingService } from "@mattrax/enterprise-billing";
import { parsePlanLimits } from "@mattrax/enterprise-core";
import { makeServicesDb, runEffect } from "../../enterprise-backend/tests/helpers.js";
import { makeStripeClient } from "./helpers.js";

const origin = "https://enterprise.test";
const devicePrice = "price_device";
const now = new Date("2026-11-16T12:00:00.000Z");

const seed = (db: ReturnType<typeof makeServicesDb>) => {
  db.store.services_tenant.push({
    id: "org-1",
    name: "Acme",
    stripeCustomerId: "cus_1",
    entitlementSyncedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  db.store.services_subscription.push({
    id: "sub-row-1",
    plan: "device",
    tenantId: "org-1",
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_1",
    status: "active",
    periodStart: now,
    periodEnd: now,
    cancelAtPeriodEnd: false,
    createdAt: now,
    updatedAt: now,
  });
};

const usage = (deviceCount: number, devicesUsed = deviceCount) => ({
  organizationId: "org-1",
  deviceCount,
  devicesUsed,
  tenantCount: 1,
});

describe("hosted billing service", () => {
  it("summarizes the stored subscription with reported usage and plan limits", async () => {
    const db = makeServicesDb();
    seed(db);

    const service = makeStripeBillingService({
      db,
      origin,
      stripe: makeEffectStripeClient(makeStripeClient() as any),
      deviceMonthlyPriceId: devicePrice,
      planLimits: parsePlanLimits(JSON.stringify({ device: { devices: 5, tenants: 3 } })),
    });

    const summary = await runEffect(
      service.summary({
        organizationId: "org-1",
        accountId: "account-1",
        organization: { id: "org-1", name: "Acme" },
        usage: usage(2, 3),
      }),
    );

    expect(summary).toMatchObject({
      plan: "device",
      status: "active",
      billableDevices: 2,
      deviceLimit: 5,
      tenantLimit: 3,
      devicesUsed: 3,
      tenantsUsed: 1,
      overDeviceLimit: false,
      overTenantLimit: false,
      limitsConfigured: true,
      subscriptionId: "sub_1",
      configured: true,
    });
    expect(db.store.services_tenant_usage[0]).toMatchObject({
      tenantId: "org-1",
      billableDevices: 2,
      devicesUsed: 3,
    });
  });

  it("creates a Checkout Session with the reported seat count and tenant metadata", async () => {
    const checkouts: any[] = [];
    const stripe = makeStripeClient();
    stripe.checkout.sessions.create = async (params: any) => {
      checkouts.push(params);

      return { id: "cs_1", url: "https://checkout.stripe.test/cs_1" };
    };

    const db = makeServicesDb();
    db.store.services_tenant.push({
      id: "org-2",
      name: "New Co",
      stripeCustomerId: null,
      entitlementSyncedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const service = makeStripeBillingService({
      db,
      origin,
      stripe: makeEffectStripeClient(stripe as any),
      deviceMonthlyPriceId: devicePrice,
    });

    await expect(
      runEffect(
        service.checkout({
          tenantId: "org-2",
          organization: { id: "org-2", name: "New Co" },
          request: { trialDays: 14 },
          usage: { organizationId: "org-2", deviceCount: 2, tenantCount: 1 },
        }),
      ),
    ).resolves.toEqual({ url: "https://checkout.stripe.test/cs_1", quantity: 2 });

    expect(checkouts[0]).toMatchObject({
      mode: "subscription",
      customer: "cus_created",
      client_reference_id: "org-2",
      metadata: { organizationId: "org-2", organizationName: "New Co", plan: "device" },
      line_items: [{ price: devicePrice, quantity: 2 }],
      subscription_data: {
        metadata: { organizationId: "org-2", organizationName: "New Co", plan: "device" },
        trial_period_days: 14,
      },
    });
    expect(db.store.services_tenant[0]!.stripeCustomerId).toBe("cus_created");
  });

  it("reports usage and reconciles the subscription quantity", async () => {
    const updates: any[] = [];
    let quantity = 1;

    const stripe = makeStripeClient();
    stripe.subscriptions.retrieve = async (id: string) => ({
      id,
      status: "active",
      items: { data: [{ id: "si_1", quantity, price: { id: devicePrice } }] },
    });
    stripe.subscriptions.update = async (id: string, params: any) => {
      updates.push({ id, params });
      quantity = params.items[0].quantity;

      return { id };
    };

    const db = makeServicesDb();
    seed(db);

    const service = makeStripeBillingService({
      db,
      origin,
      stripe: makeEffectStripeClient(stripe as any),
      deviceMonthlyPriceId: devicePrice,
    });

    await runEffect(service.reportUsage(usage(3)));

    expect(db.store.services_tenant_usage[0]).toMatchObject({ billableDevices: 3 });
    expect(updates).toEqual([
      { id: "sub_1", params: { items: [{ id: "si_1", quantity: 3 }], proration_behavior: "none" } },
    ]);
  });

  it("cancels a tenant subscription and reports a missing one", async () => {
    const db = makeServicesDb();
    seed(db);

    const service = makeStripeBillingService({
      db,
      origin,
      stripe: makeEffectStripeClient(makeStripeClient() as any),
    });

    await expect(runEffect(service.cancelTenant({ tenantId: "org-1" }))).resolves.toBe("cancelled");
    await expect(runEffect(service.cancelTenant({ tenantId: "missing" }))).resolves.toBe("none");
  });
});
