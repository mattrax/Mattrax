import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  EnterpriseBadRequest,
  EnterpriseForbidden,
  EnterpriseUnauthorized,
} from "@mattrax/enterprise-domain";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { permissionForMethod } from "@mattrax/enterprise-identity";
import { makeDb, makeStripeClient, request, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";

const headers = { cookie: "mattrax_session=test" };

const timestamp = new Date("2026-11-01T00:00:00.000Z");

describe("bulk member permissions", () => {
  it("guards both bulk endpoints with members.write", () => {
    expect(permissionForMethod("patchTenantAccountRoles")).toBe("members.write");
    expect(permissionForMethod("addUserGroupMembers")).toBe("members.write");
  });
});

const makeContext = () => {
  const db = makeDb();

  const user = {
    id: "user-1",
    name: "Owner",
    email: "owner@example.com",
    emailVerified: true,
    image: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  db.store.account.push(user);

  const auth = {
    requireUser: (input: any) => {
      const inputHeaders =
        input instanceof Request ? Object.fromEntries(input.headers) : input.headers;

      return inputHeaders.cookie
        ? Effect.succeed({ user })
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
    stripeClient: makeStripeClient(),
    // SAFETY: these tests never reach R2; the service only stores the binding.
    storage: {} as any,
    // SAFETY: the fake only implements the auth methods these tests exercise.
    auth: auth as any,
    authSecret: "bulk-assignments-test-secret",
  });

  return { db, service };
};

const makeTenant = async (context: ReturnType<typeof makeContext>) =>
  runEffect(context.service.createTenant(request(headers), { name: "Acme", slug: "acme" }));

const seedMember = (
  context: ReturnType<typeof makeContext>,
  tenantId: string,
  accountId: string,
  role = "member",
  organizationId = tenantId,
) => {
  context.db.store.account.push({
    id: accountId,
    name: accountId,
    email: `${accountId}@example.com`,
    emailVerified: true,
    image: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  context.db.store.member.push({
    id: `member-${accountId}`,
    organizationId,
    accountId,
    role,
    customRoleId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
};

const seedUser = (
  context: ReturnType<typeof makeContext>,
  tenantId: string,
  id: string,
  organizationId = tenantId,
) =>
  context.db.store.user.push({
    id,
    organizationId,
    name: id,
    email: `${id}@example.com`,
    externalId: null,
    source: "manual",
    disabled: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

const auditFor = (context: ReturnType<typeof makeContext>, action: string) =>
  context.db.store.audit_log.find((entry: any) => entry.action === action);

describe("bulk member role changes", () => {
  it("changes several members and writes one bounded audit entry", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);
    seedMember(context, tenant.id, "user-2");
    seedMember(context, tenant.id, "user-3");

    const result = await runEffect(
      context.service.patchTenantAccountRoles(request(headers), tenant.id, {
        accountIds: ["user-2", "user-3"],
        role: "admin",
      }),
    );

    expect(result).toEqual({ updated: ["user-2", "user-3"], failed: [] });
    expect(
      context.db.store.member
        .filter((member: any) => member.accountId !== "user-1")
        .map((member: any) => member.role),
    ).toEqual(["admin", "admin"]);

    expect(auditFor(context, "member.roles_changed")).toMatchObject({
      targetType: "user",
      targetId: null,
      metadata: {
        role: "admin",
        roleId: null,
        requested: 2,
        updated: 2,
        failed: 0,
        accountIds: ["user-2", "user-3"],
        truncated: false,
      },
    });
  });

  it("reports per-row failures and ignores accounts outside the tenant", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);
    seedMember(context, tenant.id, "user-2");
    seedMember(context, "other-tenant", "user-3", "member", "other-tenant");

    const result = await runEffect(
      context.service.patchTenantAccountRoles(request(headers), tenant.id, {
        accountIds: ["user-2", "user-3", "missing"],
        role: "auditor",
      }),
    );

    expect(result).toEqual({
      updated: ["user-2"],
      failed: [
        { id: "user-3", reason: "notFound" },
        { id: "missing", reason: "notFound" },
      ],
    });
    expect(context.db.store.member.find((member: any) => member.accountId === "user-3")?.role).toBe(
      "member",
    );
  });

  it("refuses owner changes for non-owners and the last owner demotion", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);
    seedMember(context, tenant.id, "user-2", "owner");
    seedMember(context, tenant.id, "user-3");

    context.db.store.member[0].role = "admin";

    const ownerResult = await runEffect(
      context.service.patchTenantAccountRoles(request(headers), tenant.id, {
        accountIds: ["user-2", "user-3"],
        role: "member",
      }),
    );

    expect(ownerResult).toEqual({
      updated: ["user-3"],
      failed: [{ id: "user-2", reason: "forbidden" }],
    });
    expect(context.db.store.member[1].role).toBe("owner");
    expect(context.db.store.member[2].role).toBe("member");
  });

  it("refuses to demote the last owner", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);

    const lastOwner = await runEffect(
      context.service.patchTenantAccountRoles(request(headers), tenant.id, {
        accountIds: ["user-1"],
        role: "admin",
      }),
    );

    expect(lastOwner).toEqual({
      updated: [],
      failed: [{ id: "user-1", reason: "lastOwner" }],
    });
    expect(context.db.store.member[0].role).toBe("owner");
  });

  it("demotes one of two owners and leaves the other in place", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);
    seedMember(context, tenant.id, "user-2", "owner");

    const result = await runEffect(
      context.service.patchTenantAccountRoles(request(headers), tenant.id, {
        accountIds: ["user-1", "user-2"],
        role: "admin",
      }),
    );

    expect(result).toEqual({
      updated: ["user-1"],
      failed: [{ id: "user-2", reason: "lastOwner" }],
    });
    expect(context.db.store.member[0].role).toBe("admin");
    expect(context.db.store.member[1].role).toBe("owner");
  });

  it("refuses a non-owner assigning the owner role", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);
    seedMember(context, tenant.id, "user-2");

    context.db.store.member[0].role = "admin";

    await expect(
      runEffect(
        context.service.patchTenantAccountRoles(request(headers), tenant.id, {
          accountIds: ["user-2"],
          role: "owner",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);
    expect(context.db.store.member[1].role).toBe("member");
  });

  it("protects an owner fallback row that also carries a custom role", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);
    seedMember(context, tenant.id, "user-2", "owner");
    context.db.store.member[1].customRoleId = "legacy-custom-role";

    context.db.store.member[0].role = "admin";

    const result = await runEffect(
      context.service.patchTenantAccountRoles(request(headers), tenant.id, {
        accountIds: ["user-2"],
        role: "member",
      }),
    );

    expect(result).toEqual({
      updated: [],
      failed: [{ id: "user-2", reason: "forbidden" }],
    });
    expect(context.db.store.member[1].role).toBe("owner");
    expect(context.db.store.member[1].customRoleId).toBe("legacy-custom-role");
  });

  it("refuses a custom-role actor assigning a built-in role above its ceiling", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);
    seedMember(context, tenant.id, "user-2");

    const actorRole = await runEffect(
      context.service.createTenantRole(request(headers), tenant.id, {
        name: "Helpdesk",
        permissions: ["tenant.read", "tenant.write", "members.write"],
      }),
    );

    context.db.store.member[0].customRoleId = actorRole.id;
    context.db.store.member[0].role = "member";

    await expect(
      runEffect(
        context.service.patchTenantAccountRoles(request(headers), tenant.id, {
          accountIds: ["user-2"],
          role: "admin",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);
    expect(context.db.store.member[1].role).toBe("member");
  });

  it("rejects a custom role above the actor's permission ceiling", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);
    seedMember(context, tenant.id, "user-2");

    const tooWide = await runEffect(
      context.service.createTenantRole(request(headers), tenant.id, {
        name: "Device manager",
        permissions: ["tenant.read", "devices.write"],
      }),
    );

    const actorRole = await runEffect(
      context.service.createTenantRole(request(headers), tenant.id, {
        name: "Helpdesk",
        permissions: ["tenant.read", "tenant.write", "members.write"],
      }),
    );

    context.db.store.member[0].customRoleId = actorRole.id;
    context.db.store.member[0].role = "member";

    await expect(
      runEffect(
        context.service.patchTenantAccountRoles(request(headers), tenant.id, {
          accountIds: ["user-2"],
          roleId: tooWide.id,
          role: "member",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);
    // A rejected delegation changes nothing.
    expect(context.db.store.member[1].customRoleId).toBeNull();
  });

  it("is idempotent and bounds the ids recorded in the audit entry", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);
    const accountIds = Array.from({ length: 55 }, (_, index) => `user-${index + 2}`);

    for (const accountId of accountIds) seedMember(context, tenant.id, accountId);

    const first = await runEffect(
      context.service.patchTenantAccountRoles(request(headers), tenant.id, {
        accountIds,
        role: "auditor",
      }),
    );

    const second = await runEffect(
      context.service.patchTenantAccountRoles(request(headers), tenant.id, {
        accountIds,
        role: "auditor",
      }),
    );

    expect(first.updated).toHaveLength(accountIds.length);
    expect(second.updated).toEqual(first.updated);
    expect(second.failed).toEqual([]);

    const entry = auditFor(context, "member.roles_changed");

    expect(entry?.metadata).toMatchObject({
      requested: 55,
      updated: 55,
      failed: 0,
      truncated: true,
    });
    const metadata = entry?.metadata;

    const recorded = Schema.is(Schema.Struct({ accountIds: Schema.Array(Schema.String) }))(metadata)
      ? metadata.accountIds
      : [];

    expect(recorded).toHaveLength(50);
  });
});

