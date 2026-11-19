import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  EnterpriseBadRequest,
  EnterpriseConflict,
  EnterpriseUnauthorized,
} from "@mattrax/enterprise-domain";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { makeDb, makeStripeClient, request, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";

const headers = { cookie: "mattrax_session=test" };

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
    stripeClient: makeStripeClient(),
    // SAFETY: this test never reaches R2; the service only stores the binding.
    storage: {} as any,
    // SAFETY: the fake only implements the auth methods these tests exercise.
    auth: auth as any,
    authSecret: "directory-groups-test-secret",
  });

  return { db, service, user };
};

const timestamp = new Date("2026-11-01T00:00:00.000Z");

/** One directory person, their device and the directory group they belong to. */
const seedDirectory = (
  context: ReturnType<typeof makeContext>,
  tenantId: string,
  overrides: { directoryGroupId?: string; organizationId?: string } = {},
) => {
  const organizationId = overrides.organizationId ?? tenantId;
  const directoryGroupId = overrides.directoryGroupId ?? "directory-1";

  context.db.store.user_group.push({
    id: directoryGroupId,
    organizationId,
    name: "Engineering",
    externalId: "entra-group-1",
    description: null,
    source: "graph",
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  context.db.store.user.push({
    id: "directory-user-1",
    organizationId,
    name: "Ada",
    email: "ada@acme.test",
    externalId: "entra-user-1",
    source: "entra",
    disabled: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  context.db.store.user_group_member.push({
    groupId: directoryGroupId,
    userId: "directory-user-1",
  });

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
    userId: "directory-user-1",
    source: "manual",
    createdAt: timestamp,
  });

  return { directoryGroupId };
};

const makeTenant = async (context: ReturnType<typeof makeContext>) =>
  runEffect(context.service.createTenant(request(headers), { name: "Acme", slug: "acme" }));

describe("directory-linked device groups", () => {
  it("derives device membership and exposes the link read-only", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);
    const { directoryGroupId } = seedDirectory(context, tenant.id);

    const group = await runEffect(
      context.service.createGroup(request(headers), tenant.id, {
        name: "Engineering devices",
        directoryGroupId,
      }),
    );

    expect(context.db.store.group_device).toEqual([
      { groupId: group.id, deviceId: "device-1", source: "directory" },
    ]);

    const detail = await runEffect(
      context.service.getGroup(request(headers), tenant.id, group.id),
    );

    expect(detail).toMatchObject({
      id: group.id,
      kind: "manual",
      directoryGroupId,
      directoryGroup: { id: directoryGroupId, name: "Engineering" },
      devicesCount: 1,
      devices: [{ id: "device-1", name: "Ada's Mac" }],
    });

    const preview = await runEffect(
      context.service.previewGroup(request(headers), tenant.id, group.id),
    );

    expect(preview).toMatchObject({ kind: "directory", count: 1 });

    // Manual edits of a derived group are rejected rather than silently lost.
    await expect(
      runEffect(
        context.service.patchGroupMembers(request(headers), tenant.id, group.id, {
          assign: { devices: ["device-1"] },
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
  });

  it("rejects a second device group linked to the same directory group", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);
    const { directoryGroupId } = seedDirectory(context, tenant.id);

    await runEffect(
      context.service.createGroup(request(headers), tenant.id, {
        name: "First",
        directoryGroupId,
      }),
    );

    await expect(
      runEffect(
        context.service.createGroup(request(headers), tenant.id, {
          name: "Second",
          directoryGroupId,
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseConflict);
  });

  it("refuses a directory group from another tenant", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);

    const other = await runEffect(
      context.service.createTenant(request(headers), { name: "Other", slug: "other" }),
    );

    context.db.store.user_group.push({
      id: "other-directory-group",
      organizationId: other.id,
      name: "Other directory",
      externalId: "entra-group-other",
      description: null,
      source: "graph",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await expect(
      runEffect(
        context.service.createGroup(request(headers), tenant.id, {
          name: "Engineering devices",
          directoryGroupId: "other-directory-group",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
  });

  it("assigns an application to a directory user group and resolves its devices", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);
    const { directoryGroupId } = seedDirectory(context, tenant.id);

    const application = await runEffect(
      context.service.createApplication(request(headers), tenant.id, {
        name: "Slack",
        platform: "apple",
        source: "store",
        storeId: "803453959",
      }),
    );

    await runEffect(
      context.service.patchApplicationAssignments(request(headers), tenant.id, application.id, {
        assign: { userGroups: [directoryGroupId] },
      }),
    );

    expect(context.db.store.user_group_application).toMatchObject([
      { organizationId: tenant.id, groupId: directoryGroupId, applicationId: application.id },
    ]);

    const detail = await runEffect(
      context.service.getApplication(request(headers), tenant.id, application.id),
    );

    expect(detail).toMatchObject({
      id: application.id,
      userGroups: [{ id: directoryGroupId, name: "Engineering" }],
      resolvedDevicesCount: 1,
    });

    // Disabling the directory person withdraws the derived device.
    context.db.store.user[0]!.disabled = true;

    const afterDisable = await runEffect(
      context.service.getApplication(request(headers), tenant.id, application.id),
    );

    expect(afterDisable.resolvedDevicesCount).toBe(0);
  });
});
