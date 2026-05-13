import { describe, expect, it } from "vitest";
import { createEnterpriseAuth } from "../src/auth.js";
import { createEnterpriseService } from "../src/enterpriseHandlers.js";
import { cookieFrom, makeDb, makeStripeClient, request, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";

const makeContext = async () => {
  const db = makeDb();
  const stripeClient = makeStripeClient();
  const service = createEnterpriseService({ db, schema, origin, stripeClient, storage: {} });
  const auth = createEnterpriseAuth({ db, schema, origin });
  const response = await runEffect(auth.authRegister(new Request(origin), { name: "Owner", email: "owner@example.com", password: "password" }));
  return { db, service, auth, headers: { cookie: cookieFrom(response) } };
};

describe("enterprise service tenant flow", () => {
  it("requires authentication to create tenants", async () => {
    const { service } = await makeContext();
    await expect(runEffect(service.createTenant(request(), { name: "Acme", slug: "acme" }))).rejects.toMatchObject({ _tag: "EnterpriseUnauthorized" });
  });

  it("creates an organization, owner member, and enrollment row", async () => {
    const { db, service, headers } = await makeContext();
    const result = await runEffect(service.createTenant(request(headers), { name: "Acme", slug: "acme", metadata: { tier: "trial" } }));

    expect(result.id).toBeDefined();
    expect(db.store.organization).toMatchObject([{ id: result.id, name: "Acme", slug: "acme", metadata: JSON.stringify({ tier: "trial" }) }]);
    expect(db.store.member).toMatchObject([{ organizationId: result.id, userId: db.store.user[0].id, role: "owner" }]);
    expect(db.store.enterprise_enrollment).toMatchObject([{ id: result.id, organizationId: result.id }]);
  });

  it("lists only tenants for the authenticated user", async () => {
    const { service, headers } = await makeContext();
    const owned = await runEffect(service.createTenant(request(headers), { name: "Acme", slug: "acme" }));

    const result = await runEffect(service.listTenants(request(headers)));
    expect(result.tenants).toEqual([{ id: owned.id, name: "Acme", slug: "acme", logo: null, role: "owner" }]);
  });

  it("enforces tenant role access", async () => {
    const { db, service, headers } = await makeContext();
    const tenant = await runEffect(service.createTenant(request(headers), { name: "Acme", slug: "acme" }));
    db.store.member[0].role = "member";

    await expect(runEffect(service.patchTenant(request(headers), tenant.id, { name: "Denied" }))).rejects.toMatchObject({ _tag: "EnterpriseForbidden" });

    db.store.member[0].role = "admin";
    await runEffect(service.patchTenant(request(headers), tenant.id, { name: "Allowed" }));
    expect(db.store.organization[0].name).toBe("Allowed");

    await expect(runEffect(service.deleteTenant(request(headers), tenant.id))).rejects.toMatchObject({ _tag: "EnterpriseForbidden" });
  });

  it("prevents deleting tenants with more than one member", async () => {
    const { db, service, headers } = await makeContext();
    const tenant = await runEffect(service.createTenant(request(headers), { name: "Acme", slug: "acme" }));
    const now = new Date();
    db.store.user.push({ id: "user-2", name: "Member", email: "member@example.com", emailVerified: false, createdAt: now, updatedAt: now });
    db.store.member.push({ id: "member-2", organizationId: tenant.id, userId: "user-2", role: "member", createdAt: now, updatedAt: now });

    await expect(runEffect(service.deleteTenant(request(headers), tenant.id))).rejects.toMatchObject({ _tag: "EnterpriseConflict" });
  });

  it("supports invitation lifecycle", async () => {
    const { db, service, headers } = await makeContext();
    const tenant = await runEffect(service.createTenant(request(headers), { name: "Acme", slug: "acme" }));
    const invitation = await runEffect(service.inviteTenantUser(request(headers), tenant.id, { email: "new@example.com", role: "admin" }));

    expect(db.store.invitation).toMatchObject([{ id: invitation.id, organizationId: tenant.id, email: "new@example.com", role: "admin", status: "pending" }]);
    const listed = await runEffect(service.listTenantInvitations(request(headers), tenant.id));
    expect(listed.invitations[0]).toMatchObject({ id: invitation.id, email: "new@example.com", role: "admin", status: "pending" });

    await runEffect(service.cancelTenantInvitation(request(headers), tenant.id, invitation.id));
    expect(db.store.invitation[0].status).toBe("canceled");
  });

  it("supports tenant user role updates and removal while protecting the last user", async () => {
    const { db, service, headers } = await makeContext();
    const tenant = await runEffect(service.createTenant(request(headers), { name: "Acme", slug: "acme" }));
    const now = new Date();
    db.store.user.push({ id: "user-2", name: "Member", email: "member@example.com", emailVerified: false, createdAt: now, updatedAt: now });
    db.store.member.push({ id: "member-2", organizationId: tenant.id, userId: "user-2", role: "member", createdAt: now, updatedAt: now });

    await runEffect(service.patchTenantUser(request(headers), tenant.id, "member-2", { role: "admin" }));
    expect(db.store.member.find((member: any) => member.id === "member-2")?.role).toBe("admin");

    await runEffect(service.removeTenantUser(request(headers), tenant.id, "member-2"));
    await expect(runEffect(service.removeTenantUser(request(headers), tenant.id, db.store.member[0].id))).rejects.toMatchObject({ _tag: "EnterpriseConflict" });
  });
});

describe("enterprise service billing flow", () => {
  it("summarizes subscription and enrolled device usage", async () => {
    const { db, service, headers } = await makeContext();
    const tenant = await runEffect(service.createTenant(request(headers), { name: "Acme", slug: "acme" }));
    const now = new Date();
    db.store.subscription.push({ id: "sub-1", plan: "business", referenceId: tenant.id, stripeSubscriptionId: "stripe-sub-1", status: "active", createdAt: now, updatedAt: now });
    db.store.device.push({ id: "device-1", organizationId: tenant.id, proto: "apple", status: "enrolled", name: "Mac", enrolledAt: now, lastSeenAt: now });
    db.store.device.push({ id: "device-2", organizationId: tenant.id, proto: "apple", status: "unenrolled", name: "Old Mac", enrolledAt: now, lastSeenAt: now });

    await expect(runEffect(service.billing(request(headers), tenant.id))).resolves.toEqual({
      plan: "business",
      status: "active",
      billableDevices: 1,
      subscriptionId: "stripe-sub-1",
    });
  });

  it("creates and persists a Stripe customer before opening the billing portal", async () => {
    const { db, auth, headers } = await makeContext();
    const createdCustomers: any[] = [];
    const portalSessions: any[] = [];
    const stripeClient = makeStripeClient({
      customers: {
        create: async (payload: any) => {
          createdCustomers.push(payload);
          return { id: "cus_new" };
        },
      },
      billingPortal: {
        sessions: {
          create: async (payload: any) => {
            portalSessions.push(payload);
            return { url: "https://billing.test/session" };
          },
        },
      },
    });
    const service = createEnterpriseService({ db, schema, origin, stripeClient, storage: {} });
    const tenant = await runEffect(service.createTenant(request(headers), { name: "Acme", slug: "acme" }));

    await expect(runEffect(service.billingPortal(request(headers), tenant.id, { returnUrl: "https://app.test/settings" }))).resolves.toEqual({ url: "https://billing.test/session" });
    expect(createdCustomers).toEqual([{ name: "Acme", metadata: { organizationId: tenant.id, customerType: "organization" } }]);
    expect(db.store.organization[0].stripeCustomerId).toBe("cus_new");
    expect(portalSessions).toEqual([{ customer: "cus_new", return_url: "https://app.test/settings" }]);

    await expect(auth.requireUser(new Request(origin, { headers: { cookie: headers.cookie } }))).resolves.toBeDefined();
  });

  it("uses an existing Stripe customer and requires write access", async () => {
    const { db, service, headers } = await makeContext();
    const tenant = await runEffect(service.createTenant(request(headers), { name: "Acme", slug: "acme" }));
    db.store.organization[0].stripeCustomerId = "cus_existing";
    db.store.member[0].role = "member";

    await expect(runEffect(service.billingPortal(request(headers), tenant.id, { returnUrl: "https://app.test/settings" }))).rejects.toMatchObject({ _tag: "EnterpriseForbidden" });
  });
});
