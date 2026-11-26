import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { EnterpriseBadRequest, EnterpriseUnauthorized } from "@mattrax/enterprise-domain";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { makeDb, request, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";

const headers = { cookie: "mattrax_session=test" };

const timestamp = new Date("2026-11-01T00:00:00.000Z");

const makeContext = () => {
  const db = makeDb();
  const now = new Date();

  const user = {
    id: "user-1",
    name: "Owner",
    email: "owner@example.com",
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
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
    // SAFETY: these tests never reach R2.
    storage: {} as any,
    // SAFETY: the fake implements only the auth methods these tests exercise.
    auth: auth as any,
    authSecret: "advanced-groups-test-secret",
  });

  return { db, service };
};

const makeTenant = async (context: ReturnType<typeof makeContext>) =>
  runEffect(context.service.createTenant(request(headers), { name: "Acme", slug: "acme" }));

const seedDevice = (
  context: ReturnType<typeof makeContext>,
  organizationId: string,
  id: string,
  name: string,
) => {
  context.db.store.device.push({
    id,
    organizationId,
    proto: "apple",
    status: "enrolled",
    name,
    enrolledAt: timestamp,
    lastSeenAt: timestamp,
  });
};

const seedUser = (
  context: ReturnType<typeof makeContext>,
  organizationId: string,
  id: string,
  overrides: {
    email?: string;
    name?: string;
    externalId?: string;
    source?: "manual" | "entra" | "scim";
  } = {},
) => {
  context.db.store.user.push({
    id,
    organizationId,
    name: overrides.name ?? id,
    email: overrides.email ?? `${id}@acme.test`,
    externalId: overrides.externalId ?? null,
    source: overrides.source ?? "manual",
    disabled: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
};

const linkUser = (
  context: ReturnType<typeof makeContext>,
  organizationId: string,
  deviceId: string,
  userId: string,
) => {
  context.db.store.device_user.push({
    organizationId,
    deviceId,
    userId,
    source: "manual",
    createdAt: timestamp,
  });
};

const groupDevices = (context: ReturnType<typeof makeContext>, groupId: string) =>
  context.db.store.group_device.filter((row) => row.groupId === groupId);

describe("nested groups", () => {
  it("inherits child membership transitively and attributes the child", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);
    seedDevice(context, tenant.id, "device-1", "Ada's Mac");

    const child = await runEffect(
      context.service.createGroup(request(headers), tenant.id, {
        name: "Child",
        devices: ["device-1"],
      }),
    );

    const parent = await runEffect(
      context.service.createGroup(request(headers), tenant.id, {
        name: "Parent",
        childGroups: [child.id],
      }),
    );

    expect(groupDevices(context, parent.id)).toEqual([
      { groupId: parent.id, deviceId: "device-1", source: "nested" },
    ]);

    const detail = await runEffect(
      context.service.getGroup(request(headers), tenant.id, parent.id),
    );

    expect(detail.devices).toMatchObject([
      {
        id: "device-1",
        name: "Ada's Mac",
        source: "nested",
        inheritedFrom: [{ id: child.id, name: "Child" }],
      },
    ]);
    expect(detail.childGroups).toMatchObject([{ id: child.id, name: "Child", devicesCount: 1 }]);

    const grandparent = await runEffect(
      context.service.createGroup(request(headers), tenant.id, {
        name: "Grandparent",
        childGroups: [parent.id],
      }),
    );

    // One level of reading is enough: the parent already holds the transitive
    // union, so the grandparent inherits device-1 without walking to the child.
    expect(groupDevices(context, grandparent.id)).toEqual([
      { groupId: grandparent.id, deviceId: "device-1", source: "nested" },
    ]);
  });

  it("removes inherited devices immediately when the child link is removed", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);
    seedDevice(context, tenant.id, "device-1", "Ada's Mac");

    const child = await runEffect(
      context.service.createGroup(request(headers), tenant.id, {
        name: "Child",
        devices: ["device-1"],
      }),
    );

    const parent = await runEffect(
      context.service.createGroup(request(headers), tenant.id, {
        name: "Parent",
        childGroups: [child.id],
      }),
    );

    await runEffect(
      context.service.patchGroupMembers(request(headers), tenant.id, parent.id, {
        unassign: { childGroups: [child.id] },
      }),
    );

    expect(groupDevices(context, parent.id)).toEqual([]);
  });

  it("keeps a manual member when it stops being inherited", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);
    seedDevice(context, tenant.id, "device-1", "Ada's Mac");

    const child = await runEffect(
      context.service.createGroup(request(headers), tenant.id, {
        name: "Child",
        devices: ["device-1"],
      }),
    );

    const parent = await runEffect(
      context.service.createGroup(request(headers), tenant.id, {
        name: "Parent",
        devices: ["device-1"],
        childGroups: [child.id],
      }),
    );

    expect(groupDevices(context, parent.id)).toEqual([
      { groupId: parent.id, deviceId: "device-1", source: "manual" },
    ]);

    await runEffect(
      context.service.patchGroupMembers(request(headers), tenant.id, parent.id, {
        unassign: { childGroups: [child.id] },
      }),
    );

    // Manual membership was the stronger source and survives.
    expect(groupDevices(context, parent.id)).toEqual([
      { groupId: parent.id, deviceId: "device-1", source: "manual" },
    ]);
  });

  it("drops inherited devices when a child group is deleted", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);
    seedDevice(context, tenant.id, "device-1", "Ada's Mac");

    const child = await runEffect(
      context.service.createGroup(request(headers), tenant.id, {
        name: "Child",
        devices: ["device-1"],
      }),
    );

    const parent = await runEffect(
      context.service.createGroup(request(headers), tenant.id, {
        name: "Parent",
        childGroups: [child.id],
      }),
    );

    await runEffect(context.service.deleteGroups(request(headers), tenant.id, [child.id]));

    expect(context.db.store.group_group).toEqual([]);
    expect(groupDevices(context, child.id)).toEqual([]);
    expect(groupDevices(context, parent.id)).toEqual([]);
  });

  it("promotes an inherited member to a rule match so removing the child keeps it", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);
    seedDevice(context, tenant.id, "device-1", "Studio");

    const child = await runEffect(
      context.service.createGroup(request(headers), tenant.id, { name: "Child" }),
    );

    const parent = await runEffect(
      context.service.createGroup(request(headers), tenant.id, {
        name: "Parent",
        kind: "dynamic",
        rules: {
          version: 1,
          all: [{ field: "name", op: "contains", value: "Mac" }],
        },
        childGroups: [child.id],
      }),
    );

    await runEffect(
      context.service.patchGroupMembers(request(headers), tenant.id, child.id, {
        assign: { devices: ["device-1"] },
      }),
    );

    expect(groupDevices(context, parent.id)).toEqual([
      { groupId: parent.id, deviceId: "device-1", source: "nested" },
    ]);

    // The device now matches the parent's rules through the device-driven
    // recompute; the inherited row is promoted rather than left as nested.
    await runEffect(
      context.service.patchDevice(request(headers), tenant.id, "device-1", {
        name: "Studio Mac",
      }),
    );

    expect(groupDevices(context, parent.id)).toEqual([
      { groupId: parent.id, deviceId: "device-1", source: "dynamic" },
    ]);

    await runEffect(
      context.service.patchGroupMembers(request(headers), tenant.id, parent.id, {
        unassign: { childGroups: [child.id] },
      }),
    );

    // Rules still select it, so removing the child edge does not drop it.
    expect(groupDevices(context, parent.id)).toEqual([
      { groupId: parent.id, deviceId: "device-1", source: "dynamic" },
    ]);
  });

  it("rejects direct and indirect cycles", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);

    const a = await runEffect(
      context.service.createGroup(request(headers), tenant.id, { name: "A" }),
    );

    const b = await runEffect(
      context.service.createGroup(request(headers), tenant.id, { name: "B", childGroups: [a.id] }),
    );

    await expect(
      runEffect(
        context.service.patchGroupMembers(request(headers), tenant.id, a.id, {
          assign: { childGroups: [b.id] },
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    await expect(
      runEffect(
        context.service.patchGroupMembers(request(headers), tenant.id, a.id, {
          assign: { childGroups: [a.id] },
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
  });

  it("refuses a child group from another tenant", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);

    const other = await runEffect(
      context.service.createTenant(request(headers), { name: "Other", slug: "other" }),
    );

    const foreign = await runEffect(
      context.service.createGroup(request(headers), other.id, { name: "Foreign" }),
    );

    await expect(
      runEffect(
        context.service.createGroup(request(headers), tenant.id, {
          name: "Parent",
          childGroups: [foreign.id],
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
  });
});

describe("group exclusions", () => {
  it("keeps an excluded device out and refuses to re-add it", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);
    seedDevice(context, tenant.id, "device-1", "Ada's Mac");

    const group = await runEffect(
      context.service.createGroup(request(headers), tenant.id, {
        name: "Group",
        devices: ["device-1"],
      }),
    );

    await runEffect(
      context.service.patchGroupMembers(request(headers), tenant.id, group.id, {
        exclude: { devices: ["device-1"] },
      }),
    );

    expect(groupDevices(context, group.id)).toEqual([]);

    await expect(
      runEffect(
        context.service.patchGroupMembers(request(headers), tenant.id, group.id, {
          assign: { devices: ["device-1"] },
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    // Removing the exclusion releases the group's own row; a parent that
    // inherits the group re-materialises it.
    await runEffect(
      context.service.patchGroupMembers(request(headers), tenant.id, group.id, {
        unexclude: { devices: ["device-1"] },
      }),
    );

    expect(groupDevices(context, group.id)).toEqual([]);
  });

  it("wins over inherited membership until the exclusion is removed", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);
    seedDevice(context, tenant.id, "device-1", "Ada's Mac");

    const child = await runEffect(
      context.service.createGroup(request(headers), tenant.id, {
        name: "Child",
        devices: ["device-1"],
      }),
    );

    const parent = await runEffect(
      context.service.createGroup(request(headers), tenant.id, {
        name: "Parent",
        childGroups: [child.id],
      }),
    );

    await runEffect(
      context.service.patchGroupMembers(request(headers), tenant.id, parent.id, {
        exclude: { devices: ["device-1"] },
      }),
    );

    expect(groupDevices(context, parent.id)).toEqual([]);

    await runEffect(
      context.service.patchGroupMembers(request(headers), tenant.id, parent.id, {
        unexclude: { devices: ["device-1"] },
      }),
    );

    expect(groupDevices(context, parent.id)).toEqual([
      { groupId: parent.id, deviceId: "device-1", source: "nested" },
    ]);
  });

  it("removes only the excluded person's directory-derived device", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);

    context.db.store.user_group.push({
      id: "directory-1",
      organizationId: tenant.id,
      name: "Engineering",
      externalId: "entra-group-1",
      description: null,
      source: "graph",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    seedUser(context, tenant.id, "user-1", { email: "ada@acme.test", source: "entra" });
    seedUser(context, tenant.id, "user-2", { email: "grace@acme.test", source: "entra" });
    seedDevice(context, tenant.id, "shared", "Shared Mac");
    seedDevice(context, tenant.id, "single", "Grace's Mac");
    linkUser(context, tenant.id, "shared", "user-1");
    linkUser(context, tenant.id, "shared", "user-2");
    linkUser(context, tenant.id, "single", "user-2");

    context.db.store.user_group_member.push(
      { groupId: "directory-1", userId: "user-1" },
      { groupId: "directory-1", userId: "user-2" },
    );

    const group = await runEffect(
      context.service.createGroup(request(headers), tenant.id, {
        name: "Engineering devices",
        directoryGroupId: "directory-1",
      }),
    );

    expect(
      groupDevices(context, group.id)
        .map((row) => row.deviceId)
        .sort(),
    ).toEqual(["shared", "single"]);

    await runEffect(
      context.service.patchGroupMembers(request(headers), tenant.id, group.id, {
        exclude: { users: ["user-1"] },
      }),
    );

    // Ada's devices are no longer derived through her. The shared Mac stays
    // because Grace still maps it; Grace's own Mac is unaffected.
    expect(
      groupDevices(context, group.id)
        .map((row) => row.deviceId)
        .sort(),
    ).toEqual(["shared", "single"]);

    await runEffect(
      context.service.patchGroupMembers(request(headers), tenant.id, group.id, {
        exclude: { users: ["user-2"] },
      }),
    );

    expect(groupDevices(context, group.id)).toEqual([]);
  });
});

describe("user conditions in dynamic groups", () => {
  const rules = (domain: string) => ({
    version: 1 as const,
    all: [{ field: "userDomain" as const, op: "eq" as const, value: domain }],
  });

  it("matches when any linked user matches and skips devices with none", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);

    seedUser(context, tenant.id, "entra-1", {
      email: "ada@acme.test",
      name: "Ada",
      source: "entra",
    });
    seedDevice(context, tenant.id, "matched", "Ada's Mac");
    linkUser(context, tenant.id, "matched", "entra-1");
    seedDevice(context, tenant.id, "nouser", "Unassigned Mac");

    const group = await runEffect(
      context.service.createGroup(request(headers), tenant.id, {
        name: "Acme people",
        kind: "dynamic",
        rules: rules("acme.test"),
      }),
    );

    expect(groupDevices(context, group.id)).toEqual([
      { groupId: group.id, deviceId: "matched", source: "dynamic" },
    ]);
  });

  it("supports the documented 'none' exclusion on a person condition", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);

    seedUser(context, tenant.id, "contractor", {
      email: "temp@contractor.test",
      source: "entra",
    });
    seedUser(context, tenant.id, "staff", { email: "ada@acme.test", source: "entra" });
    seedDevice(context, tenant.id, "contractor-device", "Temp Mac");
    seedDevice(context, tenant.id, "staff-device", "Ada's Mac");
    seedDevice(context, tenant.id, "nouser", "Unassigned Mac");
    linkUser(context, tenant.id, "contractor-device", "contractor");
    linkUser(context, tenant.id, "staff-device", "staff");

    const group = await runEffect(
      context.service.createGroup(request(headers), tenant.id, {
        name: "Staff",
        kind: "dynamic",
        rules: {
          version: 1,
          none: [{ field: "userEmail", op: "contains", value: "contractor" }],
        },
      }),
    );

    expect(
      groupDevices(context, group.id)
        .map((row) => row.deviceId)
        .sort(),
    ).toEqual(["nouser", "staff-device"]);
  });

  it("ignores an excluded person when evaluating this group's rules", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);

    seedUser(context, tenant.id, "entra-user", { email: "ada@acme.test", source: "entra" });
    seedUser(context, tenant.id, "scim-user", { email: "grace@acme.test", source: "scim" });
    seedDevice(context, tenant.id, "shared", "Shared Mac");
    linkUser(context, tenant.id, "shared", "entra-user");
    linkUser(context, tenant.id, "shared", "scim-user");

    const group = await runEffect(
      context.service.createGroup(request(headers), tenant.id, {
        name: "SCIM people",
        kind: "dynamic",
        rules: {
          version: 1,
          all: [{ field: "userSource", op: "eq", value: "scim" }],
        },
      }),
    );

    expect(groupDevices(context, group.id)).toEqual([
      { groupId: group.id, deviceId: "shared", source: "dynamic" },
    ]);

    await runEffect(
      context.service.patchGroupMembers(request(headers), tenant.id, group.id, {
        exclude: { users: ["scim-user"] },
      }),
    );

    // The only person whose source is SCIM is excluded from this group, so the
    // device no longer matches. The other user's link is unaffected.
    expect(groupDevices(context, group.id)).toEqual([]);

    await runEffect(
      context.service.patchGroupMembers(request(headers), tenant.id, group.id, {
        unexclude: { users: ["scim-user"] },
      }),
    );

    expect(groupDevices(context, group.id)).toEqual([
      { groupId: group.id, deviceId: "shared", source: "dynamic" },
    ]);
  });

  it("matches the identity provider recorded on the directory user", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);

    seedUser(context, tenant.id, "scim-user", { email: "ada@acme.test", source: "scim" });
    seedUser(context, tenant.id, "entra-user", { email: "grace@acme.test", source: "entra" });
    seedDevice(context, tenant.id, "scim-device", "Ada's Mac");
    seedDevice(context, tenant.id, "entra-device", "Grace's Mac");
    linkUser(context, tenant.id, "scim-device", "scim-user");
    linkUser(context, tenant.id, "entra-device", "entra-user");

    const group = await runEffect(
      context.service.createGroup(request(headers), tenant.id, {
        name: "Entra people",
        kind: "dynamic",
        rules: {
          version: 1,
          all: [{ field: "userSource", op: "eq", value: "entra" }],
        },
      }),
    );

    expect(groupDevices(context, group.id)).toEqual([
      { groupId: group.id, deviceId: "entra-device", source: "dynamic" },
    ]);
  });
});
