import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  EnterprisePermissionDenied,
  EnterpriseUnauthorized,
} from "@mattrax/enterprise-domain";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { makeDb, request, runEffect, schema } from "./helpers.js";

/**
 * Scope tags are an authorisation boundary, not a label. These tests set up two
 * regions in one tenant and prove that a role scoped to one region cannot list,
 * read, write, command, bulk-delete, export or audit the other. They fail if a
 * handler loses its scope filter, because the API returns the other region's
 * rows rather than an assertion helper's verdict.
 */

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

const SCOPED_PERMISSIONS = [
  "devices.read",
  "devices.write",
  "devices.command",
  "groups.read",
  "groups.write",
  "policies.read",
  "policies.write",
  "applications.read",
  "applications.write",
  "scripts.read",
  "scripts.write",
  "dashboards.read",
  "dashboards.write",
  "audit.read",
  "management.read",
  "members.read",
  "members.write",
  "scope_tags.read",
  "scope_tags.write",
  "tenant.read",
  // Required by the direct-service fallback in tests; the HTTP route uses the
  // ambient scope_tags.write permission instead.
  "tenant.write",
];

const makeContext = () => {
  const db = makeDb();

  const owner = account("user-1", "owner@example.com");
  const scoped = account("user-2", "europe@example.com");

  db.store.account.push(owner, scoped);

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
    // SAFETY: these tests never reach R2.
    storage: {} as any,
    // SAFETY: the fake implements only the auth methods these tests exercise.
    auth: auth as any,
    authSecret: "scope-tags-test-secret",
  });

  return {
    db,
    service,
    as: (user: "owner" | "scoped") => {
      currentUser = user === "owner" ? owner : scoped;
    },
  };
};

type Context = ReturnType<typeof makeContext>;

const seedGroup = (context: Context, organizationId: string, id: string, name: string) => {
  const at = new Date();

  context.db.store.enterprise_group.push({
    id,
    organizationId,
    name,
    notes: null,
    kind: "manual",
    rules: null,
    directoryGroupId: null,
    lastEvaluatedAt: null,
    createdAt: at,
    updatedAt: at,
  });
};

const seedPolicy = (context: Context, organizationId: string, id: string, name: string) => {
  const at = new Date();

  context.db.store.policy.push({
    id,
    organizationId,
    name,
    notes: null,
    priority: 0,
    enabled: true,
    createdAt: at,
    updatedAt: at,
  });
};

const seedApplication = (context: Context, organizationId: string, id: string, name: string) => {
  const at = new Date();

  context.db.store.application.push({
    id,
    organizationId,
    name,
    platform: "apple",
    bundleId: `com.example.${id}`,
    version: "1.0",
    source: "manifest",
    manifestUrl: null,
    storeId: null,
    notes: null,
    removeOnUnassign: false,
    fileName: null,
    contentType: null,
    size: null,
    sha256: null,
    r2Key: null,
    createdAt: at,
    updatedAt: at,
  });
};

const seedScript = (context: Context, organizationId: string, id: string, name: string) => {
  const at = new Date();

  context.db.store.script.push({
    id,
    organizationId,
    name,
    description: null,
    language: "zsh",
    body: "echo hello",
    runAs: "user",
    timeoutSeconds: 300,
    environment: null,
    triggerType: "manual",
    intervalSeconds: null,
    cronExpression: null,
    enabled: true,
    createdByAccountId: "user-1",
    createdAt: at,
    updatedAt: at,
  });
};

const seedDevice = (context: Context, organizationId: string, id: string) => {
  const at = new Date();

  context.db.store.device.push({
    id,
    organizationId,
    proto: "apple",
    status: "enrolled",
    name: id,
    enrolledAt: at,
    lastSeenAt: at,
  });
};

const seedScopedMember = (context: Context, organizationId: string, tagId: string) => {
  const at = new Date();

  context.db.store.tenant_role.push({
    id: "role-europe",
    organizationId,
    name: "Europe helpdesk",
    description: null,
    permissions: SCOPED_PERMISSIONS,
    createdByAccountId: "user-1",
    createdAt: at,
    updatedAt: at,
  });
  context.db.store.member.push({
    id: "member-europe",
    organizationId,
    accountId: "user-2",
    role: "member",
    customRoleId: "role-europe",
    onboardingDismissedAt: null,
    createdAt: at,
    updatedAt: at,
  });
  context.db.store.member_scope_tag.push({
    organizationId,
    memberId: "member-europe",
    tagId,
    createdAt: at,
  });
};

