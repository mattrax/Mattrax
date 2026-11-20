import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { EnterpriseUnauthorized } from "@mattrax/enterprise-domain";
import { permissionForMethod } from "@mattrax/enterprise-identity";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { makeDb, request, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";

const headers = { cookie: "mattrax_session=test" };

const timestamp = new Date("2026-11-01T00:00:00.000Z");

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
    // SAFETY: this test never reaches R2; the service only stores the binding.
    storage: {} as any,
    // SAFETY: the fake only implements the auth methods this test exercises.
    auth: auth as any,
    authSecret: "entity-list-test-secret",
  });

  return { db, service };
};

const makeTenant = async (context: ReturnType<typeof makeContext>) =>
  runEffect(context.service.createTenant(request(headers), { name: "Acme", slug: "acme" }));

const groupRow = (id: string, name: string, kind: "manual" | "dynamic" = "manual") => ({
  id,
  organizationId: "org",
  name,
  notes: null,
  kind,
  rules: null,
  directoryGroupId: null,
  lastEvaluatedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
});

const policyRow = (id: string, name: string, priority = 0) => ({
  id,
  organizationId: "org",
  name,
  notes: null,
  priority,
  enabled: true,
  createdAt: timestamp,
  updatedAt: timestamp,
});

const applicationRow = (id: string, name: string, platform: "apple" | "win" | "android") => ({
  id,
  organizationId: "org",
  name,
  platform,
  bundleId: `com.example.${id}`,
  version: "1.0.0",
  source: "manifest" as const,
  manifestUrl: null,
  storeId: null,
  fileName: null,
  contentType: null,
  size: null,
  sha256: null,
  r2Key: null,
  notes: null,
  createdAt: timestamp,
  updatedAt: timestamp,
});

const seedGroups = (context: ReturnType<typeof makeContext>, tenantId: string) => {
  // Insert in reverse so the assertions prove the server's ordering, not the
  // insertion order.
  const rows = [
    groupRow("group-5", "Echo"),
    groupRow("group-4", "Delta"),
    groupRow("group-3", "Charlie"),
    groupRow("group-2", "Bravo"),
    groupRow("group-1", "Alpha"),
  ];

  context.db.store.enterprise_group.push(
    ...rows.map((row) => ({ ...row, organizationId: tenantId })),
  );

  context.db.store.group_device.push(
    { groupId: "group-5", deviceId: "device-1" },
    { groupId: "group-5", deviceId: "device-2" },
  );
  context.db.store.group_policy.push({ groupId: "group-4", policyId: "policy-1", mode: "include" });
};

const seedPolicies = (context: ReturnType<typeof makeContext>, tenantId: string) => {
  context.db.store.policy.push(
    { ...policyRow("policy-3", "Mike", 10), organizationId: tenantId },
    { ...policyRow("policy-1", "Zulu", 5), organizationId: tenantId },
    { ...policyRow("policy-2", "Alpha", 1), organizationId: tenantId },
  );

  context.db.store.configuration.push(
    {
      kind: "mttx.apple.passcode",
      policyId: "policy-2",
      scope: "device",
      data: {},
      hash: "hash-1",
    },
    {
      kind: "mttx.apple.restrictions",
      policyId: "policy-2",
      scope: "device",
      data: {},
      hash: "hash-2",
    },
  );
};

const seedApplications = (context: ReturnType<typeof makeContext>, tenantId: string) => {
  context.db.store.application.push(
    { ...applicationRow("app-1", "Chrome", "apple"), organizationId: tenantId },
    { ...applicationRow("app-2", "Slack", "apple"), organizationId: tenantId },
  );

  context.db.store.application_group.push({ groupId: "group-1", applicationId: "app-1" });
  context.db.store.application_device.push({ applicationId: "app-1", deviceId: "device-1" });
};

describe("paginated list permissions", () => {
  it("keeps the paginated reads on the same grant as the unpaginated lists", () => {
    expect(permissionForMethod("searchGroups")).toBe("groups.read");
    expect(permissionForMethod("searchPolicies")).toBe("policies.read");
    expect(permissionForMethod("searchApplications")).toBe("applications.read");
  });
});

