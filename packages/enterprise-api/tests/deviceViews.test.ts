import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  EnterpriseBadRequest,
  EnterpriseConflict,
  EnterpriseNotFound,
  EnterprisePermissionDenied,
  EnterpriseUnauthorized,
} from "@mattrax/enterprise-domain";
import type { DeviceViewQuery } from "@mattrax/enterprise-domain";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { makeDb, makeStripeClient, request, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";

const headers = { cookie: "mattrax_session=test" };

const timestamp = new Date("2026-11-01T00:00:00.000Z");

const account = (id: string, email: string) => ({
  id,
  name: id,
  email,
  emailVerified: true,
  image: null,
  createdAt: timestamp,
  updatedAt: timestamp,
});

const makeContext = () => {
  const db = makeDb();

  const owner = account("user-1", "owner@example.com");
  const member = account("user-2", "member@example.com");

  db.store.account.push(owner, member);

  let currentUser = owner;

  const auth = {
    requireUser: (input: any) => {
      const inputHeaders =
        input instanceof Request ? Object.fromEntries(input.headers) : input.headers;

      return inputHeaders.cookie
        ? Effect.succeed({ user: currentUser })
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
    // SAFETY: these tests never reach R2.
    storage: {} as any,
    // SAFETY: the fake implements only the auth methods these tests exercise.
    auth: auth as any,
    authSecret: "device-views-test-secret",
  });

  return {
    db,
    service,
    as: (user: "owner" | "member") => {
      currentUser = user === "owner" ? owner : member;
    },
  };
};

const createTenant = async (context: ReturnType<typeof makeContext>, slug: string) => {
  context.as("owner");

  return runEffect(context.service.createTenant(request(headers), { name: slug, slug }));
};

const addMember = (context: ReturnType<typeof makeContext>, tenantId: string, role = "member") => {
  context.db.store.member.push({
    id: `member-${role}`,
    organizationId: tenantId,
    accountId: "user-2",
    role,
    customRoleId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
};

const query = (overrides: Partial<DeviceViewQuery> = {}): DeviceViewQuery => ({
  q: "mac",
  status: "enrolled",
  proto: "apple",
  health: "missing",
  sort: "lastSeenAt",
  direction: "desc",
  columns: ["name", "health", "lastSeen"],
  pageSize: 25,
  ...overrides,
});

type CreateViewOverrides = {
  name?: string;
  description?: string | null;
  visibility?: "private" | "tenant";
  query?: DeviceViewQuery;
};

const createView = (
  context: ReturnType<typeof makeContext>,
  tenantId: string,
  overrides: CreateViewOverrides = {},
) =>
  runEffect(
    context.service.createDeviceView(request(headers), tenantId, {
      name: "MIA Macs",
      description: "Macs that stopped checking in",
      visibility: "private",
      query: query(),
      ...overrides,
    }),
  );

const listViews = (context: ReturnType<typeof makeContext>, tenantId: string) =>
  runEffect(context.service.listDeviceViews(request(headers), tenantId));

describe("device views", () => {
  it("round-trips filters, sort, direction, columns and page size", async () => {
    const context = makeContext();
    const tenant = await createTenant(context, "acme");

    const created = await createView(context, tenant.id);
    const list = await listViews(context, tenant.id);

    expect(list.views).toHaveLength(1);
    expect(list.views[0]).toMatchObject({
      id: created.id,
      name: "MIA Macs",
      description: "Macs that stopped checking in",
      visibility: "private",
      isOwner: true,
      isDefault: false,
      query: query(),
    });
  });

  it("persists column changes independently of the filters", async () => {
    const context = makeContext();
    const tenant = await createTenant(context, "acme");
    const created = await createView(context, tenant.id);

    await runEffect(
      context.service.patchDeviceView(request(headers), tenant.id, created.id, {
        query: query({ columns: ["name", "serial", "groups"], pageSize: 100 }),
      }),
    );

    const list = await listViews(context, tenant.id);

    expect(list.views[0]?.query.columns).toEqual(["name", "serial", "groups"]);
    expect(list.views[0]?.query.pageSize).toBe(100);
    expect(list.views[0]?.query.health).toBe("missing");
  });

  it("isolates views by tenant and hides other tenants' ids", async () => {
    const context = makeContext();
    const acme = await createTenant(context, "acme");
    const globex = await createTenant(context, "globex");
    const created = await createView(context, acme.id);

    expect(await listViews(context, globex.id)).toEqual({ views: [] });

    await expect(
      runEffect(
        context.service.patchDeviceView(request(headers), globex.id, created.id, {
          name: "Stolen",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);

    await expect(
      runEffect(context.service.deleteDeviceView(request(headers), globex.id, created.id)),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);
  });

  it("lets a read-only member manage private views but not publish", async () => {
    const context = makeContext();
    const tenant = await createTenant(context, "acme");
    addMember(context, tenant.id);
    context.as("member");

    const privateView = await createView(context, tenant.id);
    expect(privateView.id).toBeTruthy();

    await expect(
      createView(context, tenant.id, { name: "Fleet", visibility: "tenant" }),
    ).rejects.toBeInstanceOf(EnterprisePermissionDenied);

    context.as("owner");
    const shared = await createView(context, tenant.id, {
      name: "Fleet",
      visibility: "tenant",
    });
    context.as("member");

    const list = await listViews(context, tenant.id);
    expect(list.views.map((view) => view.id)).toContain(shared.id);
    expect(list.views.find((view) => view.id === shared.id)?.isOwner).toBe(false);

    // A member can choose a tenant view as their default...
    await runEffect(
      context.service.setDefaultDeviceView(request(headers), tenant.id, { viewId: shared.id }),
    );

    const withDefault = await listViews(context, tenant.id);
    expect(withDefault.views.find((view) => view.id === shared.id)?.isDefault).toBe(true);

    // ...but cannot edit or delete it.
    await expect(
      runEffect(
        context.service.patchDeviceView(request(headers), tenant.id, shared.id, {
          name: "Changed",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterprisePermissionDenied);

    await expect(
      runEffect(context.service.deleteDeviceView(request(headers), tenant.id, shared.id)),
    ).rejects.toBeInstanceOf(EnterprisePermissionDenied);
  });

  it("stores deleted group and attribute references without failing", async () => {
    const context = makeContext();
    const tenant = await createTenant(context, "acme");

    const created = await createView(context, tenant.id, {
      name: "Old references",
      query: query({
        groupId: "deleted-group",
        attributes: JSON.stringify({ deleted_attribute: "value" }),
        columns: ["name", "attribute:deleted_attribute"],
      }),
    });

    const list = await listViews(context, tenant.id);
    const stored = list.views.find((view) => view.id === created.id);

    expect(stored?.query.groupId).toBe("deleted-group");
    expect(stored?.query.attributes).toBe('{"deleted_attribute":"value"}');
    expect(stored?.query.columns).toEqual(["name", "attribute:deleted_attribute"]);
  });

  it("rejects duplicate names for the same owner and validates the query", async () => {
    const context = makeContext();
    const tenant = await createTenant(context, "acme");

    await createView(context, tenant.id);

    await expect(createView(context, tenant.id)).rejects.toBeInstanceOf(EnterpriseConflict);

    await expect(
      createView(context, tenant.id, { name: "Bad", query: query({ pageSize: 500 }) }),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    await expect(
      createView(context, tenant.id, { name: "Bad sort", query: query({ sort: "nope" }) }),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
  });

  it("writes audit entries for create, update, delete and default changes", async () => {
    const context = makeContext();
    const tenant = await createTenant(context, "acme");
    const created = await createView(context, tenant.id);

    await runEffect(
      context.service.patchDeviceView(request(headers), tenant.id, created.id, { name: "Renamed" }),
    );
    await runEffect(
      context.service.setDefaultDeviceView(request(headers), tenant.id, { viewId: created.id }),
    );
    await runEffect(context.service.deleteDeviceView(request(headers), tenant.id, created.id));

    const actions = context.db.store.audit_log
      .filter((row) => row.organizationId === tenant.id)
      .map((row) => row.action);

    expect(actions).toEqual(
      expect.arrayContaining([
        "device_view.created",
        "device_view.updated",
        "device_view.default_changed",
        "device_view.deleted",
      ]),
    );
  });
});
