import { describe, expect, it } from "vitest";
import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { Db } from "@mattrax/enterprise-core";
import { StripeClient } from "@mattrax/effect-stripe";
import { billingWebhookRoutes, processStripeWebhook } from "../src/billingWebhook.js";
import { makeDb, runEffect } from "./helpers.js";

const webhookSecret = "whsec_test_secret";
const devicePrice = "price_device";
const now = new Date("2026-01-01T00:00:00.000Z");
const periodStart = 1_767_225_600;
const periodEnd = 1_769_817_600;

const seedOrganization = (
  db: ReturnType<typeof makeDb>,
  id: string,
  stripeCustomerId: string | null = null,
) => {
  db.store.organization.push({
    id,
    name: id,
    slug: id,
    stripeCustomerId,
    createdAt: now,
    updatedAt: now,
  });
};

const subscription = (overrides: Record<string, unknown> = {}) => ({
  id: "sub_1",
  object: "subscription",
  customer: "cus_1",
  status: "active",
  metadata: { organizationId: "org-1" },
  current_period_start: periodStart,
  current_period_end: periodEnd,
  cancel_at_period_end: false,
  items: {
    data: [
      {
        price: { id: devicePrice },
        current_period_start: periodStart,
        current_period_end: periodEnd,
      },
    ],
  },
  ...overrides,
});

const event = (type: string, object: unknown) => ({
  id: `evt_${type.replaceAll(".", "_")}`,
  object: "event",
  api_version: "2026-01-01",
  created: periodStart,
  type,
  data: { object },
});

const signed = (payload: string, secret = webhookSecret) => ({
  payload,
  signature: StripeClient.webhooks.generateTestHeaderString({ payload, secret }),
});

const deliver = (
  db: ReturnType<typeof makeDb>,
  payload: string,
  overrides: Partial<Parameters<typeof processStripeWebhook>[0]> = {},
) => {
  const { signature } = signed(payload);
  return runEffect(
    processStripeWebhook({
      db: db as any,
      payload,
      signature,
      webhookSecret,
      deviceMonthlyPriceId: devicePrice,
      now,
      ...overrides,
    }),
  );
};

const deliverEvent = (
  db: ReturnType<typeof makeDb>,
  type: string,
  object: unknown,
  overrides: Partial<Parameters<typeof processStripeWebhook>[0]> = {},
) => deliver(db, JSON.stringify(event(type, object)), overrides);

describe("Stripe webhook signature verification", () => {
  it("accepts a valid signature and applies the event", async () => {
    const db = makeDb();
    seedOrganization(db, "org-1", "cus_1");

    await expect(
      deliverEvent(db, "customer.subscription.created", subscription()),
    ).resolves.toMatchObject({ organizationId: "org-1", stripeSubscriptionId: "sub_1" });
    expect(db.store.subscription).toHaveLength(1);
  });

  it("rejects a missing signature", async () => {
    const db = makeDb();
    seedOrganization(db, "org-1", "cus_1");
    const payload = JSON.stringify(event("customer.subscription.created", subscription()));

    await expect(
      runEffect(
        processStripeWebhook({
          db: db as any,
          payload,
          signature: null,
          webhookSecret,
          deviceMonthlyPriceId: devicePrice,
          now,
        }),
      ),
    ).rejects.toMatchObject({ _tag: "BillingWebhookError", statusCode: 400 });
    expect(db.store.subscription).toHaveLength(0);
  });

  it("rejects an invalid signature", async () => {
    const db = makeDb();
    seedOrganization(db, "org-1", "cus_1");
    const payload = JSON.stringify(event("customer.subscription.created", subscription()));

    await expect(
      runEffect(
        processStripeWebhook({
          db: db as any,
          payload,
          signature: "t=1,v1=deadbeef",
          webhookSecret,
          deviceMonthlyPriceId: devicePrice,
          now,
        }),
      ),
    ).rejects.toMatchObject({ _tag: "BillingWebhookError", statusCode: 400 });
    expect(db.store.subscription).toHaveLength(0);
  });

  it("rejects a payload that changed after signing", async () => {
    const db = makeDb();
    seedOrganization(db, "org-1", "cus_1");
    const payload = JSON.stringify(event("customer.subscription.created", subscription()));
    const signature = signed(payload).signature;
    const tampered = payload.replace('"status":"active"', '"status":"canceled"');

    await expect(
      runEffect(
        processStripeWebhook({
          db: db as any,
          payload: tampered,
          signature,
          webhookSecret,
          deviceMonthlyPriceId: devicePrice,
          now,
        }),
      ),
    ).rejects.toMatchObject({ _tag: "BillingWebhookError", statusCode: 400 });
    expect(db.store.subscription).toHaveLength(0);
  });

  it("reports unconfigured billing instead of crashing", async () => {
    const db = makeDb();
    seedOrganization(db, "org-1", "cus_1");
    const payload = JSON.stringify(event("customer.subscription.created", subscription()));

    await expect(
      runEffect(
        processStripeWebhook({
          db: db as any,
          payload,
          signature: signed(payload, "whsec_other").signature,
          webhookSecret: undefined,
          deviceMonthlyPriceId: devicePrice,
          now,
        }),
      ),
    ).rejects.toMatchObject({ _tag: "BillingWebhookError", statusCode: 503 });
  });
});