describe("searchGroups pagination", () => {
  it("returns deterministic name-ordered pages and a total", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);

    seedGroups(context, tenant.id);

    const page = (offset: number) =>
      runEffect(context.service.searchGroups(request(headers), tenant.id, { limit: 2, offset }));

    const first = await page(0);
    const second = await page(2);
    const third = await page(4);

    expect(first.total).toBe(5);
    expect(first.groups.map((group) => group.name)).toEqual(["Alpha", "Bravo"]);
    expect(second.groups.map((group) => group.name)).toEqual(["Charlie", "Delta"]);
    expect(third.groups.map((group) => group.name)).toEqual(["Echo"]);
  });

  it("breaks name ties on id so a page boundary cannot repeat or skip a row", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);

    context.db.store.enterprise_group.push(
      { ...groupRow("group-b", "Same"), organizationId: tenant.id },
      { ...groupRow("group-a", "Same"), organizationId: tenant.id },
    );

    const page = await runEffect(
      context.service.searchGroups(request(headers), tenant.id, { limit: 10 }),
    );

    expect(page.groups.map((group) => group.id)).toEqual(["group-a", "group-b"]);
  });

  it("applies the encoded condition text to the page and the total", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);

    seedGroups(context, tenant.id);

    const encoded = await runEffect(
      context.service.searchGroups(request(headers), tenant.id, {
        query: "name in Alpha, Echo",
      }),
    );

    expect(encoded.total).toBe(2);
    expect(encoded.groups.map((group) => group.name)).toEqual(["Alpha", "Echo"]);
  });

  it("counts members and policies for the rows on the page", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);

    seedGroups(context, tenant.id);

    const page = await runEffect(
      context.service.searchGroups(request(headers), tenant.id, { limit: 5 }),
    );

    const byName = new Map(page.groups.map((group) => [group.name, group]));

    expect(byName.get("Echo")?.devicesCount).toBe(2);
    expect(byName.get("Delta")?.policiesCount).toBe(1);
  });
});

describe("searchPolicies pagination", () => {
  it("orders by name by default and by the requested column", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);

    seedPolicies(context, tenant.id);

    const byName = await runEffect(
      context.service.searchPolicies(request(headers), tenant.id, { limit: 10 }),
    );

    expect(byName.total).toBe(3);
    expect(byName.policies.map((policy) => policy.name)).toEqual(["Alpha", "Mike", "Zulu"]);

    const byPriority = await runEffect(
      context.service.searchPolicies(request(headers), tenant.id, {
        limit: 10,
        sort: "priority",
        direction: "desc",
      }),
    );

    expect(byPriority.policies.map((policy) => policy.name)).toEqual(["Mike", "Zulu", "Alpha"]);
  });

  it("pages without repeating rows and keeps the total stable", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);

    seedPolicies(context, tenant.id);

    const first = await runEffect(
      context.service.searchPolicies(request(headers), tenant.id, { limit: 2 }),
    );

    const second = await runEffect(
      context.service.searchPolicies(request(headers), tenant.id, { limit: 2, offset: 2 }),
    );

    expect(first.total).toBe(3);
    expect(second.total).toBe(3);
    expect(first.policies.map((policy) => policy.name)).toEqual(["Alpha", "Mike"]);
    expect(second.policies.map((policy) => policy.name)).toEqual(["Zulu"]);
  });

  it("filters by free text and keeps the per-row configuration count", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);

    seedPolicies(context, tenant.id);

    const found = await runEffect(
      context.service.searchPolicies(request(headers), tenant.id, { q: "mik" }),
    );

    expect(found.total).toBe(1);
    expect(found.policies[0]).toMatchObject({ name: "Mike", configurationCount: 0 });

    const alpha = await runEffect(
      context.service.searchPolicies(request(headers), tenant.id, {
        query: "name is Alpha",
      }),
    );

    expect(alpha.policies[0]).toMatchObject({ name: "Alpha", configurationCount: 2 });
  });
});

describe("searchApplications pagination", () => {
  it("pages in name order and reports assignment counts", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);

    seedApplications(context, tenant.id);

    const first = await runEffect(
      context.service.searchApplications(request(headers), tenant.id, { limit: 1 }),
    );

    const second = await runEffect(
      context.service.searchApplications(request(headers), tenant.id, { limit: 1, offset: 1 }),
    );

    expect(first.total).toBe(2);
    expect(first.applications.map((application) => application.name)).toEqual(["Chrome"]);
    expect(first.applications[0]).toMatchObject({ groupsCount: 1, devicesCount: 1 });
    expect(second.applications.map((application) => application.name)).toEqual(["Slack"]);
  });

  it("filters on the catalogue search text", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);

    seedApplications(context, tenant.id);

    const found = await runEffect(
      context.service.searchApplications(request(headers), tenant.id, { q: "slack" }),
    );

    expect(found.total).toBe(1);
    expect(found.applications.map((application) => application.name)).toEqual(["Slack"]);
  });
});
