import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { makeDb, request, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";

const now = new Date("2026-11-18T12:00:00.000Z");

type Role =
  | { readonly kind: "built-in"; readonly role: string }
  | { readonly kind: "custom"; readonly permissions: ReadonlyArray<string> };

const makeContext = (role: Role = { kind: "built-in", role: "owner" }) => {
  const db = makeDb();

  db.store.account.push({
    id: "user-1",
    name: "Owner",
    email: "owner@example.com",
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
  });
  db.store.organization.push({
    id: "org-1",
    name: "Acme",
    slug: "acme",
    createdAt: now,
    updatedAt: now,
  });

  const customRoleId = role.kind === "custom" ? "role-1" : null;

  if (role.kind === "custom")
    db.store.tenant_role.push({
      id: "role-1",
      organizationId: "org-1",
      name: "Limited",
      description: null,
      permissions: [...role.permissions],
      createdByAccountId: "user-1",
      createdAt: now,
      updatedAt: now,
    });

  db.store.member.push({
    id: "member-1",
    organizationId: "org-1",
    accountId: "user-1",
    role: role.kind === "built-in" ? role.role : "member",
    customRoleId,
    createdAt: now,
    updatedAt: now,
  });

  const auth = {
    requireUser: () =>
      Effect.succeed({
        user: db.store.account[0],
      }),
  };

  const service = createEnterpriseService({
    db,
    schema,
    origin,
    // SAFETY: search never reaches R2; the service only stores the binding.
    storage: {} as any,
    // SAFETY: the fake implements only the auth method search exercises.
    auth: auth as any,
    authSecret: "enterprise-test-secret",
  });

  return { db, service, headers: { cookie: "mattrax_session=test" } };
};

const application = (overrides: {
  id: string;
  organizationId?: string;
  name: string;
  platform?: "apple" | "win" | "android";
  bundleId?: string | null;
  storeId?: string | null;
}) => ({
  id: overrides.id,
  organizationId: overrides.organizationId ?? "org-1",
  name: overrides.name,
  platform: overrides.platform ?? ("apple" as const),
  bundleId: overrides.bundleId ?? null,
  version: null,
  source: "manifest" as const,
  manifestUrl: null,
  storeId: overrides.storeId ?? null,
  fileName: null,
  contentType: null,
  size: null,
  sha256: null,
  r2Key: null,
  notes: null,
  createdAt: now,
  updatedAt: now,
});

const installed = (overrides: {
  deviceId: string;
  organizationId?: string;
  bundleId: string;
  name: string | null;
  version: string | null;
  shortVersion?: string | null;
  publisher?: string | null;
}) => ({
  deviceId: overrides.deviceId,
  organizationId: overrides.organizationId ?? "org-1",
  bundleId: overrides.bundleId,
  name: overrides.name,
  version: overrides.version,
  shortVersion: overrides.shortVersion ?? null,
  publisher: overrides.publisher ?? null,
  bundleSize: null,
  dynamicSize: null,
  hasUpdateAvailable: false,
  isManaged: true,
  lastReportedAt: now,
});

const search = (context: ReturnType<typeof makeContext>, q: string, limit = 20) =>
  runEffect(context.service.search(request(context.headers), "org-1", { q, limit }));

describe("tenant search", () => {
  it("returns catalogue applications and aggregates installed software per app/version", async () => {
    const context = makeContext();

    context.db.store.application.push(
      application({
        id: "app-figma",
        name: "Figma",
        platform: "apple",
        bundleId: "com.figma.Desktop",
      }),
      application({ id: "app-slack", name: "Slack", platform: "win", storeId: "slack-store" }),
    );

    context.db.store.device_application.push(
      installed({
        deviceId: "device-1",
        bundleId: "com.figma.Desktop",
        name: "Figma",
        version: "116.1",
        shortVersion: "116.1.3",
        publisher: "Figma Inc.",
      }),
      installed({
        deviceId: "device-2",
        bundleId: "com.figma.Desktop",
        name: "Figma",
        version: "116.1",
        shortVersion: "116.1.2",
        publisher: "Figma Inc.",
      }),
      installed({
        deviceId: "device-3",
        bundleId: "com.figma.Desktop",
        name: "Figma",
        version: "117.0",
        publisher: "Figma Inc.",
      }),
      installed({ deviceId: "device-4", bundleId: "com.slack.App", name: "Slack", version: "4.0" }),
    );

    const result = await search(context, "figma");

    const applications = result.rows.filter((row) => "platform" in row);
    const software = result.rows.filter((row) => "deviceCount" in row);

    expect(applications).toEqual([
      {
        id: "app-figma",
        name: "Figma",
        platform: "apple",
        identifier: "com.figma.Desktop",
        storeId: null,
      },
    ]);

    // Two devices reported 116.1; one reported 117.0. The device row count is
    // collapsed, not returned once per device. `shortVersion` uses the smallest
    // reported value so the row does not depend on device order.
    expect(software).toEqual([
      {
        name: "Figma",
        bundleId: "com.figma.Desktop",
        version: "116.1",
        shortVersion: "116.1.2",
        publisher: "Figma Inc.",
        deviceCount: 2,
      },
      {
        name: "Figma",
        bundleId: "com.figma.Desktop",
        version: "117.0",
        shortVersion: null,
        publisher: "Figma Inc.",
        deviceCount: 1,
      },
    ]);
  });

  it("matches a store id when the catalogue has no bundle id", async () => {
    const context = makeContext();

    context.db.store.application.push(
      application({ id: "app-slack", name: "Slack", platform: "win", storeId: "slack-store" }),
    );

    const result = await search(context, "slack-store");

    expect(result.rows).toEqual([
      {
        id: "app-slack",
        name: "Slack",
        platform: "win",
        identifier: "slack-store",
        storeId: "slack-store",
      },
    ]);
  });

  it("escapes LIKE wildcards in the query", async () => {
    const context = makeContext();

    context.db.store.application.push(
      application({ id: "app-literal", name: "100% Coverage" }),
      application({ id: "app-wildcard", name: "100X Coverage" }),
      application({ id: "app-underscore", name: "a_b tool" }),
      application({ id: "app-any", name: "axb tool" }),
    );

    expect((await search(context, "100%")).rows).toEqual([
      {
        id: "app-literal",
        name: "100% Coverage",
        platform: "apple",
        identifier: null,
        storeId: null,
      },
    ]);
    expect((await search(context, "a_b")).rows).toEqual([
      {
        id: "app-underscore",
        name: "a_b tool",
        platform: "apple",
        identifier: null,
        storeId: null,
      },
    ]);
  });

  it("omits applications and software without applications.read", async () => {
    const context = makeContext({ kind: "custom", permissions: ["tenant.read", "members.read"] });

    context.db.store.application.push(application({ id: "app-figma", name: "Figma" }));
    context.db.store.device_application.push(
      installed({
        deviceId: "device-1",
        bundleId: "com.figma.Desktop",
        name: "Figma",
        version: "116.1",
      }),
    );

    const result = await search(context, "figma");

    expect(result.rows).toEqual([]);
  });

  it("does not expose devices, groups or policies without their section permissions", async () => {
    const context = makeContext({ kind: "custom", permissions: ["tenant.read"] });

    context.db.store.device.push({
      id: "device-1",
      organizationId: "org-1",
      proto: "apple",
      name: "Acme Mac",
      serial: "C02ACME",
      model: "MacBook Pro",
      status: "enrolled",
      enrolledAt: now,
      lastSeenAt: now,
    });
    context.db.store.enterprise_group.push({
      id: "group-1",
      organizationId: "org-1",
      name: "Acme Staff",
      kind: "manual",
      createdAt: now,
      updatedAt: now,
    });
    context.db.store.policy.push({
      id: "policy-1",
      organizationId: "org-1",
      name: "Acme Baseline",
      priority: 0,
      createdAt: now,
      updatedAt: now,
    });

    const result = await search(context, "acme");

    expect(result.rows).toEqual([]);
  });

  it("returns only the entity groups the role can read", async () => {
    const context = makeContext({
      kind: "custom",
      permissions: ["tenant.read", "devices.read"],
    });

    context.db.store.device.push({
      id: "device-1",
      organizationId: "org-1",
      proto: "apple",
      name: "Acme Mac",
      serial: "C02ACME",
      model: "MacBook Pro",
      status: "enrolled",
      enrolledAt: now,
      lastSeenAt: now,
    });
    context.db.store.enterprise_group.push({
      id: "group-1",
      organizationId: "org-1",
      name: "Acme Staff",
      kind: "manual",
      createdAt: now,
      updatedAt: now,
    });
    context.db.store.policy.push({
      id: "policy-1",
      organizationId: "org-1",
      name: "Acme Baseline",
      priority: 0,
      createdAt: now,
      updatedAt: now,
    });

    const result = await search(context, "acme");

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ id: "device-1", name: "Acme Mac", proto: "apple" });
  });

  it("returns applications and software to a custom role that holds applications.read", async () => {
    const context = makeContext({
      kind: "custom",
      permissions: ["tenant.read", "applications.read"],
    });

    context.db.store.application.push(application({ id: "app-figma", name: "Figma" }));
    context.db.store.device_application.push(
      installed({
        deviceId: "device-1",
        bundleId: "com.figma.Desktop",
        name: "Figma",
        version: "116.1",
      }),
    );

    const result = await search(context, "figma");

    expect(result.rows).toHaveLength(2);
    expect(result.rows.some((row) => "platform" in row)).toBe(true);
    expect(result.rows.some((row) => "deviceCount" in row)).toBe(true);
  });

  it("keeps the aggregation bounded and deterministic", async () => {
    const context = makeContext();

    context.db.store.device_application.push(
      installed({ deviceId: "device-1", bundleId: "com.acme.b", name: "Beta", version: "2.0" }),
      installed({ deviceId: "device-1", bundleId: "com.acme.a", name: "Alpha", version: "1.0" }),
      installed({ deviceId: "device-2", bundleId: "com.acme.c", name: "Gamma", version: "3.0" }),
    );

    const result = await search(context, "a", 2);
    const software = result.rows.filter((row) => "deviceCount" in row);

    expect(software.map((row) => ("name" in row ? row.name : ""))).toEqual(["Alpha", "Beta"]);
  });

  it("does not return another tenant's applications or inventory", async () => {
    const context = makeContext();

    context.db.store.application.push(
      application({ id: "app-other", name: "Figma", organizationId: "org-2" }),
    );
    context.db.store.device_application.push(
      installed({
        deviceId: "device-other",
        organizationId: "org-2",
        bundleId: "com.figma.Desktop",
        name: "Figma",
        version: "116.1",
      }),
    );

    expect((await search(context, "figma")).rows).toEqual([]);
  });
});