describe("Stripe subscription lifecycle", () => {
  it("inserts a subscription from customer.subscription.created", async () => {
    const db = makeDb();
    seedOrganization(db, "org-1", "cus_1");

    await deliverEvent(db, "customer.subscription.created", subscription());

    expect(db.store.subscription).toMatchObject([
      {
        plan: "device",
        referenceId: "org-1",
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_1",
        status: "active",
        periodStart: new Date(periodStart * 1000),
        periodEnd: new Date(periodEnd * 1000),
        cancelAtPeriodEnd: false,
        createdAt: now,
        updatedAt: now,
      },
    ]);
  });

  it("updates the same row on customer.subscription.updated and replay", async () => {
    const db = makeDb();
    seedOrganization(db, "org-1", "cus_1");

    await deliverEvent(db, "customer.subscription.created", subscription());
    const createdAt = db.store.subscription[0]!.createdAt;

    const updated = subscription({
      status: "past_due",
      cancel_at_period_end: true,
      current_period_end: periodEnd + 86_400,
      items: {
        data: [
          {
            price: { id: devicePrice },
            current_period_start: periodStart,
            current_period_end: periodEnd + 86_400,
          },
        ],
      },
    });
    await deliverEvent(db, "customer.subscription.updated", updated);
    // Stripe retries events; applying the same payload twice must be a no-op
    // for row identity and deterministic fields.
    await deliverEvent(db, "customer.subscription.updated", updated);

    expect(db.store.subscription).toHaveLength(1);
    expect(db.store.subscription[0]).toMatchObject({
      status: "past_due",
      cancelAtPeriodEnd: true,
      periodEnd: new Date((periodEnd + 86_400) * 1000),
      createdAt,
    });
  });

  it("marks deletions canceled without removing history", async () => {
    const db = makeDb();
    seedOrganization(db, "org-1", "cus_1");

    await deliverEvent(db, "customer.subscription.created", subscription());
    await deliverEvent(db, "customer.subscription.deleted", subscription({ status: "canceled" }));

    expect(db.store.subscription).toHaveLength(1);
    expect(db.store.subscription[0]).toMatchObject({
      stripeSubscriptionId: "sub_1",
      status: "canceled",
    });
  });

  it("maps invoices paid and failed onto the existing subscription", async () => {
    const db = makeDb();
    seedOrganization(db, "org-1", "cus_1");
    db.store.subscription.push({
      id: "local-sub",
      plan: "device",
      referenceId: "org-1",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      status: "past_due",
      cancelAtPeriodEnd: false,
      createdAt: now,
      updatedAt: now,
    });
    const invoice = {
      id: "in_1",
      object: "invoice",
      customer: "cus_1",
      subscription: "sub_1",
      status: "paid",
    };

    await deliverEvent(db, "invoice.paid", invoice);
    expect(db.store.subscription[0]).toMatchObject({ status: "active" });

    await deliverEvent(db, "invoice.payment_failed", { ...invoice, status: "open" });
    expect(db.store.subscription[0]).toMatchObject({ status: "past_due" });
    expect(db.store.subscription).toHaveLength(1);
  });

  it("does not resurrect a canceled subscription from a late paid invoice", async () => {
    const db = makeDb();
    seedOrganization(db, "org-1", "cus_1");
    db.store.subscription.push({
      id: "local-sub",
      plan: "device",
      referenceId: "org-1",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      status: "canceled",
      cancelAtPeriodEnd: false,
      createdAt: now,
      updatedAt: now,
    });

    await deliverEvent(db, "invoice.paid", {
      id: "in_1",
      object: "invoice",
      customer: "cus_1",
      subscription: "sub_1",
      status: "paid",
    });

    expect(db.store.subscription[0]).toMatchObject({ status: "canceled" });
  });

  it("ignores unrelated event types", async () => {
    const db = makeDb();
    seedOrganization(db, "org-1", "cus_1");

    await expect(
      deliverEvent(db, "customer.created", { id: "cus_1", object: "customer" }),
    ).resolves.toEqual({ ignored: true });
  });
});

