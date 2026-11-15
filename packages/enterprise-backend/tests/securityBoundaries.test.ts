import { Effect } from "effect";
import { Db } from "@mattrax/enterprise-core";
import { describe, expect, it } from "vitest";
import {
  EnterpriseBadRequest,
  EnterpriseForbidden,
  EnterpriseNotFound,
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
  return runEffect(context.service.createTenant(request(context.headers), { name: slug, slug }));
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
  /**
   * The requirement is a tenant property (`organization.require_mfa`) and binds
   * every role. Read-only members and auditors are not exempt: read access to
   * tenant data is the thing a borrowed session is after. Account endpoints are
   * not tenant-scoped, so a blocked member can still enrol a factor.
   */
  it("blocks every role until a factor is enrolled, but not account settings", async () => {
    const owner = await makeContext();
    const tenant = await createTenant(owner, "acme");

    owner.db.store.organization.find((row: any) => row.id === tenant.id)!.requireMfa = true;

    // The owner has no factor enrolled.
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
      runEffect(admin.service.patchTenant(request(admin.headers), tenant.id, { name: "Changed" })),
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

      // Every role is blocked, including read-only ones.
      await expect(
        runEffect(reader.service.getTenant(request(reader.headers), tenant.id)),
      ).rejects.toBeInstanceOf(EnterpriseForbidden);

      // The account surface stays reachable, so the member can enrol a factor.
      await expect(runEffect(reader.service.me(request(reader.headers)))).resolves.toMatchObject({
        user: { id },
      });
    }

    // Enrolling a passkey is enough to restore access.
    const member = await makeContext({
      db: owner.db,
      user: {
        id: "user-member",
        name: "member",
        email: "member@example.com",
        passkeyEnabled: true,
      },
    });

    await expect(
      runEffect(member.service.getTenant(request(member.headers), tenant.id)),
    ).resolves.toMatchObject({ id: tenant.id });

    expect(owner.db.store.organization.find((row: any) => row.id === tenant.id)?.name).toBe("acme");
  });

  it("does not enforce the legacy SSO-scoped flag on its own", async () => {
    const owner = await makeContext();
    const tenant = await createTenant(owner, "acme");
    const now = new Date();

    // Pre-migration rows carry the flag on the SSO config; the backfill moves
    // it to the organization. Reading the old column would be a second source
    // of truth, so it is deliberately ignored.
    owner.db.store.sso_config.push({
      organizationId: tenant.id,
      enabled: true,
      azureTenantId: null,
      autoProvision: true,
      requireMfa: true,
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      runEffect(owner.service.getTenant(request(owner.headers), tenant.id)),
    ).resolves.toMatchObject({ id: tenant.id });
  });

  it("records the requirement change in the audit log and returns it from /me", async () => {
    const owner = await makeContext({
      user: { id: "user-1", name: "Owner", email: "owner@example.com", passkeyEnabled: true },
    });

    const tenant = await createTenant(owner, "acme");

    await expect(
      runEffect(
        owner.service.patchTenantSecurity(request(owner.headers), tenant.id, {
          requireMfa: true,
        }),
      ),
    ).resolves.toEqual({ requireMfa: true });

    expect(owner.db.store.organization.find((row: any) => row.id === tenant.id)).toMatchObject({
      requireMfa: true,
    });
    expect(
      owner.db.store.audit_log.filter((row: any) => row.action === "tenant.mfa_policy_updated"),
    ).toMatchObject([{ targetType: "tenant", targetId: tenant.id }]);

    const me = await runEffect(owner.service.me(request(owner.headers)));

    expect(me.user.mfaRequired).toBe(true);
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
    expect(owner.db.store.member.find((row: any) => row.id === targetMember.id)?.customRoleId).toBe(
      privileged.id,
    );

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
      runEffect(owner.service.removeTenantUser(request(owner.headers), tenant.id, ownerMember.id)),
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
    expect(owner.db.store.invitation.find((row: any) => row.id === invitation.id)).toMatchObject({
      status: "accepted",
    });
  });
});