const setup = async () => {
  const context = makeContext();
  const tenant = await runEffect(
    context.service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
  );

  const europe = await runEffect(
    context.service.createScopeTag(request(headers), tenant.id, {
      name: "Europe",
      description: "European fleet",
    }),
  );
  const asia = await runEffect(
    context.service.createScopeTag(request(headers), tenant.id, {
      name: "Asia",
      description: "Asian fleet",
    }),
  );

  seedGroup(context, tenant.id, "group-europe", "Europe devices");
  seedGroup(context, tenant.id, "group-asia", "Asia devices");
  seedGroup(context, tenant.id, "group-untagged", "Untagged devices");
  seedPolicy(context, tenant.id, "policy-europe", "Europe baseline");
  seedPolicy(context, tenant.id, "policy-asia", "Asia baseline");
  seedApplication(context, tenant.id, "app-europe", "Europe app");
  seedApplication(context, tenant.id, "app-asia", "Asia app");
  seedScript(context, tenant.id, "script-europe", "Europe script");
  seedScript(context, tenant.id, "script-asia", "Asia script");
  seedDevice(context, tenant.id, "device-europe");
  seedDevice(context, tenant.id, "device-asia");

  await runEffect(
    context.service.setScopeTagAssignments(request(headers), tenant.id, {
      resourceType: "group",
      resourceIds: ["group-europe"],
      tagIds: [europe.id],
    }),
  );
  await runEffect(
    context.service.setScopeTagAssignments(request(headers), tenant.id, {
      resourceType: "group",
      resourceIds: ["group-asia"],
      tagIds: [asia.id],
    }),
  );
  await runEffect(
    context.service.setScopeTagAssignments(request(headers), tenant.id, {
      resourceType: "policy",
      resourceIds: ["policy-europe"],
      tagIds: [europe.id],
    }),
  );
  await runEffect(
    context.service.setScopeTagAssignments(request(headers), tenant.id, {
      resourceType: "policy",
      resourceIds: ["policy-asia"],
      tagIds: [asia.id],
    }),
  );
  await runEffect(
    context.service.setScopeTagAssignments(request(headers), tenant.id, {
      resourceType: "application",
      resourceIds: ["app-europe"],
      tagIds: [europe.id],
    }),
  );
  await runEffect(
    context.service.setScopeTagAssignments(request(headers), tenant.id, {
      resourceType: "application",
      resourceIds: ["app-asia"],
      tagIds: [asia.id],
    }),
  );
  await runEffect(
    context.service.setScopeTagAssignments(request(headers), tenant.id, {
      resourceType: "script",
      resourceIds: ["script-europe"],
      tagIds: [europe.id],
    }),
  );
  await runEffect(
    context.service.setScopeTagAssignments(request(headers), tenant.id, {
      resourceType: "script",
      resourceIds: ["script-asia"],
      tagIds: [asia.id],
    }),
  );
  await runEffect(
    context.service.setScopeTagAssignments(request(headers), tenant.id, {
      resourceType: "device",
      resourceIds: ["device-europe"],
      tagIds: [europe.id],
    }),
  );
  await runEffect(
    context.service.setScopeTagAssignments(request(headers), tenant.id, {
      resourceType: "device",
      resourceIds: ["device-asia"],
      tagIds: [asia.id],
    }),
  );

  seedScopedMember(context, tenant.id, europe.id);

  return { context, tenantId: tenant.id, europe: europe.id, asia: asia.id };
};

const expectDenied = async (effect: Promise<unknown>) => {
  await expect(effect).rejects.toBeInstanceOf(EnterprisePermissionDenied);
};