describe("bulk directory group membership", () => {
  const seedGroup = (
    context: ReturnType<typeof makeContext>,
    tenantId: string,
    id: string,
    organizationId = tenantId,
  ) =>
    context.db.store.user_group.push({
      id,
      organizationId,
      name: id,
      externalId: null,
      description: null,
      source: "manual",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

  it("adds users, reports partial failures and is idempotent", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);
    seedGroup(context, tenant.id, "group-1");
    seedUser(context, tenant.id, "user-2");
    seedUser(context, tenant.id, "user-3");
    seedUser(context, "other-tenant", "user-4", "other-tenant");

    const first = await runEffect(
      context.service.addUserGroupMembers(request(headers), tenant.id, "group-1", {
        userIds: ["user-2", "user-3", "user-4"],
      }),
    );

    expect(first).toEqual({
      updated: ["user-2", "user-3"],
      failed: [{ id: "user-4", reason: "notFound" }],
    });
    expect(context.db.store.user_group_member.map((row: any) => [row.groupId, row.userId])).toEqual(
      [
        ["group-1", "user-2"],
        ["group-1", "user-3"],
      ],
    );

    const second = await runEffect(
      context.service.addUserGroupMembers(request(headers), tenant.id, "group-1", {
        userIds: ["user-2", "user-3", "user-4"],
      }),
    );

    expect(second).toEqual(first);
    expect(context.db.store.user_group_member).toHaveLength(2);

    expect(auditFor(context, "directory.group_members_added")).toMatchObject({
      targetType: "directoryGroup",
      targetId: "group-1",
      metadata: {
        source: "manual",
        requested: 3,
        updated: 2,
        failed: 1,
        userIds: ["user-2", "user-3", "user-4"],
        truncated: false,
      },
    });
  });

  it("refuses a group from another tenant", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);
    seedGroup(context, "other-tenant", "group-2", "other-tenant");
    seedUser(context, tenant.id, "user-2");

    await expect(
      runEffect(
        context.service.addUserGroupMembers(request(headers), tenant.id, "group-2", {
          userIds: ["user-2"],
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
    expect(context.db.store.user_group_member).toEqual([]);
  });

  it("re-derives a linked device group through device_user", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);
    seedGroup(context, tenant.id, "group-1");
    seedUser(context, tenant.id, "user-2");

    context.db.store.enterprise_group.push({
      id: "device-group-1",
      organizationId: tenant.id,
      name: "Linked devices",
      notes: null,
      kind: "manual",
      rules: null,
      directoryGroupId: "group-1",
      lastEvaluatedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    context.db.store.device.push({
      id: "device-1",
      organizationId: tenant.id,
      name: "Ada's Mac",
      proto: "apple",
      status: "enrolled",
      enrolledAt: timestamp,
      lastSeenAt: timestamp,
    });
    context.db.store.device_user.push({
      organizationId: tenant.id,
      deviceId: "device-1",
      userId: "user-2",
      source: "manual",
      createdAt: timestamp,
    });

    await runEffect(
      context.service.addUserGroupMembers(request(headers), tenant.id, "group-1", {
        userIds: ["user-2"],
      }),
    );

    expect(context.db.store.group_device).toContainEqual({
      groupId: "device-group-1",
      deviceId: "device-1",
      source: "directory",
    });
  });
});
