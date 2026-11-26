import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createEnterpriseService, enterpriseAdminHandlers } from "@mattrax/enterprise-api";
import {
  EnterpriseBadRequest,
  EnterpriseConflict,
  EnterpriseForbidden,
  EnterpriseNotFound,
  EnterpriseService,
  EnterpriseUnauthorized,
} from "@mattrax/enterprise-domain";
import { ACCOUNT_AUDIT } from "@mattrax/enterprise-backend";
import { makeDb, request, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";

const now = new Date("2026-11-20T00:00:00.000Z");

type TestAccount = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  disabled: boolean;
  superadmin: boolean;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const accountRow = (overrides: Partial<TestAccount> = {}): TestAccount => ({
  id: "actor",
  name: "Actor",
  email: "actor@example.com",
  emailVerified: true,
  disabled: false,
  superadmin: true,
  image: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const organizationRow = (id: string, name: string) => ({
  id,
  name,
  slug: id,
  logo: null,
  displayName: null,
  supportEmail: null,
  brandColor: null,
  requireMfa: false,
  createdAt: now,
  updatedAt: now,
});

const memberRow = (accountId: string, organizationId: string, role: string) => ({
  id: "member-" + accountId + "-" + organizationId,
  organizationId,
  accountId,
  role,
  customRoleId: null,
  createdAt: now,
  updatedAt: now,
});

const makeContext = (
  options: {
    readonly actor?: Partial<TestAccount>;
    readonly accounts?: ReadonlyArray<Partial<TestAccount>>;
    readonly allowlist?: ReadonlyArray<string>;
  } = {},
) => {
  const db = makeDb();
  const actor = accountRow(options.actor);
  const others = (options.accounts ?? []).map((row) => accountRow(row));

  for (const row of [actor, ...others]) db.store.account.push(row);

  const auth = {
    requireUser: (input: any) => {
      const headers = input instanceof Request ? Object.fromEntries(input.headers) : input.headers;

      return headers.cookie
        ? Effect.succeed({ user: actor })
        : Effect.fail(new EnterpriseUnauthorized({ message: "Unauthenticated" }));
    },
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
    // SAFETY: these tests never reach R2; the service only stores the binding.
    storage: {} as any,
    // SAFETY: the fake implements only the auth methods these tests exercise.
    auth: auth as any,
    authSecret: "enterprise-test-secret",
    superadmins: options.allowlist ?? [],
  });

  return { db, service, actor, headers: { cookie: "mattrax_session=test" } };
};

const list = (context: ReturnType<typeof makeContext>, query = {}) =>
  runEffect(context.service.listAdminAccounts(request(context.headers), query));

const patch = (context: ReturnType<typeof makeContext>, accountId: string, superadmin: boolean) =>
  runEffect(
    context.service.patchAdminAccountSuperadmin(request(context.headers), accountId, {
      superadmin,
    }),
  );

describe("platform account catalogue", () => {
  it("lists accounts with memberships, roles and effective flags", async () => {
    const context = makeContext({
      accounts: [
        { id: "bob", name: "Bob", email: "bob@example.com", superadmin: false },
        { id: "carol", name: "Carol", email: "carol@example.com", superadmin: false },
      ],
      allowlist: ["carol@example.com"],
    });

    context.db.store.organization.push(
      organizationRow("tenant-a", "Acme"),
      organizationRow("tenant-b", "Beta"),
    );
    context.db.store.member.push(
      memberRow("actor", "tenant-a", "owner"),
      memberRow("bob", "tenant-a", "member"),
      memberRow("carol", "tenant-b", "admin"),
    );

    const result = await list(context);
    const byId = new Map(result.accounts.map((entry) => [entry.id, entry]));

    expect(result.total).toBe(3);
    expect(result.limit).toBe(25);
    expect(result.offset).toBe(0);
    expect([...byId.keys()].sort()).toEqual(["actor", "bob", "carol"]);

    expect(byId.get("actor")).toMatchObject({
      email: "actor@example.com",
      superadmin: true,
      superadminSource: "database",
      memberships: [{ tenantId: "tenant-a", role: "owner", roleName: "Owner" }],
    });
    expect(byId.get("bob")?.memberships).toEqual([
      expect.objectContaining({ tenantId: "tenant-a", roleName: "Member" }),
    ]);
    expect(byId.get("carol")).toMatchObject({
      superadmin: true,
      superadminSource: "env",
      memberships: [{ tenantId: "tenant-b", role: "admin" }],
    });
  });

  it("searches name or email and paginates", async () => {
    const context = makeContext({
      accounts: [
        { id: "bob", name: "Bob Smith", email: "bob@example.com" },
        { id: "carol", name: "Carol", email: "carol@acme.test" },
      ],
    });

    const byName = await list(context, { q: "smith" });
    expect(byName.accounts.map((entry) => entry.id)).toEqual(["bob"]);
    expect(byName.total).toBe(1);

    const byEmail = await list(context, { q: "ACME.TEST" });
    expect(byEmail.accounts.map((entry) => entry.id)).toEqual(["carol"]);

    // A wildcard in the search is escaped, not interpreted.
    expect((await list(context, { q: "%" })).accounts).toEqual([]);

    const first = await list(context, { limit: 2, offset: 0 });
    const second = await list(context, { limit: 2, offset: 2 });

    expect(first.accounts).toHaveLength(2);
    expect(second.accounts).toHaveLength(1);
    expect(first.total).toBe(3);
  });

  it("denies the catalogue to a tenant owner who is not a superadmin", async () => {
    const context = makeContext({
      actor: { id: "owner", email: "owner@example.com", superadmin: false },
    });

    context.db.store.organization.push(organizationRow("tenant-a", "Acme"));
    context.db.store.member.push(memberRow("owner", "tenant-a", "owner"));

    await expect(list(context)).rejects.toBeInstanceOf(EnterpriseForbidden);
    await expect(patch(context, "owner", false)).rejects.toBeInstanceOf(EnterpriseForbidden);
  });
});

describe("superadmin promotion and demotion", () => {
  it("promotes an enabled account and records actor, target and before/after", async () => {
    const context = makeContext({
      accounts: [{ id: "bob", name: "Bob", email: "bob@example.com", superadmin: false }],
    });

    expect(await patch(context, "bob", true)).toEqual({ status: "ok" });
    expect(context.db.store.account.find((row: any) => row.id === "bob")!.superadmin).toBe(true);

    const entry = context.db.store.account_audit_log.at(-1)!;

    expect(entry).toMatchObject({
      subjectAccountId: "bob",
      subjectEmail: "bob@example.com",
      actorAccountId: "actor",
      actorEmail: "actor@example.com",
      action: ACCOUNT_AUDIT.superadminGranted,
      targetType: "account",
      targetId: "bob",
    });
    expect(entry.metadata).toMatchObject({
      target: { id: "bob", email: "bob@example.com" },
      before: { superadmin: false },
      after: { superadmin: true },
    });
  });

  it("refuses to promote a disabled account", async () => {
    const context = makeContext({
      accounts: [
        { id: "bob", name: "Bob", email: "bob@example.com", disabled: true, superadmin: false },
      ],
    });

    await expect(patch(context, "bob", true)).rejects.toBeInstanceOf(EnterpriseBadRequest);
    expect(context.db.store.account.find((row: any) => row.id === "bob")!.superadmin).toBe(false);
    expect(context.db.store.account_audit_log).toHaveLength(0);
  });

  it("refuses to demote an account managed by the environment allowlist", async () => {
    const context = makeContext({
      accounts: [{ id: "bob", name: "Bob", email: "bob@example.com", superadmin: true }],
      allowlist: ["bob@example.com"],
    });

    await expect(patch(context, "bob", false)).rejects.toBeInstanceOf(EnterpriseForbidden);
    expect(context.db.store.account.find((row: any) => row.id === "bob")!.superadmin).toBe(true);
  });

  it("refuses self-demotion while another operator remains", async () => {
    const context = makeContext({
      accounts: [{ id: "bob", name: "Bob", email: "bob@example.com", superadmin: true }],
    });

    await expect(patch(context, "actor", false)).rejects.toBeInstanceOf(EnterpriseForbidden);
    expect(context.db.store.account.find((row: any) => row.id === "actor")!.superadmin).toBe(true);
  });

  it("refuses to remove the last operator", async () => {
    const context = makeContext();

    await expect(patch(context, "actor", false)).rejects.toBeInstanceOf(EnterpriseConflict);
    expect(context.db.store.account.find((row: any) => row.id === "actor")!.superadmin).toBe(true);
  });

  it("demotes another account when an operator remains and audits the change", async () => {
    const context = makeContext({
      accounts: [{ id: "bob", name: "Bob", email: "bob@example.com", superadmin: true }],
    });

    expect(await patch(context, "bob", false)).toEqual({ status: "ok" });
    expect(context.db.store.account.find((row: any) => row.id === "bob")!.superadmin).toBe(false);

    expect(context.db.store.account_audit_log.at(-1)).toMatchObject({
      subjectAccountId: "bob",
      actorAccountId: "actor",
      action: ACCOUNT_AUDIT.superadminRevoked,
      metadata: {
        target: { id: "bob", email: "bob@example.com" },
        before: { superadmin: true },
        after: { superadmin: false },
      },
    });
  });

  it("treats an unknown account as missing", async () => {
    const context = makeContext();

    await expect(patch(context, "missing", true)).rejects.toBeInstanceOf(EnterpriseNotFound);
  });

  it("returns the effective flag from me for both sources", async () => {
    const stored = await runEffect(
      makeContext().service.me(request({ cookie: "mattrax_session=test" })),
    );

    expect(stored.account.superadmin).toBe(true);

    const env = await runEffect(
      makeContext({
        actor: { email: "Ops@Example.com", superadmin: false },
        allowlist: ["ops@example.com"],
      }).service.me(request({ cookie: "mattrax_session=test" })),
    );

    expect(env.account.superadmin).toBe(true);
  });

  it("returns the denial through the registered HTTP handler", async () => {
    type HandlerInput = {
      readonly request: ReturnType<typeof request>;
      readonly query: Record<string, never>;
    };

    type HandlerEffect = Effect.Effect<unknown, unknown, unknown>;

    let listHandler: ((input: HandlerInput) => HandlerEffect) | undefined;

    const group = {
      handle(name: string, implementation: typeof listHandler) {
        if (name === "listAdminAccounts") listHandler = implementation;

        return group;
      },
    };

    // SAFETY: the fake builder implements the only method `enterpriseAdminHandlers`
    // calls; the real builder is provided by `HttpApiBuilder.group` in production.
    enterpriseAdminHandlers(group as any);

    const service = {
      listAdminAccounts: () =>
        Effect.fail(
          new EnterpriseForbidden({ message: "Platform administrator access is required." }),
        ),
    };

    const effect = listHandler!({
      request: request({ cookie: "mattrax_session=test" }),
      query: {},
    });

    // SAFETY: the fake service implements only the method this handler calls.
    await expect(
      runEffect(Effect.provideService(effect, EnterpriseService, service as any)),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);
  });

  it("returns every account regardless of tenant membership", async () => {
    const context = makeContext({
      accounts: [
        { id: "bob", name: "Bob", email: "bob@example.com" },
        { id: "carol", name: "Carol", email: "carol@example.com" },
      ],
    });

    context.db.store.organization.push(
      organizationRow("tenant-a", "Acme"),
      organizationRow("tenant-b", "Beta"),
    );
    context.db.store.member.push(
      memberRow("bob", "tenant-a", "owner"),
      memberRow("carol", "tenant-b", "owner"),
    );

    const result = await list(context, { limit: 50 });

    expect(result.accounts.map((entry) => entry.id).sort()).toEqual(["actor", "bob", "carol"]);
    expect(result.accounts.find((entry) => entry.id === "bob")?.memberships).toHaveLength(1);
    expect(result.accounts.find((entry) => entry.id === "carol")?.memberships).toHaveLength(1);
  });
});
