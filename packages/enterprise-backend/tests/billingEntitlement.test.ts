import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { describe, expect, it } from "vitest";
import { Db } from "@mattrax/enterprise-core";
import { billingEntitlementRoutes } from "../src/billingEntitlement.ts";
import { makeDb, makeOrganization } from "./helpers.js";

const token = "services-test-token";

const handler = (db: ReturnType<typeof makeDb>) =>
  HttpRouter.toWebHandler(
    billingEntitlementRoutes({ token }).pipe(Layer.provideMerge(Layer.succeed(Db, db))),
  ).handler;

const post = (handle: (request: Request) => Promise<Response>, body: unknown, bearer = token) =>
  handle(
    new Request("http://localhost/api/internal/billing/entitlement", {
      method: "POST",
      headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

const seeded = () => {
  const db = makeDb();
  const at = new Date("2026-01-01T00:00:00.000Z");
  db.store.organization.push(
    makeOrganization({
      id: "org-1",
      name: "Acme",
      slug: "acme",
      billingPlan: "device",
      billingStatus: "active",
      billingEntitlementRevision: 2,
      updatedAt: at,
    }),
  );

  return { db, at };
};

describe("billing entitlement receiver", () => {
  it("requires the machine token without mutating the cached entitlement", async () => {
    const { db, at } = seeded();

    const response = await post(
      handler(db),
      {
        organizationId: "org-1",
        plan: "device",
        status: "canceled",
        revision: 3,
      },
      "wrong-token",
    );

    expect(response.status).toBe(401);
    expect(db.store.organization[0]).toMatchObject({
      billingPlan: "device",
      billingStatus: "active",
      billingEntitlementRevision: 2,
      updatedAt: at,
    });
  });

  it.each([
    { organizationId: "org-1", plan: "device", status: "canceled" },
    { organizationId: "org-1", plan: "device", status: "canceled", revision: 0 },
    { organizationId: "org-1", plan: "device", status: "canceled", revision: 1.5 },
  ])("rejects an invalid or missing revision: %j", async (body) => {
    const { db } = seeded();

    expect((await post(handler(db), body)).status).toBe(400);
    expect(db.store.organization[0]!.billingEntitlementRevision).toBe(2);
  });

  it("applies a newer revision", async () => {
    const { db } = seeded();

    expect(
      (
        await post(handler(db), {
          organizationId: "org-1",
          plan: "device",
          status: "canceled",
          revision: 3,
        })
      ).status,
    ).toBe(204);
    expect(db.store.organization[0]).toMatchObject({
      billingPlan: "device",
      billingStatus: "canceled",
      billingEntitlementRevision: 3,
    });
  });

  it.each([1, 2])("ignores a delayed or equal revision %i", async (revision) => {
    const { db, at } = seeded();

    expect(
      (
        await post(handler(db), {
          organizationId: "org-1",
          plan: "device",
          status: "active",
          revision,
        })
      ).status,
    ).toBe(204);
    expect(db.store.organization[0]).toMatchObject({
      billingPlan: "device",
      billingStatus: "active",
      billingEntitlementRevision: 2,
      updatedAt: at,
    });
  });

  it("keeps the existing no-op behavior for an unknown organization", async () => {
    const db = makeDb();

    const response = await post(handler(db), {
      organizationId: "missing",
      plan: "free",
      status: null,
      revision: 1,
    });

    expect(response.status).toBe(204);
    expect(db.store.organization).toEqual([]);
  });
});
