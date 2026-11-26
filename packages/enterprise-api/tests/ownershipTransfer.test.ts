import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  EnterpriseBadRequest,
  EnterpriseConflict,
  EnterpriseForbidden,
  EnterpriseNotFound,
} from "@mattrax/enterprise-domain";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { makeEmailTransport } from "@mattrax/enterprise-backend";
import { permissionForMethod } from "@mattrax/enterprise-identity";
import type { OutboundEmailMessage } from "@mattrax/email";
import { makeDb, request, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";

type TestUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
  totpEnabled?: boolean;
  passkeyEnabled?: boolean;
};

const userRow = (overrides: Partial<TestUser> = {}): TestUser => {
  const now = new Date();

  return {
    id: "user-1",
    name: "Owner",
    email: "owner@example.com",
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
};

const makeContext = (options: { db?: any; user?: Partial<TestUser> } = {}) => {
  const db = options.db ?? makeDb();
  const user = userRow(options.user);
  const sent: OutboundEmailMessage[] = [];

  if (!db.store.account.some((row: any) => row.id === user.id)) db.store.account.push(user);

  const email = makeEmailTransport(async (message: OutboundEmailMessage) => {
    sent.push(message);
  });

  const auth = {
    requireUser: (input: any) => {
      const headers = input instanceof Request ? Object.fromEntries(input.headers) : input.headers;

      return headers.cookie ? Effect.succeed({ user }) : Effect.fail(new Error("Unauthenticated"));
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
    email,
  });

  return { db, service, user, sent, headers: { cookie: "mattrax_session=test" } };
};

const addUser = (db: any, overrides: Partial<TestUser>) => {
  const user = userRow(overrides);
  db.store.account.push(user);

  return user;
};

const addMember = (
  db: any,
  tenantId: string,
  user: { id: string },
  role: string,
  customRoleId?: string | null,
) => {
  const now = new Date();

  const member = {
    id: `member-${user.id}`,
    organizationId: tenantId,
    accountId: user.id,
    role,
    customRoleId: customRoleId ?? null,
    createdAt: now,
    updatedAt: now,
  };

  db.store.member.push(member);

  return member;
};

const createTenant = async (context: ReturnType<typeof makeContext>, slug: string) =>
  runEffect(context.service.createTenant(request(context.headers), { name: slug, slug }));

const addTarget = (db: any, tenantId: string, id = "user-target", email = "target@example.com") => {
  const target = addUser(db, { id, name: "Target", email });

  return { target, member: addMember(db, tenantId, target, "member") };
};

const requestTransfer = (
  context: ReturnType<typeof makeContext>,
  tenantId: string,
  targetAccountId: string,
) =>
  runEffect(
    context.service.requestTenantOwnershipTransfer(request(context.headers), tenantId, {
      targetAccountId,
    }),
  );

const tokenFrom = (url: string) => {
  const token = new URL(url).searchParams.get("token");
  expect(token, "accept URL must carry a token").toBeTruthy();

  return token!;
};

const transferRow = (db: any) => db.store.tenant_ownership_transfer.at(-1);

const auditActions = (db: any) => db.store.audit_log.map((row: any) => row.action);

describe("tenant ownership transfer", () => {
  it("queues an email and stores a single pending request", async () => {
    const owner = makeContext();
    const tenant = await createTenant(owner, "acme");
    const { target } = addTarget(owner.db, tenant.id);

    const created = await requestTransfer(owner, tenant.id, target.id);

    expect(created.emailSent).toBe(true);
    expect(created.targetAccountId).toBe(target.id);
    expect(created.acceptUrl).toContain(`${origin}/accept-ownership?token=`);
    expect(Date.parse(created.expiresAt)).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);

    const row = transferRow(owner.db);
    expect(row).toMatchObject({
      id: created.id,
      organizationId: tenant.id,
      requestedByAccountId: owner.user.id,
      targetAccountId: target.id,
      status: "pending",
      acceptedAt: null,
      cancelledAt: null,
    });
    expect(row.tokenHash).toEqual(expect.any(String));
    expect(row.tokenHash).not.toBe(tokenFrom(created.acceptUrl));

    expect(owner.sent).toHaveLength(0);
    expect(owner.db.store.email_outbox).toHaveLength(1);
    expect(owner.db.store.email_outbox[0]).toMatchObject({
      recipient: target.email,
      template: "ownership_transfer",
      organizationId: tenant.id,
      dedupeKey: `ownership_transfer:${created.id}`,
      status: "pending",
    });
    expect(owner.db.store.email_outbox[0]!.payload).toMatchObject({
      to: target.email,
      subject: "Take over acme on Mattrax",
    });
    expect(owner.db.store.email_outbox[0]!.payload.text).toContain(created.acceptUrl);
    expect(owner.db.store.email_outbox[0]!.payload.html).toContain("Accept ownership");
    expect(auditActions(owner.db)).toContain("member.ownership_transfer_requested");
  });

  it("only lets a built-in owner request a transfer", async () => {
    const owner = makeContext();
    const tenant = await createTenant(owner, "acme");
    const { target } = addTarget(owner.db, tenant.id);

    const admin = makeContext({
      db: owner.db,
      user: { id: "user-admin", name: "Admin", email: "admin@example.com" },
    });

    addMember(owner.db, tenant.id, admin.user, "admin");

    await expect(requestTransfer(admin, tenant.id, target.id)).rejects.toBeInstanceOf(
      EnterpriseForbidden,
    );

    // A custom role that holds every member permission still cannot hand over
    // built-in owner authority, and cannot even reach the check without write.
    const custom = await runEffect(
      owner.service.createTenantRole(request(owner.headers), tenant.id, {
        name: "Member manager",
        permissions: ["tenant.read", "members.read", "members.write"],
      }),
    );

    const delegated = makeContext({
      db: owner.db,
      user: { id: "user-delegated", name: "Delegated", email: "delegated@example.com" },
    });

    addMember(owner.db, tenant.id, delegated.user, "member", custom.id);

    await expect(requestTransfer(delegated, tenant.id, target.id)).rejects.toBeInstanceOf(
      EnterpriseForbidden,
    );
    expect(owner.db.store.tenant_ownership_transfer).toEqual([]);
  });

  it("validates the target", async () => {
    const owner = makeContext();
    const tenant = await createTenant(owner, "acme");
    const { target } = addTarget(owner.db, tenant.id);

    await expect(requestTransfer(owner, tenant.id, owner.user.id)).rejects.toBeInstanceOf(
      EnterpriseBadRequest,
    );

    const outsider = addUser(owner.db, {
      id: "user-outsider",
      name: "Outsider",
      email: "outsider@example.com",
    });

    await expect(requestTransfer(owner, tenant.id, outsider.id)).rejects.toBeInstanceOf(
      EnterpriseNotFound,
    );

    const secondOwner = addUser(owner.db, {
      id: "user-owner-2",
      name: "Second owner",
      email: "owner2@example.com",
    });

    addMember(owner.db, tenant.id, secondOwner, "owner");

    await expect(requestTransfer(owner, tenant.id, secondOwner.id)).rejects.toBeInstanceOf(
      EnterpriseConflict,
    );

    await expect(requestTransfer(owner, tenant.id, target.id)).resolves.toMatchObject({
      targetAccountId: target.id,
    });
  });

  it("allows only one pending transfer per tenant", async () => {
    const owner = makeContext();
    const tenant = await createTenant(owner, "acme");
    const { target } = addTarget(owner.db, tenant.id);

    await requestTransfer(owner, tenant.id, target.id);

    const second = addUser(owner.db, {
      id: "user-target-2",
      name: "Second target",
      email: "target2@example.com",
    });

    addMember(owner.db, tenant.id, second, "member");

    await expect(requestTransfer(owner, tenant.id, second.id)).rejects.toBeInstanceOf(
      EnterpriseConflict,
    );
    expect(owner.db.store.tenant_ownership_transfer).toHaveLength(1);
    expect(owner.db.store.email_outbox).toHaveLength(1);
  });

  it("refuses acceptance by anyone but the target", async () => {
    const owner = makeContext();
    const tenant = await createTenant(owner, "acme");
    const { target } = addTarget(owner.db, tenant.id);
    const created = await requestTransfer(owner, tenant.id, target.id);
    const token = tokenFrom(created.acceptUrl);

    const other = makeContext({
      db: owner.db,
      user: { id: "user-other", name: "Other", email: "other@example.com" },
    });

    addMember(owner.db, tenant.id, other.user, "admin");

    await expect(
      runEffect(other.service.acceptTenantOwnershipTransfer(request(other.headers), { token })),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);

    expect(transferRow(owner.db)?.status).toBe("pending");
    expect(owner.db.store.member.find((row: any) => row.accountId === target.id)?.role).toBe(
      "member",
    );
  });

  it("promotes the target and demotes the requester atomically", async () => {
    const owner = makeContext();
    const tenant = await createTenant(owner, "acme");
    const { target } = addTarget(owner.db, tenant.id);

    const custom = await runEffect(
      owner.service.createTenantRole(request(owner.headers), tenant.id, {
        name: "Support",
        permissions: ["tenant.read", "devices.read"],
      }),
    );

    // A custom role on the target must not survive the promotion: owner
    // authority is built-in only.
    const targetMember = owner.db.store.member.find(
      (row: any) => row.organizationId === tenant.id && row.accountId === target.id,
    );

    targetMember.role = "member";
    targetMember.customRoleId = custom.id;

    const created = await requestTransfer(owner, tenant.id, target.id);
    const token = tokenFrom(created.acceptUrl);

    const targetContext = makeContext({ db: owner.db, user: target });

    const result = await runEffect(
      targetContext.service.acceptTenantOwnershipTransfer(request(targetContext.headers), {
        token,
      }),
    );

    expect(result).toEqual({ tenantId: tenant.id });

    const members = owner.db.store.member.filter((row: any) => row.organizationId === tenant.id);
    const requester = members.find((row: any) => row.accountId === owner.user.id);
    const accepted = members.find((row: any) => row.accountId === target.id);

    expect(accepted).toMatchObject({ role: "owner", customRoleId: null });
    expect(requester).toMatchObject({ role: "admin", customRoleId: null });
    expect(
      members.filter((row: any) => row.role === "owner" && row.customRoleId == null),
    ).toHaveLength(1);

    expect(transferRow(owner.db)).toMatchObject({
      status: "accepted",
      acceptedAt: expect.any(Date),
    });

    const acceptedAudit = owner.db.store.audit_log.find(
      (row: any) => row.action === "member.ownership_transfer_accepted",
    );

    expect(acceptedAudit).toMatchObject({
      organizationId: tenant.id,
      actorAccountId: target.id,
      targetType: "tenant",
      targetId: tenant.id,
    });
    expect(acceptedAudit.metadata).toMatchObject({
      fromUserId: owner.user.id,
      toUserId: target.id,
      requesterRole: "admin",
    });

    // The token is single use.
    await expect(
      runEffect(
        targetContext.service.acceptTenantOwnershipTransfer(request(targetContext.headers), {
          token,
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseConflict);

    expect(accepted).toMatchObject({ role: "owner", customRoleId: null });
    expect(requester).toMatchObject({ role: "admin" });
  });

  it("never leaves the tenant without an owner when the requester is the last owner", async () => {
    const owner = makeContext();
    const tenant = await createTenant(owner, "acme");
    const { target } = addTarget(owner.db, tenant.id);
    const created = await requestTransfer(owner, tenant.id, target.id);

    const before = owner.db.store.member.filter(
      (row: any) => row.organizationId === tenant.id && row.role === "owner",
    );

    expect(before).toHaveLength(1);

    const targetContext = makeContext({ db: owner.db, user: target });

    await runEffect(
      targetContext.service.acceptTenantOwnershipTransfer(request(targetContext.headers), {
        token: tokenFrom(created.acceptUrl),
      }),
    );

    const owners = owner.db.store.member.filter(
      (row: any) =>
        row.organizationId === tenant.id && row.role === "owner" && row.customRoleId == null,
    );

    expect(owners).toHaveLength(1);
    expect(owners[0]!.accountId).toBe(target.id);
  });

  it("keeps other owners in place when ownership moves", async () => {
    const owner = makeContext();
    const tenant = await createTenant(owner, "acme");
    const { target } = addTarget(owner.db, tenant.id);

    const thirdOwner = addUser(owner.db, {
      id: "user-owner-3",
      name: "Third owner",
      email: "owner3@example.com",
    });

    addMember(owner.db, tenant.id, thirdOwner, "owner");

    const created = await requestTransfer(owner, tenant.id, target.id);
    const targetContext = makeContext({ db: owner.db, user: target });

    await runEffect(
      targetContext.service.acceptTenantOwnershipTransfer(request(targetContext.headers), {
        token: tokenFrom(created.acceptUrl),
      }),
    );

    const roles = new Map(
      owner.db.store.member
        .filter((row: any) => row.organizationId === tenant.id)
        .map((row: any) => [row.accountId, row.role]),
    );

    expect(roles.get(thirdOwner.id)).toBe("owner");
    expect(roles.get(target.id)).toBe("owner");
    expect(roles.get(owner.user.id)).toBe("admin");
  });

  it("expires a stale request and refuses acceptance", async () => {
    const owner = makeContext();
    const tenant = await createTenant(owner, "acme");
    const { target } = addTarget(owner.db, tenant.id);
    const created = await requestTransfer(owner, tenant.id, target.id);
    const token = tokenFrom(created.acceptUrl);

    transferRow(owner.db).expiresAt = new Date(Date.now() - 1_000);

    const targetContext = makeContext({ db: owner.db, user: target });

    const preview = await runEffect(
      owner.service.previewTenantOwnershipTransfer(request(), { token }),
    );

    expect(preview.state).toBe("expired");

    await expect(
      runEffect(
        targetContext.service.acceptTenantOwnershipTransfer(request(targetContext.headers), {
          token,
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    expect(transferRow(owner.db)?.status).toBe("expired");
    expect(owner.db.store.member.find((row: any) => row.accountId === target.id)?.role).toBe(
      "member",
    );
    expect(owner.db.store.member.find((row: any) => row.accountId === owner.user.id)?.role).toBe(
      "owner",
    );
  });

  it("hides an expired request from settings and allows a new one", async () => {
    const owner = makeContext();
    const tenant = await createTenant(owner, "acme");
    const { target } = addTarget(owner.db, tenant.id);
    await requestTransfer(owner, tenant.id, target.id);

    transferRow(owner.db).expiresAt = new Date(Date.now() - 1_000);

    await expect(
      runEffect(owner.service.getTenantOwnershipTransfer(request(owner.headers), tenant.id)),
    ).resolves.toEqual({ transfer: null });

    expect(transferRow(owner.db)?.status).toBe("expired");

    const second = addUser(owner.db, {
      id: "user-target-2",
      name: "Second target",
      email: "target2@example.com",
    });

    addMember(owner.db, tenant.id, second, "member");

    await expect(requestTransfer(owner, tenant.id, second.id)).resolves.toMatchObject({
      targetAccountId: second.id,
    });
  });

  it("cancels by requester, target or another owner, but not an unrelated admin", async () => {
    const owner = makeContext();
    const tenant = await createTenant(owner, "acme");
    const { target } = addTarget(owner.db, tenant.id);
    const created = await requestTransfer(owner, tenant.id, target.id);
    const token = tokenFrom(created.acceptUrl);

    const admin = makeContext({
      db: owner.db,
      user: { id: "user-admin", name: "Admin", email: "admin@example.com" },
    });

    addMember(owner.db, tenant.id, admin.user, "admin");

    await expect(
      runEffect(admin.service.cancelTenantOwnershipTransfer(request(admin.headers), tenant.id)),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);

    const targetContext = makeContext({ db: owner.db, user: target });

    await expect(
      runEffect(
        targetContext.service.cancelTenantOwnershipTransfer(
          request(targetContext.headers),
          tenant.id,
        ),
      ),
    ).resolves.toEqual({ status: "ok" });

    expect(transferRow(owner.db)).toMatchObject({
      status: "cancelled",
      cancelledAt: expect.any(Date),
    });
    expect(auditActions(owner.db)).toContain("member.ownership_transfer_cancelled");

    // A canceled token cannot be accepted and previews as cancelled.
    const preview = await runEffect(
      owner.service.previewTenantOwnershipTransfer(request(), { token }),
    );

    expect(preview).toEqual({ state: "cancelled" });

    await expect(
      runEffect(
        targetContext.service.acceptTenantOwnershipTransfer(request(targetContext.headers), {
          token,
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseConflict);
  });

  it("allows the requester and another owner to cancel", async () => {
    const owner = makeContext();
    const tenant = await createTenant(owner, "acme");
    const { target } = addTarget(owner.db, tenant.id);

    await requestTransfer(owner, tenant.id, target.id);

    await expect(
      runEffect(owner.service.cancelTenantOwnershipTransfer(request(owner.headers), tenant.id)),
    ).resolves.toEqual({ status: "ok" });

    await requestTransfer(owner, tenant.id, target.id);

    const otherOwner = makeContext({
      db: owner.db,
      user: { id: "user-owner-4", name: "Other owner", email: "owner4@example.com" },
    });

    addMember(owner.db, tenant.id, otherOwner.user, "owner");

    await expect(
      runEffect(
        otherOwner.service.cancelTenantOwnershipTransfer(request(otherOwner.headers), tenant.id),
      ),
    ).resolves.toEqual({ status: "ok" });
  });

  it("refuses to apply a request whose requester is no longer an owner", async () => {
    const owner = makeContext();
    const tenant = await createTenant(owner, "acme");
    const { target } = addTarget(owner.db, tenant.id);
    const created = await requestTransfer(owner, tenant.id, target.id);

    owner.db.store.member.find((row: any) => row.accountId === owner.user.id)!.role = "admin";

    const targetContext = makeContext({ db: owner.db, user: target });

    await expect(
      runEffect(
        targetContext.service.acceptTenantOwnershipTransfer(request(targetContext.headers), {
          token: tokenFrom(created.acceptUrl),
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseConflict);

    expect(transferRow(owner.db)?.status).toBe("cancelled");
    expect(owner.db.store.member.find((row: any) => row.accountId === target.id)?.role).toBe(
      "member",
    );
  });

  it("previews a valid transfer without exposing the full target address", async () => {
    const owner = makeContext();
    const tenant = await createTenant(owner, "acme");
    const { target } = addTarget(owner.db, tenant.id);
    const created = await requestTransfer(owner, tenant.id, target.id);

    const preview = await runEffect(
      owner.service.previewTenantOwnershipTransfer(request(), {
        token: tokenFrom(created.acceptUrl),
      }),
    );

    expect(preview).toMatchObject({
      state: "valid",
      tenant: { name: "acme", displayName: null },
      requestedByName: owner.user.name,
    });
    expect(preview.targetEmailMasked).toBe("t***@e***.com");
    expect(JSON.stringify(preview)).not.toContain(target.email);

    await expect(
      runEffect(owner.service.previewTenantOwnershipTransfer(request(), { token: "not-a-token" })),
    ).resolves.toEqual({ state: "unknown" });
  });

  it("rolls back when the target membership disappears after the pre-check", async () => {
    const owner = makeContext();
    const tenant = await createTenant(owner, "acme");
    const { target } = addTarget(owner.db, tenant.id);
    const created = await requestTransfer(owner, tenant.id, target.id);

    const targetContext = makeContext({ db: owner.db, user: target });
    const originalTransaction = owner.db.transaction;

    // Simulate a concurrent removal between the pre-check and the locked
    // transaction. The transaction's own read must fail, not demote anyone.
    owner.db.transaction = (work: any) => {
      owner.db.store.member = owner.db.store.member.filter(
        (row: any) => !(row.organizationId === tenant.id && row.accountId === target.id),
      );

      return originalTransaction(work);
    };

    try {
      await expect(
        runEffect(
          targetContext.service.acceptTenantOwnershipTransfer(request(targetContext.headers), {
            token: tokenFrom(created.acceptUrl),
          }),
        ),
      ).rejects.toBeInstanceOf(EnterpriseConflict);
    } finally {
      owner.db.transaction = originalTransaction;
    }

    expect(owner.db.store.member.find((row: any) => row.accountId === owner.user.id)?.role).toBe(
      "owner",
    );
    expect(owner.db.store.member.find((row: any) => row.accountId === target.id)).toBeUndefined();
    expect(transferRow(owner.db)?.status).toBe("pending");
    expect(auditActions(owner.db)).not.toContain("member.ownership_transfer_accepted");
  });

  it("rolls back when the requester stops being an owner after the pre-check", async () => {
    const owner = makeContext();
    const tenant = await createTenant(owner, "acme");
    const { target } = addTarget(owner.db, tenant.id);
    const created = await requestTransfer(owner, tenant.id, target.id);

    const targetContext = makeContext({ db: owner.db, user: target });
    const originalTransaction = owner.db.transaction;

    // A concurrent role change finishes after the pre-check.
    owner.db.transaction = (work: any) => {
      owner.db.store.member.find(
        (row: any) => row.organizationId === tenant.id && row.accountId === owner.user.id,
      )!.role = "admin";

      return originalTransaction(work);
    };

    try {
      await expect(
        runEffect(
          targetContext.service.acceptTenantOwnershipTransfer(request(targetContext.headers), {
            token: tokenFrom(created.acceptUrl),
          }),
        ),
      ).rejects.toBeInstanceOf(EnterpriseConflict);
    } finally {
      owner.db.transaction = originalTransaction;
    }

    expect(owner.db.store.member.find((row: any) => row.accountId === owner.user.id)?.role).toBe(
      "admin",
    );
    expect(owner.db.store.member.find((row: any) => row.accountId === target.id)?.role).toBe(
      "member",
    );
    expect(transferRow(owner.db)?.status).toBe("pending");
    expect(auditActions(owner.db)).not.toContain("member.ownership_transfer_accepted");
  });

  it("expires every stale pending row before inserting a new request", async () => {
    const owner = makeContext();
    const tenant = await createTenant(owner, "acme");
    const { target } = addTarget(owner.db, tenant.id);
    const past = new Date(Date.now() - 60_000);

    for (const id of ["transfer-a", "transfer-b"]) {
      owner.db.store.tenant_ownership_transfer.push({
        id,
        organizationId: tenant.id,
        requestedByAccountId: owner.user.id,
        targetAccountId: target.id,
        status: "pending",
        tokenHash: `hash-${id}`,
        expiresAt: past,
        acceptedAt: null,
        cancelledAt: null,
        createdAt: past,
        updatedAt: past,
      });
    }

    await expect(requestTransfer(owner, tenant.id, target.id)).resolves.toMatchObject({
      targetAccountId: target.id,
    });

    const rows = owner.db.store.tenant_ownership_transfer;
    expect(rows.filter((row: any) => row.id === "transfer-a")[0]).toMatchObject({
      status: "expired",
    });
    expect(rows.filter((row: any) => row.id === "transfer-b")[0]).toMatchObject({
      status: "expired",
    });
    expect(rows.filter((row: any) => row.status === "pending")).toHaveLength(1);
  });

  it("lets a target with a custom role cancel without members.write access", async () => {
    expect(permissionForMethod("cancelTenantOwnershipTransfer")).toBeUndefined();

    const owner = makeContext();
    const tenant = await createTenant(owner, "acme");
    const { target } = addTarget(owner.db, tenant.id);

    const reader = await runEffect(
      owner.service.createTenantRole(request(owner.headers), tenant.id, {
        name: "Tenant reader",
        permissions: ["tenant.read"],
      }),
    );

    owner.db.store.member.find(
      (row: any) => row.organizationId === tenant.id && row.accountId === target.id,
    )!.customRoleId = reader.id;

    await requestTransfer(owner, tenant.id, target.id);

    const targetContext = makeContext({ db: owner.db, user: target });

    await expect(
      runEffect(
        targetContext.service.cancelTenantOwnershipTransfer(
          request(targetContext.headers),
          tenant.id,
        ),
      ),
    ).resolves.toEqual({ status: "ok" });
  });

  it("applies the tenant MFA requirement when accepting", async () => {
    const owner = makeContext();
    const tenant = await createTenant(owner, "acme");
    const { target } = addTarget(owner.db, tenant.id);
    const created = await requestTransfer(owner, tenant.id, target.id);

    owner.db.store.organization.find((row: any) => row.id === tenant.id)!.requireMfa = true;

    const withoutFactor = makeContext({ db: owner.db, user: target });

    await expect(
      runEffect(
        withoutFactor.service.acceptTenantOwnershipTransfer(request(withoutFactor.headers), {
          token: tokenFrom(created.acceptUrl),
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);

    expect(transferRow(owner.db)?.status).toBe("pending");
    expect(owner.db.store.member.find((row: any) => row.accountId === target.id)?.role).toBe(
      "member",
    );

    const withFactor = makeContext({
      db: owner.db,
      user: { ...target, passkeyEnabled: true },
    });

    await expect(
      runEffect(
        withFactor.service.acceptTenantOwnershipTransfer(request(withFactor.headers), {
          token: tokenFrom(created.acceptUrl),
        }),
      ),
    ).resolves.toEqual({ tenantId: tenant.id });

    expect(owner.db.store.member.find((row: any) => row.accountId === target.id)?.role).toBe(
      "owner",
    );
  });

  it("does not report a transfer as valid once the target left", async () => {
    const owner = makeContext();
    const tenant = await createTenant(owner, "acme");
    const { target } = addTarget(owner.db, tenant.id);
    const created = await requestTransfer(owner, tenant.id, target.id);

    owner.db.store.member = owner.db.store.member.filter(
      (row: any) => !(row.organizationId === tenant.id && row.accountId === target.id),
    );

    await expect(
      runEffect(
        owner.service.previewTenantOwnershipTransfer(request(), {
          token: tokenFrom(created.acceptUrl),
        }),
      ),
    ).resolves.toMatchObject({ state: "stale" });
  });
});
