import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { reconcileEntitlements } from "@mattrax/enterprise-billing";
import { makeServicesDb, runEffect } from "./helpers.js";

describe("billing entitlement reconciliation", () => {
  it("locks and promotes a revision-0 row before pushing its current snapshot", async () => {
    const db = makeServicesDb();
    const now = new Date("2026-01-01T00:00:00.000Z");
    db.store.services_subscription.push({
      id: "local-sub",
      plan: "device",
      tenantId: "org-1",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      status: "canceled",
      entitlementRevision: 0,
      cancelAtPeriodEnd: false,
      createdAt: now,
      updatedAt: now,
    });

    const select = db.select.bind(db);
    const transaction = db.transaction.bind(db);
    const locks: string[] = [];
    let transactions = 0;
    const pushed: unknown[] = [];
    db.select = ((fields?: any) => {
      const builder: any = select(fields);
      const lock = builder.for.bind(builder);
      builder.for = (strength: string) => {
        locks.push(strength);
        return lock(strength);
      };
      return builder;
    }) as typeof db.select;
    db.transaction = ((work: any) => {
      transactions++;
      return transaction(work);
    }) as typeof db.transaction;

    const result = await runEffect(
      reconcileEntitlements(db, (entitlement) =>
        Effect.sync(() => {
          pushed.push(entitlement);
        }),
      ),
    );

    expect(result).toEqual({ tenants: 1, promoted: 1 });
    expect(transactions).toBe(1);
    expect(locks).toEqual(["update"]);
    expect(pushed).toEqual([
      { organizationId: "org-1", plan: "device", status: "canceled", revision: 1 },
    ]);
    expect(db.store.services_subscription[0]).toMatchObject({ entitlementRevision: 1 });
  });
});