describe("SCIM token expiry and rotation", () => {
  const sha256Hex = async (value: string) => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));

    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  };

  const seedScimToken = async (
    db: any,
    organizationId: string,
    token: string,
    overrides: { readonly name?: string; readonly expiresAt?: Date | null } = {},
  ) => {
    const at = new Date();

    const row = {
      id: `scim-token-${token}`,
      organizationId,
      name: "IdP connector",
      tokenHash: await sha256Hex(token),
      lastUsedAt: null,
      expiresAt: new Date(at.getTime() + 86_400_000),
      revokedAt: null,
      createdAt: at,
      updatedAt: at,
      ...overrides,
    };

    db.store.scim_token.push(row);

    return row;
  };

  const scimRequest = (options: {
    token?: string;
    tenantId: string;
    method?: string;
    path?: string;
  }) =>
    // SAFETY: the SCIM handler only reads headers, url, method and (for POST)
    // the JSON effect from its request value.
    ({
      headers: options.token ? { authorization: `Bearer ${options.token}` } : {},
      url: `https://enterprise.test/scim/v2/${options.tenantId}${options.path ?? "/Users"}`,
      method: options.method ?? "GET",
      json: Effect.succeed({}),
    }) as any;

  it("defaults new tokens to a 90-day lifetime, stores only the hash and reports expiry", async () => {
    const owner = await makeContext();
    const tenant = await createTenant(owner, "acme");

    const created = await runEffect(
      owner.service.createScimToken(request(owner.headers), tenant.id, { name: "Okta SCIM" }),
    );

    const lifetimeDays =
      (new Date(created.expiresAt!).getTime() - Date.now()) / (24 * 60 * 60 * 1_000);

    expect(lifetimeDays).toBeGreaterThan(89);
    expect(lifetimeDays).toBeLessThanOrEqual(90);

    const stored = owner.db.store.scim_token.find((row: any) => row.id === created.id);

    expect(stored).toMatchObject({
      organizationId: tenant.id,
      name: "Okta SCIM",
      tokenHash: await sha256Hex(created.token),
    });
    expect(stored?.tokenHash).not.toContain(created.token);
    expect(stored?.expiresAt).toBeInstanceOf(Date);

    const listed = await runEffect(owner.service.listScimTokens(request(owner.headers), tenant.id));

    expect(listed.tokens).toMatchObject([
      {
        id: created.id,
        name: "Okta SCIM",
        expiresAt: created.expiresAt,
        lastUsedAt: null,
        rotationDue: false,
      },
    ]);
    // The list never carries the bearer value or its hash.
    expect(JSON.stringify(listed)).not.toContain(created.token);
    expect(JSON.stringify(listed)).not.toContain(stored!.tokenHash);
  });

  it("accepts an explicit expiry and flags tokens inside the rotation window", async () => {
    const owner = await makeContext();
    const tenant = await createTenant(owner, "acme");

    const threeDays = new Date(Date.now() + 3 * 86_400_000).toISOString();

    const created = await runEffect(
      owner.service.createScimToken(request(owner.headers), tenant.id, {
        name: "Rotating connector",
        expiresAt: threeDays,
      }),
    );

    expect(created.expiresAt).toBe(threeDays);

    const listed = await runEffect(owner.service.listScimTokens(request(owner.headers), tenant.id));

    expect(listed.tokens[0]).toMatchObject({ rotationDue: true, expiresAt: threeDays });
  });

  it("rejects an expiry in the past or beyond the maximum lifetime", async () => {
    const owner = await makeContext();
    const tenant = await createTenant(owner, "acme");

    await expect(
      runEffect(
        owner.service.createScimToken(request(owner.headers), tenant.id, {
          name: "Expired",
          expiresAt: new Date(Date.now() - 60_000).toISOString(),
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    await expect(
      runEffect(
        owner.service.createScimToken(request(owner.headers), tenant.id, {
          name: "Too long",
          expiresAt: new Date(Date.now() + 366 * 86_400_000).toISOString(),
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    await expect(
      runEffect(
        owner.service.createScimToken(request(owner.headers), tenant.id, {
          name: "Not a date",
          expiresAt: "tomorrow",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    await expect(
      runEffect(owner.service.createScimToken(request(owner.headers), tenant.id, { name: "   " })),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    expect(owner.db.store.scim_token).toHaveLength(0);
  });

  it("rejects an expired bearer token without recording a use", async () => {
    const owner = await makeContext();
    const tenant = await createTenant(owner, "acme");
    const token = "expired-scim-token";

    const row = await seedScimToken(owner.db, tenant.id, token, {
      expiresAt: new Date(Date.now() - 1_000),
    });

    const response = await runEffect(
      Effect.provideService(scimHandler(scimRequest({ token, tenantId: tenant.id })), Db, owner.db),
    );

    expect(response.status).toBe(401);
    expect(row.lastUsedAt).toBeNull();
  });

  it("accepts a live token from its own tenant and records the use", async () => {
    const owner = await makeContext();
    const tenant = await createTenant(owner, "acme");
    const token = "live-scim-token";

    const row = await seedScimToken(owner.db, tenant.id, token);

    const response = await runEffect(
      Effect.provideService(scimHandler(scimRequest({ token, tenantId: tenant.id })), Db, owner.db),
    );

    expect(response.status).toBe(200);
    expect(row.lastUsedAt).toBeInstanceOf(Date);
  });

  it("refuses another tenant's token and a legacy token with no expiry keeps working", async () => {
    const owner = await makeContext();
    const tenant = await createTenant(owner, "acme");
    const other = await createTenant(owner, "beta");

    await seedScimToken(owner.db, other.id, "other-tenant-token");

    const crossTenant = await runEffect(
      Effect.provideService(
        scimHandler(scimRequest({ token: "other-tenant-token", tenantId: tenant.id })),
        Db,
        owner.db,
      ),
    );

    expect(crossTenant.status).toBe(401);

    await seedScimToken(owner.db, tenant.id, "legacy-token", { expiresAt: null });

    const legacy = await runEffect(
      Effect.provideService(
        scimHandler(scimRequest({ token: "legacy-token", tenantId: tenant.id })),
        Db,
        owner.db,
      ),
    );

    expect(legacy.status).toBe(200);
  });

  it("scopes the token list to one tenant", async () => {
    const owner = await makeContext();
    const tenant = await createTenant(owner, "acme");
    const other = await createTenant(owner, "beta");

    await seedScimToken(owner.db, other.id, "other-list-token", { name: "Other tenant" });

    const listed = await runEffect(owner.service.listScimTokens(request(owner.headers), tenant.id));

    expect(listed.tokens).toHaveLength(0);
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
      runEffect(admin.service.removeTenantUser(request(admin.headers), tenant.id, ownerMember.id)),
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
      runEffect(owner.service.removeTenantUser(request(owner.headers), tenant.id, ownerMember.id)),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);
  });
});
