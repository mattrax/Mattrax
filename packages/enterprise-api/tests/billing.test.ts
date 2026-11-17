import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { Db } from "@mattrax/enterprise-core";
import { makeEffectStripeClient } from "@mattrax/effect-stripe";
import { EnterpriseStripeError, EnterpriseUnauthorized } from "@mattrax/enterprise-domain";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { reconcileSubscriptionQuantity } from "@mattrax/enterprise-billing";
import { runMaintenance } from "@mattrax/enterprise-backend";
import { makeDb, makeStripeClient, request, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";

const authSecret = "enterprise-test-secret";

const devicePrice = "price_device";

const now = new Date("2026-11-16T12:00:00.000Z");

type FakeStripe = {
  readonly client: any;
  readonly checkouts: Array<any>;
  readonly invoiceLists: Array<any>;
  readonly customerUpdates: Array<any>;
  readonly subscriptionUpdates: Array<any>;
};

/**
 * A Stripe double whose subscription quantity is mutable, so reconciliation can
 * be observed the way Stripe would see it.
 */
const makeFakeStripe = (options: { quantity?: number; customerName?: string } = {}): FakeStripe => {
  const state = { quantity: options.quantity ?? 0 };
  const checkouts: Array<any> = [];
  const invoiceLists: Array<any> = [];
  const customerUpdates: Array<any> = [];
  const subscriptionUpdates: Array<any> = [];

  const client = makeStripeClient({
    customers: {
      create: async ({ name }: { name?: string }) => ({ id: "cus_1", name: name ?? null }),
      retrieve: async (id: string) => ({ id, name: options.customerName ?? null }),
      update: async (id: string, params: any) => {
        customerUpdates.push({ id, params });

        return { id, name: params.name ?? null };
      },
    },
    checkout: {
      sessions: {
        create: async (params: any) => {
          checkouts.push(params);

          return { id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" };
        },
      },
    },
    invoices: {
      list: async (params: any) => {
        invoiceLists.push(params);

        return { data: [] };
      },
    },
    subscriptions: {
      retrieve: async (id: string) => ({
        id,
        status: "active",
        cancel_at_period_end: false,
        metadata: { organizationId: "org-1" },
        items: {
          data: [
            {
              id: "si_1",
              quantity: state.quantity,
              price: { id: devicePrice },
            },
          ],
        },
      }),
      update: async (id: string, params: any) => {
        subscriptionUpdates.push({ id, params });

        if (params.items?.[0]) state.quantity = params.items[0].quantity;

        return { id };
      },
    },
  });

  return { client, checkouts, invoiceLists, customerUpdates, subscriptionUpdates };
};

const makeContext = (
  options: {
    stripeClient?: any;
    deviceMonthlyPriceId?: string;
    planLimits?: any;
    db?: any;
  } = {},
) => {
  const db = options.db ?? makeDb();

  db.store.user.push({
    id: "user-1",
    name: "Owner",
    email: "owner@example.com",
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
  });
  db.store.organization.push({
    id: "org-1",
    name: "Acme",
    slug: "acme",
    stripeCustomerId: null,
    createdAt: now,
    updatedAt: now,
  });
  db.store.member.push({
    id: "member-1",
    organizationId: "org-1",
    userId: "user-1",
    role: "owner",
    createdAt: now,
    updatedAt: now,
  });

  const auth = {
    requireUser: (input: any) => {
      const headers = input instanceof Request ? Object.fromEntries(input.headers) : input.headers;

      return headers.cookie
        ? Effect.succeed({ user: db.store.user[0], apiToken: undefined })
        : Effect.fail(new EnterpriseUnauthorized({ message: "Unauthenticated" }));
    },
    listApiTokens: () => Effect.succeed({ tokens: [] }),
    createApiToken: () => Effect.die("not used"),
    revokeApiToken: () => Effect.succeed({ status: "ok" }),
    requestEmailChange: () => Effect.succeed({ status: "ok" }),
    requireStepUp: () => Effect.void,
    verifyEmailChange: () => Effect.succeed({ status: "ok" }),
  };

  const service = createEnterpriseService({
    db,
    schema,
    origin,
    stripeClient: options.stripeClient,
    deviceMonthlyPriceId: options.deviceMonthlyPriceId,
    // SAFETY: these tests never reach R2; the service stores the binding.
    storage: {} as any,
    // SAFETY: the fake only implements the auth methods these tests exercise.
    auth: auth as any,
    authSecret,
    planLimits: options.planLimits,
  });

  return { db, service, headers: { cookie: "mattrax_session=test" } };
};

const seedDevice = (db: any, id: string, status = "enrolled") =>
  db.store.device.push({
    id,
    organizationId: "org-1",
    proto: "apple",
    status,
    name: id,
    enrolledAt: now,
    lastSeenAt: now,
  });

const seedSubscription = (db: any, status = "active") =>
  db.store.subscription.push({
    id: "sub-row-1",
    plan: "device",
    referenceId: "org-1",
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_1",
    status,
    periodStart: now,
    periodEnd: now,
    cancelAtPeriodEnd: false,
    createdAt: now,
    updatedAt: now,
  });

describe("billing checkout", () => {
  it("creates a Checkout Session for the tenant with the fleet's seat count", async () => {
    const stripe = makeFakeStripe();

    const { db, service, headers } = makeContext({
      stripeClient: stripe.client,
      deviceMonthlyPriceId: devicePrice,
    });

    seedDevice(db, "device-1");
    seedDevice(db, "device-2");
    seedDevice(db, "device-3", "unenrolled");

    const result = await runEffect(
      service.billingCheckout(request(headers), "org-1", { trialDays: 14 }),
    );

    expect(result).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_test_1" });
    expect(stripe.checkouts).toHaveLength(1);

    const params = stripe.checkouts[0]!;

    expect(params).toMatchObject({
      mode: "subscription",
      customer: "cus_1",
      client_reference_id: "org-1",
      metadata: { organizationId: "org-1", plan: "device" },
      line_items: [{ price: devicePrice, quantity: 2 }],
      subscription_data: {
        metadata: { organizationId: "org-1", plan: "device" },
        trial_period_days: 14,
      },
    });
    expect(params.success_url).toBe(
      "https://enterprise.test/t/org-1/settings/billing?checkout=success",
    );
    expect(params.cancel_url).toBe(
      "https://enterprise.test/t/org-1/settings/billing?checkout=cancelled",
    );
    expect(db.store.organization[0]!.stripeCustomerId).toBe("cus_1");
    expect(db.store.audit_log.map((row: any) => row.action)).toContain("billing.checkout_started");
  });

  it("starts with one seat when no device is enrolled yet", async () => {
    const stripe = makeFakeStripe();

    const { service, headers } = makeContext({
      stripeClient: stripe.client,
      deviceMonthlyPriceId: devicePrice,
    });

    await runEffect(service.billingCheckout(request(headers), "org-1", {}));

    expect(stripe.checkouts[0]!.line_items).toEqual([{ price: devicePrice, quantity: 1 }]);
    expect(stripe.checkouts[0]!.subscription_data).toEqual({
      metadata: { organizationId: "org-1", plan: "device" },
    });
  });

  it("reports missing Stripe configuration as a typed product error", async () => {
    const withoutStripe = makeContext({ deviceMonthlyPriceId: devicePrice });
    await expect(
      runEffect(withoutStripe.service.billingCheckout(request(withoutStripe.headers), "org-1", {})),
    ).rejects.toBeInstanceOf(EnterpriseStripeError);

    const stripe = makeFakeStripe();
    const withoutPrice = makeContext({ stripeClient: stripe.client });
    await expect(
      runEffect(withoutPrice.service.billingCheckout(request(withoutPrice.headers), "org-1", {})),
    ).rejects.toBeInstanceOf(EnterpriseStripeError);
    expect(stripe.checkouts).toHaveLength(0);
  });

  it("rejects a Checkout URL that is not HTTPS", async () => {
    const stripe = makeFakeStripe();
    stripe.client.checkout.sessions.create = async () => ({
      id: "cs_bad",
      url: "http://checkout.example.test/cs_bad",
    });

    const { service, headers } = makeContext({
      stripeClient: stripe.client,
      deviceMonthlyPriceId: devicePrice,
    });

    await expect(
      runEffect(service.billingCheckout(request(headers), "org-1", {})),
    ).rejects.toBeInstanceOf(EnterpriseStripeError);
  });
});

describe("billing portal redirects", () => {
  it("ignores a return URL outside ORIGIN", async () => {
    const stripe = makeFakeStripe();

    const { service, headers } = makeContext({ stripeClient: stripe.client });

    // The fake echoes `return_url`, so the result shows what was sent to Stripe.
    const result = await runEffect(
      service.billingPortal(request(headers), "org-1", {
        returnUrl: "https://evil.example.test/steal",
      }),
    );

    expect(result.url).toBe("https://enterprise.test/t/org-1/settings/billing");
  });

  it("keeps a same-origin return URL", async () => {
    const stripe = makeFakeStripe();

    const { service, headers } = makeContext({ stripeClient: stripe.client });

    const result = await runEffect(
      service.billingPortal(request(headers), "org-1", {
        returnUrl: "https://enterprise.test/t/org-1/settings/billing?from=portal",
      }),
    );

    expect(result.url).toBe("https://enterprise.test/t/org-1/settings/billing?from=portal");
  });
});

describe("billing invoices", () => {
  const invoice = (overrides = {}) => ({
    id: "in_1",
    number: "ACME-0001",
    status: "paid",
    total: 2500,
    amount_due: 0,
    amount_paid: 2500,
    currency: "usd",
    created: 1_761_292_800,
    period_start: 1_761_292_800,
    period_end: 1_764_000_000,
    hosted_invoice_url: "https://invoice.stripe.com/i/in_1",
    invoice_pdf: "https://pay.stripe.com/invoice/in_1/pdf",
    ...overrides,
  });

  it("lists invoices for the tenant's Stripe customer", async () => {
    const stripe = makeFakeStripe();
    stripe.client.invoices.list = async (params: any) => {
      stripe.invoiceLists.push(params);

      return {
        data: [
          invoice(),
          invoice({
            id: "in_2",
            number: null,
            status: "open",
            total: 900,
            amount_due: 900,
            amount_paid: 0,
            hosted_invoice_url: null,
            invoice_pdf: null,
          }),
        ],
      };
    };

    const { db, service, headers } = makeContext({ stripeClient: stripe.client });
    db.store.organization[0]!.stripeCustomerId = "cus_1";

    const result = await runEffect(service.billingInvoices(request(headers), "org-1"));

    expect(stripe.invoiceLists).toEqual([{ customer: "cus_1", limit: 24 }]);
    expect(result.invoices).toHaveLength(2);
    expect(result.invoices[0]).toEqual({
      id: "in_1",
      number: "ACME-0001",
      status: "paid",
      total: 2500,
      amountDue: 0,
      amountPaid: 2500,
      currency: "usd",
      createdAt: new Date(1_761_292_800 * 1000).toISOString(),
      periodStart: new Date(1_761_292_800 * 1000).toISOString(),
      periodEnd: new Date(1_764_000_000 * 1000).toISOString(),
      hostedInvoiceUrl: "https://invoice.stripe.com/i/in_1",
      pdfUrl: "https://pay.stripe.com/invoice/in_1/pdf",
    });
    expect(result.invoices[1]).toMatchObject({
      number: null,
      status: "open",
      hostedInvoiceUrl: null,
      pdfUrl: null,
    });
  });

  it("returns no invoices without asking Stripe for an unknown customer", async () => {
    const stripe = makeFakeStripe();

    const { service, headers } = makeContext({ stripeClient: stripe.client });

    await expect(runEffect(service.billingInvoices(request(headers), "org-1"))).resolves.toEqual({
      invoices: [],
    });
    expect(stripe.invoiceLists).toHaveLength(0);
  });

  it("reports missing configuration as a typed product error", async () => {
    const { service, headers } = makeContext();

    await expect(
      runEffect(service.billingInvoices(request(headers), "org-1")),
    ).rejects.toBeInstanceOf(EnterpriseStripeError);
  });
});

describe("Stripe customer rename", () => {
  it("renames the Stripe customer when the tenant is renamed", async () => {
    const stripe = makeFakeStripe();

    const { db, service, headers } = makeContext({ stripeClient: stripe.client });
    db.store.organization[0]!.stripeCustomerId = "cus_1";

    await runEffect(service.patchTenant(request(headers), "org-1", { name: "Acme Holdings" }));

    expect(db.store.organization[0]!.name).toBe("Acme Holdings");
    expect(stripe.customerUpdates).toEqual([{ id: "cus_1", params: { name: "Acme Holdings" } }]);
  });

  it("does not fail a rename when Stripe is unavailable", async () => {
    const stripe = makeFakeStripe();
    stripe.client.customers.update = async () => {
      throw new Error("stripe is down");
    };

    const { db, service, headers } = makeContext({ stripeClient: stripe.client });
    db.store.organization[0]!.stripeCustomerId = "cus_1";

    await expect(
      runEffect(service.patchTenant(request(headers), "org-1", { name: "Acme Holdings" })),
    ).resolves.toEqual({ status: "ok" });
    expect(db.store.organization[0]!.name).toBe("Acme Holdings");
  });
});

describe("seat reconciliation", () => {
  const reconcile = (db: any, stripe: FakeStripe, planLimits?: any) =>
    runEffect(
      reconcileSubscriptionQuantity({
        db,
        stripe: makeEffectStripeClient(stripe.client),
        organizationId: "org-1",
        deviceMonthlyPriceId: devicePrice,
        planLimits,
      }),
    );

  it("raises the quantity when devices enrol", async () => {
    const stripe = makeFakeStripe({ quantity: 1 });
    const { db } = makeContext({ stripeClient: stripe.client });
    seedSubscription(db);
    seedDevice(db, "device-1");
    seedDevice(db, "device-2");

    await expect(reconcile(db, stripe)).resolves.toEqual({
      status: "updated",
      quantity: 2,
      previous: 1,
    });
    expect(stripe.subscriptionUpdates).toEqual([
      {
        id: "sub_1",
        params: {
          items: [{ id: "si_1", quantity: 2 }],
          proration_behavior: "none",
        },
      },
    ]);
  });

  it("lowers the quantity when a device is unenrolled", async () => {
    const stripe = makeFakeStripe({ quantity: 2 });

    const { db, service, headers } = makeContext({
      stripeClient: stripe.client,
      deviceMonthlyPriceId: devicePrice,
    });

    seedSubscription(db);
    seedDevice(db, "device-1");
    seedDevice(db, "device-2");

    await runEffect(service.deviceUnenroll(request(headers), "org-1", "device-2"));

    expect(db.store.device.find((row: any) => row.id === "device-2")?.status).toBe("unenrolling");
    expect(stripe.subscriptionUpdates).toEqual([
      {
        id: "sub_1",
        params: {
          items: [{ id: "si_1", quantity: 1 }],
          proration_behavior: "none",
        },
      },
    ]);
  });

  it("caps the paid quantity at the plan's device limit", async () => {
    const stripe = makeFakeStripe({ quantity: 0 });

    const planLimits = {
      configured: true,
      defaultPlan: "device",
      plans: { device: { devices: 2, tenants: null } },
      warnings: [],
    };

    const { db } = makeContext({ stripeClient: stripe.client });

    seedSubscription(db);
    seedDevice(db, "device-1");
    seedDevice(db, "device-2");
    seedDevice(db, "device-3");

    await expect(reconcile(db, stripe, planLimits)).resolves.toMatchObject({ quantity: 2 });
  });

  it("leaves a subscription alone when it is not the per-device price", async () => {
    const stripe = makeFakeStripe({ quantity: 1 });
    stripe.client.subscriptions.retrieve = async (id: string) => ({
      id,
      status: "active",
      items: { data: [{ id: "si_1", quantity: 1, price: { id: "price_flat" } }] },
    });
    const { db } = makeContext({ stripeClient: stripe.client });
    seedSubscription(db);
    seedDevice(db, "device-1");

    await expect(reconcile(db, stripe)).resolves.toEqual({
      status: "skipped",
      reason: "not_per_device",
    });
    expect(stripe.subscriptionUpdates).toHaveLength(0);
  });

  it("skips a canceled subscription so a late write cannot resurrect it", async () => {
    const stripe = makeFakeStripe({ quantity: 1 });
    const { db } = makeContext({ stripeClient: stripe.client });
    seedSubscription(db, "canceled");
    seedDevice(db, "device-1");

    await expect(reconcile(db, stripe)).resolves.toEqual({
      status: "skipped",
      reason: "subscription_ended",
    });
    expect(stripe.subscriptionUpdates).toHaveLength(0);
  });

  it("sweeps every tenant from maintenance and retries the customer name", async () => {
    const stripe = makeFakeStripe({ quantity: 1, customerName: "Acme (old)" });
    const { db } = makeContext({ stripeClient: stripe.client });
    db.store.organization[0]!.stripeCustomerId = "cus_1";
    seedSubscription(db);
    seedDevice(db, "device-1");
    seedDevice(db, "device-2");
    seedDevice(db, "device-3");

    const result = await runEffect(
      runMaintenance({
        now,
        auditRetentionDays: 0,
        credentialAlerts: false,
        dynamicGroups: false,
        applicationInventory: false,
        webhookRetry: false,
        billing: {
          stripe: makeEffectStripeClient(stripe.client),
          deviceMonthlyPriceId: devicePrice,
        },
      }).pipe(Effect.provideService(Db, db)),
    );

    expect(result.billingSeatsUpdated).toBe(1);
    expect(result.billingSeatsFailed).toBe(0);
    expect(result.billingCustomerNamesUpdated).toBe(1);
    expect(stripe.subscriptionUpdates[0]!.params.items).toEqual([{ id: "si_1", quantity: 3 }]);
    expect(stripe.customerUpdates).toEqual([{ id: "cus_1", params: { name: "Acme" } }]);
  });
});