describe("Stripe webhook tenant resolution", () => {
  it("rejects an unknown organization metadata id", async () => {
    const db = makeDb();

    await expect(
      deliverEvent(
        db,
        "customer.subscription.created",
        subscription({ metadata: { organizationId: "missing-org" } }),
      ),
    ).rejects.toMatchObject({ _tag: "BillingWebhookError", statusCode: 400 });
    expect(db.store.subscription).toHaveLength(0);
  });

  it("rejects an unknown Stripe customer", async () => {
    const db = makeDb();

    await expect(
      deliverEvent(
        db,
        "customer.subscription.created",
        subscription({ metadata: {}, customer: "cus_unknown" }),
      ),
    ).rejects.toMatchObject({ _tag: "BillingWebhookError", statusCode: 400 });
    expect(db.store.subscription).toHaveLength(0);
  });

  it("rejects metadata and customer that map to different organizations", async () => {
    const db = makeDb();
    seedOrganization(db, "org-1", "cus_1");
    seedOrganization(db, "org-2", "cus_2");

    await expect(
      deliverEvent(
        db,
        "customer.subscription.created",
        subscription({ metadata: { organizationId: "org-1" }, customer: "cus_2" }),
      ),
    ).rejects.toMatchObject({ _tag: "BillingWebhookError", statusCode: 400 });
    expect(db.store.subscription).toHaveLength(0);
  });

  it("rejects a subscription id that already belongs to another tenant", async () => {
    const db = makeDb();
    seedOrganization(db, "org-1", "cus_1");
    seedOrganization(db, "org-2", "cus_2");
    db.store.subscription.push({
      id: "local-org-2",
      plan: "device",
      referenceId: "org-2",
      stripeCustomerId: "cus_2",
      stripeSubscriptionId: "sub_2",
      status: "active",
      cancelAtPeriodEnd: false,
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      deliverEvent(
        db,
        "customer.subscription.updated",
        subscription({
          id: "sub_2",
          customer: "cus_1",
          metadata: { organizationId: "org-1" },
        }),
      ),
    ).rejects.toMatchObject({ _tag: "BillingWebhookError", statusCode: 400 });
    expect(db.store.subscription).toHaveLength(1);
    expect(db.store.subscription[0]).toMatchObject({
      referenceId: "org-2",
      status: "active",
    });
  });

  it("keeps tenants isolated when two organizations both have subscriptions", async () => {
    const db = makeDb();
    seedOrganization(db, "org-1", "cus_1");
    seedOrganization(db, "org-2", "cus_2");
    db.store.subscription.push({
      id: "local-org-1",
      plan: "device",
      referenceId: "org-1",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      status: "active",
      cancelAtPeriodEnd: false,
      createdAt: now,
      updatedAt: now,
    });

    await deliverEvent(
      db,
      "customer.subscription.created",
      subscription({
        id: "sub_2",
        customer: "cus_2",
        metadata: { organizationId: "org-2" },
      }),
    );

    expect(db.store.subscription).toHaveLength(2);
    expect(db.store.subscription.find((row: any) => row.referenceId === "org-1")).toMatchObject({
      stripeSubscriptionId: "sub_1",
      status: "active",
    });
    expect(db.store.subscription.find((row: any) => row.referenceId === "org-2")).toMatchObject({
      stripeSubscriptionId: "sub_2",
      status: "active",
    });
  });
});

describe("POST /api/v1/billing/webhook", () => {
  const makeHandler = (
    db: ReturnType<typeof makeDb>,
    config: { webhookSecret?: string; deviceMonthlyPriceId?: string } = {
      webhookSecret,
      deviceMonthlyPriceId: devicePrice,
    },
  ) =>
    HttpRouter.toWebHandler(
      billingWebhookRoutes(config).pipe(Layer.provideMerge(Layer.succeed(Db, db as any))),
    ).handler;

  it("accepts a signed event and returns 200", async () => {
    const db = makeDb();
    seedOrganization(db, "org-1", "cus_1");
    const payload = JSON.stringify(event("customer.subscription.created", subscription()));

    const response = await makeHandler(db)(
      new Request("http://localhost/api/v1/billing/webhook", {
        method: "POST",
        headers: {
          "stripe-signature": signed(payload).signature,
          "content-type": "application/json",
        },
        body: payload,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
    expect(db.store.subscription).toHaveLength(1);
  });

  it("returns 400 for a missing signature", async () => {
    const db = makeDb();
    seedOrganization(db, "org-1", "cus_1");
    const payload = JSON.stringify(event("customer.subscription.created", subscription()));

    const response = await makeHandler(db)(
      new Request("http://localhost/api/v1/billing/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
      }),
    );

    expect(response.status).toBe(400);
    expect(db.store.subscription).toHaveLength(0);
  });

  it("returns 503 when the webhook secret is not configured", async () => {
    const db = makeDb();
    const payload = JSON.stringify(event("customer.subscription.created", subscription()));

    const response = await makeHandler(db, { deviceMonthlyPriceId: devicePrice })(
      new Request("http://localhost/api/v1/billing/webhook", {
        method: "POST",
        headers: {
          "stripe-signature": signed(payload).signature,
          "content-type": "application/json",
        },
        body: payload,
      }),
    );

    expect(response.status).toBe(503);
  });
});