describe("scope tags", () => {
  it("rejects duplicate tag names and unknown tag ids", async () => {
    const { context, tenantId } = await setup();

    await expect(
      runEffect(
        context.service.createScopeTag(request(headers), tenantId, { name: "Europe" }),
      ),
    ).rejects.toThrow(/already exists/i);

    await expectDenied(
      runEffect(
        context.service.setScopeTagAssignments(request(headers), tenantId, {
          resourceType: "group",
          resourceIds: ["group-untagged"],
          tagIds: ["tag-from-another-tenant"],
        }),
      ),
    );
  });

  it("refuses to delete a tag that is still assigned to an administrator", async () => {
    const { context, tenantId, europe } = await setup();

    await expect(
      runEffect(context.service.deleteScopeTag(request(headers), tenantId, europe)),
    ).rejects.toThrow(/assigned to one or more members/i);
  });

  it("filters policy lists and refuses cross-scope policy writes", async () => {
    const { context, tenantId } = await setup();

    context.as("scoped");
    const policies = await runEffect(context.service.listPolicies(request(headers), tenantId));
    expect(policies.rows.map((row: { id: string }) => row.id)).toEqual(["policy-europe"]);

    await expectDenied(
      runEffect(context.service.getPolicy(request(headers), tenantId, "policy-asia")),
    );
    await expectDenied(
      runEffect(
        context.service.patchPolicy(request(headers), tenantId, "policy-asia", {
          name: "Renamed by Europe",
        }),
      ),
    );

    const deleted = await runEffect(
      context.service.deletePolicies(request(headers), tenantId, ["policy-europe", "policy-asia"]),
    );
    expect(deleted.deleted).toEqual(["policy-europe"]);
    expect(deleted.failed).toEqual([{ id: "policy-asia", reason: "notFound" }]);
  });

  it("lists only in-scope resources and hides untagged resources from a scoped role", async () => {
    const { context, tenantId } = await setup();

    context.as("owner");
    const ownerList = await runEffect(context.service.listGroups(request(headers), tenantId));
    expect(ownerList.rows.map((row: { id: string }) => row.id).sort()).toEqual([
      "group-asia",
      "group-europe",
      "group-untagged",
    ]);

    context.as("scoped");
    const scopedList = await runEffect(context.service.listGroups(request(headers), tenantId));
    expect(scopedList.rows.map((row: { id: string }) => row.id)).toEqual(["group-europe"]);
  });

  it("refuses to read or write another tag's group and leaves it unchanged", async () => {
    const { context, tenantId } = await setup();

    context.as("scoped");
    await expectDenied(
      runEffect(context.service.getGroup(request(headers), tenantId, "group-asia")),
    );
    await expectDenied(
      runEffect(
        context.service.patchGroup(request(headers), tenantId, "group-asia", {
          name: "Renamed by Europe",
        }),
      ),
    );

    context.as("owner");
    const row = await runEffect(context.service.getGroup(request(headers), tenantId, "group-asia"));
    expect(row.name).toBe("Asia devices");
  });

  it("does not delete another tag's group through a bulk action", async () => {
    const { context, tenantId } = await setup();

    context.as("scoped");
    const result = await runEffect(
      context.service.deleteGroups(request(headers), tenantId, ["group-europe", "group-asia"]),
    );

    expect(result.deleted).toEqual(["group-europe"]);
    expect(result.failed).toEqual([{ id: "group-asia", reason: "notFound" }]);

    context.as("owner");
    const remaining = await runEffect(
      context.service.listGroups(request(headers), tenantId),
    );
    expect(remaining.rows.map((row: { id: string }) => row.id).sort()).toEqual([
      "group-asia",
      "group-untagged",
    ]);
  });

  it("cannot move a resource into a tag outside its own scope", async () => {
    const { context, tenantId, asia } = await setup();

    context.as("scoped");
    await expectDenied(
      runEffect(
        context.service.setScopeTagAssignments(request(headers), tenantId, {
          resourceType: "group",
          resourceIds: ["group-europe"],
          tagIds: [asia],
        }),
      ),
    );

    context.as("owner");
    const assignments = await runEffect(
      context.service.listScopeTagAssignments(request(headers), tenantId, {
        resourceType: "group",
        resourceIds: "group-europe",
      }),
    );
    expect(assignments.assignments[0]?.tagIds).not.toContain(asia);
  });

  it("refuses to untag a resource when the caller is scoped", async () => {
    const { context, tenantId } = await setup();

    context.as("scoped");
    await expect(
      runEffect(
        context.service.setScopeTagAssignments(request(headers), tenantId, {
          resourceType: "group",
          resourceIds: ["group-europe"],
          tagIds: [],
        }),
      ),
    ).rejects.toThrow(/tenant-wide/i);
  });

  it("filters device lists, reads, commands and CSV export to the scope", async () => {
    const { context, tenantId } = await setup();

    context.as("scoped");
    const list = await runEffect(context.service.listDevices(request(headers), tenantId));
    expect(list.rows.map((row: { id: string }) => row.id)).toEqual(["device-europe"]);

    await expect(
      runEffect(context.service.getDevice(request(headers), tenantId, "device-asia")),
    ).rejects.toThrow(/not found/i);

    await expectDenied(
      runEffect(
        context.service.deviceAction(request(headers), tenantId, "device-asia", {
          action: "sync",
        }),
      ),
    );

    const exported = await runEffect(
      context.service.exportDevices(request(headers), tenantId, {}),
    );
    expect(exported.csv).toContain("device-europe");
    expect(exported.csv).not.toContain("device-asia");
  });

  it("automatically tags a resource created by a scoped administrator", async () => {
    const { context, tenantId, europe } = await setup();

    context.as("scoped");
    const created = await runEffect(
      context.service.createGroup(request(headers), tenantId, { name: "Europe field team" }),
    );

    const list = await runEffect(context.service.listGroups(request(headers), tenantId));
    expect(list.rows.map((row: { id: string }) => row.id).sort()).toEqual(
      ["group-europe", created.id].sort(),
    );

    const assignments = await runEffect(
      context.service.listScopeTagAssignments(request(headers), tenantId, {
        resourceType: "group",
        resourceIds: created.id,
      }),
    );
    expect(assignments.assignments).toEqual([
      { resourceType: "group", resourceId: created.id, tagIds: [europe] },
    ]);
  });

  it("does not leak another tag's assignment mapping to a scoped reader", async () => {
    const { context, tenantId, europe } = await setup();

    context.as("scoped");
    const assignments = await runEffect(
      context.service.listScopeTagAssignments(request(headers), tenantId, {
        resourceType: "group",
      }),
    );

    expect(assignments.assignments).toEqual([
      { resourceType: "group", resourceId: "group-europe", tagIds: [europe] },
    ]);
  });

  it("keeps owners unscoped even when tags are stored against their membership", async () => {
    const { context, tenantId, europe } = await setup();

    // A stray row must never narrow an owner: the built-in role wins so the
    // tenant can always be administered back into shape.
    context.db.store.member_scope_tag.push({
      organizationId: tenantId,
      memberId: context.db.store.member.find(
        (row: { accountId: string }) => row.accountId === "user-1",
      ).id,
      tagId: europe,
      createdAt: new Date(),
    });

    context.as("owner");
    const list = await runEffect(context.service.listGroups(request(headers), tenantId));
    expect(list.rows).toHaveLength(3);
  });

  it("prevents a scoped administrator widening their own or another membership", async () => {
    const { context, tenantId, europe } = await setup();

    context.as("scoped");
    await expect(
      runEffect(
        context.service.setMemberScopeTags(request(headers), tenantId, "user-2", {
          tagIds: [],
        }),
      ),
    ).rejects.toThrow(/unscoped administrator/i);

    // Non-empty but still self: the empty-tags guard must not be what stops it.
    await expect(
      runEffect(
        context.service.setMemberScopeTags(request(headers), tenantId, "user-2", {
          tagIds: [europe],
        }),
      ),
    ).rejects.toThrow(/your own scope tags/i);
  });

  it("preserves tags the editor cannot see and drops tag counts on delete", async () => {
    const { context, tenantId, asia, europe } = await setup();

    await runEffect(
      context.service.setScopeTagAssignments(request(headers), tenantId, {
        resourceType: "group",
        resourceIds: ["group-europe"],
        tagIds: [europe, asia],
      }),
    );

    context.as("scoped");
    await runEffect(
      context.service.setScopeTagAssignments(request(headers), tenantId, {
        resourceType: "group",
        resourceIds: ["group-europe"],
        tagIds: [europe],
      }),
    );

    context.as("owner");
    const assignments = await runEffect(
      context.service.listScopeTagAssignments(request(headers), tenantId, {
        resourceType: "group",
        resourceIds: "group-europe",
      }),
    );
    expect(new Set(assignments.assignments[0]?.tagIds)).toEqual(new Set([europe, asia]));

    const before = await runEffect(context.service.listScopeTags(request(headers), tenantId));
    const beforeCount = before.tags.find((tag: { id: string }) => tag.id === europe)?.resourceCount;

    await runEffect(context.service.deleteGroups(request(headers), tenantId, ["group-europe"]));
    const tags = await runEffect(context.service.listScopeTags(request(headers), tenantId));
    expect(tags.tags.find((tag: { id: string }) => tag.id === europe)?.resourceCount).toBe(
      beforeCount! - 1,
    );
  });

  it("refuses cross-scope device subresources and tenant-wide exports", async () => {
    const { context, tenantId } = await setup();

    context.as("scoped");
    await expectDenied(
      runEffect(context.service.deviceUnenroll(request(headers), tenantId, "device-asia")),
    );
    await expectDenied(
      runEffect(context.service.listDeviceAppleUsers(request(headers), tenantId, "device-asia")),
    );
    await expectDenied(
      runEffect(
        context.service.setDeviceAttributes(request(headers), tenantId, "device-asia", {
          values: {},
        }),
      ),
    );
    await expectDenied(
      runEffect(context.service.exportTenant(request(headers), tenantId, {})),
    );
    await expectDenied(
      runEffect(context.service.listWindowsFailures(request(headers), tenantId, {})),
    );
    await expectDenied(
      runEffect(context.service.listUsers(request(headers), tenantId)),
    );
  });

  it("filters global search and blocks tenant-wide dashboard reports", async () => {
    const { context, tenantId, europe } = await setup();
    const at = new Date();

    context.db.store.dashboard.push({
      id: "dashboard-europe",
      organizationId: tenantId,
      name: "Europe overview",
      description: null,
      isDefault: false,
      createdByAccountId: "user-1",
      createdAt: at,
      updatedAt: at,
    });
    await runEffect(
      context.service.setScopeTagAssignments(request(headers), tenantId, {
        resourceType: "dashboard",
        resourceIds: ["dashboard-europe"],
        tagIds: [europe],
      }),
    );

    context.as("scoped");
    const results = await runEffect(
      context.service.search(request(headers), tenantId, { q: "europe" }),
    );
    expect(results.rows.map((row) => ("id" in row ? row.id : "")).sort()).toEqual([
      "app-europe",
      "device-europe",
      "group-europe",
      "policy-europe",
    ]);

    await expectDenied(
      runEffect(
        context.service.createDashboardReport(request(headers), tenantId, "dashboard-europe", {
          name: "Weekly",
          recipients: { memberAccountIds: ["user-1"], emails: [] },
        }),
      ),
    );
  });

  it("filters applications, scripts, dashboards and VPP assignments", async () => {
    const { context, tenantId, europe } = await setup();
    const at = new Date();

    context.db.store.dashboard.push({
      id: "dashboard-europe",
      organizationId: tenantId,
      name: "Europe overview",
      description: null,
      isDefault: false,
      createdByAccountId: "user-1",
      createdAt: at,
      updatedAt: at,
    });
    await runEffect(
      context.service.setScopeTagAssignments(request(headers), tenantId, {
        resourceType: "dashboard",
        resourceIds: ["dashboard-europe"],
        tagIds: [europe],
      }),
    );
    context.db.store.device_vpp_assignment.push(
      {
        organizationId: tenantId,
        deviceId: "device-europe",
        adamId: "123",
        serial: "europe",
        pricingParam: null,
        state: "assigned",
        eventId: null,
        lastError: null,
        createdAt: at,
        updatedAt: at,
      },
      {
        organizationId: tenantId,
        deviceId: "device-asia",
        adamId: "123",
        serial: "asia",
        pricingParam: null,
        state: "assigned",
        eventId: null,
        lastError: null,
        createdAt: at,
        updatedAt: at,
      },
    );

    context.as("scoped");
    const apps = await runEffect(context.service.listApplications(request(headers), tenantId));
    expect(apps.applications.map((row: { id: string }) => row.id)).toEqual(["app-europe"]);
    await expectDenied(
      runEffect(context.service.downloadApplication(request(headers), tenantId, "app-asia", "x")),
    );

    const scripts = await runEffect(context.service.listScripts(request(headers), tenantId));
    expect(scripts.scripts.map((row: { id: string }) => row.id)).toEqual(["script-europe"]);

    const dashboards = await runEffect(
      context.service.listDashboards(request(headers), tenantId),
    );
    expect(dashboards.dashboards.map((row: { id: string }) => row.id)).toEqual([
      "dashboard-europe",
    ]);

    const vpp = await runEffect(
      context.service.listVppAssignments(request(headers), tenantId),
    );
    expect(vpp.assignments.map((row: { deviceId: string }) => row.deviceId)).toEqual([
      "device-europe",
    ]);

    await expect(
      runEffect(
        context.service.setMemberScopeTags(request(headers), tenantId, "user-1", {
          tagIds: [europe],
        }),
      ),
    ).rejects.toThrow(/Owners are always unscoped/i);
  });

  it("records a denied cross-scope attempt in the audit log", async () => {
    const { context, tenantId } = await setup();

    context.as("scoped");
    await expectDenied(
      runEffect(
        context.service.patchGroup(request(headers), tenantId, "group-asia", { name: "Nope" }),
      ),
    );

    context.as("owner");
    const audit = await runEffect(context.service.listAuditLog(request(headers), tenantId));
    const denial = audit.entries.find(
      (entry: { action: string }) => entry.action === "scope_tag.access_denied",
    );

    expect(denial).toBeDefined();
    expect(denial?.targetId).toBe("group-asia");

    // The denial names another region's resource, so a scoped audit query must
    // not surface it either.
    context.as("scoped");
    const scopedAudit = await runEffect(
      context.service.listAuditLog(request(headers), tenantId),
    );
    expect(
      scopedAudit.entries.some(
        (entry: { action: string }) => entry.action === "scope_tag.access_denied",
      ),
    ).toBe(false);
  });
});
