import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { EnterpriseNotFound } from "@mattrax/enterprise-domain";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { makeDb, makeStripeClient, request, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";

const headers = { cookie: "mattrax_session=test" };

const timestamp = new Date("2026-11-01T00:00:00.000Z");

const owner = {
  id: "account-1",
  name: "Owner",
  email: "owner@example.com",
  emailVerified: true,
  image: null,
  createdAt: timestamp,
  updatedAt: timestamp,
};

type FakeToken = { scopes: ReadonlyArray<string> };

const makeContext = () => {
  const db = makeDb();
  const state = { user: owner };
  let token: FakeToken | undefined;

  db.store.account.push(owner);

  const auth = {
    requireUser: (input: any) => {
      const inputHeaders =
        input instanceof Request ? Object.fromEntries(input.headers) : input.headers;

      if (!inputHeaders.cookie) return Effect.fail(new Error("Unauthenticated"));

      return Effect.succeed({
        user: state.user,
        ...(token ? { apiToken: token } : {}),
      });
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
    // SAFETY: this test never reaches R2; the service only stores the binding.
    storage: {} as any,
    // SAFETY: the fake only implements the auth methods these tests exercise.
    auth: auth as any,
    authSecret: "users-test-secret",
  });

  return {
    db,
    service,
    state,
    useToken: (value: FakeToken) => {
      token = value;
    },
  };
};

const makeTenant = async (context: ReturnType<typeof makeContext>, slug = "acme") =>
  runEffect(context.service.createTenant(request(headers), { name: "Acme", slug }));

/**
 * One person with two group memberships, a linked device, a linked account and
 * every shape of user-policy edge: direct include, group include, a group
 * exclusion from another group, and a disabled direct assignment.
 */
const seed = (context: ReturnType<typeof makeContext>, tenantId: string) => {
  const organizationId = tenantId;

  context.db.store.user.push(
    {
      id: "user-1",
      organizationId,
      name: "Ada Lovelace",
      email: "ada@acme.test",
      externalId: "entra-user-1",
      source: "entra",
      disabled: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "user-2",
      organizationId,
      name: "Grace Hopper",
      email: "grace@acme.test",
      externalId: null,
      source: "manual",
      disabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  );

  context.db.store.user_group.push(
    {
      id: "group-1",
      organizationId,
      name: "Engineering",
      externalId: "entra-group-1",
      description: null,
      source: "graph",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "group-2",
      organizationId,
      name: "Contractors",
      externalId: "entra-group-2",
      description: null,
      source: "graph",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  );

  context.db.store.user_group_member.push(
    { groupId: "group-1", userId: "user-1" },
    { groupId: "group-2", userId: "user-1" },
  );

  context.db.store.device.push({
    id: "device-1",
    organizationId,
    proto: "apple",
    status: "enrolled",
    name: "Ada's Mac",
    enrolledAt: timestamp,
    lastSeenAt: timestamp,
  });

  context.db.store.device_user.push({
    organizationId,
    deviceId: "device-1",
    userId: "user-1",
    source: "manual",
    createdAt: timestamp,
  });

  const policy = (id: string, name: string, enabled = true) => ({
    id,
    organizationId,
    name,
    notes: null,
    priority: 0,
    enabled,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  context.db.store.policy.push(
    policy("policy-direct", "Direct policy"),
    policy("policy-group", "Group policy"),
    policy("policy-excluded", "Excluded policy"),
    policy("policy-disabled", "Disabled policy", false),
  );

  context.db.store.user_policy.push(
    {
      organizationId,
      userId: "user-1",
      policyId: "policy-direct",
      mode: "include",
      createdAt: timestamp,
    },
    {
      organizationId,
      userId: "user-1",
      policyId: "policy-disabled",
      mode: "include",
      createdAt: timestamp,
    },
  );

  context.db.store.user_group_policy.push(
    {
      organizationId,
      groupId: "group-1",
      policyId: "policy-group",
      mode: "include",
      createdAt: timestamp,
    },
    {
      organizationId,
      groupId: "group-1",
      policyId: "policy-excluded",
      mode: "include",
      createdAt: timestamp,
    },
    {
      organizationId,
      groupId: "group-2",
      policyId: "policy-excluded",
      mode: "exclude",
      createdAt: timestamp,
    },
  );

  context.db.store.sso_identity.push({
    organizationId,
    objectId: "entra-user-1",
    accountId: owner.id,
    createdAt: timestamp,
  });
};

describe("directory user views", () => {
  it("lists users with group and device counts in one pass", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);
    seed(context, tenant.id);

    const response = await runEffect(context.service.listUsers(request(headers), tenant.id));

    expect(response.rows).toEqual([
      {
        id: "user-1",
        name: "Ada Lovelace",
        email: "ada@acme.test",
        externalId: "entra-user-1",
        source: "entra",
        disabled: false,
        linked: true,
        groupCount: 2,
        deviceCount: 1,
      },
      {
        id: "user-2",
        name: "Grace Hopper",
        email: "grace@acme.test",
        externalId: null,
        source: "manual",
        disabled: true,
        linked: false,
        groupCount: 0,
        deviceCount: 0,
      },
    ]);
  });

  it("returns the groups, devices and policy assignments of one person", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);
    seed(context, tenant.id);

    const detail = await runEffect(context.service.getUser(request(headers), tenant.id, "user-1"));

    expect(detail).toMatchObject({
      id: "user-1",
      linked: true,
      linkedAccount: { id: owner.id, email: owner.email },
      groups: [
        { id: "group-2", name: "Contractors", source: "graph" },
        { id: "group-1", name: "Engineering", source: "graph" },
      ],
      devices: [
        {
          id: "device-1",
          name: "Ada's Mac",
          proto: "apple",
          status: "enrolled",
          source: "manual",
          linkedAt: timestamp.toISOString(),
        },
      ],
    });

    // Direct and group inclusions apply; the disable and the exclusion veto.
    expect(detail.policies?.map((policy) => policy.policyId)).toEqual([
      "policy-direct",
      "policy-group",
    ]);
    expect(detail.policies?.[0]).toMatchObject({ direct: true, groups: [] });
    expect(detail.policies?.[1]).toMatchObject({
      direct: false,
      groups: [{ id: "group-1", name: "Engineering" }],
    });
  });

  it("does not resolve a user from another tenant", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);
    seed(context, tenant.id);

    const other = await makeTenant(context, "other");
    context.db.store.user.push({
      id: "other-user",
      organizationId: other.id,
      name: "Other",
      email: "other@example.test",
      externalId: null,
      source: "manual",
      disabled: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await expect(
      runEffect(context.service.getUser(request(headers), tenant.id, "other-user")),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);
  });

  it("applies a narrowed credential's scope to the optional sections", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);
    seed(context, tenant.id);

    // The owner role can read devices and policies, but this token is limited
    // to the directory. The optional sections must be absent, not merely
    // permission-checked: a members.read token used to inherit the role's
    // devices.read and policies.read through the old sub-gate.
    context.useToken({ scopes: ["members.read"] });

    const list = await runEffect(context.service.listUsers(request(headers), tenant.id));

    expect(list.rows[0]).not.toHaveProperty("deviceCount");

    const detail = await runEffect(context.service.getUser(request(headers), tenant.id, "user-1"));

    expect(detail.groups).toHaveLength(2);
    expect(detail).not.toHaveProperty("devices");
    expect(detail).not.toHaveProperty("policies");
  });

  it("omits device and policy data the caller cannot read", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);
    seed(context, tenant.id);

    context.db.store.account.push({
      ...owner,
      id: "account-2",
      name: "Directory viewer",
      email: "viewer@example.com",
    });
    context.db.store.tenant_role.push({
      id: "role-directory",
      organizationId: tenant.id,
      name: "Directory viewer",
      description: null,
      permissions: ["members.read"],
      createdByAccountId: owner.id,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    context.db.store.member.push({
      id: "member-2",
      organizationId: tenant.id,
      accountId: "account-2",
      role: "member",
      customRoleId: "role-directory",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    context.state.user = {
      ...owner,
      id: "account-2",
      name: "Directory viewer",
      email: "viewer@example.com",
    };

    const list = await runEffect(context.service.listUsers(request(headers), tenant.id));

    expect(list.rows[0]).not.toHaveProperty("deviceCount");

    const detail = await runEffect(context.service.getUser(request(headers), tenant.id, "user-1"));

    // Members can read the directory, but not the fleet or policy configuration.
    expect(detail.groups).toHaveLength(2);
    expect(detail).not.toHaveProperty("devices");
    expect(detail).not.toHaveProperty("policies");
  });
});
