import { createHmac } from "node:crypto";
import { Effect, Layer, ManagedRuntime } from "effect";
import { MysqlClient } from "@effect/sql-mysql2";
import { HttpRouter } from "effect/http";
import type { RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Db } from "@mattrax/enterprise-core";
import {
  BillingWebhookError,
  processStripeWebhook,
  ServicesDbService,
} from "@mattrax/enterprise-billing";
import { applyBillingEntitlement, billingEntitlementRoutes } from "../src/billingEntitlement.ts";
import { effectMysqlOptions, startMysqlFixture } from "./mysql.ts";
import type { MysqlFixture } from "./mysql.ts";

const webhookSecret = "whsec_disposable_mysql";
const token = "services-disposable-token";
const now = new Date("2026-01-01T00:00:00.000Z");

const subscription = (id: string, status = "active") => ({
  id,
  object: "subscription",
  customer: "cus_1",
  status,
  metadata: { organizationId: "org-1", plan: "device" },
  cancel_at_period_end: false,
  items: { data: [{ price: { id: "price_device" } }] },
});

const event = (id: string, type: string, object: unknown) => ({
  id,
  object: "event",
  api_version: "2026-01-01",
  created: Math.floor(Date.now() / 1000),
  type,
  data: { object },
});

const signed = (value: unknown) => {
  const payload = JSON.stringify(value);
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac("sha256", webhookSecret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");

  return { payload, signature: `t=${timestamp},v1=${digest}` };
};

const deliver = (db: any, id: string, type: string, object: unknown) => {
  const { payload, signature } = signed(event(id, type, object));

  return Effect.runPromise(
    processStripeWebhook({
      db,
      payload,
      signature,
      webhookSecret,
      deviceMonthlyPriceId: "price_device",
      now,
    }),
  );
};

describe.skipIf(!process.env.TEST_MYSQL_URL)("billing races on disposable MySQL", () => {
  let fixture: MysqlFixture;
  let runtime: ManagedRuntime.ManagedRuntime<Db | ServicesDbService, never>;

  beforeAll(async () => {
    fixture = (await startMysqlFixture())!;
    const database = MysqlClient.layer(effectMysqlOptions(fixture.connection));
    runtime = ManagedRuntime.make(
      Layer.mergeAll(Db.layer, ServicesDbService.layer).pipe(Layer.provide(database), Layer.orDie),
    );
  });

  beforeEach(async () => {
    await fixture.query("DELETE FROM organization");
    await fixture.query("DELETE FROM services_stripe_event");
    await fixture.query("DELETE FROM services_subscription");
    await fixture.query("DELETE FROM services_tenant");
  });

  afterAll(async () => {
    await runtime?.dispose();
    await fixture?.dispose();
  });

  const seedSubscription = async (
    stripeSubscriptionId = "sub_1",
    status = "active",
    revision = 0,
  ) => {
    await fixture.query(
      "INSERT INTO services_tenant (id, name, stripe_customer_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ["org-1", "Acme", "cus_1", now, now],
    );
    await fixture.query(
      "INSERT INTO services_subscription (id, plan, tenant_id, stripe_customer_id, stripe_subscription_id, status, entitlement_revision, cancel_at_period_end, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        "local-sub",
        "device",
        "org-1",
        "cus_1",
        stripeSubscriptionId,
        status,
        revision,
        false,
        now,
        now,
      ],
    );
  };

  it("uses affected rows to reject delayed and equal entitlement revisions", async () => {
    const db = await runtime.runPromise(Db);
    await fixture.query(
      "INSERT INTO organization (id, billing_plan, billing_status, billing_entitlement_revision, updated_at) VALUES (?, ?, ?, ?, ?)",
      ["org-1", "device", "active", 2, now],
    );

    const newer = await runtime.runPromise(
      applyBillingEntitlement(db, {
        organizationId: "org-1",
        plan: "device",
        status: "canceled",
        revision: 3,
      }),
    );
    const stale = await runtime.runPromise(
      applyBillingEntitlement(db, {
        organizationId: "org-1",
        plan: "device",
        status: "active",
        revision: 1,
      }),
    );
    const equal = await runtime.runPromise(
      applyBillingEntitlement(db, {
        organizationId: "org-1",
        plan: "device",
        status: "active",
        revision: 3,
      }),
    );

    const handler = HttpRouter.toWebHandler(
      billingEntitlementRoutes({ token }).pipe(Layer.provideMerge(Layer.succeed(Db, db))),
    ).handler;
    const post = (revision: number, status: string) =>
      handler(
        new Request("http://localhost/api/internal/billing/entitlement", {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ organizationId: "org-1", plan: "device", status, revision }),
        }),
      );

    const [afterNewer] = await fixture.query<RowDataPacket[]>(
      "SELECT billing_status, billing_entitlement_revision, updated_at FROM organization WHERE id = ?",
      ["org-1"],
    );
    expect((await post(1, "active")).status).toBe(204);
    expect((await post(3, "active")).status).toBe(204);
    const [afterStale] = await fixture.query<RowDataPacket[]>(
      "SELECT billing_status, billing_entitlement_revision, updated_at FROM organization WHERE id = ?",
      ["org-1"],
    );

    expect([newer.affectedRows, stale.affectedRows, equal.affectedRows]).toEqual([1, 0, 0]);
    expect(afterStale).toMatchObject({
      billing_status: "canceled",
      billing_entitlement_revision: 3,
    });
    expect(new Date(afterStale.updated_at).getTime()).toBe(
      new Date(afterNewer.updated_at).getTime(),
    );
  });

  it("cannot restore paid state when stale and canceled pushes overlap", async () => {
    const db = await runtime.runPromise(Db);
    await fixture.query(
      "INSERT INTO organization (id, billing_plan, billing_status, billing_entitlement_revision, updated_at) VALUES (?, ?, ?, ?, ?)",
      ["org-1", "device", "active", 4, now],
    );
    const handler = HttpRouter.toWebHandler(
      billingEntitlementRoutes({ token }).pipe(Layer.provideMerge(Layer.succeed(Db, db))),
    ).handler;
    const post = (revision: number, status: string) =>
      handler(
        new Request("http://localhost/api/internal/billing/entitlement", {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ organizationId: "org-1", plan: "device", status, revision }),
        }),
      );

    await Promise.all([post(4, "active"), post(5, "canceled")]);

    const [row] = await fixture.query<RowDataPacket[]>(
      "SELECT billing_status, billing_entitlement_revision FROM organization WHERE id = ?",
      ["org-1"],
    );
    expect(row).toMatchObject({ billing_status: "canceled", billing_entitlement_revision: 5 });
  });

  it("serializes concurrent billing events without losing entitlement revisions", async () => {
    const db = await runtime.runPromise(ServicesDbService);
    await seedSubscription();

    await Promise.all([
      deliver(db, "evt_concurrent_update", "customer.subscription.updated", subscription("sub_1")),
      deliver(
        db,
        "evt_concurrent_delete",
        "customer.subscription.deleted",
        subscription("sub_1", "canceled"),
      ),
    ]);

    const [row] = await fixture.query<RowDataPacket[]>(
      "SELECT status, entitlement_revision FROM services_subscription WHERE tenant_id = ?",
      ["org-1"],
    );
    const [ledger] = await fixture.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM services_stripe_event",
    );
    expect(row).toMatchObject({ status: "canceled", entitlement_revision: 2 });
    expect(ledger.count).toBe(2);
  });

  it("rejects stale subscription identities and permits only validated Checkout replacement", async () => {
    const db = await runtime.runPromise(ServicesDbService);
    await seedSubscription("sub_current", "unpaid", 3);

    await expect(
      deliver(db, "evt_stale_invoice", "invoice.paid", {
        id: "in_stale",
        object: "invoice",
        customer: "cus_1",
        subscription: "sub_replaced",
        status: "paid",
      }),
    ).rejects.toMatchObject({ _tag: "BillingWebhookError", statusCode: 400 });
    let [row] = await fixture.query<RowDataPacket[]>(
      "SELECT stripe_subscription_id, status, entitlement_revision FROM services_subscription WHERE tenant_id = ?",
      ["org-1"],
    );
    expect(row).toMatchObject({
      stripe_subscription_id: "sub_current",
      status: "unpaid",
      entitlement_revision: 3,
    });

    await deliver(db, "evt_checkout_replacement", "checkout.session.completed", {
      id: "cs_replacement",
      object: "checkout.session",
      mode: "subscription",
      payment_status: "paid",
      customer: "cus_1",
      subscription: "sub_new",
      client_reference_id: "org-1",
      metadata: { organizationId: "org-1", plan: "device" },
    });
    [row] = await fixture.query<RowDataPacket[]>(
      "SELECT stripe_subscription_id, status, entitlement_revision FROM services_subscription WHERE tenant_id = ?",
      ["org-1"],
    );
    expect(row).toMatchObject({
      stripe_subscription_id: "sub_new",
      status: "active",
      entitlement_revision: 4,
    });

    await expect(
      deliver(
        db,
        "evt_stale_subscription",
        "customer.subscription.updated",
        subscription("sub_current"),
      ),
    ).rejects.toBeInstanceOf(BillingWebhookError);
    [row] = await fixture.query<RowDataPacket[]>(
      "SELECT stripe_subscription_id, status, entitlement_revision FROM services_subscription WHERE tenant_id = ?",
      ["org-1"],
    );
    expect(row).toMatchObject({
      stripe_subscription_id: "sub_new",
      status: "active",
      entitlement_revision: 4,
    });
  });
});
