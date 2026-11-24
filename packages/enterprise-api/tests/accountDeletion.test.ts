import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import {
  EnterpriseBadRequest,
  EnterpriseConflict,
  EnterpriseDbError,
  EnterpriseForbidden,
} from "@mattrax/enterprise-domain";
import { makeDb, makeStripeClient, request, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";
const authSecret = "account-deletion-test-secret";
const timestamp = new Date("2026-11-24T09:00:00.000Z");

const account = (id: string, email: string) => ({
  id,
  name: id,
  email,
  emailVerified: true,
  image: null,
  disabled: false,
  totpEnabled: false,
  authRevision: "rev-" + id,
  defaultTenantId: null,
  superadmin: false,
  source: "manual",
  createdAt: timestamp,
  updatedAt: timestamp,
});

const organization = (id: string, name: string, slug: string) => ({
  id,
  name,
  displayName: null,
  slug,
  logo: null,
  supportEmail: null,
  brandColor: null,
  metadata: null,
  stripeCustomerId: null,
  requireMfa: false,
  scriptsEnabled: true,
  createdAt: timestamp,
  updatedAt: timestamp,
});

const member = (id: string, organizationId: string, accountId: string, role: string) => ({
  id,
  organizationId,
  accountId,
  role,
  customRoleId: null,
  onboardingDismissedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
});

const makeContext = (
  options: {
    readonly tenants?: ReadonlyArray<{ id: string; name: string; slug: string }>;
    readonly memberships?: ReadonlyArray<{ id: string; organizationId: string; role: string }>;
    readonly others?: ReadonlyArray<{ id: string; email: string }>;
    readonly devices?: number;
    readonly billing?: Record<string, (...args: any[]) => Effect.Effect<any, any>>;
    readonly storage?: Record<string, (...args: any[]) => Promise<any>>;
  } = {},
) => {
  const db = makeDb();
  const user = account("user-1", "owner@example.com");

  db.store.account.push(
    user,
    ...(options.others ?? []).map((other) => account(other.id, other.email)),
  );

  const tenants = options.tenants ?? [{ id: "org-1", name: "Acme", slug: "acme" }];

  for (const tenant of tenants)
    db.store.organization.push(organization(tenant.id, tenant.name, tenant.slug));

  const memberships = options.memberships ?? [
    { id: "member-1", organizationId: "org-1", role: "owner" },
  ];

  for (const membership of memberships)
    db.store.member.push(
      member(membership.id, membership.organizationId, user.id, membership.role),
    );

  for (let index = 0; index < (options.devices ?? 0); index++)
    db.store.device.push({
      id: `device-${index}`,
      organizationId: "org-1",
      name: `Device ${index}`,
      status: "enrolled",
      platform: "apple",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

  const auth = {
    requireUser: (input: any) => {
      const inputHeaders =
        input instanceof Request ? Object.fromEntries(input.headers) : input.headers;
      const session = String(inputHeaders.cookie ?? "");
      const token = session.slice(session.indexOf("=") + 1);

      if (token !== "user-1") return Effect.die("Unauthenticated test request");

      return Effect.succeed({ user: db.store.account.find((row: any) => row.id === "user-1") });
    },
    requireStepUp: (input: any) => auth.requireUser(input),
    listApiTokens: () => Effect.succeed({ tokens: [] }),
    createApiToken: () =>
      Effect.succeed({ token: "mtx_test", item: { id: "token-1", name: "CI" } }),
    revokeApiToken: () => Effect.succeed({ status: "ok" }),
    requestEmailChange: () => Effect.succeed({ status: "ok" }),
    verifyEmailChange: () => Effect.succeed({ status: "ok" }),
  };

  const billing = {
    summary: () => Effect.die("not used"),
    portal: () => Effect.die("not used"),
    checkout: () => Effect.die("not used"),
    invoices: () => Effect.die("not used"),
    reportUsage: () => Effect.void,
    renameTenant: () => Effect.void,
    preflightTenantDeletion: () => Effect.void,
    cancelTenant: () => Effect.succeed("cancelled" as const),
    ...options.billing,
  };

  const service = createEnterpriseService({
    db,
    schema,
    origin,
    stripeClient: makeStripeClient(),
    // SAFETY: the fake only implements the auth methods these tests exercise.
    auth: auth as any,
    // SAFETY: teardown lists and deletes tenant-prefixed objects; these tests
    // own no objects, so an empty bucket is the whole contract.
    storage: {
      list: async () => ({ objects: [], truncated: false }),
      delete: async () => undefined,
      ...options.storage,
    } as any,
    // SAFETY: the tenant is solo and has no subscription; only the teardown
    // preflight and cancellation are reached.
    billing: billing as any,
    authSecret,
  });

  return { db, service, user };
};

const headers = { cookie: "mattrax_session=user-1" };

const submit = <A, E>(effect: Effect.Effect<A, E, any>) =>
  Effect.runPromise(Effect.result(effect));

const failureTag = (outcome: any) => (outcome._tag === "Failure" ? outcome.failure._tag : "ok");

describe("account deletion preview", () => {
  it("allows the sole owner of a single tenant and describes the cascade", async () => {
    const { service } = makeContext({ devices: 3 });

    const preview = await runEffect(service.getAccountDeletion(request(headers)));

    expect(preview.canDelete).toBe(true);
    expect(preview.blockers).toEqual([]);
    expect(preview.tenant).toMatchObject({
      id: "org-1",
      name: "Acme",
      slug: "acme",
      memberCount: 1,
      ownerCount: 1,
      deviceCount: 3,
    });
    expect(preview.lastAccount).toBe(true);
  });

  it("blocks an account that belongs to more than one tenant", async () => {
    const { service } = makeContext({
      tenants: [
        { id: "org-1", name: "Acme", slug: "acme" },
        { id: "org-2", name: "Beta", slug: "beta" },
      ],
      memberships: [
        { id: "member-1", organizationId: "org-1", role: "owner" },
        { id: "member-2", organizationId: "org-2", role: "owner" },
      ],
    });

    const preview = await runEffect(service.getAccountDeletion(request(headers)));

    expect(preview.canDelete).toBe(false);
    expect(preview.blockers.map((blocker) => blocker.code)).toEqual(["multiple_tenants"]);
    expect(preview.blockers[0]?.message).toContain("2 tenants");
    expect(preview.tenant).toBeUndefined();
  });

  it("blocks a tenant with another owner", async () => {
    const { db, service } = makeContext();

    db.store.member.push(member("member-2", "org-1", "user-2", "owner"));

    const preview = await runEffect(service.getAccountDeletion(request(headers)));

    expect(preview.canDelete).toBe(false);
    expect(preview.blockers.map((blocker) => blocker.code)).toContain(
      "tenant_has_other_owners",
    );
    expect(preview.tenant?.ownerCount).toBe(2);
  });

  it("blocks a tenant with other members even when the caller is the sole owner", async () => {
    const { db, service } = makeContext();

    db.store.member.push(member("member-2", "org-1", "user-2", "member"));

    const preview = await runEffect(service.getAccountDeletion(request(headers)));

    expect(preview.canDelete).toBe(false);
    expect(preview.blockers.map((blocker) => blocker.code)).toContain(
      "tenant_has_other_members",
    );
    expect(preview.blockers[0]?.message).toContain("1 other member");
  });

  it("tells a non-owner in a shared tenant to leave through administrators", async () => {
    const { db, service } = makeContext({
      memberships: [{ id: "member-1", organizationId: "org-1", role: "member" }],
    });

    db.store.member.push(member("member-2", "org-1", "user-2", "owner"));

    const preview = await runEffect(service.getAccountDeletion(request(headers)));

    expect(preview.canDelete).toBe(false);
    expect(preview.blockers.map((blocker) => blocker.code)).toContain(
      "tenant_has_other_members",
    );
    expect(preview.blockers[0]?.message).toContain("Remove your own administrator access");
  });

  it("blocks a single member who is not the built-in owner", async () => {
    const { service } = makeContext({
      memberships: [{ id: "member-1", organizationId: "org-1", role: "admin" }],
    });

    const preview = await runEffect(service.getAccountDeletion(request(headers)));

    expect(preview.canDelete).toBe(false);
    expect(preview.blockers.map((blocker) => blocker.code)).toContain("tenant_owner_required");
  });
});

describe("deleting an account", () => {
  it("rejects a mismatched confirmation email without changing anything", async () => {
    const { db, service } = makeContext();

    const outcome = await submit(
      service.deleteMe(request(headers), { confirmEmail: "someone@example.com" }),
    );

    expect(failureTag(outcome)).toBe("EnterpriseBadRequest");
    expect((outcome as any).failure).toBeInstanceOf(EnterpriseBadRequest);
    expect(db.store.account).toHaveLength(1);
    expect(db.store.organization).toHaveLength(1);
  });

  it("refuses a shared tenant and keeps the account", async () => {
    const { db, service } = makeContext();

    db.store.member.push(member("member-2", "org-1", "user-2", "owner"));

    const outcome = await submit(
      service.deleteMe(request(headers), { confirmEmail: "owner@example.com" }),
    );

    expect(failureTag(outcome)).toBe("EnterpriseForbidden");
    expect((outcome as any).failure).toBeInstanceOf(EnterpriseForbidden);
    expect(db.store.account).toHaveLength(1);
    expect(db.store.organization).toHaveLength(1);
  });

  it("keeps both rows when billing preflight fails", async () => {
    const { db, service } = makeContext({
      billing: {
        preflightTenantDeletion: () => Effect.fail(new Error("billing unavailable")),
      },
    });

    const outcome = await submit(
      service.deleteMe(request(headers), { confirmEmail: "owner@example.com" }),
    );

    expect(failureTag(outcome)).toBe("EnterpriseDbError");
    expect((outcome as any).failure).toBeInstanceOf(EnterpriseDbError);
    expect((outcome as any).failure.message).toContain("account was kept");
    expect(db.store.account).toHaveLength(1);
    expect(db.store.organization).toHaveLength(1);
  });

  it("keeps both rows when storage fails during teardown", async () => {
    const { db, service } = makeContext({
      storage: {
        list: async () => {
          throw new Error("R2 unavailable");
        },
      },
    });

    const outcome = await submit(
      service.deleteMe(request(headers), { confirmEmail: "owner@example.com" }),
    );

    expect(failureTag(outcome)).toBe("EnterpriseDbError");
    expect((outcome as any).failure.message).toContain("account was kept");
    expect(db.store.account).toHaveLength(1);
    expect(db.store.organization).toHaveLength(1);
    expect(db.store.tenant_deletion[0]).toMatchObject({ status: "failed" });
  });

  it("returns a conflict when another teardown owns the tenant job", async () => {
    const { db, service } = makeContext();

    db.store.tenant_deletion.push({
      id: "job-1",
      organizationId: "org-1",
      status: "pending",
      steps: [],
      attempts: 1,
      lastError: null,
      requestedByAccountId: "user-1",
      requestedByEmail: "owner@example.com",
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: null,
    });

    const outcome = await submit(
      service.deleteMe(request(headers), { confirmEmail: "owner@example.com" }),
    );

    expect(failureTag(outcome)).toBe("EnterpriseConflict");
    expect((outcome as any).failure).toBeInstanceOf(EnterpriseConflict);
    expect((outcome as any).failure.message).toContain("already in progress");
    expect(db.store.account).toHaveLength(1);
    expect(db.store.organization).toHaveLength(1);
  });

  it("reports that the tenant is gone when only the account cleanup fails, and retries", async () => {
    const { db, service } = makeContext();

    const originalDelete = db.delete;
    const tableName = (table: any) => {
      const symbol = Object.getOwnPropertySymbols(table).find(
        (candidate) => candidate.description === "drizzle:Name",
      );

      return symbol ? table[symbol] : undefined;
    };

    db.delete = (table: any) =>
      tableName(table) === "account"
        ? { where: () => Effect.fail(new Error("account delete failed")) }
        : originalDelete(table);

    const failed = await submit(
      service.deleteMe(request(headers), { confirmEmail: "owner@example.com" }),
    );

    expect(failureTag(failed)).toBe("EnterpriseDbError");
    expect((failed as any).failure.message).toContain("tenant was deleted");
    expect(db.store.account).toHaveLength(1);
    expect(db.store.organization).toHaveLength(0);

    db.delete = originalDelete;

    const retried = await submit(
      service.deleteMe(request(headers), { confirmEmail: "owner@example.com" }),
    );

    expect((retried as any)._tag).toBe("Success");
    expect((retried as any).success.deletedTenants).toEqual([]);
    expect(db.store.account).toHaveLength(0);
  });

  it("deletes the account, cascades the solo tenant and records the cascade", async () => {
    const { db, service } = makeContext({ devices: 1 });

    const outcome = await submit(
      service.deleteMe(request(headers), { confirmEmail: "owner@example.com" }),
    );

    expect((outcome as any)._tag).toBe("Success");
    expect((outcome as any).success).toEqual({
      status: "ok",
      deletedTenants: [{ id: "org-1", name: "Acme" }],
    });
    expect(db.store.account).toHaveLength(0);
    expect(db.store.organization).toHaveLength(0);
    expect(db.store.member).toHaveLength(0);

    const audit = Object.values(db.store)
      .flat()
      .find((row: any) => row.action === "account.deleted");

    expect(audit).toMatchObject({
      targetType: "account",
      targetId: "user-1",
      metadata: {
        tenants: [{ id: "org-1", name: "Acme" }],
        lastAccount: true,
      },
    });
  });
});
