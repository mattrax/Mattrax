import { Effect } from "effect";
import { HttpServerResponse } from "effect/http";
import { Db } from "@mattrax/enterprise-core";
import { describe, expect, it } from "vitest";
import {
  EnterpriseBadRequest,
  EnterpriseForbidden,
  EnterpriseLastTenantAccount,
  EnterpriseNotFound,
  EnterpriseUnauthorized,
} from "@mattrax/enterprise-domain";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { scimHandler } from "@mattrax/enterprise-api";
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

  if (!db.store.account.some((row: any) => row.id === user.id)) db.store.account.push(user);

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
    (row: any) => row.organizationId === tenantId && row.accountId === user.id,
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
    accountId: user.id,
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

/**
 * Seed the two independent identities a tenant accumulates: a directory person
 * (with a directory group) and the IdP link for the dashboard account. Removing
 * the administrator must only clear the latter.
 */
const seedDirectoryAccess = (
  db: any,
  organizationId: string,
  directoryUserId: string,
  accountId: string,
  suffix: string,
) => {
  const timestamp = new Date();
  const groupId = `group-${suffix}`;

  db.store.user.push({
    id: directoryUserId,
    organizationId,
    name: `Directory ${suffix}`,
    email: `${suffix}@example.com`,
    externalId: null,
    source: "manual",
    disabled: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  db.store.user_group.push({
    id: groupId,
    organizationId,
    name: `Directory ${suffix}`,
    externalId: `external-${suffix}`,
    description: null,
    source: "graph",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  db.store.user_group_member.push({ groupId, userId: directoryUserId });
  db.store.sso_identity.push({
    organizationId,
    objectId: `object-${suffix}`,
    accountId,
    createdAt: timestamp,
  });

  return { groupId, objectId: `object-${suffix}` };
};

/** Decode the JSON body the SCIM handlers attach to a response. */
const responseJson = async (response: any) => HttpServerResponse.toWeb(response).json();

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
        account: { id },
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

    expect(me.account.mfaRequired).toBe(true);
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

    // Policy assignments target directory users, not dashboard accounts.
    const directoryUser = {
      id: "directory-second",
      organizationId: secondTenant.id,
      name: "Second Person",
      email: "person@second.example.com",
      externalId: null,
      source: "manual" as const,
      disabled: false,
      createdAt: now,
      updatedAt: now,
    };

    second.db.store.user.push(directoryUser);

    await expect(
      runEffect(
        first.service.patchPolicyAssignments(request(first.headers), firstTenant.id, policy.id, {
          assignUsers: [directoryUser.id],
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

    const secondTenant = await createTenant(second, "second");

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

    // Device links target directory users, not dashboard accounts.
    const directoryUser = {
      id: "directory-second",
      organizationId: secondTenant.id,
      name: "Second Person",
      email: "person@second.example.com",
      externalId: null,
      source: "manual" as const,
      disabled: false,
      createdAt: now,
      updatedAt: now,
    };

    second.db.store.user.push(directoryUser);

    await expect(
      runEffect(
        first.service.setDeviceUsers(request(first.headers), firstTenant.id, "device-first", {
          userIds: [directoryUser.id],
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
      owner.service.patchTenantAccount(request(owner.headers), tenant.id, target.user.id, {
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
        admin.service.patchTenantAccount(request(admin.headers), tenant.id, secondTarget.user.id, {
          roleId: privileged.id,
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);
    await expect(
      runEffect(
        admin.service.inviteTenantAccount(request(admin.headers), tenant.id, {
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
      "tenant.write",
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
    for (const accountId of [actor.user.id, target.user.id]) {
      await expect(
        runEffect(
          actor.service.patchTenantAccount(request(actor.headers), tenant.id, accountId, {
            role: "admin",
          }),
        ),
      ).rejects.toBeInstanceOf(EnterpriseForbidden);
    }

    // Inviting an administrator is the same delegation and is refused.
    await expect(
      runEffect(
        actor.service.inviteTenantAccount(request(actor.headers), tenant.id, {
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
          actor.service.patchTenantAccount(request(actor.headers), tenant.id, target.user.id, {
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
        owner.service.inviteTenantAccount(request(owner.headers), tenant.id, {
          email: "invited@example.com",
          roleId: custom.id,
          role: "owner",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    await expect(
      runEffect(
        owner.service.patchTenantAccount(request(owner.headers), tenant.id, target.user.id, {
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
      "tenant.write",
      "members.read",
      "members.write",
    ]);

    // A stale/legacy row: the raw built-in role says owner while a custom role
    // is actually authoritative.
    addMember(owner.db, tenant.id, actor.user, "owner", memberManager.id);

    const ownerMember = owner.db.store.member.find(
      (row: any) => row.organizationId === tenant.id && row.accountId === owner.user.id,
    );

    // The forged owner neither gains owner powers...
    await expect(
      runEffect(
        actor.service.patchTenantAccount(request(actor.headers), tenant.id, owner.user.id, {
          role: "member",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);
    await expect(
      runEffect(
        actor.service.removeTenantAccount(request(actor.headers), tenant.id, owner.user.id),
      ),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);

    // ...nor inflates the owner count: the real owner is still the last one.
    await expect(
      runEffect(
        owner.service.removeTenantAccount(request(owner.headers), tenant.id, owner.user.id),
      ),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);

    expect(owner.db.store.member.some((row: any) => row.id === ownerMember.id)).toBe(true);
  });
});

describe("SCIM directory provisioning", () => {
  const tenantId = "tenant-acme";
  const otherTenantId = "tenant-beta";

  /** The SCIM user fields these tests exercise. */
  type ScimUserBody = {
    userName?: string;
    externalId?: string;
    name?: { formatted?: string; givenName?: string; familyName?: string };
    roles?: ReadonlyArray<{ value: string }>;
  };

  const sha256Hex = async (value: string) => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));

    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  };

  const makeScimDb = async (token = "directory-token") => {
    const db = makeDb();
    const timestamp = new Date();
    const tokenHash = await sha256Hex(token);

    for (const organizationId of [tenantId, otherTenantId])
      db.store.scim_token.push({
        id: `scim-token-${organizationId}`,
        organizationId,
        name: "IdP connector",
        tokenHash,
        lastUsedAt: null,
        expiresAt: null,
        revokedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

    return db;
  };

  const scimRequest = (options: {
    token?: string;
    tenantId?: string;
    method?: string;
    path?: string;
    body?: unknown;
    /** Simulate a request body that is not valid JSON. */
    invalidJson?: boolean;
  }) =>
    // SAFETY: the SCIM handler reads headers, url, method and the JSON effect
    // from its request value; this mirrors helpers.request.
    ({
      headers: { authorization: `Bearer ${options.token ?? "directory-token"}` },
      url: `https://enterprise.test/scim/v2/${options.tenantId ?? tenantId}${
        options.path ?? "/Users"
      }`,
      method: options.method ?? "GET",
      json: options.invalidJson
        ? Effect.fail(new Error("not JSON"))
        : Effect.succeed(options.body ?? {}),
    }) as any;

  const callScim = (db: any, options: Parameters<typeof scimRequest>[0]) =>
    runEffect(Effect.provideService(scimHandler(scimRequest(options)), Db, db));

  const createScimUser = async (db: any, body: ScimUserBody, tenant?: string) => {
    const response = await callScim(db, { method: "POST", body, tenantId: tenant });

    return { response, body: await responseJson(response) };
  };

  it("provisions tenant directory users without accounts or members", async () => {
    const db = await makeScimDb();

    const created = await callScim(db, {
      method: "POST",
      body: {
        userName: "Ada@Example.com",
        externalId: "idp-1",
        name: { givenName: "Ada", familyName: "Lovelace" },
        // Directory people have no roles; an IdP-sent role is ignored.
        roles: [{ value: "owner" }],
      },
    });

    expect(created.status).toBe(201);

    const rendered = await responseJson(created);

    expect(rendered).toMatchObject({
      userName: "ada@example.com",
      externalId: "idp-1",
      active: true,
      name: { formatted: "Ada Lovelace" },
    });
    expect(rendered).not.toHaveProperty("roles");

    expect(db.store.user).toHaveLength(1);
    expect(db.store.user[0]).toMatchObject({
      organizationId: tenantId,
      email: "ada@example.com",
      name: "Ada Lovelace",
      externalId: "idp-1",
      source: "scim",
      disabled: false,
    });

    // A directory person is not a dashboard identity: no account, membership
    // or invitation is provisioned.
    expect(db.store.account).toEqual([]);
    expect(db.store.member).toEqual([]);
    expect(db.store.invitation).toEqual([]);

    const listed = await responseJson(await callScim(db, {}));

    expect(listed).toMatchObject({
      totalResults: 1,
      Resources: [
        expect.objectContaining({ id: db.store.user[0].id, userName: "ada@example.com" }),
      ],
    });

    // A retried create reuses the tenant row instead of duplicating the person.
    const retried = await callScim(db, { method: "POST", body: { userName: "ada@example.com" } });

    expect(retried.status).toBe(200);
    expect(db.store.user).toHaveLength(1);
  });

  it("rejects a malformed userName with a SCIM error body", async () => {
    const db = await makeScimDb();

    const response = await callScim(db, { method: "POST", body: { userName: "not-an-email" } });

    expect(response.status).toBe(400);
    expect(await responseJson(response)).toMatchObject({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "400",
    });
  });

  it("answers malformed JSON with a SCIM syntax error instead of throwing", async () => {
    const db = await makeScimDb();

    const response = await callScim(db, { method: "POST", invalidJson: true });

    expect(response.status).toBe(400);
    expect(await responseJson(response)).toMatchObject({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "400",
      scimType: "invalidSyntax",
      detail: "Request body must be valid JSON",
    });
    expect(db.store.user).toEqual([]);
  });

  it("rejects a payload whose nested fields have the wrong shape", async () => {
    const db = await makeScimDb();

    const response = await callScim(db, {
      method: "POST",
      body: { userName: "ada@example.com", name: "Ada Lovelace" },
    });

    expect(response.status).toBe(400);
    expect(await responseJson(response)).toMatchObject({
      status: "400",
      scimType: "invalidValue",
      detail: "Invalid SCIM user payload",
    });
    expect(db.store.user).toEqual([]);
  });

  it("rejects a patch whose operations are not an array", async () => {
    const db = await makeScimDb();
    const created = await createScimUser(db, { userName: "ada@example.com" });

    const response = await callScim(db, {
      method: "PATCH",
      path: `/Users/${created.body.id}`,
      body: { Operations: "replace" },
    });

    expect(response.status).toBe(400);
    expect(await responseJson(response)).toMatchObject({
      status: "400",
      scimType: "invalidValue",
      detail: "Invalid SCIM patch",
    });
  });

  it("keeps directory users and mutations tenant-local", async () => {
    const db = await makeScimDb();

    const acme = await createScimUser(db, { userName: "shared@example.com" });
    const beta = await createScimUser(db, { userName: "shared@example.com" }, otherTenantId);

    expect(acme.response.status).toBe(201);
    expect(beta.response.status).toBe(201);
    // The same address is one person per tenant; neither create reused the other.
    expect(acme.body.id).not.toBe(beta.body.id);
    expect(db.store.user.map((row: any) => row.organizationId).sort()).toEqual(
      [tenantId, otherTenantId].sort(),
    );

    const crossGet = await callScim(db, { path: `/Users/${beta.body.id}` });

    const crossPatch = await callScim(db, {
      method: "PATCH",
      path: `/Users/${beta.body.id}`,
      body: { Operations: [{ op: "replace", path: "active", value: false }] },
    });

    const crossDelete = await callScim(db, { method: "DELETE", path: `/Users/${beta.body.id}` });

    expect([crossGet.status, crossPatch.status, crossDelete.status]).toEqual([404, 404, 404]);
    expect(db.store.user.find((row: any) => row.id === beta.body.id)?.disabled).toBe(false);
  });

  it("patches name, tenant-local userName and active without touching accounts", async () => {
    const db = await makeScimDb();
    const timestamp = new Date();

    // A dashboard account with the target address is a different identity and
    // must not block a tenant-local directory rename.
    db.store.account.push({
      id: "account-1",
      name: "Grace",
      email: "grace@example.com",
      emailVerified: true,
      image: null,
      disabled: false,
      source: "manual",
      authRevision: "revision",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const { body: created } = await createScimUser(db, { userName: "old@example.com" });

    const patched = await callScim(db, {
      method: "PATCH",
      path: `/Users/${created.id}`,
      body: {
        Operations: [
          { op: "replace", path: "name.givenName", value: "Grace" },
          { op: "replace", path: "userName", value: "Grace@Example.com" },
        ],
      },
    });

    expect(patched.status).toBe(200);
    expect(await responseJson(patched)).toMatchObject({
      userName: "grace@example.com",
      name: { formatted: "Grace" },
      active: true,
    });
    expect(db.store.user.find((row: any) => row.id === created.id)).toMatchObject({
      email: "grace@example.com",
      name: "Grace",
    });

    const deactivated = await callScim(db, {
      method: "PATCH",
      path: `/Users/${created.id}`,
      body: { Operations: [{ op: "replace", path: "active", value: false }] },
    });

    expect(deactivated.status).toBe(200);
    expect(await responseJson(deactivated)).toMatchObject({ active: false });
    expect(db.store.user.find((row: any) => row.id === created.id)?.disabled).toBe(true);
    expect(db.store.member).toEqual([]);

    const reactivated = await callScim(db, {
      method: "PATCH",
      path: `/Users/${created.id}`,
      body: { Operations: [{ op: "replace", path: "active", value: true }] },
    });

    expect(await responseJson(reactivated)).toMatchObject({ active: true });
    expect(db.store.user.find((row: any) => row.id === created.id)?.disabled).toBe(false);
  });

  it("rejects a userName another directory user in the same tenant already uses", async () => {
    const db = await makeScimDb();

    await createScimUser(db, { userName: "taken@example.com" });
    const { body: other } = await createScimUser(db, { userName: "other@example.com" });

    const response = await callScim(db, {
      method: "PATCH",
      path: `/Users/${other.id}`,
      body: { Operations: [{ op: "replace", path: "userName", value: "taken@example.com" }] },
    });

    expect(response.status).toBe(409);
    expect(await responseJson(response)).toMatchObject({ scimType: "uniqueness" });
  });

  it("deletes only the tenant directory user", async () => {
    const db = await makeScimDb();

    const { body: removed } = await createScimUser(db, { userName: "one@example.com" });
    const { body: kept } = await createScimUser(db, { userName: "two@example.com" });

    db.store.user_group_member.push({ groupId: "group-1", userId: removed.id });

    const response = await callScim(db, { method: "DELETE", path: `/Users/${removed.id}` });

    expect(response.status).toBe(204);
    expect(db.store.user.map((row: any) => row.id)).toEqual([kept.id]);
    expect(db.store.account).toEqual([]);
    expect(db.store.member).toEqual([]);

    const missing = await callScim(db, { method: "DELETE", path: `/Users/${removed.id}` });

    expect(missing.status).toBe(404);
  });

  it("lists and patches group members from the tenant directory", async () => {
    const db = await makeScimDb();

    const { body: acme } = await createScimUser(db, { userName: "ada@example.com" });

    const { body: beta } = await createScimUser(db, { userName: "bob@example.com" }, otherTenantId);

    const createdGroup = await callScim(db, {
      method: "POST",
      path: "/Groups",
      body: { displayName: "Staff", members: [{ value: acme.id }, { value: beta.id }] },
    });

    expect(createdGroup.status).toBe(201);

    const group = await responseJson(createdGroup);

    // Another tenant's directory person is not a member of this tenant's group.
    expect(group.members).toEqual([{ value: acme.id, display: "ada@example.com", type: "User" }]);

    const listed = await responseJson(await callScim(db, { path: "/Groups" }));

    expect(listed.totalResults).toBe(1);
    expect(listed.Resources[0]).toMatchObject({
      displayName: "Staff",
      members: [{ value: acme.id, display: "ada@example.com", type: "User" }],
    });

    const patched = await callScim(db, {
      method: "PATCH",
      path: `/Groups/${group.id}`,
      body: { Operations: [{ op: "add", path: "members", value: [{ value: beta.id }] }] },
    });

    expect(patched.status).toBe(200);
    expect(await responseJson(patched)).toMatchObject({
      members: [{ value: acme.id, display: "ada@example.com", type: "User" }],
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
      (row: any) => row.organizationId === tenant.id && row.accountId === owner.user.id,
    );

    await expect(
      runEffect(
        admin.service.removeTenantAccount(request(admin.headers), tenant.id, owner.user.id),
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
      owner.service.removeTenantAccount(request(owner.headers), tenant.id, secondOwner.user.id),
    );

    // ...but the last owner cannot remove themselves while other members remain.
    const ownerMember = owner.db.store.member.find(
      (row: any) => row.organizationId === tenant.id && row.accountId === owner.user.id,
    );

    await expect(
      runEffect(
        owner.service.removeTenantAccount(request(owner.headers), tenant.id, owner.user.id),
      ),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);
  });
});

describe("tenant member removal", () => {
  it("clears the removed account's SSO identity but leaves directory people alone", async () => {
    const owner = await makeContext();
    const tenant = await createTenant(owner, "acme");
    const other = await createTenant(owner, "beta");

    const member = await makeContext({
      db: owner.db,
      user: { id: "user-member", name: "Member", email: "member@example.com" },
    });

    const bystander = await makeContext({
      db: owner.db,
      user: { id: "user-bystander", name: "Bystander", email: "bystander@example.com" },
    });

    const membership = addMember(owner.db, tenant.id, member.user, "member");

    const acme = seedDirectoryAccess(
      owner.db,
      tenant.id,
      "directory-member-acme",
      member.user.id,
      "acme",
    );

    const beta = seedDirectoryAccess(
      owner.db,
      other.id,
      "directory-member-beta",
      member.user.id,
      "beta",
    );

    // Another directory person in the same tenant group must keep their
    // membership, and their account's SSO link is independent.
    owner.db.store.user.push({
      id: "directory-bystander",
      organizationId: tenant.id,
      name: "Directory Bystander",
      email: "bystander-directory@example.com",
      externalId: null,
      source: "manual",
      disabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    owner.db.store.user_group_member.push({
      groupId: acme.groupId,
      userId: "directory-bystander",
    });
    owner.db.store.sso_identity.push({
      organizationId: tenant.id,
      objectId: "object-bystander",
      accountId: bystander.user.id,
      createdAt: new Date(),
    });

    await runEffect(
      owner.service.removeTenantAccount(request(owner.headers), tenant.id, member.user.id),
    );

    expect(owner.db.store.member.some((row: any) => row.id === membership.id)).toBe(false);

    // Removing dashboard access is not removing a person: directory users,
    // their group memberships and their device links stay untouched in both
    // tenants.
    expect(owner.db.store.user.map((row: any) => row.id)).toEqual(
      expect.arrayContaining([
        "directory-member-acme",
        "directory-member-beta",
        "directory-bystander",
      ]),
    );
    expect(
      owner.db.store.user_group_member
        .filter((row: any) => row.userId === "directory-member-acme")
        .map((row: any) => row.groupId),
    ).toEqual([acme.groupId]);
    expect(
      owner.db.store.user_group_member
        .filter((row: any) => row.userId === "directory-member-beta")
        .map((row: any) => row.groupId),
    ).toEqual([beta.groupId]);
    expect(
      owner.db.store.user_group_member.filter((row: any) => row.userId === "directory-bystander"),
    ).toEqual([{ groupId: acme.groupId, userId: "directory-bystander" }]);

    // Only this tenant's account SSO link is removed; the same account's link
    // to another tenant and the bystander's link are untouched.
    expect(
      owner.db.store.sso_identity
        .filter((row: any) => row.accountId === member.user.id)
        .map((row: any) => row.organizationId),
    ).toEqual([other.id]);
    expect(owner.db.store.sso_identity).toContainEqual(
      expect.objectContaining({ organizationId: tenant.id, accountId: bystander.user.id }),
    );
  });

  it("leaves directory state intact when the last owner cannot be removed", async () => {
    const owner = await makeContext();
    const tenant = await createTenant(owner, "acme");

    const membership = owner.db.store.member.find(
      (row: any) => row.organizationId === tenant.id && row.accountId === owner.user.id,
    );

    const grants = seedDirectoryAccess(
      owner.db,
      tenant.id,
      "directory-owner",
      owner.user.id,
      "owner",
    );

    await expect(
      runEffect(
        owner.service.removeTenantAccount(request(owner.headers), tenant.id, owner.user.id),
      ),
    ).rejects.toBeInstanceOf(EnterpriseLastTenantAccount);

    expect(
      owner.db.store.member.some(
        (row: any) => row.organizationId === tenant.id && row.accountId === owner.user.id,
      ),
    ).toBe(true);
    expect(owner.db.store.user_group_member).toContainEqual({
      groupId: grants.groupId,
      userId: "directory-owner",
    });
    expect(owner.db.store.sso_identity).toContainEqual(
      expect.objectContaining({ organizationId: tenant.id, accountId: owner.user.id }),
    );
  });
});
