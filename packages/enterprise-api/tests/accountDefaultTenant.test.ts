import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { EnterpriseBadRequest } from "@mattrax/enterprise-domain";
import { makeDb, makeStripeClient, request, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";

const now = new Date();

const makeContext = (options: { readonly defaultTenantId?: string | null } = {}) => {
  const db = makeDb();

  const user = {
    id: "user-1",
    name: "Owner",
    email: "owner@example.com",
    emailVerified: true,
    image: null,
    defaultTenantId: options.defaultTenantId ?? null,
    createdAt: now,
    updatedAt: now,
  };

  db.store.user.push(user);
  db.store.organization.push(
    {
      id: "tenant-a",
      name: "Acme",
      slug: "acme",
      logo: null,
      displayName: null,
      supportEmail: null,
      brandColor: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "tenant-b",
      name: "Beta",
      slug: "beta",
      logo: null,
      displayName: null,
      supportEmail: null,
      brandColor: null,
      createdAt: now,
      updatedAt: now,
    },
  );
  db.store.member.push({
    id: "member-a",
    organizationId: "tenant-a",
    userId: user.id,
    role: "owner",
    customRoleId: null,
    createdAt: now,
    updatedAt: now,
  });

  const auth = {
    requireUser: () => Effect.succeed({ user }),
    listApiTokens: () => Effect.succeed({ tokens: [] }),
    createApiToken: () => Effect.die("not used"),
    revokeApiToken: () => Effect.succeed({ status: "ok" }),
    requestEmailChange: () => Effect.succeed({ status: "ok" }),
    verifyEmailChange: () => Effect.succeed({ status: "ok" }),
    requireStepUp: () => Effect.void,
  };

  const service = createEnterpriseService({
    db,
    schema,
    origin,
    stripeClient: makeStripeClient(),
    // SAFETY: this test never reaches R2; the service only stores the binding.
    storage: {} as any,
    // SAFETY: the fake implements only the auth methods these tests use.
    auth: auth as any,
  });

  return { db, service, headers: { cookie: "__Host-mattrax_session=test" } };
};

describe("account default tenant", () => {
  it("stores a tenant the account belongs to and reports it from /me", async () => {
    const { db, service, headers } = makeContext();

    const result = await runEffect(
      service.updateMe(request(headers), { defaultTenantId: "tenant-a" }),
    );

    expect(result).toEqual({ status: "ok" });
    expect(db.store.user[0]!.defaultTenantId).toBe("tenant-a");

    const me = await runEffect(service.me(request(headers)));
    expect(me.user.defaultTenantId).toBe("tenant-a");
  });

  it("rejects a tenant the account does not belong to", async () => {
    const { db, service, headers } = makeContext();

    await expect(
      runEffect(service.updateMe(request(headers), { defaultTenantId: "tenant-b" })),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
    expect(db.store.user[0]!.defaultTenantId).toBeNull();
  });

  it("clears the default without changing the rest of the profile", async () => {
    const { db, service, headers } = makeContext({ defaultTenantId: "tenant-a" });

    await runEffect(service.updateMe(request(headers), { defaultTenantId: null }));

    expect(db.store.user[0]).toMatchObject({
      name: "Owner",
      image: null,
      defaultTenantId: null,
    });
  });

  it("treats an empty selection as clearing the default", async () => {
    const { db, service, headers } = makeContext({ defaultTenantId: "tenant-a" });

    await runEffect(service.updateMe(request(headers), { defaultTenantId: "" }));

    expect(db.store.user[0]!.defaultTenantId).toBeNull();
  });

  it("keeps the current default when the request omits the field", async () => {
    const { db, service, headers } = makeContext({ defaultTenantId: "tenant-a" });

    await runEffect(service.updateMe(request(headers), { name: "Renamed" }));

    expect(db.store.user[0]).toMatchObject({
      name: "Renamed",
      defaultTenantId: "tenant-a",
    });
  });

  it("reports a stale default as null after the membership disappears", async () => {
    // The stored choice still names tenant-b, but this account only belongs to
    // tenant-a (for example, it was removed from tenant-b after choosing it).
    const { service, headers } = makeContext({ defaultTenantId: "tenant-b" });

    const me = await runEffect(service.me(request(headers)));

    expect(me.tenants.map((tenant) => tenant.id)).toEqual(["tenant-a"]);
    expect(me.user.defaultTenantId).toBeNull();
  });
});
