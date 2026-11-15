import { Effect } from "effect";
import { Db } from "@mattrax/enterprise-core";
import { describe, expect, it } from "vitest";
import {
  EnterpriseBadRequest,
  EnterpriseForbidden,
  EnterpriseNotFound,
  EnterprisePermissionDenied,
  EnterpriseUnauthorized,
} from "@mattrax/enterprise-domain";
import { createEnterpriseService } from "../src/enterpriseHandlers.js";
import { scimHandler } from "../src/scim.js";
import { makeDb, makeStripeClient, request, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";
const authSecret = "enterprise-test-secret";

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

/**
 * One authenticated browser context over a shared in-memory store. Multiple
 * contexts on the same `db` model different members of the same tenants (and
 * outsiders), which is what the boundary tests need.
 */
const makeContext = async (
  options: {
    db?: any;
    user?: Partial<TestUser>;
    apiToken?: any;
  } = {},
) => {
  const db = options.db ?? makeDb();
  const user = userRow(options.user);

  if (!db.store.user.some((row: any) => row.id === user.id)) db.store.user.push(user);

  const auth = {
    requireUser: (input: any) => {
      const headers = input instanceof Request ? Object.fromEntries(input.headers) : input.headers;

      return headers.cookie
        ? Effect.succeed({ user, apiToken: options.apiToken })
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
    stripeClient: makeStripeClient(),
    // SAFETY: these tests never reach R2; the service only stores the binding.
    storage: {} as any,
    // SAFETY: the fake implements only the auth methods these tests exercise.
    auth: auth as any,
    authSecret,
  });

  return { db, service, user, headers: { cookie: "mattrax_session=test" } };
};

const addMember = (
  db: any,
  tenantId: string,
  user: { id: string },
  role: string,
  customRoleId?: string | null,
) => {
  const existing = db.store.member.find(
    (row: any) => row.organizationId === tenantId && row.userId === user.id,
  );

  if (existing) {
    existing.role = role;
    existing.customRoleId = customRoleId ?? null;

    return existing;
  }

  const now = new Date();

  const member = {
    id: `member-${user.id}`,
    organizationId: tenantId,
    userId: user.id,
    role,
    customRoleId: customRoleId ?? null,
    createdAt: now,
    updatedAt: now,
  };

  db.store.member.push(member);

  return member;
};

const createTenant = async (context: Awaited<ReturnType<typeof makeContext>>, slug: string) => {
  return runEffect(
    context.service.createTenant(request(context.headers), { name: slug, slug }),
  );
};

const createRole = (
  context: Awaited<ReturnType<typeof makeContext>>,
  tenantId: string,
  name: string,
  permissions: ReadonlyArray<string>,
) =>
  runEffect(
    context.service.createTenantRole(request(context.headers), tenantId, { name, permissions }),
  );

describe("tenant membership boundaries", () => {
  it("rejects an authenticated non-member from tenant data and hides the tenant", async () => {
    const owner = await makeContext();
    const tenant = await createTenant(owner, "acme");

    const outsider = await makeContext({
      db: owner.db,
      user: {
        id: "user-outsider",
        name: "Outsider",
        email: "outsider@example.com",
      },
    });

    await expect(
      runEffect(outsider.service.getTenant(request(outsider.headers), tenant.id)),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);
    await expect(
      runEffect(outsider.service.listDevices(request(outsider.headers), tenant.id)),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);
    await expect(
      runEffect(
        outsider.service.patchTenant(request(outsider.headers), tenant.id, { name: "Hijacked" }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);

    // The member list is the only tenant directory `listTenants` exposes, so a
    // non-member must not see the tenant at all.
    await expect(
      runEffect(outsider.service.listTenants(request(outsider.headers))),
    ).resolves.toEqual({ tenants: [] });
    expect(owner.db.store.organization.find((row: any) => row.id === tenant.id)?.name).toBe("acme");
  });

  it("rejects an unverified account from tenant data even when it is a member", async () => {
    const owner = await makeContext();
    const tenant = await createTenant(owner, "acme");

    const unverified = await makeContext({
      db: owner.db,
      user: { emailVerified: false },
    });

    await expect(
      runEffect(unverified.service.getTenant(request(unverified.headers), tenant.id)),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);
    await expect(
      runEffect(unverified.service.listDevices(request(unverified.headers), tenant.id)),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);
    await expect(
      runEffect(unverified.service.listTenants(request(unverified.headers))),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);
  });
});

describe("tenant MFA requirement", () => {
  it("blocks an administrator's reads and writes but keeps member and auditor reads", async () => {
    const owner = await makeContext();
    const tenant = await createTenant(owner, "acme");
    const now = new Date();

    owner.db.store.sso_config.push({
      organizationId: tenant.id,
      enabled: true,
      azureTenantId: null,
      autoProvision: true,
      requireMfa: true,
      createdAt: now,
      updatedAt: now,
    });

    // The owner also holds write permissions and has no factor enrolled.
    await expect(
      runEffect(owner.service.getTenant(request(owner.headers), tenant.id)),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);

    const admin = await makeContext({
      db: owner.db,
      user: { id: "user-admin", name: "Admin", email: "admin@example.com" },
    });

    addMember(owner.db, tenant.id, admin.user, "admin");

    await expect(
      runEffect(admin.service.getTenant(request(admin.headers), tenant.id)),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);
    await expect(
      runEffect(
        admin.service.patchTenant(request(admin.headers), tenant.id, { name: "Changed" }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);

    for (const [id, role] of [
      ["user-member", "member"],
      ["user-auditor", "auditor"],
    ] as const) {
      const reader = await makeContext({
        db: owner.db,
        user: { id, name: role, email: `${role}@example.com` },
      });

      addMember(owner.db, tenant.id, reader.user, role);

      await expect(
        runEffect(reader.service.getTenant(request(reader.headers), tenant.id)),
      ).resolves.toMatchObject({ id: tenant.id });
      await expect(
        runEffect(
          reader.service.patchTenant(request(reader.headers), tenant.id, { name: "Changed" }),
        ),
      ).rejects.toBeInstanceOf(EnterprisePermissionDenied);
    }

    expect(owner.db.store.organization.find((row: any) => row.id === tenant.id)?.name).toBe("acme");
  });
});

describe("cross-tenant references", () => {
  it("rejects a user or user group from another tenant in policy assignments", async () => {
    const first = await makeContext();
    const firstTenant = await createTenant(first, "first");

    const second = await makeContext({
      db: first.db,
      user: { id: "user-second", name: "Second Owner", email: "second@example.com" },
    });

    const secondTenant = await createTenant(second, "second");

    const policy = await runEffect(
      first.service.createPolicy(request(first.headers), firstTenant.id, { name: "Baseline" }),
    );

    const now = new Date();

    first.db.store.user_group.push({
      id: "group-second",
      organizationId: secondTenant.id,
      name: "Second Staff",
      externalId: null,
      description: null,
      source: "manual",
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      runEffect(
        first.service.patchPolicyAssignments(request(first.headers), firstTenant.id, policy.id, {
          assignUsers: [second.user.id],
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    await expect(
      runEffect(
        first.service.patchPolicyAssignments(request(first.headers), firstTenant.id, policy.id, {
          assignUserGroups: ["group-second"],
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    // Nothing leaked into either assignment table.
    expect(first.db.store.user_policy ?? []).toEqual([]);
    expect(first.db.store.user_group_policy ?? []).toEqual([]);
  });

  it("rejects a user from another tenant in device assignments", async () => {
    const first = await makeContext();
    const firstTenant = await createTenant(first, "first");

    const second = await makeContext({
      db: first.db,
      user: { id: "user-second", name: "Second Owner", email: "second@example.com" },
    });

    await createTenant(second, "second");

    const now = new Date();

    first.db.store.device.push({
      id: "device-first",
      organizationId: firstTenant.id,
      proto: "apple",
      status: "enrolled",
      name: "Mac",
      enrolledAt: now,
      lastSeenAt: now,
    });

    await expect(
      runEffect(
        first.service.setDeviceUsers(request(first.headers), firstTenant.id, "device-first", {
          userIds: [second.user.id],
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    expect(first.db.store.device_user ?? []).toEqual([]);
  });
});

describe("custom role delegation ceiling", () => {
  it("stops an administrator creating or patching a role above their permissions", async () => {
    const owner = await makeContext();
    const tenant = await createTenant(owner, "acme");

    const admin = await makeContext({
      db: owner.db,
      user: { id: "user-admin", name: "Admin", email: "admin@example.com" },
    });

    addMember(owner.db, tenant.id, admin.user, "admin");

    // Owner-only permissions are refused even before the general ceiling.
    for (const permission of ["tenant.delete", "tenant.export", "backups.write"]) {
      await expect(
        runEffect(
          admin.service.createTenantRole(request(admin.headers), tenant.id, {
            name: `Escalated ${permission}`,
            permissions: [permission],
          }),
        ),
      ).rejects.toBeInstanceOf(EnterpriseForbidden);
    }

    // The admin does hold these, so delegating them is allowed.
    const helpdesk = await runEffect(
      admin.service.createTenantRole(request(admin.headers), tenant.id, {
        name: "Helpdesk",
        permissions: ["tenant.read", "devices.read", "devices.write"],
      }),
    );

    await expect(
      runEffect(
        admin.service.patchTenantRole(request(admin.headers), tenant.id, helpdesk.id, {
          permissions: ["tenant.delete"],
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);

    // The stored role is unchanged after the rejected patch.
    expect(
      owner.db.store.tenant_role.find((row: any) => row.id === helpdesk.id)?.permissions,
    ).toEqual(["tenant.read", "devices.read", "devices.write"]);
  });

  it("stops an administrator assigning a privileged custom role but lets an owner", async () => {
    const owner = await makeContext();
    const tenant = await createTenant(owner, "acme");

    const admin = await makeContext({
      db: owner.db,
      user: { id: "user-admin", name: "Admin", email: "admin@example.com" },
    });

    addMember(owner.db, tenant.id, admin.user, "admin");

    const target = await makeContext({
      db: owner.db,
      user: { id: "user-target", name: "Target", email: "target@example.com" },
    });

    const targetMember = addMember(owner.db, tenant.id, target.user, "member");

    const privileged = await runEffect(
      owner.service.createTenantRole(request(owner.headers), tenant.id, {
        name: "Lifecycle",
        permissions: ["tenant.read", "tenant.delete", "tenant.export", "backups.write"],
      }),
    );

    // An owner may create and assign it...
    await runEffect(
      owner.service.patchTenantUser(request(owner.headers), tenant.id, targetMember.id, {
        roleId: privileged.id,
      }),
    );
    expect(
      owner.db.store.member.find((row: any) => row.id === targetMember.id)?.customRoleId,
    ).toBe(privileged.id);

    // ...but an administrator cannot hand it to anyone else.
    const secondTarget = await makeContext({
      db: owner.db,
      user: { id: "user-second-target", name: "Second", email: "second@example.com" },
    });

    const secondMember = addMember(owner.db, tenant.id, secondTarget.user, "member");

    await expect(
      runEffect(
        admin.service.patchTenantUser(request(admin.headers), tenant.id, secondMember.id, {
          roleId: privileged.id,
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);
    await expect(
      runEffect(
        admin.service.inviteTenantUser(request(admin.headers), tenant.id, {
          email: "invited@example.com",
          roleId: privileged.id,
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);

    expect(
      owner.db.store.member.find((row: any) => row.id === secondMember.id)?.customRoleId,
    ).toBeNull();
    expect(owner.db.store.invitation).toEqual([]);
  });

  it("uses a custom role's own permissions as the delegating ceiling", async () => {
    const owner = await makeContext();
    const tenant = await createTenant(owner, "acme");

    const delegated = await makeContext({
      db: owner.db,
      user: { id: "user-delegated", name: "Delegated", email: "delegated@example.com" },
    });

    const helpdesk = await runEffect(
      owner.service.createTenantRole(request(owner.headers), tenant.id, {
        name: "Role Manager",
        permissions: ["tenant.read", "roles.read", "roles.write", "members.read"],
      }),
    );

    addMember(owner.db, tenant.id, delegated.user, "member", helpdesk.id);

    // `roles.write` is enough to reach the endpoint, but the actor does not
    // hold tenant.write or tenant.delete, so neither can be delegated onward.
    for (const permission of ["tenant.write", "tenant.delete", "devices.write"]) {
      await expect(
        runEffect(
          delegated.service.createTenantRole(request(delegated.headers), tenant.id, {
            name: `Delegated ${permission}`,
            permissions: [permission],
          }),
        ),
      ).rejects.toBeInstanceOf(EnterpriseForbidden);
    }

    // A permission the actor does hold is fine.
    const readOnly = await runEffect(
      delegated.service.createTenantRole(request(delegated.headers), tenant.id, {
        name: "Read only",
        permissions: ["tenant.read"],
      }),
    );

    expect(readOnly.id).toBeDefined();
  });
});

describe("built-in role delegation ceiling", () => {
  it("stops a custom-role member with members.write assigning admin to self or others", async () => {
    const owner = await makeContext();
    const tenant = await createTenant(owner, "acme");

    const actor = await makeContext({
      db: owner.db,
      user: { id: "user-actor", name: "Actor", email: "actor@example.com" },
    });

    const memberManager = await createRole(owner, tenant.id, "Member manager", [
      "tenant.read",
      "members.read",
      "members.write",
    ]);

    const actorMember = addMember(owner.db, tenant.id, actor.user, "member", memberManager.id);

    const target = await makeContext({
      db: owner.db,
      user: { id: "user-target", name: "Target", email: "target@example.com" },
    });

    const targetMember = addMember(owner.db, tenant.id, target.user, "member");

    // Neither self-promotion nor promoting someone else may exceed the actor's
    // own permission set, even though `members.write` reaches the endpoint.
    for (const memberId of [actorMember.id, targetMember.id]) {
      await expect(
        runEffect(
          actor.service.patchTenantUser(request(actor.headers), tenant.id, memberId, {
            role: "admin",
          }),
        ),
      ).rejects.toBeInstanceOf(EnterpriseForbidden);
    }

    // Inviting an administrator is the same delegation and is refused.
    await expect(
      runEffect(
        actor.service.inviteTenantUser(request(actor.headers), tenant.id, {
          email: "admin-invite@example.com",
          role: "admin",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);

    expect(owner.db.store.member.find((row: any) => row.id === actorMember.id)?.role).toBe(
      "member",
    );
    expect(owner.db.store.member.find((row: any) => row.id === targetMember.id)?.role).toBe(
      "member",
    );
    expect(owner.db.store.invitation).toEqual([]);
  });

  it("lets owners and administrators grant built-in roles within their ceiling", async () => {
    const owner = await makeContext();
    const tenant = await createTenant(owner, "acme");

    const admin = await makeContext({
      db: owner.db,
      user: { id: "user-admin", name: "Admin", email: "admin@example.com" },
    });

    addMember(owner.db, tenant.id, admin.user, "admin");

    const target = await makeContext({
      db: owner.db,
      user: { id: "user-target", name: "Target", email: "target@example.com" },
    });

    const targetMember = addMember(owner.db, tenant.id, target.user, "member");

    for (const actor of [owner, admin]) {
      for (const role of ["member", "auditor", "admin"]) {
        await runEffect(
          actor.service.patchTenantUser(request(actor.headers), tenant.id, targetMember.id, {
            role,
          }),
        );

        expect(owner.db.store.member.find((row: any) => row.id === targetMember.id)?.role).toBe(
          role,
        );
      }
    }
  });

  it("rejects a custom role that also carries built-in owner on invite and patch", async () => {
    const owner = await makeContext();
    const tenant = await createTenant(owner, "acme");

    const custom = await createRole(owner, tenant.id, "Support", ["tenant.read", "devices.read"]);

    const target = await makeContext({
      db: owner.db,
      user: { id: "user-target", name: "Target", email: "target@example.com" },
    });

    const targetMember = addMember(owner.db, tenant.id, target.user, "member");

    await expect(
      runEffect(
        owner.service.inviteTenantUser(request(owner.headers), tenant.id, {
          email: "invited@example.com",
          roleId: custom.id,
          role: "owner",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    await expect(
      runEffect(
        owner.service.patchTenantUser(request(owner.headers), tenant.id, targetMember.id, {
          roleId: custom.id,
          role: "owner",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    expect(owner.db.store.invitation).toEqual([]);
    expect(
      owner.db.store.member.find((row: any) => row.id === targetMember.id)?.customRoleId,
    ).toBeNull();
    expect(owner.db.store.member.find((row: any) => row.id === targetMember.id)?.role).toBe(
      "member",
    );
  });

  it("does not count a custom-role member's legacy owner string as owner authority", async () => {
    const owner = await makeContext();
    const tenant = await createTenant(owner, "acme");

    const actor = await makeContext({
      db: owner.db,
      user: { id: "user-actor", name: "Actor", email: "actor@example.com" },
    });

    const memberManager = await createRole(owner, tenant.id, "Member manager", [
      "tenant.read",
      "members.read",
      "members.write",
    ]);

    // A stale/legacy row: the raw built-in role says owner while a custom role
    // is actually authoritative.
    addMember(owner.db, tenant.id, actor.user, "owner", memberManager.id);

    const ownerMember = owner.db.store.member.find(
      (row: any) => row.organizationId === tenant.id && row.userId === owner.user.id,
    );

    // The forged owner neither gains owner powers...
    await expect(
      runEffect(
        actor.service.patchTenantUser(request(actor.headers), tenant.id, ownerMember.id, {
          role: "member",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);
    await expect(
      runEffect(actor.service.removeTenantUser(request(actor.headers), tenant.id, ownerMember.id)),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);

    // ...nor inflates the owner count: the real owner is still the last one.
    await expect(
      runEffect(
        owner.service.removeTenantUser(request(owner.headers), tenant.id, ownerMember.id),
      ),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);

    expect(owner.db.store.member.some((row: any) => row.id === ownerMember.id)).toBe(true);
  });
});

describe("SCIM provisioning boundary", () => {
  type ScimCreateUserBody = {
    userName: string;
    roles?: ReadonlyArray<{ value: string }>;
  };

  const tokenHash = async (value: string) => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));

    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  };

  const setupScim = async (
    context: Awaited<ReturnType<typeof makeContext>>,
    tenantId: string,
    token: string,
  ) => {
    const timestamp = new Date();

    context.db.store.scim_token.push({
      id: "scim-token-1",
      organizationId: tenantId,
      name: "Boundary test",
      tokenHash: await tokenHash(token),
      lastUsedAt: null,
      revokedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  };

  const scimCreateUser = (token: string, tenantId: string, body: ScimCreateUserBody) =>
    // SAFETY: the SCIM handler only reads headers, url, method and the JSON
    // effect from its request value; this mirrors helpers.request.
    scimHandler({
      headers: { authorization: `Bearer ${token}` },
      url: `https://enterprise.test/scim/v2/${tenantId}/Users`,
      method: "POST",
      json: Effect.succeed(body),
    } as any);

  it("cannot provision an owner or administrator", async () => {
    const owner = await makeContext();
    const tenant = await createTenant(owner, "acme");
    const token = "scim-boundary-token";

    await setupScim(owner, tenant.id, token);

    for (const role of ["owner", "admin"]) {
      const response = await runEffect(
        Effect.provideService(
          scimCreateUser(token, tenant.id, {
            userName: `${role}@example.com`,
            roles: [{ value: role }],
          }),
          Db,
          owner.db,
        ),
      );

      expect(response.status).toBe(400);
    }

    // The only owner is the original creator; SCIM created no membership.
    expect(
      owner.db.store.member.filter(
        (row: any) => row.organizationId === tenant.id && row.role === "owner",
      ),
    ).toHaveLength(1);
    expect(
      owner.db.store.member.some(
        (row: any) => row.organizationId === tenant.id && row.role === "admin",
      ),
    ).toBe(false);

    // Plain members are still provisioned.
    const response = await runEffect(
      Effect.provideService(
        scimCreateUser(token, tenant.id, {
          userName: "member@example.com",
          roles: [{ value: "member" }],
        }),
        Db,
        owner.db,
      ),
    );

    expect(response.status).toBe(201);
    expect(
      owner.db.store.member.some(
        (row: any) => row.organizationId === tenant.id && row.role === "member",
      ),
    ).toBe(true);
  });

  it("coerces common non-privileged role labels and settles matching invitations", async () => {
    const owner = await makeContext();
    const tenant = await createTenant(owner, "acme");
    const token = "scim-role-label-token";

    await setupScim(owner, tenant.id, token);

    for (const [role, email] of [
      ["User", "user-label@example.com"],
      ["Employee", "employee-label@example.com"],
      ["Member", "member-label@example.com"],
    ] as const) {
      const response = await runEffect(
        Effect.provideService(
          scimCreateUser(token, tenant.id, {
            userName: email,
            roles: [{ value: role }],
          }),
          Db,
          owner.db,
        ),
      );

      expect(response.status, `${role} should provision`).toBe(201);
      const provisioned = owner.db.store.user.find((row: any) => row.email === email);
      expect(
        owner.db.store.member.some(
          (row: any) =>
            row.organizationId === tenant.id &&
            row.userId === provisioned?.id &&
            row.role === "member",
        ),
      ).toBe(true);
    }

    const invitedEmail = "scim-settled@example.com";

    const invitation = await runEffect(
      owner.service.inviteTenantUser(request(owner.headers), tenant.id, {
        email: invitedEmail,
        role: "member",
      }),
    );

    const response = await runEffect(
      Effect.provideService(
        scimCreateUser(token, tenant.id, {
          userName: invitedEmail,
          roles: [{ value: "Employee" }],
        }),
        Db,
        owner.db,
      ),
    );

    expect(response.status).toBe(201);
    expect(
      owner.db.store.invitation.find((row: any) => row.id === invitation.id),
    ).toMatchObject({ status: "accepted" });
  });
});

describe("owner removal", () => {
  it("refuses to let an administrator remove an owner", async () => {
    const owner = await makeContext();
    const tenant = await createTenant(owner, "acme");

    const admin = await makeContext({
      db: owner.db,
      user: { id: "user-admin", name: "Admin", email: "admin@example.com" },
    });

    addMember(owner.db, tenant.id, admin.user, "admin");

    const ownerMember = owner.db.store.member.find(
      (row: any) => row.organizationId === tenant.id && row.userId === owner.user.id,
    );

    await expect(
      runEffect(
        admin.service.removeTenantUser(request(admin.headers), tenant.id, ownerMember.id),
      ),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);

    expect(owner.db.store.member.some((row: any) => row.id === ownerMember.id)).toBe(true);
  });

  it("still refuses to remove the last owner", async () => {
    const owner = await makeContext();
    const tenant = await createTenant(owner, "acme");

    const secondOwner = await makeContext({
      db: owner.db,
      user: { id: "user-owner-2", name: "Second Owner", email: "owner2@example.com" },
    });

    const secondOwnerMember = addMember(owner.db, tenant.id, secondOwner.user, "owner");

    const remaining = await makeContext({
      db: owner.db,
      user: { id: "user-member", name: "Member", email: "member@example.com" },
    });

    addMember(owner.db, tenant.id, remaining.user, "member");

    // With two owners, an owner may remove the other owner...
    await runEffect(
      owner.service.removeTenantUser(request(owner.headers), tenant.id, secondOwnerMember.id),
    );

    // ...but the last owner cannot remove themselves while other members remain.
    const ownerMember = owner.db.store.member.find(
      (row: any) => row.organizationId === tenant.id && row.userId === owner.user.id,
    );

    await expect(
      runEffect(
        owner.service.removeTenantUser(request(owner.headers), tenant.id, ownerMember.id),
      ),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);
  });
});
