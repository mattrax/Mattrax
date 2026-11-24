import { Effect, Schema } from "effect";
import * as SqlError from "effect/sql/SqlError";
import { describe, expect, it } from "vitest";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import {
  arrayBufferToBase64,
  exportPrivateKeyJwk,
  generateCaKeyPair,
  pemEncode,
  sealSecret,
} from "@mattrax/crypto";
import { ApnsError, generateApnsKeyPair, makeApnsService } from "@mattrax/apns";
import { AndroidManagement, GoogleApiError } from "@mattrax/dm-android";
import {
  EnterpriseBadRequest,
  EnterpriseConflict,
  EnterpriseForbidden,
  EnterpriseInternal,
  EnterpriseLastTenantAccount,
  EnterpriseNotFound,
  EnterpriseNotConfigured,
  EnterprisePermissionDenied,
  EnterpriseTenantHasMembers,
  EnterpriseUnauthorized,
  EnterpriseUpstreamError,
  StepUpRequired,
  dashboardQueryForWidget,
  defaultOverviewWidgets,
  scriptAgentToken,
} from "@mattrax/enterprise-domain";
import type { DeviceSearchQuery } from "@mattrax/enterprise-domain";
import { ScepRepositoryLive } from "@mattrax/mdm-core";
import { makeWindowsBackend } from "@mattrax/mdm-windows";
import { permissionForMethod } from "@mattrax/enterprise-identity";
import { certToPem, createCaCertificate } from "@mattrax/scep";
import { appleEnrollmentProfileResponse, createEnterpriseService } from "@mattrax/enterprise-api";
import { makeEmailTransport } from "@mattrax/enterprise-backend";
import type { EmailTransport, OutboundEmailMessage } from "@mattrax/email";
import { makeDb, request, requireField, runEffect, schema } from "./helpers.js";

if (typeof crypto !== "undefined" && crypto.subtle !== undefined) {
  try {
    pkijs.getEngine();
  } catch {
    pkijs.setEngine("WebCrypto", crypto, crypto.subtle);
  }
}

const origin = "https://enterprise.test";

const authSecret = "enterprise-test-secret";

const makeFakeApns = () => {
  const pushes: Array<{
    pushToken: string;
    pushMagic: string;
    topic: string;
    certPem?: string;
    privateKeyPem?: string;
  }> = [];

  const apns = makeApnsService({
    name: "fake",
    available: true,
    push: (input) =>
      Effect.sync(() => {
        pushes.push(input);
      }),
  });

  return { apns, pushes };
};

const testCertificate = async (options: {
  keyPair: CryptoKeyPair;
  topic?: string;
  notBefore?: Date;
  notAfter?: Date;
}) => {
  const attribute = (type: string, value: string) =>
    new pkijs.AttributeTypeAndValue({ type, value: new asn1js.Utf8String({ value }) });

  const certificate = new pkijs.Certificate();
  certificate.version = 2;
  certificate.serialNumber = new asn1js.Integer({ value: 1 });

  const name = new pkijs.RelativeDistinguishedNames({
    typesAndValues: [
      attribute("2.5.4.10", "Acme"),
      attribute("2.5.4.11", "tenant-1"),
      attribute("2.5.4.3", "Acme APNs"),
      attribute("0.9.2342.19200300.100.1.1", options.topic ?? "com.apple.mgmt.External.acme"),
    ],
  });

  certificate.issuer = name;
  certificate.subject = name;
  const now = Date.now();
  certificate.notBefore.value = options.notBefore ?? new Date(now - 60_000);
  certificate.notAfter.value = options.notAfter ?? new Date(now + 86_400_000);
  await certificate.subjectPublicKeyInfo.importKey(options.keyPair.publicKey);
  await certificate.sign(options.keyPair.privateKey, "SHA-256");

  return pemEncode("CERTIFICATE", certificate.toSchema(true).toBER(false));
};

const makeCsr = async (commonName = "DESKTOP-TEST") => {
  const keyPair = await generateCaKeyPair();
  const csr = new pkijs.CertificationRequest();
  csr.version = 0;
  csr.subject = new pkijs.RelativeDistinguishedNames({
    typesAndValues: [
      new pkijs.AttributeTypeAndValue({
        type: "2.5.4.3",
        value: new asn1js.Utf8String({ value: commonName }),
      }),
    ],
  });
  await csr.subjectPublicKeyInfo.importKey(keyPair.publicKey);
  await csr.sign(keyPair.privateKey, "SHA-256");

  return arrayBufferToBase64(csr.toSchema().toBER(false));
};

const sealedJwk = async (secret = authSecret) => {
  const keys = await generateCaKeyPair();
  const jwk = await exportPrivateKeyJwk(keys.privateKey);

  return { keyPair: keys, jwk, encrypted: await sealSecret(secret, JSON.stringify(jwk)) };
};

/** One row of the JSON audit export, as the endpoint renders it. */
const AuditExportEntry = Schema.Struct({
  action: Schema.String,
  actorEmail: Schema.String,
});

const makeContext = async (
  overrides: {
    apns?: any;
    pushes?: Array<any>;
    authSecret?: string | null;
    email?: EmailTransport;
    apiToken?: any;
    oauth?: any;
    db?: any;
    analytics?: any;
    auth?: { requireStepUp?: (request: any, action: any) => Effect.Effect<any, any> };
    android?: Parameters<typeof createEnterpriseService>[0]["android"];
    enrollmentProfileTtlSeconds?: number;
  } = {},
) => {
  const db = overrides.db ?? makeDb();
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
      const headers = input instanceof Request ? Object.fromEntries(input.headers) : input.headers;

      return headers.cookie
        ? Effect.succeed({ user, apiToken: overrides.apiToken, oauth: overrides.oauth })
        : Effect.fail(new EnterpriseUnauthorized({ message: "Unauthenticated" }));
    },
    listApiTokens: () => Effect.succeed({ tokens: [] }),
    createApiToken: () => Effect.die("not used"),
    revokeApiToken: () => Effect.succeed({ status: "ok" }),
    requestEmailChange: () => Effect.succeed({ status: "ok" }),
    verifyEmailChange: () => Effect.succeed({ status: "ok" }),
    requireStepUp: () => Effect.void,
    ...overrides.auth,
  };

  const service = createEnterpriseService({
    db,
    schema,
    origin,
    // SAFETY: this test never reaches R2; the service only stores the binding.
    storage: {} as any,
    // SAFETY: the fake only implements the auth methods these tests exercise.
    auth: auth as any,
    authSecret: overrides.authSecret === null ? undefined : (overrides.authSecret ?? authSecret),
    apns: overrides.apns,
    android: overrides.android,
    email: overrides.email,
    analytics: overrides.analytics,
    enrollmentProfileTtlSeconds: overrides.enrollmentProfileTtlSeconds,
  });

  return { db, service, auth, user, headers: { cookie: "mattrax_session=test" } };
};

const gatewayRequest = (headers: Record<string, string>, path: string, method = "GET") =>
  ({ headers, url: `${origin}${path}`, method }) as any;

describe("enterprise service tenant flow", () => {
  it("requires authentication to create tenants", async () => {
    const { service } = await makeContext();
    await expect(
      runEffect(service.createTenant(request(), { name: "Acme", slug: "acme" })),
    ).rejects.toBeInstanceOf(EnterpriseUnauthorized);
  });

  it("creates an organization, owner member, and enrollment row", async () => {
    const { db, service, headers } = await makeContext();

    const result = await runEffect(
      service.createTenant(request(headers), {
        name: "Acme",
        slug: "acme",
        metadata: { tier: "trial" },
      }),
    );

    expect(result.id).toBeDefined();
    expect(db.store.organization).toMatchObject([
      { id: result.id, name: "Acme", slug: "acme", metadata: JSON.stringify({ tier: "trial" }) },
    ]);
    expect(db.store.member).toMatchObject([
      { organizationId: result.id, accountId: db.store.account[0].id, role: "owner" },
    ]);
    expect(db.store.enterprise_enrollment).toMatchObject([
      { id: result.id, organizationId: result.id },
    ]);
  });

  it("includes tenant members in cross-entity search", async () => {
    const { service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const found = await runEffect(
      service.search(request(headers), tenant.id, { q: "owner", limit: 10 }),
    );

    expect(found.rows).toContainEqual(
      expect.objectContaining({
        name: "Owner",
        email: "owner@example.com",
        role: "owner",
      }),
    );
  });

  it("loads the built-in overview for a fresh tenant", async () => {
    const { service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    await expect(runEffect(service.listDashboards(request(headers), tenant.id))).resolves.toEqual({
      dashboards: [],
    });

    const queries = defaultOverviewWidgets()
      .filter((widget) => widget.type !== "markdown")
      .map(dashboardQueryForWidget);
    const batch = await runEffect(
      service.queryDashboardBatch(request(headers), tenant.id, { queries }),
    );

    expect(batch.results).toHaveLength(queries.length);
    expect(batch.results).toEqual(queries.map(() => ({ total: 0, rows: [], buckets: [] })));
  });

  it("creates shared dashboards and applies partial widget updates", async () => {
    const { service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const created = await runEffect(
      service.createDashboard(request(headers), tenant.id, {
        name: "Ops",
        template: "overview",
      }),
    );

    const dashboard = await runEffect(
      service.getDashboard(request(headers), tenant.id, created.id),
    );

    expect(dashboard).toMatchObject({ name: "Ops", isDefault: true });
    expect(dashboard.widgets.length).toBeGreaterThan(0);

    const widget = dashboard.widgets[0];

    const patched = await runEffect(
      service.patchDashboardWidget(request(headers), tenant.id, created.id, widget.id, {
        title: "Renamed widget",
      }),
    );

    expect(patched.title).toBe("Renamed widget");
    // Omitted fields keep their previous values.
    expect(patched.x).toBe(widget.x);
    expect(patched.h).toBe(widget.h);

    await runEffect(
      service.patchDashboardLayout(request(headers), tenant.id, created.id, {
        widgets: [{ id: widget.id, x: 2 }],
      }),
    );

    const afterLayout = await runEffect(
      service.getDashboard(request(headers), tenant.id, created.id),
    );

    const moved = afterLayout.widgets.find((item: { id: string }) => item.id === widget.id)!;
    expect(moved.x).toBe(2);
    expect(moved.y).toBe(widget.y);

    const query = await runEffect(
      service.queryDashboard(request(headers), tenant.id, {
        dataset: "devices",
        query: { all: [] },
      }),
    );

    expect(query.total).toBe(0);
    expect(query.buckets).toEqual([]);

    // Stat widgets opt into a count-only response: no row projection or
    // buckets, so the dashboard overview does not pay for unused data.
    const countOnly = await runEffect(
      service.queryDashboard(request(headers), tenant.id, {
        dataset: "devices",
        query: { all: [] },
        countOnly: true,
      }),
    );

    expect(countOnly).toEqual({ total: 0, rows: [], buckets: [] });

    const second = await runEffect(
      service.createDashboard(request(headers), tenant.id, { name: "Second" }),
    );

    await runEffect(
      service.patchDashboard(request(headers), tenant.id, second.id, { isDefault: true }),
    );
    const list = await runEffect(service.listDashboards(request(headers), tenant.id));
    expect(list.dashboards.find((item: { id: string }) => item.id === second.id)?.isDefault).toBe(
      true,
    );
    expect(list.dashboards.find((item: { id: string }) => item.id === created.id)?.isDefault).toBe(
      false,
    );

    // Deleting the default promotes the remaining dashboard.
    await runEffect(service.deleteDashboard(request(headers), tenant.id, second.id));
    const afterDelete = await runEffect(service.listDashboards(request(headers), tenant.id));
    expect(afterDelete.dashboards).toHaveLength(1);
    expect(afterDelete.dashboards[0].isDefault).toBe(true);
  });

  it("maps the batched dashboard query to the dashboard read permission", () => {
    expect(permissionForMethod("listDashboards")).toBe("dashboards.read");
    expect(permissionForMethod("getDashboard")).toBe("dashboards.read");
    expect(permissionForMethod("queryDashboard")).toBe("dashboards.read");
    expect(permissionForMethod("queryDashboardBatch")).toBe("dashboards.read");
  });

  it("evaluates batched dashboard widget queries against one snapshot", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const now = new Date();
    const stale = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

    const devices = [
      ["device-1", "apple", "S1", now],
      ["device-2", "win", "S2", stale],
      ["device-3", "android", "S3", now],
    ] as const;

    for (const [id, proto, serial, lastSeenAt] of devices)
      db.store.device.push({
        id,
        organizationId: tenant.id,
        proto,
        status: "enrolled",
        name: id,
        serial,
        enrolledAt: now,
        lastSeenAt,
        createdAt: now,
        updatedAt: now,
      });

    db.store.device_application.push(
      {
        deviceId: "device-1",
        organizationId: tenant.id,
        bundleId: "com.example.editor",
        name: "Editor",
        version: "1.0",
        shortVersion: "1.0",
        hasUpdateAvailable: false,
        isManaged: true,
        lastReportedAt: now,
      },
      {
        deviceId: "device-2",
        organizationId: tenant.id,
        bundleId: "com.example.editor",
        name: "Editor",
        version: "2.0",
        shortVersion: "2.0",
        hasUpdateAvailable: true,
        isManaged: false,
        lastReportedAt: now,
      },
    );

    const queries = [
      { dataset: "devices" as const, query: { all: [] }, countOnly: true },
      {
        dataset: "devices" as const,
        query: {
          all: [{ field: "health" as const, op: "eq" as const, value: "attention" as const }],
        },
        countOnly: true,
      },
      { dataset: "devices" as const, query: { all: [] }, groupBy: "platform" },
    ];

    const batch = await runEffect(
      service.queryDashboardBatch(request(headers), tenant.id, { queries }),
    );

    // Counts, health filters and bucket dimensions all resolve from the same
    // loaded devices, in the order the widgets asked for them.
    expect(batch.results[0]).toEqual({ total: 3, rows: [], buckets: [] });
    expect(batch.results[1]).toEqual({ total: 1, rows: [], buckets: [] });
    expect(batch.results[2].total).toBe(3);
    expect(batch.results[2].buckets).toEqual([
      { label: "Apple", value: 1 },
      { label: "Windows", value: 1 },
      { label: "Android", value: 1 },
    ]);

    // Batching must not change how a single-widget request behaves.
    const single = await runEffect(service.queryDashboard(request(headers), tenant.id, queries[2]));

    expect(single).toEqual(batch.results[2]);
  });

  it("shares one application inventory read across software widgets", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const now = new Date();

    for (const id of ["device-1", "device-2"])
      db.store.device.push({
        id,
        organizationId: tenant.id,
        proto: "apple",
        status: "enrolled",
        name: id,
        serial: id,
        enrolledAt: now,
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      });

    for (const [deviceId, version, managed] of [
      ["device-1", "1.0", true],
      ["device-2", "2.0", false],
    ] as const)
      db.store.device_application.push({
        deviceId,
        organizationId: tenant.id,
        bundleId: "com.example.editor",
        name: "Editor",
        version,
        shortVersion: version,
        hasUpdateAvailable: version === "2.0",
        isManaged: managed,
        lastReportedAt: now,
      });

    const queries = [
      { dataset: "software" as const, query: { all: [] }, groupBy: "name" },
      { dataset: "software" as const, query: { all: [] }, groupBy: "managed" },
      { dataset: "software" as const, query: { all: [] } },
    ];

    const batch = await runEffect(
      service.queryDashboardBatch(request(headers), tenant.id, { queries }),
    );

    expect(batch.results[0].total).toBe(1);
    expect(batch.results[0].buckets).toEqual([{ label: "Editor", value: 1 }]);
    expect(batch.results[0].rows[0]).toMatchObject({
      bundleId: "com.example.editor",
      deviceCount: 2,
    });

    // Both devices report the same bundle, so the bundle counts once and is
    // managed if any device reports a managed install.
    expect(batch.results[1].buckets).toEqual([{ label: "Managed", value: 1 }]);

    for (const [index, query] of queries.entries()) {
      const single = await runEffect(service.queryDashboard(request(headers), tenant.id, query));

      expect(batch.results[index]).toEqual(single);
    }
  });

  it("lists only tenants for the authenticated user", async () => {
    const { service, headers } = await makeContext();

    const owned = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const result = await runEffect(service.listTenants(request(headers)));
    expect(result.tenants).toMatchObject([
      {
        id: owned.id,
        name: "Acme",
        slug: "acme",
        logo: null,
        displayName: null,
        supportEmail: null,
        brandColor: null,
        role: "owner",
        roleId: null,
        roleName: "Owner",
        roleKind: "built-in",
      },
    ]);
    expect(result.tenants[0]?.permissions).toContain("tenant.read");
    expect(result.tenants[0]?.permissions).toContain("members.write");
  });

  it("stores tenant branding and applies fallbacks for unconfigured tenants", async () => {
    const { service, headers } = await makeContext();

    const branded = await runEffect(
      service.createTenant(request(headers), {
        name: "Acme",
        slug: "acme",
        displayName: "Acme Corp",
        logo: "https://cdn.example.com/acme.png",
        supportEmail: "help@acme.test",
        brandColor: "#2563EB",
      }),
    );

    const plain = await runEffect(
      service.createTenant(request(headers), { name: "Plain", slug: "plain" }),
    );

    const detail = await runEffect(service.getTenant(request(headers), branded.id));
    expect(detail).toMatchObject({
      displayName: "Acme Corp",
      supportEmail: "help@acme.test",
      brandColor: "#2563eb",
      logo: "https://cdn.example.com/acme.png",
    });

    const brandedEnrollment = await runEffect(service.getEnrollment(branded.id, undefined));
    expect(brandedEnrollment.branding).toEqual({
      displayName: "Acme Corp",
      logo: "https://cdn.example.com/acme.png",
      supportEmail: "help@acme.test",
      brandColor: "#2563eb",
    });

    const fallback = await runEffect(service.getEnrollment(plain.id, undefined));
    expect(fallback.branding).toEqual({
      displayName: "Plain",
      logo: null,
      supportEmail: "hello@mattrax.app",
      brandColor: "#1c1917",
    });
  });

  it("validates and normalises tenant branding writes", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    await expect(
      runEffect(service.patchTenant(request(headers), tenant.id, { brandColor: "blue" })),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
    await expect(
      runEffect(service.patchTenant(request(headers), tenant.id, { supportEmail: "not-an-email" })),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
    await expect(
      runEffect(service.patchTenant(request(headers), tenant.id, { logo: "javascript:alert(1)" })),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    await runEffect(
      service.patchTenant(request(headers), tenant.id, {
        brandColor: "#abc",
        supportEmail: "  help@acme.test ",
        displayName: "  Acme Corp  ",
      }),
    );
    expect(db.store.organization[0]).toMatchObject({
      displayName: "Acme Corp",
      supportEmail: "help@acme.test",
      brandColor: "#aabbcc",
    });

    // Clearing a value restores the default at read time.
    await runEffect(
      service.patchTenant(request(headers), tenant.id, {
        displayName: null,
        supportEmail: null,
        brandColor: null,
      }),
    );
    const enrollment = await runEffect(service.getEnrollment(tenant.id, undefined));
    expect(enrollment.branding).toMatchObject({
      displayName: "Acme",
      supportEmail: "hello@mattrax.app",
      brandColor: "#1c1917",
    });
  });

  it("keeps branding scoped to its tenant", async () => {
    const { service, headers } = await makeContext();

    const first = await runEffect(
      service.createTenant(request(headers), { name: "First", slug: "first" }),
    );

    const second = await runEffect(
      service.createTenant(request(headers), {
        name: "Second",
        slug: "second",
        displayName: "Second Brand",
      }),
    );

    await runEffect(
      service.patchTenant(request(headers), first.id, {
        displayName: "First Brand",
        supportEmail: "first@example.test",
      }),
    );

    await expect(runEffect(service.getTenant(request(headers), second.id))).resolves.toMatchObject({
      displayName: "Second Brand",
      supportEmail: null,
      brandColor: null,
    });

    const firstEnrollment = await runEffect(service.getEnrollment(first.id, undefined));
    const secondEnrollment = await runEffect(service.getEnrollment(second.id, undefined));
    expect(firstEnrollment.branding.displayName).toBe("First Brand");
    expect(firstEnrollment.branding.supportEmail).toBe("first@example.test");
    expect(secondEnrollment.branding.displayName).toBe("Second Brand");
    expect(secondEnrollment.branding.supportEmail).toBe("hello@mattrax.app");
  });

  it("records product analytics for identified tenant operations", async () => {
    const identified: any[] = [];
    const captured: Array<{ event: string; properties: any }> = [];

    const { service, headers } = await makeContext({
      analytics: {
        identify: (identity: any) => identified.push(identity),
        capture: (event: string, properties: any) => captured.push({ event, properties }),
      },
    });

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    expect(identified).toContainEqual(
      expect.objectContaining({
        userId: "user-1",
        email: "owner@example.com",
      }),
    );
    expect(captured).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "tenant_created",
          properties: expect.objectContaining({
            method: "createTenant",
            target_id: tenant.id,
            status: "ok",
          }),
        }),
        expect.objectContaining({
          event: "api_operation",
          properties: expect.objectContaining({
            method: "createTenant",
            target_id: tenant.id,
            status: "ok",
          }),
        }),
      ]),
    );

    captured.length = 0;
    await runEffect(service.getTenant(request(headers), tenant.id));
    expect(identified).toContainEqual(
      expect.objectContaining({
        userId: "user-1",
        tenantId: tenant.id,
        roleName: "Owner",
        roleKind: "built-in",
      }),
    );
    expect(captured).toContainEqual(
      expect.objectContaining({
        event: "api_operation",
        properties: expect.objectContaining({
          method: "getTenant",
          tenant_id: tenant.id,
          permission: "tenant.read",
        }),
      }),
    );
  });

  it("enforces tenant role access", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    db.store.member[0].role = "member";

    await expect(
      runEffect(service.patchTenant(request(headers), tenant.id, { name: "Denied" })),
    ).rejects.toBeInstanceOf(EnterprisePermissionDenied);

    db.store.member[0].role = "admin";
    await runEffect(service.patchTenant(request(headers), tenant.id, { name: "Allowed" }));
    expect(db.store.organization[0].name).toBe("Allowed");

    await expect(
      runEffect(service.deleteTenant(request(headers), tenant.id)),
    ).rejects.toBeInstanceOf(EnterprisePermissionDenied);
  });

  it("allows auditors to read but not write or delete", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    db.store.member[0].role = "auditor";

    await expect(runEffect(service.getTenant(request(headers), tenant.id))).resolves.toMatchObject({
      id: tenant.id,
      role: "auditor",
    });
    await expect(
      runEffect(service.patchTenant(request(headers), tenant.id, { name: "Denied" })),
    ).rejects.toBeInstanceOf(EnterprisePermissionDenied);
    await expect(
      runEffect(service.deleteTenant(request(headers), tenant.id)),
    ).rejects.toBeInstanceOf(EnterprisePermissionDenied);
  });

  it("enforces custom role permissions and audits the effective role", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const role = await runEffect(
      service.createTenantRole(request(headers), tenant.id, {
        name: "Helpdesk",
        permissions: ["tenant.read", "devices.read"],
      }),
    );

    db.store.member[0].customRoleId = role.id;

    const denied = runEffect(service.patchTenant(request(headers), tenant.id, { name: "Denied" }));
    await expect(denied).rejects.toBeInstanceOf(EnterprisePermissionDenied);
    await expect(denied).rejects.toMatchObject({
      permission: "tenant.write",
      roleName: "Helpdesk",
      roleKind: "custom",
    });

    db.store.member[0].customRoleId = null;
    await runEffect(
      service.patchTenantRole(request(headers), tenant.id, role.id, {
        permissions: ["tenant.read", "devices.read", "tenant.write"],
      }),
    );
    db.store.member[0].customRoleId = role.id;
    await runEffect(service.patchTenant(request(headers), tenant.id, { name: "Allowed" }));

    const entry = db.store.audit_log.find(
      (item: any) => item.action === "tenant.updated" && item.targetId === tenant.id,
    );

    expect(entry?.metadata).toMatchObject({
      rbac: {
        permission: "tenant.write",
        roleName: "Helpdesk",
        roleKind: "custom",
      },
    });
  });

  it("accepts auditor invitations and role changes", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    await runEffect(
      service.inviteTenantAccount(request(headers), tenant.id, {
        email: "auditor@example.com",
        role: "auditor",
      }),
    );
    expect(db.store.invitation[0]).toMatchObject({ role: "auditor" });

    const now = new Date();
    db.store.account.push({
      id: "user-2",
      name: "Auditor",
      email: "auditor@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    db.store.member.push({
      id: "member-2",
      organizationId: tenant.id,
      accountId: "user-2",
      role: "member",
      createdAt: now,
      updatedAt: now,
    });
    await runEffect(
      service.patchTenantAccount(request(headers), tenant.id, "user-2", { role: "auditor" }),
    );
    expect(db.store.member.find((member: any) => member.id === "member-2")?.role).toBe("auditor");
  });

  it("enforces API token scopes and tenant binding", async () => {
    const first = await makeContext({
      apiToken: { tenantId: null, scopes: ["read"] },
    });

    const firstTenant = await runEffect(
      first.service.createTenant(request(first.headers), { name: "First", slug: "first" }),
    );

    const secondTenant = await runEffect(
      first.service.createTenant(request(first.headers), { name: "Second", slug: "second" }),
    );

    // Read-only tokens can read.
    await expect(
      runEffect(first.service.getTenant(request(first.headers), firstTenant.id)),
    ).resolves.toMatchObject({ id: firstTenant.id });
    // ...but can never mutate.
    await expect(
      runEffect(
        first.service.patchTenant(request(first.headers), firstTenant.id, { name: "Denied" }),
      ),
    ).rejects.toBeInstanceOf(EnterprisePermissionDenied);
    await expect(
      runEffect(first.service.deleteTenant(request(first.headers), firstTenant.id)),
    ).rejects.toBeInstanceOf(EnterprisePermissionDenied);

    // A tenant-bound token cannot reach another tenant, even when the user is
    // a member.
    const bound = await makeContext({
      db: first.db,
      apiToken: { tenantId: firstTenant.id, scopes: ["read", "write"] },
    });

    await expect(
      runEffect(bound.service.getTenant(request(bound.headers), secondTenant.id)),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);

    // A write token passes the scope check and the member role check.
    const writer = await makeContext({
      db: first.db,
      apiToken: { tenantId: firstTenant.id, scopes: ["read", "write"] },
    });

    await runEffect(
      writer.service.patchTenant(request(writer.headers), firstTenant.id, { name: "Allowed" }),
    );
    expect(writer.db.store.organization.find((row: any) => row.id === firstTenant.id)?.name).toBe(
      "Allowed",
    );

    // Tokens created before scoping existed behave as full-access tokens.
    const legacy = await makeContext({
      db: first.db,
      apiToken: { tenantId: null, scopes: null },
    });

    await runEffect(
      legacy.service.patchTenant(request(legacy.headers), firstTenant.id, { name: "Legacy" }),
    );
    expect(legacy.db.store.organization.find((row: any) => row.id === firstTenant.id)?.name).toBe(
      "Legacy",
    );
  });

  it("publishes an MCP context filtered by the credential grant", async () => {
    const base = await makeContext();

    const tenant = await runEffect(
      base.service.createTenant(request(base.headers), { name: "Acme", slug: "acme" }),
    );

    const reader = await makeContext({
      db: base.db,
      apiToken: { id: "token-1", name: "CLI", tenantId: null, scopes: ["devices.read"] },
    });

    const context = await runEffect(reader.service.mcpContext(request(reader.headers)));

    expect(context.me.tenants[0]?.id).toBe(tenant.id);
    expect(context.permissions).toContain("devices.read");
    expect(context.permissions).not.toContain("devices.write");
    expect(context.methods).toContain("listDevices");
    expect(context.methods).not.toContain("patchDevice");
    expect(context.methods).not.toContain("createGroup");

    // A write grant exposes the mutation but still never account endpoints.
    const writer = await makeContext({
      db: base.db,
      apiToken: { tenantId: null, scopes: ["devices.write"] },
    });

    const writeContext = await runEffect(writer.service.mcpContext(request(writer.headers)));

    expect(writeContext.permissions).toEqual(["devices.read", "devices.write"]);
    expect(writeContext.methods).toContain("patchDevice");
    expect(writeContext.methods).not.toContain("createGroup");
    expect(writeContext.methods).not.toContain("createApiToken");

    // Handover exports carry every escrowed secret and the derived zip download
    // is a token-bearing GET, so the methods are never advertised even when
    // the account's role holds the permission.
    const ownerContext = await runEffect(base.service.mcpContext(request(base.headers)));

    expect(ownerContext.permissions).toContain("devices.handover");
    expect(ownerContext.methods).not.toContain("createDeviceHandover");
    expect(ownerContext.methods).not.toContain("downloadDeviceHandover");
    expect(ownerContext.methods).not.toContain("deviceHandoverImpact");
  });

  it("derives MCP audit entries only from authenticated dispatched calls", async () => {
    const base = await makeContext();
    const tenant = await runEffect(
      base.service.createTenant(request(base.headers), { name: "Acme", slug: "acme" }),
    );
    const gatewayHeaders = {
      cookie: "mattrax_session=test",
      "x-mattrax-mcp-authorization": "Bearer mcp-token",
      "x-mattrax-client-address": "203.0.113.9",
    };
    const reader = await makeContext({
      db: base.db,
      apiToken: { id: "token-1", name: "CLI", tenantId: null, scopes: ["devices.read"] },
    });

    await runEffect(
      reader.service.listDevices(
        gatewayRequest(gatewayHeaders, `/api/v1/tenants/${tenant.id}/devices`),
        tenant.id,
      ),
    );

    expect(
      base.db.store.audit_log.filter((row: any) => row.action === "mcp.tool_called"),
    ).toMatchObject([
      {
        organizationId: tenant.id,
        actorAccountId: "user-1",
        targetType: "mcp",
        metadata: {
          tool: "listDevices",
          method: "GET",
          path: `/api/v1/tenants/${tenant.id}/devices`,
          status: 200,
          credential: { type: "api_token", id: expect.any(String) },
        },
      },
    ]);

    // A browser session cannot produce that entry even with the marker.
    await runEffect(
      base.service.listDevices(
        gatewayRequest(gatewayHeaders, `/api/v1/tenants/${tenant.id}/devices`),
        tenant.id,
      ),
    );
    expect(
      base.db.store.audit_log.filter((row: any) => row.action === "mcp.tool_called"),
    ).toHaveLength(1);

    // A read-only credential cannot attribute a write it cannot perform.
    await expect(
      runEffect(
        reader.service.patchTenant(
          gatewayRequest(gatewayHeaders, `/api/v1/tenants/${tenant.id}`, "PATCH"),
          tenant.id,
          { name: "Forged" },
        ),
      ),
    ).rejects.toBeInstanceOf(EnterprisePermissionDenied);
    expect(
      base.db.store.audit_log.filter((row: any) => row.action === "mcp.tool_called"),
    ).toHaveLength(1);
  });

  it("rejects a direct client-authored activity payload without writing an audit row", async () => {
    const base = await makeContext();
    const tenant = await runEffect(
      base.service.createTenant(request(base.headers), { name: "Acme", slug: "acme" }),
    );
    const reader = await makeContext({
      db: base.db,
      apiToken: { id: "token-1", name: "CLI", tenantId: null, scopes: ["devices.read"] },
    });

    await expect(
      runEffect(
        reader.service.recordMcpActivity(
          gatewayRequest(
            {
              cookie: "mattrax_session=test",
              "x-mattrax-mcp-authorization": "Bearer mcp-token",
            },
            `/api/v1/tenants/${tenant.id}/mcp/activity`,
            "POST",
          ),
          tenant.id,
          {
            tool: "fabricated-tool",
            method: "DELETE",
            path: `/api/v1/tenants/${tenant.id}/devices`,
            status: 200,
          },
        ),
      ),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);
    expect(
      base.db.store.audit_log.filter((row: any) => row.action === "mcp.tool_called"),
    ).toHaveLength(0);
  });
  it("does not attribute a call whose URL names a different tenant", async () => {
    const base = await makeContext();
    const tenant = await runEffect(
      base.service.createTenant(request(base.headers), { name: "Acme", slug: "acme" }),
    );
    const reader = await makeContext({
      db: base.db,
      apiToken: { id: "token-1", name: "CLI", tenantId: tenant.id, scopes: ["devices.read"] },
    });

    await expect(
      runEffect(
        reader.service.listDevices(
          gatewayRequest(
            {
              cookie: "mattrax_session=test",
              "x-mattrax-mcp-authorization": "Bearer mcp-token",
            },
            "/api/v1/tenants/other-tenant/devices",
          ),
          tenant.id,
        ),
      ),
    ).resolves.toMatchObject({ rows: [] });
    expect(
      base.db.store.audit_log.filter((row: any) => row.action === "mcp.tool_called"),
    ).toHaveLength(0);
  });
  it("enforces fine-grained API token permissions per method", async () => {
    const base = await makeContext();

    const tenant = await runEffect(
      base.service.createTenant(request(base.headers), { name: "Acme", slug: "acme" }),
    );

    const limited = await makeContext({
      db: base.db,
      apiToken: { tenantId: null, scopes: ["devices.read"] },
    });

    await expect(
      runEffect(limited.service.listDevices(request(limited.headers), tenant.id)),
    ).resolves.toMatchObject({ rows: [] });

    await expect(
      runEffect(
        limited.service.patchDevice(request(limited.headers), tenant.id, "device-1", {
          name: "Renamed",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterprisePermissionDenied);

    await expect(
      runEffect(limited.service.listPolicies(request(limited.headers), tenant.id)),
    ).rejects.toBeInstanceOf(EnterprisePermissionDenied);
  });

  it("prevents deleting tenants with more than one member", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const now = new Date();
    db.store.account.push({
      id: "user-2",
      name: "Member",
      email: "member@example.com",
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    });
    db.store.member.push({
      id: "member-2",
      organizationId: tenant.id,
      accountId: "user-2",
      role: "member",
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      runEffect(service.deleteTenant(request(headers), tenant.id)),
    ).rejects.toBeInstanceOf(EnterpriseTenantHasMembers);
  });

  it("supports invitation lifecycle", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const invitation = await runEffect(
      service.inviteTenantAccount(request(headers), tenant.id, {
        email: "new@example.com",
        role: "admin",
      }),
    );

    expect(db.store.invitation).toMatchObject([
      {
        id: invitation.id,
        organizationId: tenant.id,
        email: "new@example.com",
        role: "admin",
        status: "pending",
      },
    ]);

    const listed = await runEffect(service.listTenantInvitations(request(headers), tenant.id, {}));

    expect(listed.invitations[0]).toMatchObject({
      id: invitation.id,
      email: "new@example.com",
      role: "admin",
      status: "pending",
    });

    await runEffect(service.cancelTenantInvitation(request(headers), tenant.id, invitation.id));
    expect(db.store.invitation[0].status).toBe("canceled");
  });

  it("uses tenant branding in invitation emails", async () => {
    const sent: Array<OutboundEmailMessage> = [];

    const { service, headers } = await makeContext({
      email: makeEmailTransport(
        async (message) => {
          sent.push(message);
        },
        { local: true },
      ),
    });

    const tenant = await runEffect(
      service.createTenant(request(headers), {
        name: "Acme",
        slug: "acme",
        displayName: "Acme <Corp>",
        supportEmail: "help@acme.test",
      }),
    );

    await runEffect(
      service.inviteTenantAccount(request(headers), tenant.id, {
        email: "new@example.com",
        role: "admin",
      }),
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: "new@example.com",
      from: { name: "Acme <Corp>", email: "hello@mattrax.cloud" },
      subject: "Join Acme <Corp> on Mattrax",
    });
    expect(sent[0].text).toContain("Acme <Corp>");
    expect(sent[0].text).toContain("help@acme.test");
    // Tenant names are escaped before entering the HTML body.
    expect(sent[0].html).toContain("Acme &lt;Corp&gt;");
    expect(sent[0].html).not.toContain("Acme <Corp>");
  });

  it("supports tenant user role updates and removal while protecting the last user", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const now = new Date();
    db.store.account.push({
      id: "user-2",
      name: "Member",
      email: "member@example.com",
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    });
    db.store.member.push({
      id: "member-2",
      organizationId: tenant.id,
      accountId: "user-2",
      role: "member",
      createdAt: now,
      updatedAt: now,
    });

    await runEffect(
      service.patchTenantAccount(request(headers), tenant.id, "user-2", { role: "admin" }),
    );
    expect(db.store.member.find((member: any) => member.id === "member-2")?.role).toBe("admin");

    await runEffect(service.removeTenantAccount(request(headers), tenant.id, "user-2"));
    await expect(
      runEffect(
        service.removeTenantAccount(request(headers), tenant.id, db.store.member[0].accountId),
      ),
    ).rejects.toBeInstanceOf(EnterpriseLastTenantAccount);
  });
});

describe("enterprise service group flow", () => {
  it("creates groups with tenant-scoped device and policy assignments", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const now = new Date();
    db.store.device.push({
      id: "device-1",
      organizationId: tenant.id,
      proto: "apple",
      status: "enrolled",
      name: "Mac",
      enrolledAt: now,
      lastSeenAt: now,
    });
    db.store.policy.push({
      id: "policy-1",
      organizationId: tenant.id,
      name: "Baseline",
      notes: null,
      createdAt: now,
      updatedAt: now,
    });

    const group = await runEffect(
      service.createGroup(request(headers), tenant.id, {
        name: "Engineering",
        devices: ["device-1"],
        policies: ["policy-1"],
      }),
    );

    expect(db.store.enterprise_group).toMatchObject([
      { id: group.id, organizationId: tenant.id, name: "Engineering" },
    ]);
    expect(db.store.group_device).toEqual([
      { groupId: group.id, deviceId: "device-1", source: "manual" },
    ]);
    expect(db.store.group_policy).toEqual([{ groupId: group.id, policyId: "policy-1" }]);
  });

  it("rejects assignments outside the tenant", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const now = new Date();
    db.store.device.push({
      id: "other-device",
      organizationId: "other-tenant",
      proto: "apple",
      status: "enrolled",
      name: "Other",
      enrolledAt: now,
      lastSeenAt: now,
    });

    await expect(
      runEffect(
        service.createGroup(request(headers), tenant.id, {
          name: "Engineering",
          devices: ["other-device"],
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);
  });

  it("patches group metadata and membership assignments", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const now = new Date();
    db.store.device.push(
      {
        id: "device-1",
        organizationId: tenant.id,
        proto: "apple",
        status: "enrolled",
        name: "Mac",
        enrolledAt: now,
        lastSeenAt: now,
      },
      {
        id: "device-2",
        organizationId: tenant.id,
        proto: "apple",
        status: "enrolled",
        name: "Mac 2",
        enrolledAt: now,
        lastSeenAt: now,
      },
    );

    const group = await runEffect(
      service.createGroup(request(headers), tenant.id, {
        name: "Engineering",
        devices: ["device-1"],
      }),
    );

    await runEffect(
      service.patchGroup(request(headers), tenant.id, group.id, {
        name: "Platform",
        notes: "Core devices",
      }),
    );
    await runEffect(
      service.patchGroupMembers(request(headers), tenant.id, group.id, {
        assign: { devices: ["device-2"] },
        unassign: { devices: ["device-1"] },
      }),
    );

    expect(db.store.enterprise_group[0]).toMatchObject({ name: "Platform", notes: "Core devices" });
    expect(db.store.group_device).toEqual([
      { groupId: group.id, deviceId: "device-2", source: "manual" },
    ]);
  });

  it("duplicates groups and deletes with partial failure reporting", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const now = new Date();
    db.store.device.push({
      id: "device-1",
      organizationId: tenant.id,
      proto: "apple",
      status: "enrolled",
      name: "Mac",
      enrolledAt: now,
      lastSeenAt: now,
    });

    const group = await runEffect(
      service.createGroup(request(headers), tenant.id, {
        name: "Engineering",
        notes: "Original",
        devices: ["device-1"],
      }),
    );

    const duplicated = await runEffect(
      service.duplicateGroup(request(headers), tenant.id, group.id, { name: "Engineering Copy" }),
    );

    expect(db.store.enterprise_group.find((item: any) => item.id === duplicated.id)).toMatchObject({
      name: "Engineering Copy",
      notes: "Original",
    });
    expect(db.store.group_device).toContainEqual({
      groupId: duplicated.id,
      deviceId: "device-1",
      source: "manual",
    });

    const result = await runEffect(
      service.deleteGroups(request(headers), tenant.id, [group.id, "missing-group"]),
    );

    expect(result).toEqual({
      deleted: [group.id],
      failed: [{ id: "missing-group", reason: "notFound" }],
    });
  });

  const dynamicRules = {
    version: 1 as const,
    all: [{ field: "platform" as const, op: "eq" as const, value: "apple" as const }],
  };

  it("creates dynamic groups and materialises only matching devices", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const now = new Date();
    db.store.device.push(
      {
        id: "apple-1",
        organizationId: tenant.id,
        proto: "apple",
        status: "enrolled",
        name: "Mac",
        serial: "C02APPLE",
        enrolledAt: now,
        lastSeenAt: now,
      },
      {
        id: "win-1",
        organizationId: tenant.id,
        proto: "win",
        status: "enrolled",
        name: "PC",
        serial: "WIN123",
        enrolledAt: now,
        lastSeenAt: now,
      },
    );

    const group = await runEffect(
      service.createGroup(request(headers), tenant.id, {
        name: "Macs",
        kind: "dynamic",
        rules: dynamicRules,
      }),
    );

    expect(db.store.enterprise_group[0]).toMatchObject({
      id: group.id,
      kind: "dynamic",
      rules: dynamicRules,
    });
    expect(db.store.group_device).toEqual([
      { groupId: group.id, deviceId: "apple-1", source: "dynamic" },
    ]);

    const preview = await runEffect(service.previewGroup(request(headers), tenant.id, group.id));
    expect(preview).toMatchObject({ kind: "dynamic", count: 1 });
    expect(preview.devices.map((device) => device.id)).toEqual(["apple-1"]);
  });

  it("re-evaluates on group update and preserves manual exceptions", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const now = new Date();
    db.store.device.push(
      {
        id: "apple-1",
        organizationId: tenant.id,
        proto: "apple",
        status: "enrolled",
        name: "Mac",
        enrolledAt: now,
        lastSeenAt: now,
      },
      {
        id: "win-1",
        organizationId: tenant.id,
        proto: "win",
        status: "enrolled",
        name: "PC",
        enrolledAt: now,
        lastSeenAt: now,
      },
    );

    const group = await runEffect(
      service.createGroup(request(headers), tenant.id, {
        name: "Macs",
        kind: "dynamic",
        rules: dynamicRules,
      }),
    );

    db.store.group_device.push({ groupId: group.id, deviceId: "win-1", source: "manual" });

    await runEffect(
      service.patchGroup(request(headers), tenant.id, group.id, {
        rules: { version: 1, all: [{ field: "platform", op: "eq", value: "win" }] },
      }),
    );

    expect(db.store.group_device).toEqual([
      { groupId: group.id, deviceId: "win-1", source: "manual" },
    ]);

    // Switching back to manual drops rule-derived rows but keeps explicit ones.
    db.store.group_device.push({ groupId: group.id, deviceId: "apple-2", source: "dynamic" });
    await runEffect(
      service.patchGroup(request(headers), tenant.id, group.id, { kind: "manual", rules: null }),
    );
    expect(db.store.group_device.filter((row: any) => row.source === "dynamic")).toEqual([]);
  });

  it("rejects manual device assignment on dynamic groups", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const now = new Date();
    db.store.device.push({
      id: "device-1",
      organizationId: tenant.id,
      proto: "apple",
      status: "enrolled",
      name: "Mac",
      enrolledAt: now,
      lastSeenAt: now,
    });

    const group = await runEffect(
      service.createGroup(request(headers), tenant.id, {
        name: "Macs",
        kind: "dynamic",
        rules: dynamicRules,
      }),
    );

    await expect(
      runEffect(
        service.patchGroupMembers(request(headers), tenant.id, group.id, {
          assign: { devices: ["device-1"] },
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
  });

  it("rejects dynamic rules without conditions and manual groups with rules", async () => {
    const { service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    await expect(
      runEffect(
        service.createGroup(request(headers), tenant.id, {
          name: "Empty",
          kind: "dynamic",
          rules: { version: 1 },
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    await expect(
      runEffect(
        service.createGroup(request(headers), tenant.id, {
          name: "Manual",
          kind: "manual",
          rules: dynamicRules,
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
  });

  it("accepts group references and rejects cycles and cross-tenant ids", async () => {
    const { service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const pilot = await runEffect(
      service.createGroup(request(headers), tenant.id, { name: "Pilot", kind: "manual" }),
    );

    const ring = await runEffect(
      service.createGroup(request(headers), tenant.id, {
        name: "Ring",
        kind: "dynamic",
        rules: { version: 1, all: [{ field: "group", op: "in", value: [pilot.id] }] },
      }),
    );

    // A direct self-reference is rejected before it is stored.
    await expect(
      runEffect(
        service.patchGroup(request(headers), tenant.id, ring.id, {
          rules: { version: 1, all: [{ field: "group", op: "in", value: [ring.id] }] },
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    // Making the pilot group reference the ring would close a loop.
    await expect(
      runEffect(
        service.patchGroup(request(headers), tenant.id, pilot.id, {
          kind: "dynamic",
          rules: { version: 1, all: [{ field: "group", op: "in", value: [ring.id] }] },
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    // An id outside the tenant (here: nonexistent) is not accepted.
    await expect(
      runEffect(
        service.patchGroup(request(headers), tenant.id, ring.id, {
          rules: { version: 1, all: [{ field: "group", op: "in", value: ["other-tenant"] }] },
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
  });

  it("rejects a rule that references a group containing it", async () => {
    const { service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const parent = await runEffect(
      service.createGroup(request(headers), tenant.id, { name: "Parent", kind: "manual" }),
    );
    const child = await runEffect(
      service.createGroup(request(headers), tenant.id, { name: "Child", kind: "manual" }),
    );

    await runEffect(
      service.patchGroupMembers(request(headers), tenant.id, parent.id, {
        assign: { childGroups: [child.id] },
      }),
    );

    await expect(
      runEffect(
        service.patchGroup(request(headers), tenant.id, child.id, {
          kind: "dynamic",
          rules: { version: 1, all: [{ field: "group", op: "in", value: [parent.id] }] },
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
  });

  it("recomputes a parent watcher after a nested child membership change", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const now = new Date();
    db.store.device.push({
      id: "device-1",
      organizationId: tenant.id,
      proto: "apple",
      status: "enrolled",
      name: "Mac",
      enrolledAt: now,
      lastSeenAt: now,
    });

    const parent = await runEffect(
      service.createGroup(request(headers), tenant.id, { name: "Parent", kind: "manual" }),
    );
    const child = await runEffect(
      service.createGroup(request(headers), tenant.id, { name: "Child", kind: "manual" }),
    );
    await runEffect(
      service.patchGroupMembers(request(headers), tenant.id, parent.id, {
        assign: { childGroups: [child.id] },
      }),
    );

    const watcher = await runEffect(
      service.createGroup(request(headers), tenant.id, {
        name: "Watcher",
        kind: "dynamic",
        rules: { version: 1, all: [{ field: "group", op: "in", value: [parent.id] }] },
      }),
    );

    await runEffect(
      service.patchGroupMembers(request(headers), tenant.id, child.id, {
        assign: { devices: ["device-1"] },
      }),
    );

    // The child row reaches the parent through inheritance first, then the
    // watcher is recomputed against the parent's new membership.
    expect(db.store.group_device).toEqual(
      expect.arrayContaining([
        { groupId: parent.id, deviceId: "device-1", source: "nested" },
        { groupId: watcher.id, deviceId: "device-1", source: "dynamic" },
      ]),
    );
  });

  it("recomputes a former parent's watcher when a nested group is deleted", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const now = new Date();
    db.store.device.push({
      id: "device-1",
      organizationId: tenant.id,
      proto: "apple",
      status: "enrolled",
      name: "Mac",
      enrolledAt: now,
      lastSeenAt: now,
    });

    const parent = await runEffect(
      service.createGroup(request(headers), tenant.id, { name: "Parent", kind: "manual" }),
    );
    const child = await runEffect(
      service.createGroup(request(headers), tenant.id, { name: "Child", kind: "manual" }),
    );
    await runEffect(
      service.patchGroupMembers(request(headers), tenant.id, parent.id, {
        assign: { childGroups: [child.id] },
      }),
    );
    const watcher = await runEffect(
      service.createGroup(request(headers), tenant.id, {
        name: "Watcher",
        kind: "dynamic",
        rules: { version: 1, all: [{ field: "group", op: "in", value: [parent.id] }] },
      }),
    );

    await runEffect(
      service.patchGroupMembers(request(headers), tenant.id, child.id, {
        assign: { devices: ["device-1"] },
      }),
    );

    await runEffect(service.deleteGroups(request(headers), tenant.id, [child.id]));

    // The parent loses the inherited device and the watcher follows in the
    // same request, even though the nesting edge is already gone.
    expect(
      db.store.group_device.filter((row: { groupId: string }) => row.groupId === watcher.id),
    ).toEqual([]);
  });
});

describe("enterprise service policy flow", () => {
  const deploymentQuery = "insert into policy_deployment (id, policy_id, version) values (?, ?, ?)";

  const mysqlDriverError = (errno: number, code: string, message: string) =>
    Object.assign(new Error(message), { code, errno, sqlMessage: message });

  const snapshotSqlError = (reason: SqlError.SqlErrorReason) =>
    new EffectDrizzleQueryError({
      query: deploymentQuery,
      params: undefined,
      cause: new SqlError.SqlError({ reason }),
    });

  const snapshotCollision = (constraint: string) =>
    snapshotSqlError(
      new SqlError.UniqueViolation({
        cause: mysqlDriverError(1062, "ER_DUP_ENTRY", "Duplicate entry"),
        message: "Duplicate entry",
        operation: "insert",
        constraint,
      }),
    );

  const makePolicyContext = async () => {
    const context = await makeContext();
    const tenant = await runEffect(
      context.service.createTenant(request(context.headers), { name: "Acme", slug: "acme" }),
    );
    const policy = await runEffect(
      context.service.createPolicy(request(context.headers), tenant.id, { name: "Baseline" }),
    );

    return { ...context, tenant, policy };
  };

  const interceptDeploymentInserts = (
    db: any,
    respond: (
      row: any,
      attempt: number,
      commit: () => Effect.Effect<unknown, unknown, any>,
    ) => Effect.Effect<any, any, any>,
  ) => {
    const insert = db.insert.bind(db);
    const attempts: any[] = [];

    db.insert = (table: any) => {
      const builder = insert(table);

      if (table !== schema.policyDeployment) return builder;

      const values = builder.values.bind(builder);

      builder.values = (rows: any) => {
        const row = Array.isArray(rows) ? rows[0] : rows;
        const pending = values(rows);
        // The fake applies writes when the builder is yielded, not in values().
        const commit = Effect.gen(function* () {
          yield* pending;
        });
        attempts.push(row);

        return Effect.suspend(() => respond(row, attempts.length, () => commit));
      };

      return builder;
    };

    return attempts;
  };

  it("stores the delivery scope of a configuration", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const policy = await runEffect(
      service.createPolicy(request(headers), tenant.id, { name: "User settings" }),
    );

    await runEffect(
      service.patchPolicy(request(headers), tenant.id, policy.id, {
        configurations: {
          "mttx.apple.declaration.usersettings": {
            kind: "com.apple.configuration.app.settings",
            configuration: {},
          },
        },
        configurationScopes: { "mttx.apple.declaration.usersettings": "user" },
      }),
    );

    expect(db.store.configuration[0]).toMatchObject({
      policyId: policy.id,
      kind: "mttx.apple.declaration.usersettings",
      scope: "user",
    });

    const detail = await runEffect(service.getPolicy(request(headers), tenant.id, policy.id));

    expect(requireField(detail, "configurationScopes").configurationScopes).toEqual({
      "mttx.apple.declaration.usersettings": "user",
    });

    const list = await runEffect(service.listPolicies(request(headers), tenant.id));

    expect(list.rows[0]).toMatchObject({ userConfigurationCount: 1 });
  });

  it("creates, patches, and reads policy configurations", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const policy = await runEffect(
      service.createPolicy(request(headers), tenant.id, { name: "Baseline", notes: "Initial" }),
    );

    await runEffect(
      service.patchPolicy(request(headers), tenant.id, policy.id, {
        name: "Baseline v2",
        notes: "Updated",
        configurations: {
          "mttx.apple.device": { camera: false },
          "mttx.apple.declaration.files": {
            kind: "com.apple.configuration.services.configuration-files",
            configuration: { ServiceType: "com.apple.servicemanagement" },
          },
        },
      }),
    );

    expect(db.store.policy[0]).toMatchObject({
      id: policy.id,
      organizationId: tenant.id,
      name: "Baseline v2",
      notes: "Updated",
    });
    expect(db.store.configuration).toMatchObject([
      { policyId: policy.id, kind: "mttx.apple.device", data: { camera: false } },
      {
        policyId: policy.id,
        kind: "mttx.apple.declaration.files",
        data: {
          kind: "com.apple.configuration.services.configuration-files",
          configuration: { ServiceType: "com.apple.servicemanagement" },
        },
      },
    ]);

    const result = await runEffect(service.getPolicy(request(headers), tenant.id, policy.id));
    expect(result).toMatchObject({
      id: policy.id,
      name: "Baseline v2",
      notes: "Updated",
      configurations: {
        "mttx.apple.device": { camera: false },
        "mttx.apple.declaration.files": {
          kind: "com.apple.configuration.services.configuration-files",
          configuration: { ServiceType: "com.apple.servicemanagement" },
        },
      },
    });
  });

  it("disables and re-enables a policy without dropping its configuration", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const policy = await runEffect(
      service.createPolicy(request(headers), tenant.id, { name: "Baseline" }),
    );

    await runEffect(
      service.patchPolicy(request(headers), tenant.id, policy.id, {
        configurations: { "mttx.apple.device": { camera: false } },
      }),
    );

    expect(db.store.policy[0]).toMatchObject({ enabled: true });

    await runEffect(
      service.patchPolicy(request(headers), tenant.id, policy.id, { enabled: false }),
    );

    expect(db.store.policy[0]).toMatchObject({ enabled: false });
    // The configuration survives a disable; only delivery stops.
    expect(db.store.configuration).toHaveLength(1);

    const disabled = await runEffect(service.getPolicy(request(headers), tenant.id, policy.id));

    expect(disabled).toMatchObject({
      enabled: false,
      configurations: { "mttx.apple.device": { camera: false } },
    });

    expect(db.store.policy_deployment.at(-1)?.snapshot).toMatchObject({ "@@enabled": false });
    expect(db.store.audit_log.at(-1)).toMatchObject({
      action: "policy.updated",
      targetId: policy.id,
      metadata: { enabled: false },
    });

    const list = await runEffect(service.listPolicies(request(headers), tenant.id));

    expect(list.rows[0]).toMatchObject({ enabled: false, configurationCount: 1 });

    await runEffect(service.patchPolicy(request(headers), tenant.id, policy.id, { enabled: true }));

    expect(db.store.policy[0]).toMatchObject({ enabled: true });

    const enabled = await runEffect(service.getPolicy(request(headers), tenant.id, policy.id));

    expect(enabled).toMatchObject({ enabled: true });
    expect(db.store.policy_deployment.at(-1)?.snapshot).not.toHaveProperty("@@enabled");
    expect(db.store.audit_log.at(-1)).toMatchObject({
      action: "policy.updated",
      metadata: { enabled: true },
    });
  });

  it("restores the enabled state from deployment snapshots", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const policy = await runEffect(
      service.createPolicy(request(headers), tenant.id, { name: "Baseline" }),
    );

    await runEffect(
      service.patchPolicy(request(headers), tenant.id, policy.id, {
        configurations: { "mttx.apple.device": { camera: false } },
      }),
    );
    await runEffect(
      service.patchPolicy(request(headers), tenant.id, policy.id, { enabled: false }),
    );

    const deployments = await runEffect(
      service.listPolicyDeployments(request(headers), tenant.id, policy.id),
    );

    const disabledDeployment = deployments.deployments.find((item) => item.version === 3)!;
    const enabledDeployment = deployments.deployments.find((item) => item.version === 2)!;

    // Rolling back to an older, enabled snapshot re-enables the policy and
    // must not turn the reserved state key into a configuration kind.
    await runEffect(
      service.rollbackPolicy(request(headers), tenant.id, policy.id, enabledDeployment.id),
    );

    expect(db.store.policy[0]).toMatchObject({ enabled: true });
    expect(db.store.configuration.some((row: any) => row.kind === "@@enabled")).toBe(false);
    expect(db.store.audit_log.at(-1)).toMatchObject({
      action: "policy.rolled_back",
      metadata: { deploymentId: enabledDeployment.id, enabled: true },
    });

    // Restoring a disabled snapshot disables it again.
    await runEffect(
      service.rollbackPolicy(request(headers), tenant.id, policy.id, disabledDeployment.id),
    );

    expect(db.store.policy[0]).toMatchObject({ enabled: false });
    expect(db.store.audit_log.at(-1)).toMatchObject({
      action: "policy.rolled_back",
      metadata: { deploymentId: disabledDeployment.id, enabled: false },
    });

    // A hand-written snapshot from before the flag existed restores enabled.
    db.store.policy_deployment.push({
      id: "pre-feature-deployment",
      organizationId: tenant.id,
      policyId: policy.id,
      version: 1000,
      snapshot: { "mttx.apple.device": { camera: false } },
      createdByAccountId: null,
      createdAt: new Date(),
    });

    await runEffect(
      service.rollbackPolicy(request(headers), tenant.id, policy.id, "pre-feature-deployment"),
    );

    expect(db.store.policy[0]).toMatchObject({ enabled: true });
    expect(db.store.audit_log.at(-1)).toMatchObject({
      action: "policy.rolled_back",
      metadata: { deploymentId: "pre-feature-deployment", enabled: true },
    });
  });

  it("rejects patching policies outside the tenant", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const now = new Date();
    db.store.policy.push({
      id: "other-policy",
      organizationId: "other-tenant",
      name: "Other",
      notes: null,
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      runEffect(
        service.patchPolicy(request(headers), tenant.id, "other-policy", { name: "Denied" }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);
  });

  it.each([
    {
      name: "connection",
      error: () =>
        snapshotSqlError(
          new SqlError.ConnectionError({
            cause: mysqlDriverError(2003, "ECONNREFUSED", "connect ECONNREFUSED"),
            message: "connect ECONNREFUSED",
            operation: "insert",
          }),
        ),
    },
    {
      name: "syntax",
      error: () =>
        snapshotSqlError(
          new SqlError.SqlSyntaxError({
            cause: mysqlDriverError(1064, "ER_PARSE_ERROR", "You have an error in your SQL"),
            message: "You have an error in your SQL",
            operation: "insert",
          }),
        ),
    },
    {
      name: "non-unique constraint",
      error: () =>
        snapshotSqlError(
          new SqlError.ConstraintError({
            cause: mysqlDriverError(1452, "ER_NO_REFERENCED_ROW_2", "Constraint failed"),
            message: "Constraint failed",
            operation: "insert",
          }),
        ),
    },
    {
      name: "unique constraint on another table",
      error: () => snapshotCollision("configuration.PRIMARY"),
    },
    {
      name: "unstructured driver duplicate",
      error: () =>
        new EffectDrizzleQueryError({
          query: deploymentQuery,
          params: undefined,
          cause: mysqlDriverError(1062, "ER_DUP_ENTRY", "Duplicate entry"),
        }),
    },
  ])("does not retry a Drizzle-wrapped $name snapshot failure", async ({ error }) => {
    const { db, service, headers, tenant, policy } = await makePolicyContext();
    const attempts = interceptDeploymentInserts(db, () => Effect.fail(error()));

    await expect(
      runEffect(
        service.patchPolicy(request(headers), tenant.id, policy.id, {
          configurations: { "mttx.apple.device": { camera: false } },
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseInternal);

    expect(attempts).toHaveLength(1);
    expect(db.store.policy_deployment).toHaveLength(1);
  });

  it("reuses one deployment id when a stale version read collides", async () => {
    const { db, service, headers, tenant, policy } = await makePolicyContext();
    const attempts = interceptDeploymentInserts(db, (_row, attempt, commit) =>
      attempt === 1
        ? Effect.fail(snapshotCollision("policy_deployment.policy_deployment_version_unique"))
        : Effect.suspend(commit),
    );

    await runEffect(
      service.patchPolicy(request(headers), tenant.id, policy.id, {
        configurations: { "mttx.apple.device": { camera: false } },
      }),
    );

    expect(attempts.map((row) => row.version)).toEqual([2, 3]);
    expect(new Set(attempts.map((row) => row.id)).size).toBe(1);
    expect(db.store.policy_deployment).toHaveLength(2);
    expect(db.store.policy_deployment.at(-1)).toMatchObject({
      id: attempts[0].id,
      version: 3,
      snapshot: { "mttx.apple.device": { camera: false } },
    });
  });

  it("acknowledges an ambiguously committed snapshot without inserting again", async () => {
    const { db, service, headers, tenant, policy } = await makePolicyContext();
    const attempts = interceptDeploymentInserts(db, (_row, _attempt, commit) =>
      Effect.suspend(commit).pipe(
        Effect.andThen(Effect.fail(snapshotCollision("policy_deployment.PRIMARY"))),
      ),
    );

    await runEffect(
      service.patchPolicy(request(headers), tenant.id, policy.id, {
        configurations: { "mttx.apple.device": { camera: false } },
      }),
    );

    expect(attempts).toHaveLength(1);
    expect(db.store.policy_deployment).toHaveLength(2);
    expect(db.store.policy_deployment.at(-1)).toMatchObject({
      id: attempts[0].id,
      version: 2,
      snapshot: { "mttx.apple.device": { camera: false } },
    });
  });

  it("does not accept a committed snapshot with different contents", async () => {
    const { db, service, headers, tenant, policy } = await makePolicyContext();
    const attempts = interceptDeploymentInserts(db, (row) =>
      Effect.sync(() => {
        db.store.policy_deployment.push({
          ...row,
          snapshot: { "mttx.apple.device": { camera: true } },
        });
      }).pipe(Effect.andThen(Effect.fail(snapshotCollision("policy_deployment.PRIMARY")))),
    );

    await expect(
      runEffect(
        service.patchPolicy(request(headers), tenant.id, policy.id, {
          configurations: { "mttx.apple.device": { camera: false } },
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseInternal);

    expect(attempts).toHaveLength(1);
  });

  it("bounds repeated version collisions and keeps the deployment id fixed", async () => {
    const { db, service, headers, tenant, policy } = await makePolicyContext();
    const attempts = interceptDeploymentInserts(db, () =>
      Effect.fail(snapshotCollision("policy_deployment_version_unique")),
    );

    await expect(
      runEffect(
        service.patchPolicy(request(headers), tenant.id, policy.id, {
          configurations: { "mttx.apple.device": { camera: false } },
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseInternal);

    expect(attempts.map((row) => row.version)).toEqual([2, 3, 4, 5]);
    expect(new Set(attempts.map((row) => row.id)).size).toBe(1);
    expect(db.store.policy_deployment).toHaveLength(1);
  });

  it("duplicates policy configurations and deletes with partial failure reporting", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const policy = await runEffect(
      service.createPolicy(request(headers), tenant.id, { name: "Baseline", notes: "Original" }),
    );

    await runEffect(
      service.patchPolicy(request(headers), tenant.id, policy.id, {
        configurations: { "mttx.apple.device": { camera: false } },
      }),
    );

    const duplicated = await runEffect(
      service.duplicatePolicy(request(headers), tenant.id, policy.id, { name: "Baseline Copy" }),
    );

    expect(db.store.policy.find((item: any) => item.id === duplicated.id)).toMatchObject({
      name: "Baseline Copy",
      notes: "Original",
    });
    expect(db.store.configuration).toContainEqual(
      expect.objectContaining({
        policyId: duplicated.id,
        kind: "mttx.apple.device",
        data: { camera: false },
      }),
    );

    const result = await runEffect(
      service.deletePolicies(request(headers), tenant.id, [policy.id, "missing-policy"]),
    );

    expect(result).toEqual({
      deleted: [policy.id],
      failed: [{ id: "missing-policy", reason: "notFound" }],
    });
  });
});

describe("enterprise service policy list", () => {
  const seedDevice = (
    db: any,
    organizationId: string,
    id: string,
    proto: "apple" | "win" | "android" = "apple",
  ) => {
    const now = new Date();

    db.store.device.push({
      id,
      organizationId,
      proto,
      status: "enrolled",
      name: id,
      enrolledAt: now,
      lastSeenAt: now,
    });
  };

  const seedUser = (
    db: any,
    organizationId: string,
    id: string,
    options: { disabled?: boolean } = {},
  ) => {
    const now = new Date();

    // Directory people are tenant-scoped by `organizationId`; they are not
    // accounts and need no membership row to receive policy.
    db.store.user.push({
      id,
      organizationId,
      name: id,
      email: `${id}@example.com`,
      disabled: options.disabled ?? false,
      source: "manual",
      createdAt: now,
      updatedAt: now,
    });
  };

  const seedDirectoryGroup = (db: any, organizationId: string, id: string) => {
    const now = new Date();

    db.store.user_group.push({
      id,
      organizationId,
      name: id,
      externalId: null,
      description: null,
      source: "manual",
      createdAt: now,
      updatedAt: now,
    });
  };

  it("returns configuration counts and a resolved device scope", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const included = await runEffect(
      service.createPolicy(request(headers), tenant.id, { name: "Included" }),
    );

    const empty = await runEffect(
      service.createPolicy(request(headers), tenant.id, { name: "Empty" }),
    );

    const now = new Date();

    db.store.configuration.push(
      { policyId: included.id, kind: "mttx.apple.device", data: {}, hash: "hash-1" },
      {
        policyId: included.id,
        kind: "mttx.apple.declaration.files",
        data: {},
        hash: "hash-2",
      },
      // Another tenant's configuration must not leak into this tenant's count.
      { policyId: "other-policy", kind: "mttx.apple.device", data: {}, hash: "other" },
    );

    const includeGroup = await runEffect(
      service.createGroup(request(headers), tenant.id, { name: "Include" }),
    );

    const excludeGroup = await runEffect(
      service.createGroup(request(headers), tenant.id, { name: "Exclude" }),
    );

    db.store.group_policy.push(
      { groupId: includeGroup.id, policyId: included.id, mode: "include" },
      { groupId: excludeGroup.id, policyId: included.id, mode: "exclude" },
    );

    seedDevice(db, tenant.id, "device-1");
    seedDevice(db, tenant.id, "device-2");
    seedDevice(db, tenant.id, "device-3");
    seedDevice(db, tenant.id, "device-4");
    seedDevice(db, tenant.id, "device-5");

    db.store.group_device.push(
      { groupId: includeGroup.id, deviceId: "device-1", source: "manual" },
      { groupId: includeGroup.id, deviceId: "device-2", source: "manual" },
      { groupId: includeGroup.id, deviceId: "device-4", source: "manual" },
      { groupId: excludeGroup.id, deviceId: "device-2", source: "manual" },
    );

    db.store.device_policy.push(
      { deviceId: "device-3", policyId: included.id, mode: "include" },
      { deviceId: "device-4", policyId: included.id, mode: "exclude" },
    );

    // Unrelated rows prove the count is scoped to the tenant's policy ids.
    db.store.group_policy.push({
      groupId: includeGroup.id,
      policyId: "other-policy",
      mode: "include",
    });
    db.store.device.push({
      id: "other-device",
      organizationId: "other-tenant",
      proto: "apple",
      status: "enrolled",
      name: "other-device",
      enrolledAt: now,
      lastSeenAt: now,
    });
    db.store.group_device.push({
      groupId: includeGroup.id,
      deviceId: "other-device",
      source: "manual",
    });

    const { rows } = await runEffect(service.listPolicies(request(headers), tenant.id));
    const byId = new Map(rows.map((row) => [row.id, row]));

    expect(byId.get(included.id)).toMatchObject({
      id: included.id,
      configurationCount: 2,
      // device-1 through the group, device-3 directly. device-2 is vetoed by a
      // group exclusion and device-4 by a direct device exclusion.
      scopedDeviceCount: 2,
      scopedUserCount: 0,
    });
    expect(byId.get(empty.id)).toMatchObject({
      configurationCount: 0,
      scopedDeviceCount: 0,
      scopedUserCount: 0,
    });
    expect(rows).toHaveLength(2);
  });

  it("counts directory users through includes and exclusions", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const policy = await runEffect(
      service.createPolicy(request(headers), tenant.id, { name: "People" }),
    );

    const now = new Date();

    seedDirectoryGroup(db, tenant.id, "group-include");
    seedDirectoryGroup(db, tenant.id, "group-exclude");

    db.store.user_group_policy.push(
      {
        organizationId: tenant.id,
        groupId: "group-include",
        policyId: policy.id,
        mode: "include",
        createdAt: now,
      },
      {
        organizationId: tenant.id,
        groupId: "group-exclude",
        policyId: policy.id,
        mode: "exclude",
        createdAt: now,
      },
    );

    for (const id of ["user-1", "user-2", "user-3", "user-4", "user-5", "user-6", "user-7"])
      seedUser(db, tenant.id, id, { disabled: id === "user-3" });

    for (const id of ["user-1", "user-2", "user-3", "user-4", "user-6"])
      db.store.user_group_member.push({ groupId: "group-include", userId: id });

    for (const id of ["user-4", "user-5"])
      db.store.user_group_member.push({ groupId: "group-exclude", userId: id });

    db.store.user_policy.push(
      {
        organizationId: tenant.id,
        userId: "user-1",
        policyId: policy.id,
        mode: "include",
        createdAt: now,
      },
      // A direct include survives the user's excluded directory group.
      {
        organizationId: tenant.id,
        userId: "user-5",
        policyId: policy.id,
        mode: "include",
        createdAt: now,
      },
      {
        organizationId: tenant.id,
        userId: "user-6",
        policyId: policy.id,
        mode: "exclude",
        createdAt: now,
      },
    );

    for (const [deviceId, userId] of [
      ["device-1", "user-1"],
      ["device-2", "user-2"],
      ["device-3", "user-3"],
      ["device-4", "user-4"],
      ["device-5", "user-5"],
      ["device-6", "user-6"],
      ["device-7", "user-7"],
    ] as const) {
      seedDevice(db, tenant.id, deviceId);
      db.store.device_user.push({
        organizationId: tenant.id,
        deviceId,
        userId,
        source: "manual",
        createdAt: now,
      });
    }

    const { rows } = await runEffect(service.listPolicies(request(headers), tenant.id));

    expect(rows.find((row) => row.id === policy.id)).toMatchObject({
      // user-1 is direct, user-2 is in the included group and user-5 is direct
      // despite also being in the excluded group. user-3 is disabled, user-4 is
      // only in the excluded group, user-6 is directly excluded and user-7 is
      // linked to a device but not included by any user or group assignment.
      scopedUserCount: 3,
      scopedDeviceCount: 3,
    });
  });

  it("derives delivery from the current configuration and declaration reports", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const policy = await runEffect(
      service.createPolicy(request(headers), tenant.id, { name: "Baseline" }),
    );

    const untracked = await runEffect(
      service.createPolicy(request(headers), tenant.id, { name: "Windows only" }),
    );

    const idle = await runEffect(
      service.createPolicy(request(headers), tenant.id, { name: "No devices" }),
    );

    db.store.configuration.push({
      policyId: policy.id,
      kind: "mttx.apple.declaration.files",
      data: { kind: "com.apple.configuration.services.configuration-files" },
      hash: "current-hash",
    });

    seedDevice(db, tenant.id, "apple-1");
    seedDevice(db, tenant.id, "apple-2");
    seedDevice(db, tenant.id, "win-1", "win");

    const now = new Date();

    for (const [deviceId, policyId] of [
      ["apple-1", policy.id],
      ["apple-2", policy.id],
      // The mixed-platform scope proves Windows devices are counted but not
      // treated as tracked delivery evidence.
      ["win-1", policy.id],
      ["win-1", untracked.id],
    ] as const)
      db.store.device_policy.push({ deviceId, policyId, mode: "include" });

    db.store.device_declaration.push(
      {
        deviceId: "apple-1",
        identifier: `${policy.id}:mttx.apple.declaration.files`,
        declarationType: "configurations",
        active: true,
        valid: "valid",
        serverToken: "current-hash",
        reasons: null,
        updatedAt: now,
      },
      {
        deviceId: "apple-2",
        identifier: `${policy.id}:mttx.apple.declaration.files`,
        declarationType: "configurations",
        active: true,
        valid: "invalid",
        serverToken: "current-hash",
        reasons: { Error: "failed" },
        updatedAt: now,
      },
    );

    const read = async () =>
      (await runEffect(service.listPolicies(request(headers), tenant.id))).rows.find(
        (row) => row.id === policy.id,
      )!;

    expect((await read()).delivery).toMatchObject({
      state: "partial",
      version: 1,
      scopedDevices: 3,
      trackedDevices: 2,
      deliveredDevices: 1,
      failedDevices: 1,
      pendingDevices: 0,
    });

    const declaration = db.store.device_declaration.find((row: any) => row.deviceId === "apple-2");

    declaration.valid = "valid";
    declaration.reasons = null;

    expect((await read()).delivery).toMatchObject({
      state: "delivered",
      deliveredDevices: 2,
      failedDevices: 0,
      pendingDevices: 0,
    });

    // A declaration from the previous save is valid and active, but its server
    // token is the old content hash, so it must not look delivered.
    declaration.serverToken = "stale-hash";

    expect((await read()).delivery).toMatchObject({
      state: "partial",
      deliveredDevices: 1,
      failedDevices: 0,
      pendingDevices: 1,
    });

    const rows = (await runEffect(service.listPolicies(request(headers), tenant.id))).rows;

    expect(rows.find((row) => row.id === untracked.id)?.delivery).toMatchObject({
      state: "not-tracked",
      scopedDevices: 1,
      trackedDevices: 0,
    });
    expect(rows.find((row) => row.id === idle.id)?.delivery).toMatchObject({
      state: "no-devices",
      scopedDevices: 0,
      trackedDevices: 0,
    });
  });

  it("accepts the resolved token of a variable-bearing configuration", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const policy = await runEffect(
      service.createPolicy(request(headers), tenant.id, { name: "Variables" }),
    );

    // The saved hash covers the template; the device reports the token of the
    // substituted payload. They must not be compared byte for byte.
    db.store.configuration.push({
      policyId: policy.id,
      kind: "mttx.apple.declaration.files",
      data: { note: "${device.name}" },
      hash: "template-hash",
    });

    seedDevice(db, tenant.id, "apple-1");
    db.store.device_policy.push({
      deviceId: "apple-1",
      policyId: policy.id,
      mode: "include",
    });
    db.store.device_declaration.push({
      deviceId: "apple-1",
      identifier: `${policy.id}:mttx.apple.declaration.files`,
      declarationType: "configurations",
      active: true,
      valid: "valid",
      serverToken: "resolved-hash",
      reasons: null,
      updatedAt: new Date(),
    });

    const { rows } = await runEffect(service.listPolicies(request(headers), tenant.id));

    expect(rows.find((row) => row.id === policy.id)?.delivery).toMatchObject({
      state: "delivered",
      trackedDevices: 1,
      deliveredDevices: 1,
      pendingDevices: 0,
    });
  });

  it("does not treat legacy-mode Apple devices as declaration-tracked", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const policy = await runEffect(
      service.createPolicy(request(headers), tenant.id, { name: "Legacy" }),
    );

    db.store.configuration.push({
      policyId: policy.id,
      kind: "mttx.apple.declaration.files",
      data: { kind: "com.apple.configuration.services.configuration-files" },
      hash: "current-hash",
    });

    seedDevice(db, tenant.id, "apple-1");
    db.store.device_apple.push({
      deviceId: "apple-1",
      declarationMode: "legacy",
    });
    db.store.device_policy.push({
      deviceId: "apple-1",
      policyId: policy.id,
      mode: "include",
    });

    const { rows } = await runEffect(service.listPolicies(request(headers), tenant.id));

    expect(rows.find((row) => row.id === policy.id)?.delivery).toMatchObject({
      state: "not-tracked",
      scopedDevices: 1,
      trackedDevices: 0,
      legacyDevices: 1,
      pendingDevices: 0,
    });
  });
});

describe("enterprise service effective policy", () => {
  const seedDevice = (db: any, organizationId: string, id: string) => {
    const now = new Date();
    db.store.device.push({
      id,
      organizationId,
      proto: "apple",
      status: "enrolled",
      name: id,
      dmIdentifier: `dm-${id}`,
      enrolledAt: now,
      lastSeenAt: now,
    });
  };

  it("resolves includes, priority and direct exclusions for a device", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const group = await runEffect(
      service.createGroup(request(headers), tenant.id, { name: "Engineering" }),
    );

    const low = await runEffect(
      service.createPolicy(request(headers), tenant.id, { name: "Low", priority: 1 }),
    );

    const high = await runEffect(
      service.createPolicy(request(headers), tenant.id, { name: "High", priority: 10 }),
    );

    const excluded = await runEffect(
      service.createPolicy(request(headers), tenant.id, { name: "Excluded", priority: 100 }),
    );

    const kind = "mttx.apple.device";

    for (const [policyId, camera] of [
      [low.id, false],
      [high.id, true],
      [excluded.id, false],
    ] as const) {
      await runEffect(
        service.patchPolicy(request(headers), tenant.id, policyId, {
          configurations: { [kind]: { camera } },
        }),
      );
    }

    seedDevice(db, tenant.id, "device-1");

    await runEffect(
      service.patchGroupMembers(request(headers), tenant.id, group.id, {
        assign: {
          devices: ["device-1"],
          policies: [
            { id: low.id, mode: "include" },
            { id: high.id, mode: "include" },
            { id: excluded.id, mode: "include" },
          ],
        },
      }),
    );
    await runEffect(
      service.patchPolicyAssignments(request(headers), tenant.id, excluded.id, {
        assign: [{ id: "device-1", mode: "exclude" }],
      }),
    );

    const result = await runEffect(
      service.getDeviceEffectivePolicy(request(headers), tenant.id, "device-1"),
    );

    expect(result.configurations).toEqual([
      expect.objectContaining({
        kind,
        policyId: high.id,
        policyName: "High",
        scope: "group",
        groupIds: [group.id],
      }),
    ]);
    expect(result.policies).toEqual([
      expect.objectContaining({ policyId: high.id, policyName: "High", kinds: [kind] }),
    ]);
    expect(result.overridden).toEqual([
      expect.objectContaining({ kind, policyId: low.id, reason: "lower-priority" }),
    ]);
    expect(result.exclusions).toEqual([
      expect.objectContaining({
        policyId: excluded.id,
        scope: "direct",
        effective: true,
        reason: "device-exclude",
      }),
    ]);
  });

  it("reports a policy's reverse scope and a group's computed reach", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const group = await runEffect(
      service.createGroup(request(headers), tenant.id, { name: "Engineering" }),
    );

    const low = await runEffect(
      service.createPolicy(request(headers), tenant.id, { name: "Low", priority: 1 }),
    );

    const high = await runEffect(
      service.createPolicy(request(headers), tenant.id, { name: "High", priority: 10 }),
    );

    const kind = "mttx.apple.device";

    for (const policyId of [low.id, high.id])
      await runEffect(
        service.patchPolicy(request(headers), tenant.id, policyId, {
          configurations: { [kind]: { camera: false } },
        }),
      );

    seedDevice(db, tenant.id, "device-1");

    await runEffect(
      service.patchGroupMembers(request(headers), tenant.id, group.id, {
        assign: {
          devices: ["device-1"],
          policies: [
            { id: low.id, mode: "include" },
            { id: high.id, mode: "include" },
          ],
        },
      }),
    );

    const policyScope = await runEffect(
      service.getPolicyScope(request(headers), tenant.id, low.id),
    );

    expect(policyScope).toMatchObject({
      policyId: low.id,
      platforms: ["apple"],
      channels: ["device"],
      deviceCount: 1,
      devices: [
        expect.objectContaining({
          deviceId: "device-1",
          channel: "device",
          status: "overridden",
          reason: "higher-priority",
          losses: [
            expect.objectContaining({
              kind,
              winnerPolicyId: high.id,
              winnerPolicyName: "High",
            }),
          ],
        }),
      ],
    });

    const groupScope = await runEffect(
      service.getGroupScope(request(headers), tenant.id, group.id),
    );

    expect(groupScope.memberCount).toBe(1);
    expect(groupScope.policies).toEqual([
      expect.objectContaining({
        policyId: high.id,
        mode: "include",
        devices: [expect.objectContaining({ status: "applies", kinds: [kind] })],
      }),
      expect.objectContaining({
        policyId: low.id,
        mode: "include",
        devices: [expect.objectContaining({ status: "overridden" })],
      }),
    ]);
  });

  it("resolves a user-scoped policy on the linked user's channel", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const policy = await runEffect(
      service.createPolicy(request(headers), tenant.id, { name: "User settings" }),
    );

    const kind = "mttx.apple.declaration.safari";

    await runEffect(
      service.patchPolicy(request(headers), tenant.id, policy.id, {
        configurations: {
          [kind]: {
            kind: "com.apple.configuration.safari.bookmarks",
            configuration: {},
          },
        },
        configurationScopes: { [kind]: "user" },
      }),
    );

    seedDevice(db, tenant.id, "device-1");

    const now = new Date();

    db.store.user.push({
      id: "user-1",
      organizationId: tenant.id,
      name: "Oscar",
      email: "oscar@example.com",
      disabled: false,
      source: "manual",
      createdAt: now,
      updatedAt: now,
    });

    db.store.device_apple.push({
      deviceId: "device-1",
      declarationMode: "ddm",
    });

    db.store.device_apple_user.push({
      deviceId: "device-1",
      userId: "apple-user-1",
      directoryUserId: "user-1",
      identityVerifiedAt: now,
      consecutivePushFailures: 0,
      updatedAt: now,
    });

    db.store.user_policy.push({
      organizationId: tenant.id,
      userId: "user-1",
      policyId: policy.id,
      mode: "include",
      createdAt: now,
    });

    const scope = await runEffect(service.getPolicyScope(request(headers), tenant.id, policy.id));

    expect(scope.channels).toEqual(["user"]);
    expect(scope.devices).toEqual([
      expect.objectContaining({
        deviceId: "device-1",
        channel: "user",
        userId: "user-1",
        userName: "Oscar",
        status: "applies",
        kinds: [kind],
      }),
    ]);
  });

  it("reports a user policy with no verified Apple channel", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const policy = await runEffect(
      service.createPolicy(request(headers), tenant.id, { name: "User settings" }),
    );

    const kind = "mttx.apple.declaration.safari";

    await runEffect(
      service.patchPolicy(request(headers), tenant.id, policy.id, {
        configurations: {
          [kind]: { kind: "com.apple.configuration.safari.bookmarks", configuration: {} },
        },
        configurationScopes: { [kind]: "user" },
      }),
    );

    seedDevice(db, tenant.id, "device-1");

    const now = new Date();

    db.store.user.push({
      id: "user-1",
      organizationId: tenant.id,
      name: "Oscar",
      email: "oscar@example.com",
      disabled: false,
      source: "manual",
      createdAt: now,
      updatedAt: now,
    });

    db.store.device_user.push({
      organizationId: tenant.id,
      deviceId: "device-1",
      userId: "user-1",
      source: "manual",
      createdAt: now,
    });

    db.store.device_apple.push({ deviceId: "device-1", declarationMode: "ddm" });

    db.store.user_policy.push({
      organizationId: tenant.id,
      userId: "user-1",
      policyId: policy.id,
      mode: "include",
      createdAt: now,
    });

    const scope = await runEffect(service.getPolicyScope(request(headers), tenant.id, policy.id));

    expect(scope.devices).toEqual([
      expect.objectContaining({
        deviceId: "device-1",
        channel: "user",
        status: "not-included",
        reason: "no-verified-user-channel",
      }),
    ]);
  });

  it("caps a policy's device list and reports the real count", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const policy = await runEffect(
      service.createPolicy(request(headers), tenant.id, { name: "Fleet" }),
    );

    await runEffect(
      service.patchPolicy(request(headers), tenant.id, policy.id, {
        configurations: { "mttx.apple.device": { camera: false } },
      }),
    );

    const now = new Date();

    for (let index = 0; index <= 500; index += 1) {
      const id = `device-${String(index).padStart(4, "0")}`;

      db.store.device.push({
        id,
        organizationId: tenant.id,
        proto: "apple",
        status: "enrolled",
        name: id,
        dmIdentifier: `dm-${id}`,
        enrolledAt: now,
        lastSeenAt: now,
      });
      db.store.device_policy.push({
        deviceId: id,
        policyId: policy.id,
        mode: "include",
      });
    }

    const scope = await runEffect(service.getPolicyScope(request(headers), tenant.id, policy.id));

    expect(scope.truncated).toBe(true);
    expect(scope.deviceCount).toBe(501);
    expect(scope.devices).toHaveLength(500);
  });

  it("keeps a group's assigned policies visible without members", async () => {
    const { service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const group = await runEffect(
      service.createGroup(request(headers), tenant.id, { name: "Empty" }),
    );

    const policy = await runEffect(
      service.createPolicy(request(headers), tenant.id, { name: "Security" }),
    );

    await runEffect(
      service.patchGroupMembers(request(headers), tenant.id, group.id, {
        assign: { policies: [{ id: policy.id, mode: "include" }] },
      }),
    );

    const scope = await runEffect(service.getGroupScope(request(headers), tenant.id, group.id));

    expect(scope).toMatchObject({ memberCount: 0, truncated: false });
    expect(scope.policies).toEqual([expect.objectContaining({ policyId: policy.id, devices: [] })]);
  });

  it("includes Windows user-scoped settings on the device effective policy", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const policy = await runEffect(
      service.createPolicy(request(headers), tenant.id, { name: "Per-user" }),
    );

    const kind = "mttx.windows.custom.wifi";

    await runEffect(
      service.patchPolicy(request(headers), tenant.id, policy.id, {
        configurations: {
          [kind]: {
            nodes: [
              {
                omaUri: "./User/Vendor/MSFT/Policy/Config/Foo",
                value: 1,
                format: "int",
              },
            ],
          },
        },
        configurationScopes: { [kind]: "user" },
      }),
    );

    const now = new Date();

    db.store.device.push({
      id: "windows-1",
      organizationId: tenant.id,
      proto: "win",
      status: "enrolled",
      name: "windows-1",
      dmIdentifier: "dm-windows-1",
      enrolledAt: now,
      lastSeenAt: now,
    });

    db.store.device_policy.push({
      deviceId: "windows-1",
      policyId: policy.id,
      mode: "include",
    });

    const effective = await runEffect(
      service.getDeviceEffectivePolicy(request(headers), tenant.id, "windows-1"),
    );

    expect(effective.configurations).toEqual([
      expect.objectContaining({
        kind,
        policyId: policy.id,
        configurationScope: "user",
      }),
    ]);
  });

  it("scopes the effective policy to the tenant", async () => {
    const { db, service, headers } = await makeContext();

    const first = await runEffect(
      service.createTenant(request(headers), { name: "First", slug: "first" }),
    );

    const second = await runEffect(
      service.createTenant(request(headers), { name: "Second", slug: "second" }),
    );

    seedDevice(db, first.id, "device-1");

    await expect(
      runEffect(service.getDeviceEffectivePolicy(request(headers), second.id, "device-1")),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);
  });
});

describe("enterprise service APNs", () => {
  const seedCertificate = async (db: any, tenantId: string) => {
    const { encrypted } = await sealedJwk();
    db.store.apple_push_certificate.push({
      organizationId: tenantId,
      email: "admin@example.com",
      topic: "com.apple.mgmt.External.acme",
      certPem: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----",
      encryptedKey: encrypted,
      updatedAt: new Date(),
    });
  };

  const seedDevice = async (
    db: any,
    tenantId: string,
    id: string,
    options: { status?: string; proto?: string; token?: string; dmIdentifier?: string } = {},
  ) => {
    const now = new Date();
    db.store.device.push({
      id,
      organizationId: tenantId,
      proto: options.proto ?? "apple",
      status: options.status ?? "enrolled",
      name: id,
      // Distinct from the row id so tests cannot pass by conflating the two.
      dmIdentifier: options.dmIdentifier ?? `dm-${id}`,
      enrolledAt: now,
      lastSeenAt: now,
    });
    db.store.device_apple.push({
      deviceId: id,
      token: options.token ?? `${id}-token`,
      pushMagic: `${id}-magic`,
      topic: "com.apple.mgmt.External.acme",
    });
  };

  const seedAppleUser = (
    db: any,
    id: string,
    overrides: {
      userId?: string;
      token?: string | null;
      authenticatedAt?: Date | null;
      profiles?: Array<{
        identifier: string;
        displayName?: string;
        payloadType?: string;
        payloadUuid?: string;
        managed: boolean;
      }>;
    } = {},
  ) => {
    const now = new Date();
    db.store.device_apple_user.push({
      deviceId: id,
      userId: overrides.userId ?? "user-1",
      userShortName: "oscar",
      userLongName: "Oscar Beaumont",
      token: overrides.token === null ? null : (overrides.token ?? "user-1-token"),
      pushMagic: overrides.token === null ? null : "user-1-magic",
      topic: "com.apple.mgmt.External.acme",
      authenticatedAt: overrides.authenticatedAt === undefined ? now : overrides.authenticatedAt,
      lastSeenAt: now,
      profiles: overrides.profiles ?? [],
      consecutivePushFailures: 0,
      updatedAt: now,
    });
  };

  it("generates a CSR plist and stores a pending key", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const result = await runEffect(service.getApnsCsr(request(headers), tenant.id));
    const xml = atob(result.plist);
    expect(xml).toContain("PushCertRequestCSR");
    expect(xml).toContain("PushCertCertificateChain");

    expect(db.store.apple_push_key).toHaveLength(1);
    expect(db.store.apple_push_key[0].organizationId).toBe(tenant.id);
    expect(db.store.apple_push_key[0].encryptedPrivateKeyJwk).not.toContain('"d"');
  });

  it("validates an uploaded certificate against the pending key", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const keys = await generateApnsKeyPair();
    const jwk = await exportPrivateKeyJwk(keys.privateKey);
    db.store.apple_push_key.push({
      organizationId: tenant.id,
      encryptedPrivateKeyJwk: await sealSecret(authSecret, JSON.stringify(jwk)),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const pem = await testCertificate({ keyPair: keys });

    await runEffect(
      service.uploadApns(request(headers), tenant.id, {
        email: "admin@example.com",
        cert: pem,
      }),
    );

    expect(db.store.apple_push_certificate).toMatchObject([
      {
        organizationId: tenant.id,
        email: "admin@example.com",
        topic: "com.apple.mgmt.External.acme",
      },
    ]);
    expect(db.store.apple_push_certificate[0].encryptedKey).toBeTruthy();
    expect(db.store.apple_push_key).toHaveLength(0);

    const info = await runEffect(service.getApns(request(headers), tenant.id));
    expect(info).toMatchObject({
      configured: true,
      topic: "com.apple.mgmt.External.acme",
      commonName: "Acme APNs",
      keyConfigured: true,
      keyMatchesCertificate: true,
      topicMatchesCertificate: true,
      renewalUrl: "https://identity.apple.com/pushcert/",
    });
    expect(info.expiresAt).toBeTruthy();
    expect(info.daysLeft).toBeGreaterThan(0);
  });

  it("rejects invalid and mismatched certificates", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    await expect(
      runEffect(
        service.uploadApns(request(headers), tenant.id, {
          email: "admin@example.com",
          cert: "not a certificate",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    const expired = await generateApnsKeyPair();

    const expiredPem = await testCertificate({
      keyPair: expired,
      notBefore: new Date(Date.now() - 10 * 86_400_000),
      notAfter: new Date(Date.now() - 86_400_000),
    });

    await expect(
      runEffect(
        service.uploadApns(request(headers), tenant.id, {
          email: "admin@example.com",
          cert: expiredPem,
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    // A pending key exists, so a certificate for a different key is rejected.
    const pending = await sealedJwk();
    db.store.apple_push_key.push({
      organizationId: tenant.id,
      encryptedPrivateKeyJwk: pending.encrypted,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const other = await generateApnsKeyPair();
    const otherPem = await testCertificate({ keyPair: other });
    await expect(
      runEffect(
        service.uploadApns(request(headers), tenant.id, {
          email: "admin@example.com",
          cert: otherPem,
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
  });

  it("pushes on device action and unenroll", async () => {
    const { apns, pushes } = makeFakeApns();
    const { db, service, headers } = await makeContext({ apns });

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    await seedCertificate(db, tenant.id);
    await seedDevice(db, tenant.id, "device-1");

    await runEffect(service.deviceAction(request(headers), tenant.id, "device-1", {}));
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({
      pushToken: "device-1-token",
      pushMagic: "device-1-magic",
      topic: "com.apple.mgmt.External.acme",
    });

    // A device that is not enrolled must not be pushed, and the action must
    // fail rather than claim success for a command that was never queued.
    await seedDevice(db, tenant.id, "device-2", { status: "unenrolled" });
    await expect(
      runEffect(service.deviceAction(request(headers), tenant.id, "device-2", {})),
    ).rejects.toMatchObject({
      message: "This action is only available while the device is enrolled.",
    });
    expect(pushes).toHaveLength(1);

    await runEffect(service.deviceUnenroll(request(headers), tenant.id, "device-1"));
    expect(db.store.device.find((item: any) => item.id === "device-1")?.status).toBe("unenrolling");
    expect(pushes).toHaveLength(2);
  });

  const seedAndroidDevice = (
    db: any,
    organizationId: string,
    overrides: {
      id?: string;
      status?: string;
      managementMode?: string | null;
      ownership?: string | null;
    } = {},
  ) => {
    const now = new Date();
    const id = overrides.id ?? "device-android";
    const enterpriseName = "enterprises/LC123";
    const dmIdentifier = `${enterpriseName}/devices/${id}`;

    db.store.android_enterprise.push({
      organizationId,
      enterpriseName,
      signupUrl: null,
      signupState: null,
      pubsubTopic: null,
      pubsubSubscription: null,
      serviceAccountEmail: null,
      status: "active",
      lastError: null,
      lastSyncedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    db.store.device.push({
      id,
      organizationId,
      proto: "android",
      status: overrides.status ?? "enrolled",
      name: "Pixel",
      dmIdentifier,
      enrolledAt: now,
      lastSeenAt: now,
    });
    db.store.android_device.push({
      deviceId: id,
      organizationId,
      enterpriseName,
      deviceName: dmIdentifier,
      managementMode: overrides.managementMode ?? "DEVICE_OWNER",
      ownership: overrides.ownership ?? "COMPANY_OWNED",
      state: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    });

    return { id, enterpriseName, deviceName: dmIdentifier };
  };

  // SAFETY: the service only checks that Android delivery is configured; every
  // outbound Google call goes through the injected fake below.
  const androidConfig = {} as NonNullable<Parameters<typeof createEnterpriseService>[0]["android"]>;

  const makeAndroidDeleteService = (
    deleteDevice: (input: { deviceName: string }) => Effect.Effect<void, GoogleApiError>,
  ) => {
    // SAFETY: the unenroll path only calls `deleteDevice`; the fake omits the
    // rest of the AndroidManagementService surface.
    return AndroidManagement.of({ deleteDevice } as any);
  };

  it("unenrolls an Android device by deleting the Google resource", async () => {
    const { db, service, headers } = await makeContext({ android: androidConfig });

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const androidDevice = seedAndroidDevice(db, tenant.id);

    db.store.device_command.push({
      id: "command-1",
      organizationId: tenant.id,
      deviceId: androidDevice.id,
      requestType: "AndroidWipe",
      payload: { type: "WIPE" },
      status: "sent",
      dedupeKey: "dedupe-1",
      expiresAt: null,
      resultStatus: null,
      resultDetail: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const deleted: Array<string> = [];

    const android = makeAndroidDeleteService((input) => {
      deleted.push(input.deviceName);

      return Effect.void;
    });

    await runEffect(
      service
        .deviceUnenroll(request(headers), tenant.id, androidDevice.id)
        .pipe(Effect.provideService(AndroidManagement, android)),
    );

    expect(deleted).toEqual([androidDevice.deviceName]);
    expect(db.store.device.find((item: any) => item.id === androidDevice.id)?.status).toBe(
      "unenrolled",
    );
    expect(db.store.device_command.find((item: any) => item.id === "command-1")?.status).toBe(
      "cancelled",
    );
    expect(db.store.audit_log).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "device.unenrolled",
          targetId: androidDevice.id,
          metadata: expect.objectContaining({ platform: "android", revokedCertificates: 0 }),
        }),
      ]),
    );
  });

  it("maps Android delete failures without moving the device", async () => {
    const { db, service, headers } = await makeContext({ android: androidConfig });

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const androidDevice = seedAndroidDevice(db, tenant.id);

    const android = makeAndroidDeleteService(() =>
      Effect.fail(new GoogleApiError({ message: "Google is unavailable", status: 503 })),
    );

    await expect(
      runEffect(
        service
          .deviceUnenroll(request(headers), tenant.id, androidDevice.id)
          .pipe(Effect.provideService(AndroidManagement, android)),
      ),
    ).rejects.toBeInstanceOf(EnterpriseUpstreamError);

    expect(db.store.device.find((item: any) => item.id === androidDevice.id)?.status).toBe(
      "enrolled",
    );
  });

  it("records a new provisioning mode for future enrollments", async () => {
    const { db, service, headers } = await makeContext({ android: androidConfig });

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    seedAndroidDevice(db, tenant.id);

    await runEffect(
      service.patchTenantAndroid(request(headers), tenant.id, {
        provisioningMode: "fully-managed",
      }),
    );

    expect(db.store.android_enterprise[0]).toMatchObject({ provisioningMode: "fully-managed" });
    expect(db.store.audit_log).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "android.provisioning_mode_changed",
          metadata: expect.objectContaining({ mode: "fully-managed" }),
        }),
      ]),
    );
  });

  it("disconnects Android Enterprise and retires its devices", async () => {
    const { db, service, headers } = await makeContext({ android: androidConfig });

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const androidDevice = seedAndroidDevice(db, tenant.id);
    const deleted: string[] = [];

    // SAFETY: the disconnect path only calls `deleteEnterprise`; the fake omits
    // the rest of the AndroidManagementService surface.
    const android = AndroidManagement.of({
      deleteEnterprise: (input: { enterpriseName: string }) => {
        deleted.push(input.enterpriseName);

        return Effect.void;
      },
    } as any);

    await runEffect(
      service
        .patchTenantAndroid(request(headers), tenant.id, { disconnect: true })
        .pipe(Effect.provideService(AndroidManagement, android)),
    );

    expect(deleted).toEqual([androidDevice.enterpriseName]);
    expect(db.store.android_enterprise).toHaveLength(0);
    expect(db.store.device.find((item: any) => item.id === androidDevice.id)?.status).toBe(
      "unenrolled",
    );
    expect(db.store.audit_log).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "android.enterprise_disconnected" }),
      ]),
    );
  });

  it("deprovisions Google before deleting Android device rows", async () => {
    const { db, service, headers } = await makeContext({ android: androidConfig });

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const androidDevice = seedAndroidDevice(db, tenant.id);
    const deleted: string[] = [];

    const android = makeAndroidDeleteService((input) => {
      deleted.push(input.deviceName);

      return Effect.void;
    });

    await runEffect(
      service
        .deleteDevices(request(headers), tenant.id, [androidDevice.id])
        .pipe(Effect.provideService(AndroidManagement, android)),
    );

    expect(deleted).toEqual([androidDevice.deviceName]);
    expect(db.store.device.find((item: any) => item.id === androidDevice.id)).toBeUndefined();
  });

  it("keeps an Android device row when Google refuses to delete it", async () => {
    const { db, service, headers } = await makeContext({ android: androidConfig });

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const androidDevice = seedAndroidDevice(db, tenant.id);

    const android = makeAndroidDeleteService(() =>
      Effect.fail(new GoogleApiError({ message: "Google is unavailable", status: 503 })),
    );

    await expect(
      runEffect(
        service
          .deleteDevices(request(headers), tenant.id, [androidDevice.id])
          .pipe(Effect.provideService(AndroidManagement, android)),
      ),
    ).rejects.toBeInstanceOf(EnterpriseConflict);

    // The row survives: deleting it would leave Google managing a device the
    // dashboard no longer knows about.
    expect(db.store.device.find((item: any) => item.id === androidDevice.id)).toBeDefined();
  });

  it("requires step-up before disconnecting Android Enterprise", async () => {
    const actions: Array<string> = [];

    const { db, service, headers } = await makeContext({
      android: androidConfig,
      auth: {
        requireStepUp: (_request: any, action: any) => {
          actions.push(String(action));

          return Effect.fail(
            new StepUpRequired({
              message: "Confirm this action with your authenticator or passkey.",
              action,
              methods: ["passkey", "totp"],
            }),
          );
        },
      },
    });

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    seedAndroidDevice(db, tenant.id);

    await expect(
      runEffect(service.patchTenantAndroid(request(headers), tenant.id, { disconnect: true })),
    ).rejects.toBeInstanceOf(StepUpRequired);

    expect(actions).toEqual(["android-disconnect"]);
    expect(db.store.android_enterprise).toHaveLength(1);
  });

  it("requires step-up before deleting an Android device", async () => {
    const { db, service, headers } = await makeContext({
      android: androidConfig,
      auth: {
        requireStepUp: (_request: any, action: any) =>
          Effect.fail(
            new StepUpRequired({
              message: "Confirm this action with your authenticator or passkey.",
              action,
              methods: ["passkey", "totp"],
            }),
          ),
      },
    });

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const androidDevice = seedAndroidDevice(db, tenant.id);

    const deleted: Array<string> = [];

    const android = makeAndroidDeleteService((input) => {
      deleted.push(input.deviceName);

      return Effect.void;
    });

    await expect(
      runEffect(
        service
          .deviceUnenroll(request(headers), tenant.id, androidDevice.id)
          .pipe(Effect.provideService(AndroidManagement, android)),
      ),
    ).rejects.toBeInstanceOf(StepUpRequired);

    expect(deleted).toEqual([]);
    expect(db.store.device.find((item: any) => item.id === androidDevice.id)?.status).toBe(
      "enrolled",
    );
  });

  it("refuses Android password resets for personally-owned work profiles", async () => {
    const { db, service, headers } = await makeContext({ android: androidConfig });

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const androidDevice = seedAndroidDevice(db, tenant.id, {
      managementMode: "PROFILE_OWNER",
      ownership: "PERSONALLY_OWNED",
    });

    await expect(
      runEffect(
        service.deviceAction(request(headers), tenant.id, androidDevice.id, {
          action: "reset-password",
        }),
      ),
    ).rejects.toMatchObject({
      message: "Android only permits password resets on company-owned devices.",
    });

    expect(db.store.device_command).toHaveLength(0);

    // The device page uses the same capability model, so it must not offer the
    // action the handler would reject.
    const detail = await runEffect(
      service.getDevice(request(headers), tenant.id, androidDevice.id),
    );

    expect(detail.actions).not.toContain("reset-password");
    expect(detail.actions).not.toContain("relinquish-ownership");
    expect(detail.actions).toContain("lock");
  });

  it("lists Apple user channels for a device", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    await seedDevice(db, tenant.id, "device-1");
    db.store.device_apple[0].enrollmentMode = "user";
    seedAppleUser(db, "device-1", {
      profiles: [
        {
          identifier: "com.acme.wifi",
          displayName: "Acme Wi-Fi",
          payloadType: "Configuration",
          payloadUuid: "uuid-1",
          managed: true,
        },
      ],
    });

    const result = await runEffect(
      service.listDeviceAppleUsers(request(headers), tenant.id, "device-1"),
    );

    expect(result.enrollmentMode).toBe("user");
    expect(result.users).toMatchObject([
      {
        platformUserId: "user-1",
        shortName: "oscar",
        longName: "Oscar Beaumont",
        binding: "authenticated",
        configured: true,
        push: { configured: true, consecutiveFailures: 0 },
        profiles: [{ identifier: "com.acme.wifi", displayName: "Acme Wi-Fi", managed: true }],
      },
    ]);
    expect(result.users[0].actions).toEqual(["sync", "refresh-profiles"]);

    // Another tenant cannot read this device's users.
    const other = await runEffect(
      service.createTenant(request(headers), { name: "Other", slug: "other" }),
    );

    await expect(
      runEffect(service.listDeviceAppleUsers(request(headers), other.id, "device-1")),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);
  });

  it("binds an Apple user channel to a directory identity", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    await seedDevice(db, tenant.id, "device-1");
    db.store.user.push({
      id: "dir-1",
      organizationId: tenant.id,
      name: "dir-1",
      email: "dir-1@example.com",
      disabled: false,
      source: "manual",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    seedAppleUser(db, "device-1");

    await runEffect(
      service.bindAppleUserIdentity(request(headers), tenant.id, "device-1", "user-1", {
        userId: "dir-1",
      }),
    );

    const bound = await runEffect(
      service.listDeviceAppleUsers(request(headers), tenant.id, "device-1"),
    );

    expect(bound.users[0].identity).toMatchObject({
      userId: "dir-1",
      name: "dir-1",
      email: "dir-1@example.com",
      source: "manual",
    });

    await runEffect(
      service.unbindAppleUserIdentity(request(headers), tenant.id, "device-1", "user-1"),
    );

    const unbound = await runEffect(
      service.listDeviceAppleUsers(request(headers), tenant.id, "device-1"),
    );

    expect(unbound.users[0].identity).toBeNull();
  });

  it("rejects a directory user from another tenant", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const other = await runEffect(
      service.createTenant(request(headers), { name: "Other", slug: "other" }),
    );

    await seedDevice(db, tenant.id, "device-1");
    db.store.user.push({
      id: "other-user",
      organizationId: other.id,
      name: "other-user",
      email: "other-user@example.com",
      disabled: false,
      source: "manual",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    seedAppleUser(db, "device-1");

    await expect(
      runEffect(
        service.bindAppleUserIdentity(request(headers), tenant.id, "device-1", "user-1", {
          userId: "other-user",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
  });

  it("wakes a user channel and queues a per-user profile refresh", async () => {
    const { apns, pushes } = makeFakeApns();
    const { db, service, headers } = await makeContext({ apns });

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    await seedCertificate(db, tenant.id);
    await seedDevice(db, tenant.id, "device-1");
    seedAppleUser(db, "device-1");

    await runEffect(
      service.deviceAppleUserAction(request(headers), tenant.id, "device-1", "user-1", {
        action: "sync",
      }),
    );

    expect(pushes.at(-1)).toMatchObject({
      pushToken: "user-1-token",
      pushMagic: "user-1-magic",
      topic: "com.apple.mgmt.External.acme",
    });

    const queued = await runEffect(
      service.deviceAppleUserAction(request(headers), tenant.id, "device-1", "user-1", {
        action: "refresh-profiles",
      }),
    );

    expect(queued.commandId).toBeTruthy();
    expect(pushes).toHaveLength(2);
    expect(db.store.device_command.at(-1)).toMatchObject({
      deviceId: "device-1",
      userId: "user-1",
      requestType: "ProfileList",
      status: "queued",
    });

    // De-duplicated while the first refresh is still in flight.
    const duplicate = await runEffect(
      service.deviceAppleUserAction(request(headers), tenant.id, "device-1", "user-1", {
        action: "refresh-profiles",
      }),
    );

    expect(duplicate).toMatchObject({ status: "ok", deduplicated: true });
    expect(db.store.device_command).toHaveLength(1);
  });

  it("refuses per-user actions for unknown users, other tenants and unenrolled devices", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    await seedDevice(db, tenant.id, "device-1");
    seedAppleUser(db, "device-1");

    await expect(
      runEffect(
        service.deviceAppleUserAction(request(headers), tenant.id, "device-1", "missing", {
          action: "sync",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);

    const other = await runEffect(
      service.createTenant(request(headers), { name: "Other", slug: "other" }),
    );

    await expect(
      runEffect(
        service.deviceAppleUserAction(request(headers), other.id, "device-1", "user-1", {
          action: "sync",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);

    await seedDevice(db, tenant.id, "device-2", { status: "unenrolled" });
    seedAppleUser(db, "device-2");

    await expect(
      runEffect(
        service.deviceAppleUserAction(request(headers), tenant.id, "device-2", "user-1", {
          action: "refresh-profiles",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
  });

  it("does not wake a user channel without push credentials", async () => {
    const { apns, pushes } = makeFakeApns();
    const { db, service, headers } = await makeContext({ apns });

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    await seedCertificate(db, tenant.id);
    await seedDevice(db, tenant.id, "device-1");
    seedAppleUser(db, "device-1", { token: null, authenticatedAt: null });

    const listed = await runEffect(
      service.listDeviceAppleUsers(request(headers), tenant.id, "device-1"),
    );

    expect(listed.users[0]).toMatchObject({
      configured: false,
      binding: "unbound",
      actions: ["refresh-profiles"],
    });

    await expect(
      runEffect(
        service.deviceAppleUserAction(request(headers), tenant.id, "device-1", "user-1", {
          action: "sync",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
    expect(pushes).toHaveLength(0);
  });

  it("revokes device-scoped SCEP identities when unenrolling", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    await seedCertificate(db, tenant.id);
    await seedDevice(db, tenant.id, "device-1");

    const otherTenant = await runEffect(
      service.createTenant(request(headers), { name: "Other", slug: "other" }),
    );

    const future = new Date(Date.now() + 86_400_000);
    db.store.scep_issued_certificate.push(
      {
        serial: "serial-1",
        organizationId: tenant.id,
        enrollmentId: null,
        deviceId: "device-1",
        notAfter: future,
        revokedAt: null,
        createdAt: new Date(),
      },
      {
        serial: "serial-other",
        organizationId: otherTenant.id,
        enrollmentId: null,
        deviceId: "device-1",
        notAfter: future,
        revokedAt: null,
        createdAt: new Date(),
      },
    );

    await runEffect(service.deviceUnenroll(request(headers), tenant.id, "device-1"));
    const revoked = db.store.scep_issued_certificate.find((row: any) => row.serial === "serial-1");
    expect(revoked?.revokedAt).toBeInstanceOf(Date);
    // Tenant scoping: the same device id in another tenant is untouched.
    expect(
      db.store.scep_issued_certificate.find((row: any) => row.serial === "serial-other")?.revokedAt,
    ).toBeNull();
    expect(db.store.audit_log.at(-1)).toMatchObject({
      action: "device.unenrolled",
      metadata: { revokedCertificates: 1 },
    });
  });

  it("revokes device-scoped SCEP identities when deleting a device", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    await seedDevice(db, tenant.id, "device-1");
    db.store.scep_issued_certificate.push({
      serial: "serial-1",
      organizationId: tenant.id,
      enrollmentId: null,
      deviceId: "device-1",
      notAfter: new Date(Date.now() + 86_400_000),
      revokedAt: null,
      createdAt: new Date(),
    });

    await runEffect(service.deleteDevices(request(headers), tenant.id, ["device-1"]));
    expect(db.store.scep_issued_certificate[0].revokedAt).toBeInstanceOf(Date);
    expect(db.store.device).toHaveLength(0);
  });

  it("supports an explicit identity revocation action", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    await seedDevice(db, tenant.id, "device-1");
    db.store.scep_issued_certificate.push({
      serial: "serial-1",
      organizationId: tenant.id,
      enrollmentId: null,
      deviceId: "device-1",
      notAfter: new Date(Date.now() + 86_400_000),
      revokedAt: null,
      createdAt: new Date(),
    });

    const result = await runEffect(
      service.revokeDeviceIdentity(request(headers), tenant.id, "device-1"),
    );

    expect(result).toEqual({ status: "ok", revoked: 1 });
    expect(db.store.audit_log.at(-1)).toMatchObject({
      action: "device.identity_revoked",
      targetType: "device",
      targetId: "device-1",
      metadata: { revokedCertificates: 1 },
    });

    // Repeating the action is safe and reports nothing left to revoke.
    await expect(
      runEffect(service.revokeDeviceIdentity(request(headers), tenant.id, "device-1")),
    ).resolves.toEqual({ status: "ok", revoked: 0 });

    await expect(
      runEffect(service.revokeDeviceIdentity(request(headers), tenant.id, "missing")),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);
  });

  it("rejects identity revocation when no certificates are recorded", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    await seedDevice(db, tenant.id, "device-1");
    await expect(
      runEffect(service.revokeDeviceIdentity(request(headers), tenant.id, "device-1")),
    ).rejects.toBeInstanceOf(EnterpriseConflict);
  });

  it("links Windows enrollment certificates to the internal device id end to end", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const enrollment = db.store.enterprise_enrollment.find(
      (row: any) => row.organizationId === tenant.id,
    )!;

    enrollment.enabledWindows = true;
    enrollment.maxDevices = 100;

    const caKeys = await generateCaKeyPair();
    db.store.scep_ca.push({
      id: 1,
      certPem: await testCertificate({ keyPair: caKeys }),
      privateKeyJwk: await exportPrivateKeyJwk(caKeys.privateKey),
      createdAt: new Date(),
    });

    const windows = makeWindowsBackend({
      db,
      origin,
      authSecret,
      windowsOrganizationId: tenant.id,
    });

    const policy = await runEffect(windows.getWindowsEnrollmentPolicy(""));

    // SAFETY: enrollment only reads `url` off the MDM origin; the remaining
    // origin fields belong to the full Windows management backend.
    const result = await runEffect(
      windows.windowsEnroll({
        authToken: policy.authToken,
        csr: await makeCsr(),
        deviceId: "windows-device-1",
        deviceName: "DESKTOP-TEST",
        enrollmentType: "Full",
        context: { DeviceID: "windows-device-1", DeviceName: "DESKTOP-TEST" },
        mdmOrigin: { url: origin } as any,
      }),
    );

    expect(result.deviceId).toBe("windows-device-1");

    const device = db.store.device.find((row: any) => row.organizationId === tenant.id)!;
    expect(device).toMatchObject({ proto: "win", dmIdentifier: "windows-device-1" });
    // The Windows DeviceID and the internal row id are unrelated.
    expect(device.id).not.toBe(device.dmIdentifier);

    const certificate = db.store.scep_issued_certificate[0]!;
    expect(certificate.deviceId).toBe(device.id);
    expect(certificate.deviceId).not.toBe(device.dmIdentifier);
    expect(certificate.serial).toMatch(/^[0-9a-f]+$/);

    const scep = ScepRepositoryLive.make(db, { authSecret });
    // Renewal resolves through the internal id before revocation.
    await expect(
      Effect.runPromise(
        scep.findIssuedCertificate!({ organizationId: tenant.id }, certificate.serial),
      ),
    ).resolves.toMatchObject({ deviceId: device.id, organizationId: tenant.id });

    const revoked = await runEffect(
      service.revokeDeviceIdentity(request(headers), tenant.id, device.id),
    );

    expect(revoked).toEqual({ status: "ok", revoked: 1 });
    expect(certificate.revokedAt).toBeInstanceOf(Date);

    // The renewed identity can no longer be used to renew.
    const lookup = Effect.runPromise(
      scep.findIssuedCertificate!({ organizationId: tenant.id }, certificate.serial),
    );

    await expect(lookup).rejects.toHaveProperty("_tag", "ScepError");
    await expect(lookup).rejects.toMatchObject({ message: expect.stringContaining("revoked") });

    // Health surfaces the (now revoked) certificate for the device.
    const health = await runEffect(service.getDeviceHealth(request(headers), tenant.id, device.id));
    expect(health.certificates).toHaveLength(1);
    expect(health.certificates[0]).toMatchObject({
      serial: certificate.serial,
      revokedAt: expect.any(String),
    });
  });

  it("revokes legacy dmIdentifier-linked certificates when deleting a device", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    await seedDevice(db, tenant.id, "device-1");
    // Legacy Windows issuance recorded the DeviceID (dmIdentifier) instead of
    // the internal row id.
    db.store.scep_issued_certificate.push({
      serial: "legacy-serial",
      organizationId: tenant.id,
      enrollmentId: null,
      deviceId: "dm-device-1",
      notAfter: new Date(Date.now() + 86_400_000),
      revokedAt: null,
      createdAt: new Date(),
    });

    await runEffect(service.deleteDevices(request(headers), tenant.id, ["device-1"]));
    const certificate = db.store.scep_issued_certificate[0]!;
    expect(certificate.revokedAt).toBeInstanceOf(Date);

    const scep = ScepRepositoryLive.make(db, { authSecret });

    const legacy = Effect.runPromise(
      scep.findIssuedCertificate!({ organizationId: tenant.id }, "legacy-serial"),
    );

    await expect(legacy).rejects.toHaveProperty("_tag", "ScepError");
    await expect(legacy).rejects.toMatchObject({ message: expect.stringContaining("revoked") });
  });

  it("derives device health and tenant-level counts", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    await seedDevice(db, tenant.id, "device-1");
    await seedDevice(db, tenant.id, "device-2");
    db.store.device[1].lastSeenAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    db.store.device_declaration.push({
      deviceId: "device-1",
      identifier: "com.acme.wifi",
      declarationType: "configurations",
      active: true,
      valid: "invalid",
      serverToken: null,
      reasons: [{ code: "Error", description: "Invalid payload" }],
      updatedAt: new Date(),
    });

    const detail = await runEffect(
      service.getDeviceHealth(request(headers), tenant.id, "device-1"),
    );

    expect(detail.health).toMatchObject({ level: "attention", stale: false });
    expect(detail.health.reasons).toContainEqual(
      expect.objectContaining({ code: "declaration_invalid" }),
    );
    expect(detail.declarations).toHaveLength(1);

    const summary = await runEffect(service.getDeviceHealthSummary(request(headers), tenant.id));
    expect(summary.counts).toEqual({
      total: 2,
      healthy: 0,
      attention: 2,
      critical: 0,
      missing: 0,
      stale: 1,
      unknown: 0,
    });
    expect(summary.reasons.map((group) => group.code)).toContain("declaration_invalid");
    expect(summary.devices).toHaveLength(2);
    expect(summary.devices[0]).toMatchObject({ level: "attention" });

    // The list filter must return exactly the devices the cards count.
    const attention = await runEffect(
      service.searchDevices(request(headers), tenant.id, { health: "attention" }),
    );

    expect(attention.total).toBe(summary.counts.attention);
    expect(attention.devices.map((row: any) => row.id).sort()).toEqual(["device-1", "device-2"]);

    const stale = await runEffect(
      service.searchDevices(request(headers), tenant.id, { health: "stale" }),
    );

    expect(stale.total).toBe(summary.counts.stale);
    expect(stale.devices.map((row: any) => row.id)).toEqual(["device-2"]);

    const healthy = await runEffect(
      service.searchDevices(request(headers), tenant.id, { health: "healthy" }),
    );

    expect(healthy.total).toBe(summary.counts.healthy);
    expect(healthy.devices).toHaveLength(0);

    // The list column carries the same rollup as the filter and the summary.
    expect(attention.devices.every((row: any) => row.health.level === "attention")).toBe(true);
    expect(attention.devices[0].health.reasons).toContainEqual(
      expect.objectContaining({ code: "declaration_invalid" }),
    );

    // A healthy device sorts after the two attention devices ascending (worst
    // first) and before them descending.
    await seedDevice(db, tenant.id, "device-3");

    const worstFirst = await runEffect(
      service.searchDevices(request(headers), tenant.id, { sort: "health" }),
    );

    expect(worstFirst.devices.map((row: any) => row.health.level)).toEqual([
      "attention",
      "attention",
      "healthy",
    ]);

    const healthiestFirst = await runEffect(
      service.searchDevices(request(headers), tenant.id, { sort: "health", direction: "desc" }),
    );

    expect(healthiestFirst.devices.map((row: any) => row.health.level)).toEqual([
      "healthy",
      "attention",
      "attention",
    ]);

    // MIA is a distinct level between stale and the auto-unenrol sweep.
    db.store.device[1].lastSeenAt = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);

    const miaSummary = await runEffect(service.getDeviceHealthSummary(request(headers), tenant.id));

    expect(miaSummary.counts).toMatchObject({ attention: 1, missing: 1, stale: 1 });
    expect(miaSummary.devices[0]).toMatchObject({ id: "device-2", level: "missing" });

    const mia = await runEffect(
      service.searchDevices(request(headers), tenant.id, { health: "missing" }),
    );

    expect(mia.total).toBe(miaSummary.counts.missing);
    expect(mia.devices.map((row: any) => row.id)).toEqual(["device-2"]);
    expect(mia.devices[0].health.reasons).toContainEqual(
      expect.objectContaining({ code: "missing" }),
    );

    // `stale` remains the broader filter and includes the MIA device.
    const stillStale = await runEffect(
      service.searchDevices(request(headers), tenant.id, { health: "stale" }),
    );

    expect(stillStale.devices.map((row: any) => row.id)).toEqual(["device-2"]);

    await expect(
      runEffect(service.getDeviceHealth(request(headers), tenant.id, "missing")),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);
  });

  it("pushes enrolled Apple devices when groups sync", async () => {
    const { apns, pushes } = makeFakeApns();
    const { db, service, headers } = await makeContext({ apns });

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    await seedCertificate(db, tenant.id);
    await seedDevice(db, tenant.id, "device-1");
    await seedDevice(db, tenant.id, "device-2", { proto: "win" });

    const group = await runEffect(
      service.createGroup(request(headers), tenant.id, {
        name: "Engineering",
        devices: ["device-1", "device-2"],
      }),
    );

    await runEffect(service.syncGroups(request(headers), tenant.id, [group.id, group.id]));
    expect(pushes.map((push) => push.pushToken)).toEqual(["device-1-token"]);
  });

  it("pushes enrolled Apple devices when policies sync or change", async () => {
    const { apns, pushes } = makeFakeApns();
    const { db, service, headers } = await makeContext({ apns });

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    await seedCertificate(db, tenant.id);
    await seedDevice(db, tenant.id, "device-1");

    const policy = await runEffect(
      service.createPolicy(request(headers), tenant.id, { name: "Baseline" }),
    );

    await runEffect(
      service.createGroup(request(headers), tenant.id, {
        name: "Engineering",
        devices: ["device-1"],
        policies: [policy.id],
      }),
    );

    await runEffect(service.syncPolicies(request(headers), tenant.id, [policy.id, policy.id]));
    expect(pushes).toHaveLength(1);

    await runEffect(
      service.patchPolicy(request(headers), tenant.id, policy.id, {
        configurations: { "mttx.apple.device": { camera: true } },
      }),
    );
    expect(pushes).toHaveLength(2);

    await runEffect(service.deletePolicies(request(headers), tenant.id, [policy.id]));
    expect(pushes).toHaveLength(3);
  });

  it("pushes devices affected by group membership and group deletion", async () => {
    const { apns, pushes } = makeFakeApns();
    const { db, service, headers } = await makeContext({ apns });

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    await seedCertificate(db, tenant.id);
    await seedDevice(db, tenant.id, "device-1");
    await seedDevice(db, tenant.id, "device-2");

    const policy = await runEffect(
      service.createPolicy(request(headers), tenant.id, { name: "Baseline" }),
    );

    const group = await runEffect(
      service.createGroup(request(headers), tenant.id, {
        name: "Engineering",
        devices: ["device-1"],
      }),
    );

    await runEffect(
      service.patchGroupMembers(request(headers), tenant.id, group.id, {
        assign: { devices: ["device-2"], policies: [policy.id] },
      }),
    );
    expect(pushes.map((push) => push.pushToken).sort()).toEqual([
      "device-1-token",
      "device-2-token",
    ]);

    const beforeDelete = pushes.length;
    await runEffect(service.deleteGroups(request(headers), tenant.id, [group.id]));
    expect(pushes.length).toBe(beforeDelete + 2);
  });

  it("records APNs outcomes, classifies invalid tokens and resets failures", async () => {
    let mode: "ok" | "fail" | "invalid" = "ok";

    const apns = makeApnsService({
      name: "fake",
      available: true,
      push: () =>
        mode === "ok"
          ? Effect.void
          : Effect.fail(
              new ApnsError({
                message:
                  mode === "invalid"
                    ? 'APNs rejected push (HTTP 410): {"reason":"Unregistered"}'
                    : "APNs request failed: temporary",
              }),
            ),
    });

    const { db, service, headers } = await makeContext({ apns });

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    await seedCertificate(db, tenant.id);
    await seedDevice(db, tenant.id, "device-1");
    const apple = () => db.store.device_apple.find((row: any) => row.deviceId === "device-1")!;

    await runEffect(service.deviceAction(request(headers), tenant.id, "device-1", {}));
    expect(apple().lastPushAt).toBeInstanceOf(Date);
    expect(apple().lastPushOkAt).toBeInstanceOf(Date);
    expect(apple().lastPushError).toBeNull();
    expect(apple().lastPushErrorCode).toBeNull();
    expect(apple().consecutivePushFailures).toBe(0);
    const firstSuccess = apple().lastPushOkAt;

    mode = "fail";
    await runEffect(service.deviceAction(request(headers), tenant.id, "device-1", {}));
    expect(apple().lastPushOkAt).toEqual(firstSuccess);
    expect(apple().consecutivePushFailures).toBe(1);
    expect(apple().lastPushErrorCode).toBe("delivery_failed");
    expect(apple().lastPushError).toContain("temporary");

    mode = "ok";
    await runEffect(service.deviceAction(request(headers), tenant.id, "device-1", {}));
    expect(apple().consecutivePushFailures).toBe(0);
    expect(apple().lastPushError).toBeNull();
    expect(apple().lastPushErrorCode).toBeNull();
    expect(apple().lastPushOkAt.getTime()).toBeGreaterThanOrEqual(firstSuccess.getTime());

    mode = "invalid";
    await runEffect(service.deviceAction(request(headers), tenant.id, "device-1", {}));
    expect(apple().lastPushErrorCode).toBe("invalid_token");
    expect(apple().consecutivePushFailures).toBe(1);
    expect(apple().lastPushError).toContain("Unregistered");

    const health = await runEffect(
      service.getDeviceHealth(request(headers), tenant.id, "device-1"),
    );

    expect(health.push).toMatchObject({
      configured: true,
      invalidToken: true,
      consecutiveFailures: 1,
      lastErrorCode: "invalid_token",
    });
  });

  it("reports tenant-scoped push health and filters failing devices", async () => {
    let rejectDeviceOne = true;

    const apns = makeApnsService({
      name: "fake",
      available: true,
      push: (input) =>
        input.pushToken === "device-1-token" && rejectDeviceOne
          ? Effect.fail(
              new ApnsError({
                message: 'APNs rejected push (HTTP 410): {"reason":"Unregistered"}',
              }),
            )
          : Effect.void,
    });

    const { db, service, headers } = await makeContext({ apns });

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    await seedCertificate(db, tenant.id);
    await seedDevice(db, tenant.id, "device-1");
    await seedDevice(db, tenant.id, "device-2");

    const other = await runEffect(
      service.createTenant(request(headers), { name: "Other", slug: "other" }),
    );

    await seedCertificate(db, other.id);
    await seedDevice(db, other.id, "device-other");

    await runEffect(service.deviceAction(request(headers), tenant.id, "device-1", {}));
    await runEffect(service.deviceAction(request(headers), tenant.id, "device-2", {}));
    await runEffect(service.deviceAction(request(headers), other.id, "device-other", {}));

    const health = await runEffect(service.getDevicePushHealth(request(headers), tenant.id));
    expect(health.counts).toEqual({
      configured: 2,
      attempted: 2,
      succeeded: 1,
      failing: 1,
      invalidToken: 1,
    });
    // The other tenant's failing device is not part of this rollup.
    expect(health.recentFailures.map((failure) => failure.deviceId)).toEqual(["device-1"]);

    const failing = await runEffect(
      service.searchDevices(request(headers), tenant.id, { push: "failing" }),
    );

    expect(failing.devices.map((device) => device.id)).toEqual(["device-1"]);

    const invalid = await runEffect(
      service.searchDevices(request(headers), tenant.id, { push: "invalid" }),
    );

    expect(invalid.devices.map((device) => device.id)).toEqual(["device-1"]);

    // Recovery removes the device from both filters.
    rejectDeviceOne = false;
    await runEffect(service.deviceAction(request(headers), tenant.id, "device-1", {}));

    const none = await runEffect(
      service.searchDevices(request(headers), tenant.id, { push: "failing" }),
    );

    expect(none.devices).toEqual([]);
  });

  it("aggregates a tenant-scoped device activity timeline", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const other = await runEffect(
      service.createTenant(request(headers), { name: "Other", slug: "other" }),
    );

    await seedDevice(db, tenant.id, "device-1");
    await seedDevice(db, tenant.id, "device-2");

    const time = (value: string) => new Date(value);
    db.store.audit_log.push(
      {
        id: "audit-own",
        organizationId: tenant.id,
        action: "device.updated",
        targetType: "device",
        targetId: "device-1",
        actorEmail: "owner@example.com",
        metadata: { fields: ["name"] },
        createdAt: time("2026-01-04T00:00:00.000Z"),
      },
      {
        id: "audit-sibling",
        organizationId: tenant.id,
        action: "device.updated",
        targetType: "device",
        targetId: "device-2",
        createdAt: time("2026-01-05T00:00:00.000Z"),
      },
      {
        id: "audit-other-tenant",
        organizationId: other.id,
        action: "device.updated",
        targetType: "device",
        targetId: "device-1",
        createdAt: time("2026-01-06T00:00:00.000Z"),
      },
    );
    db.store.device_command.push({
      id: "command-1",
      organizationId: tenant.id,
      deviceId: "device-1",
      requestType: "DeviceLock",
      status: "succeeded",
      resultStatus: "Acknowledged",
      createdAt: time("2026-01-02T00:00:00.000Z"),
      updatedAt: time("2026-01-02T00:01:00.000Z"),
    });
    db.store.device_declaration.push({
      deviceId: "device-1",
      identifier: "com.example.policy",
      declarationType: "configurations",
      active: true,
      valid: "valid",
      updatedAt: time("2026-01-03T00:00:00.000Z"),
    });
    db.store.scep_issued_certificate.push({
      serial: "serial-1",
      organizationId: tenant.id,
      enrollmentId: null,
      deviceId: "device-1",
      notAfter: time("2027-01-01T00:00:00.000Z"),
      revokedAt: null,
      createdAt: time("2026-01-01T00:00:00.000Z"),
    });

    const result = await runEffect(
      service.getDeviceActivity(request(headers), tenant.id, "device-1", { limit: 50 }),
    );

    const ids = result.events.map((event) => event.id);
    expect(ids).toContain("audit:audit-own");
    expect(ids).toContain("command:command-1");
    expect(ids).toContain("declaration:com.example.policy");
    expect(ids).toContain("certificate:serial-1:issued");
    expect(ids).toContain("lifecycle:enrolled");
    expect(ids).not.toContain("audit:audit-sibling");
    expect(ids).not.toContain("audit:audit-other-tenant");
    // Newest first.
    const times = result.events.map((event) => Date.parse(event.at));
    expect([...times].sort((left, right) => right - left)).toEqual(times);

    const limited = await runEffect(
      service.getDeviceActivity(request(headers), tenant.id, "device-1", { limit: 2 }),
    );

    expect(limited.events).toHaveLength(2);

    await expect(
      runEffect(service.getDeviceActivity(request(headers), tenant.id, "missing", {})),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);
    // The device exists, but in another tenant.
    await expect(
      runEffect(service.getDeviceActivity(request(headers), other.id, "device-1", {})),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);
  });

  it("pages device activity with a keyset cursor instead of deep offsets", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    await seedDevice(db, tenant.id, "device-1");

    for (let index = 0; index < 7; index++)
      db.store.audit_log.push({
        id: `audit-${index}`,
        organizationId: tenant.id,
        action: "device.updated",
        targetType: "device",
        targetId: "device-1",
        createdAt: new Date(Date.UTC(2026, 0, 3, 0, 0, 7 - index)),
      });

    const first = await runEffect(
      service.getDeviceActivity(request(headers), tenant.id, "device-1", { limit: 3 }),
    );

    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toBeTruthy();

    const second = await runEffect(
      service.getDeviceActivity(request(headers), tenant.id, "device-1", {
        limit: 3,
        cursor: first.nextCursor!,
      }),
    );

    const third = await runEffect(
      service.getDeviceActivity(request(headers), tenant.id, "device-1", {
        limit: 3,
        cursor: second.nextCursor!,
      }),
    );

    const ids = [...first.events, ...second.events, ...third.events].map((event) => event.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(9);
    expect(ids).toContain("lifecycle:enrolled");
    expect(third.hasMore).toBe(false);
    expect(third.nextCursor).toBeUndefined();

    // Offset paging is retired; callers must continue from the cursor.
    await expect(
      runEffect(
        service.getDeviceActivity(request(headers), tenant.id, "device-1", { limit: 3, offset: 3 }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
  });
});

describe("device command lifecycle", () => {
  const seed = (db: any, tenantId: string) => {
    const now = new Date();
    db.store.device.push({
      id: "device-1",
      organizationId: tenantId,
      proto: "apple",
      status: "enrolled",
      name: "device-1",
      dmIdentifier: "dm-device-1",
      enrolledAt: now,
      lastSeenAt: now,
    });
    db.store.device_apple.push({
      deviceId: "device-1",
      token: "device-1-token",
      pushMagic: "device-1-magic",
      topic: "com.apple.mgmt.External.acme",
    });
  };

  const commands = (db: any) =>
    db.store.device_command.filter((row: any) => row.deviceId === "device-1");

  it("queues one erase when the action is submitted twice", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    seed(db, tenant.id);

    await runEffect(
      service.deviceAction(request(headers), tenant.id, "device-1", { action: "wipe" }),
    );
    await runEffect(
      service.deviceAction(request(headers), tenant.id, "device-1", { action: "wipe" }),
    );

    // Each erase carries a fresh PIN, so the newer one supersedes the older
    // rather than running both. Exactly one erase stays active; the
    // `Settings` pre-step that disables supervised Activation Lock is queued
    // once and de-duplicated.
    const active = commands(db).filter((row: any) => row.status === "queued");

    const erases = active.filter((row: any) => row.requestType === "EraseDevice");

    expect(erases).toHaveLength(1);
    expect(erases[0].expiresAt).toBeInstanceOf(Date);
    expect(active.filter((row: any) => row.requestType === "Settings")).toHaveLength(1);
    expect(commands(db).filter((row: any) => row.status === "superseded")).toHaveLength(1);
  });

  it("returns the in-flight command for identical work instead of queueing twice", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    seed(db, tenant.id);

    const first = await runEffect(
      service.deviceAction(request(headers), tenant.id, "device-1", {
        action: "collect-security-info",
      }),
    );

    const second = await runEffect(
      service.deviceAction(request(headers), tenant.id, "device-1", {
        action: "collect-security-info",
      }),
    );

    expect(commands(db)).toHaveLength(1);
    const firstCommandId = "commandId" in first ? first.commandId : undefined;

    expect(second).toMatchObject({ deduplicated: true, commandId: firstCommandId });
  });

  it("extends the deadline when a duplicate command is clicked again", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    seed(db, tenant.id);

    await runEffect(
      service.deviceAction(request(headers), tenant.id, "device-1", {
        action: "collect-security-info",
      }),
    );

    // Simulate the row reaching the end of its delivery window.
    const existing = commands(db)[0]!;
    existing.expiresAt = new Date(Date.now() + 60 * 1000);

    const second = await runEffect(
      service.deviceAction(request(headers), tenant.id, "device-1", {
        action: "collect-security-info",
      }),
    );

    expect(second).toMatchObject({ deduplicated: true });
    expect(commands(db)).toHaveLength(1);
    // A fresh 24-hour budget from the second click, not the old deadline.
    expect(commands(db)[0]!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
  });

  it("supersedes a pending lock when a wipe is queued", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    seed(db, tenant.id);

    await runEffect(
      service.deviceAction(request(headers), tenant.id, "device-1", { action: "lock" }),
    );
    await runEffect(
      service.deviceAction(request(headers), tenant.id, "device-1", { action: "wipe" }),
    );

    const statuses = commands(db).map((row: any) => [row.requestType, row.status]);

    expect(statuses).toEqual([
      ["DeviceLock", "superseded"],
      ["Settings", "queued"],
      ["EraseDevice", "queued"],
    ]);
  });

  it("queues Apple's Settings/DeviceName command for set-device-name", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    seed(db, tenant.id);

    const result = await runEffect(
      service.deviceAction(request(headers), tenant.id, "device-1", {
        action: "set-device-name",
        deviceName: "  Reception Mac  ",
      }),
    );

    expect(result).toMatchObject({ status: "ok" });
    expect("commandId" in result ? result.commandId : undefined).toBeDefined();

    const [queued] = commands(db).filter((row: any) => row.requestType === "Settings");

    expect(queued).toMatchObject({
      status: "queued",
      payload: { Settings: [{ Item: "DeviceName", DeviceName: "Reception Mac" }] },
    });
    expect(queued.expiresAt).toBeInstanceOf(Date);
    expect(db.store.audit_log.at(-1)).toMatchObject({
      action: "device.action",
      metadata: expect.objectContaining({
        action: "set-device-name",
        deviceName: "Reception Mac",
      }),
    });
  });

  it("rejects a missing or over-long device name", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    seed(db, tenant.id);

    await expect(
      runEffect(
        service.deviceAction(request(headers), tenant.id, "device-1", {
          action: "set-device-name",
          deviceName: "   ",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    await expect(
      runEffect(
        service.deviceAction(request(headers), tenant.id, "device-1", {
          action: "set-device-name",
          deviceName: "x".repeat(64),
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    expect(commands(db)).toHaveLength(0);

    // Apple accepts 63 characters exactly.
    await runEffect(
      service.deviceAction(request(headers), tenant.id, "device-1", {
        action: "set-device-name",
        deviceName: "x".repeat(63),
      }),
    );

    expect(commands(db)).toHaveLength(1);
  });

  it("does not offer set-device-name on Apple User Enrollment", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    seed(db, tenant.id);
    db.store.device_apple[0]!.enrollmentMode = "user";

    const failure = await runEffect(
      service.deviceAction(request(headers), tenant.id, "device-1", {
        action: "set-device-name",
        deviceName: "Reception Mac",
      }),
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(EnterpriseBadRequest);
    expect(failure).toMatchObject({ message: expect.stringContaining("User Enrollment") });
    expect(commands(db)).toHaveLength(0);
  });

  it("persists the apply-name opt-in on rename and audits it", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    seed(db, tenant.id);

    await runEffect(
      service.patchDevice(request(headers), tenant.id, "device-1", {
        name: "Reception Mac",
        applyNameToDevice: true,
      }),
    );

    expect(db.store.device[0]).toMatchObject({
      name: "Reception Mac",
      namePushEnabled: true,
    });
    expect(db.store.audit_log.at(-1)).toMatchObject({ action: "device.renamed" });

    // The same limit the command enforces applies to the opt-in path.
    await expect(
      runEffect(
        service.patchDevice(request(headers), tenant.id, "device-1", {
          name: "x".repeat(64),
          applyNameToDevice: true,
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
  });

  it("rejects the apply-name opt-in on platforms without name delivery", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const now = new Date();
    db.store.device.push({
      id: "windows-1",
      organizationId: tenant.id,
      proto: "win",
      status: "enrolled",
      name: "DESKTOP-1",
      enrolledAt: now,
      lastSeenAt: now,
    });

    await expect(
      runEffect(
        service.patchDevice(request(headers), tenant.id, "windows-1", {
          name: "Reception PC",
          applyNameToDevice: true,
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
  });

  it("queues Apple's shared-device lock screen profile with the message and asset tag", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    seed(db, tenant.id);
    db.store.device[0]!.assetTag = "AST-1042";
    db.store.device[0]!.osEdition = "iPadOS";
    db.store.device[0]!.osVersion = "18.1";

    const result = await runEffect(
      service.deviceAction(request(headers), tenant.id, "device-1", {
        action: "set-lock-screen-message",
        lockScreenMessage: "  If found, return to the IT desk  ",
        lockScreenIncludeAssetTag: true,
      }),
    );

    expect(result).toMatchObject({ status: "ok" });
    expect("commandId" in result ? result.commandId : undefined).toBeDefined();

    const [queued] = commands(db).filter((row: any) => row.requestType === "InstallProfile");

    expect(queued).toMatchObject({ status: "queued" });
    expect(queued.expiresAt).toBeInstanceOf(Date);

    const profile = new TextDecoder().decode(
      Uint8Array.from(atob(queued!.payload.Payload), (character) => character.charCodeAt(0)),
    );

    expect(profile).toContain("com.apple.shareddeviceconfiguration");
    expect(profile).toContain("If found, return to the IT desk");
    expect(profile).toContain("AssetTagInformation");
    expect(profile).toContain("AST-1042");
    expect(db.store.device[0]).toMatchObject({
      lockScreenMessage: "If found, return to the IT desk",
      lockScreenIncludeAssetTag: true,
    });
    expect(db.store.audit_log.at(-1)).toMatchObject({
      action: "device.action",
      metadata: expect.objectContaining({
        action: "set-lock-screen-message",
        lockScreenMessage: "If found, return to the IT desk",
        includeAssetTag: true,
      }),
    });
  });

  it("resolves the policy lock screen default and lets a device override it", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    seed(db, tenant.id);
    db.store.device[0]!.assetTag = "AST-1042";
    db.store.device[0]!.osEdition = "iPadOS";

    const policy = await runEffect(
      service.createPolicy(request(headers), tenant.id, {
        name: "Shared iPads",
        configurations: {
          "mttx.apple.lockScreenMessage": {
            message: "Please return to the IT desk",
            includeAssetTag: true,
          },
        },
      }),
    );

    await runEffect(
      service.createGroup(request(headers), tenant.id, {
        name: "Shared iPads",
        devices: ["device-1"],
        policies: [policy.id],
      }),
    );

    const detail = await runEffect(service.getDevice(request(headers), tenant.id, "device-1"));

    expect(detail).toMatchObject({
      effectiveLockScreenMessage: "Please return to the IT desk",
      effectiveLockScreenIncludeAssetTag: true,
      lockScreenMessageSource: "policy",
      lockScreenPolicyName: "Shared iPads",
      lockScreenMessageProblem: null,
    });

    await runEffect(
      service.patchDevice(request(headers), tenant.id, "device-1", {
        lockScreenMessage: "Call Oscar on +61 400 000 000",
        lockScreenIncludeAssetTag: false,
      }),
    );

    const overridden = await runEffect(service.getDevice(request(headers), tenant.id, "device-1"));

    expect(overridden).toMatchObject({
      lockScreenMessage: "Call Oscar on +61 400 000 000",
      effectiveLockScreenMessage: "Call Oscar on +61 400 000 000",
      effectiveLockScreenIncludeAssetTag: false,
      lockScreenMessageSource: "device",
    });
  });

  it("omits AssetTagInformation when Include asset tag is off", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    seed(db, tenant.id);
    db.store.device[0]!.assetTag = "AST-1042";

    await runEffect(
      service.deviceAction(request(headers), tenant.id, "device-1", {
        action: "set-lock-screen-message",
        lockScreenMessage: "If found, return to the IT desk",
      }),
    );

    const profile = new TextDecoder().decode(
      Uint8Array.from(atob(commands(db)[0]!.payload.Payload), (character) =>
        character.charCodeAt(0),
      ),
    );

    expect(profile).toContain("If found, return to the IT desk");
    expect(profile).not.toContain("AssetTagInformation");
  });

  it("refuses Include asset tag when the device has no asset tag", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    seed(db, tenant.id);

    const failure = await runEffect(
      service.deviceAction(request(headers), tenant.id, "device-1", {
        action: "set-lock-screen-message",
        lockScreenMessage: "If found, return to the IT desk",
        lockScreenIncludeAssetTag: true,
      }),
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(EnterpriseBadRequest);
    expect(failure).toMatchObject({ message: expect.stringContaining("no asset tag") });
    expect(commands(db)).toHaveLength(0);
    expect(db.store.device[0]).not.toHaveProperty("lockScreenMessage");
  });

  it("rejects an empty or over-long lock screen message", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    seed(db, tenant.id);
    db.store.device[0]!.osEdition = "iOS";

    for (const lockScreenMessage of ["   ", "x".repeat(501)]) {
      const failure = await runEffect(
        service.deviceAction(request(headers), tenant.id, "device-1", {
          action: "set-lock-screen-message",
          lockScreenMessage,
        }),
      ).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(EnterpriseBadRequest);
    }

    expect(commands(db)).toHaveLength(0);
  });

  it("does not offer set-lock-screen-message on macOS, tvOS, Android or BYOD Apple devices", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    seed(db, tenant.id);
    db.store.device[0]!.osEdition = "macOS";

    const macFailure = await runEffect(
      service.deviceAction(request(headers), tenant.id, "device-1", {
        action: "set-lock-screen-message",
        lockScreenMessage: "Return to the IT desk",
      }),
    ).catch((error: unknown) => error);

    expect(macFailure).toBeInstanceOf(EnterpriseBadRequest);
    expect(macFailure).toMatchObject({ message: expect.stringContaining("macOS") });

    db.store.device[0]!.osEdition = "tvOS";
    const tvFailure = await runEffect(
      service.deviceAction(request(headers), tenant.id, "device-1", {
        action: "set-lock-screen-message",
        lockScreenMessage: "Return to the IT desk",
      }),
    ).catch((error: unknown) => error);

    expect(tvFailure).toBeInstanceOf(EnterpriseBadRequest);
    expect(tvFailure).toMatchObject({ message: expect.stringContaining("tvOS") });

    db.store.device[0]!.osEdition = "iOS";
    db.store.device_apple[0]!.enrollmentMode = "user";
    const byodFailure = await runEffect(
      service.deviceAction(request(headers), tenant.id, "device-1", {
        action: "set-lock-screen-message",
        lockScreenMessage: "Return to the IT desk",
      }),
    ).catch((error: unknown) => error);

    expect(byodFailure).toBeInstanceOf(EnterpriseBadRequest);
    expect(byodFailure).toMatchObject({ message: expect.stringContaining("User Enrollment") });

    const now = new Date();
    db.store.device.push({
      id: "android-1",
      organizationId: tenant.id,
      proto: "android",
      status: "enrolled",
      name: "Android",
      enrolledAt: now,
      lastSeenAt: now,
    });

    const androidFailure = await runEffect(
      service.deviceAction(request(headers), tenant.id, "android-1", {
        action: "set-lock-screen-message",
        lockScreenMessage: "Return to the IT desk",
      }),
    ).catch((error: unknown) => error);

    expect(androidFailure).toBeInstanceOf(EnterpriseBadRequest);
    expect(androidFailure).toMatchObject({
      message: expect.stringContaining("supervised iPhone and iPad"),
    });
    expect(commands(db)).toHaveLength(0);
  });

  it("stores and clears the per-device lock screen override", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    seed(db, tenant.id);
    db.store.device[0]!.assetTag = "AST-1042";

    await runEffect(
      service.patchDevice(request(headers), tenant.id, "device-1", {
        lockScreenMessage: "Return to the IT desk",
        lockScreenIncludeAssetTag: true,
      }),
    );

    expect(db.store.device[0]).toMatchObject({
      lockScreenMessage: "Return to the IT desk",
      lockScreenIncludeAssetTag: true,
    });

    await runEffect(
      service.patchDevice(request(headers), tenant.id, "device-1", {
        lockScreenMessage: null,
        lockScreenIncludeAssetTag: null,
      }),
    );

    expect(db.store.device[0]).toMatchObject({
      lockScreenMessage: null,
      lockScreenIncludeAssetTag: null,
    });
  });

  it("requires devices.command to set but not clear a lock screen override", async () => {
    const base = await makeContext();

    const tenant = await runEffect(
      base.service.createTenant(request(base.headers), { name: "Acme", slug: "acme" }),
    );

    seed(base.db, tenant.id);
    base.db.store.device[0]!.assetTag = "AST-1042";
    base.db.store.device[0]!.osEdition = "iPadOS";

    const writer = await makeContext({
      db: base.db,
      apiToken: { tenantId: null, scopes: ["devices.write"] },
    });

    await expect(
      runEffect(
        writer.service.patchDevice(request(writer.headers), tenant.id, "device-1", {
          lockScreenMessage: "Return to the IT desk",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);

    // Clearing the override does not queue work, so devices.write is enough.
    await runEffect(
      writer.service.patchDevice(request(writer.headers), tenant.id, "device-1", {
        lockScreenMessage: null,
        lockScreenIncludeAssetTag: null,
      }),
    );

    expect(base.db.store.device[0]).toMatchObject({
      lockScreenMessage: null,
      lockScreenIncludeAssetTag: null,
    });
  });

  it("rejects the lock screen asset-tag opt-in when the device has no asset tag", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    seed(db, tenant.id);

    await expect(
      runEffect(
        service.patchDevice(request(headers), tenant.id, "device-1", {
          lockScreenMessage: "Return to the IT desk",
          lockScreenIncludeAssetTag: true,
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
  });

  it("queues a fresh command when the identical one already expired", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    seed(db, tenant.id);

    const stale = new Date(Date.now() - 60 * 60 * 1000);
    db.store.device_command.push({
      id: "stale-lock",
      organizationId: tenant.id,
      deviceId: "device-1",
      requestType: "DeviceLock",
      payload: { PIN: "123456" },
      status: "queued",
      dedupeKey: null,
      expiresAt: stale,
      resultStatus: null,
      resultDetail: null,
      createdAt: new Date(stale.getTime() - 15 * 60 * 1000),
      updatedAt: new Date(stale.getTime() - 15 * 60 * 1000),
    });

    await runEffect(
      service.deviceAction(request(headers), tenant.id, "device-1", { action: "lock" }),
    );

    const byId = new Map(commands(db).map((row: any) => [row.id, row]));
    expect(byId.get("stale-lock")).toMatchObject({ status: "expired", dedupeKey: null });

    const queued = commands(db).filter((row: any) => row.status === "queued");
    expect(queued).toHaveLength(1);
    expect(queued[0]!.requestType).toBe("DeviceLock");
    expect(queued[0]!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("reports the lifecycle in the command history with expiry and a label", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    seed(db, tenant.id);

    const stale = new Date(Date.now() - 60 * 60 * 1000);
    db.store.device_command.push({
      id: "stale-lock",
      organizationId: tenant.id,
      deviceId: "device-1",
      requestType: "DeviceLock",
      payload: { PIN: "123456" },
      status: "queued",
      dedupeKey: null,
      expiresAt: stale,
      resultStatus: null,
      resultDetail: null,
      createdAt: new Date(stale.getTime() - 15 * 60 * 1000),
      updatedAt: new Date(stale.getTime() - 15 * 60 * 1000),
    });

    const history = await runEffect(
      service.listDeviceCommands(request(headers), tenant.id, "device-1"),
    );

    expect(history.commands[0]).toMatchObject({
      id: "stale-lock",
      status: "expired",
      statusLabel: "Expired",
    });
    expect(history.commands[0].expiresAt).toBe(stale.toISOString());
  });

  it("cancels queued commands when the device is unenrolled", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    seed(db, tenant.id);

    await runEffect(
      service.deviceAction(request(headers), tenant.id, "device-1", { action: "lock" }),
    );
    await runEffect(service.deviceUnenroll(request(headers), tenant.id, "device-1"));

    expect(commands(db)[0]).toMatchObject({ status: "cancelled", dedupeKey: null });
  });

  it("queues Lost Mode with the message and persists the requested state", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    seed(db, tenant.id);
    db.store.device[0]!.osEdition = "iOS";

    const result = await runEffect(
      service.deviceAction(request(headers), tenant.id, "device-1", {
        action: "start-lost-mode",
        lostModeMessage: "  This iPad is lost  ",
        lostModePhone: "+61 400 000 000",
        lostModeFootnote: "AST-1042",
      }),
    );

    expect(result).toMatchObject({ status: "ok" });
    expect(commands(db)).toEqual([
      expect.objectContaining({
        requestType: "EnableLostMode",
        payload: {
          Message: "This iPad is lost",
          PhoneNumber: "+61 400 000 000",
          Footnote: "AST-1042",
        },
        status: "queued",
      }),
    ]);
    expect(db.store.device_apple[0]).toMatchObject({
      lostModeMessage: "This iPad is lost",
      lostModePhone: "+61 400 000 000",
      lostModeFootnote: "AST-1042",
    });
    expect(db.store.device_apple[0]!.lostModeRequestedAt).toBeInstanceOf(Date);
    expect(db.store.audit_log.at(-1)).toMatchObject({
      action: "device.action",
      metadata: expect.objectContaining({
        action: "start-lost-mode",
        lostModeMessage: "This iPad is lost",
      }),
    });
  });

  it("requires a message or phone number and rejects Lost Mode off iPhone/iPad", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    seed(db, tenant.id);
    db.store.device[0]!.osEdition = "iOS";

    const empty = await runEffect(
      service.deviceAction(request(headers), tenant.id, "device-1", {
        action: "start-lost-mode",
        lostModeMessage: "   ",
      }),
    ).catch((error: unknown) => error);

    expect(empty).toBeInstanceOf(EnterpriseBadRequest);
    expect(empty).toMatchObject({ message: expect.stringContaining("at least one") });
    expect(commands(db)).toHaveLength(0);

    db.store.device[0]!.osEdition = "macOS";
    const mac = await runEffect(
      service.deviceAction(request(headers), tenant.id, "device-1", {
        action: "start-lost-mode",
        lostModeMessage: "Lost",
      }),
    ).catch((error: unknown) => error);

    expect(mac).toBeInstanceOf(EnterpriseBadRequest);
    expect(mac).toMatchObject({ message: expect.stringContaining("macOS") });
    expect(commands(db)).toHaveLength(0);
  });

  it("de-duplicates an identical Lost Mode request", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    seed(db, tenant.id);
    db.store.device[0]!.osEdition = "iOS";

    const payload = {
      action: "start-lost-mode",
      lostModeMessage: "Lost iPad",
      lostModePhone: "+61 400 000 000",
    } as const;

    const first = await runEffect(
      service.deviceAction(request(headers), tenant.id, "device-1", payload),
    );
    const second = await runEffect(
      service.deviceAction(request(headers), tenant.id, "device-1", payload),
    );

    expect(second).toMatchObject({
      commandId: requireField(first, "commandId").commandId,
      deduplicated: true,
    });
    expect(commands(db)).toHaveLength(1);
  });

  it("offers PlayLostModeSound only while Lost Mode is active", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    seed(db, tenant.id);
    db.store.device[0]!.osEdition = "iOS";

    await expect(
      runEffect(
        service.deviceAction(request(headers), tenant.id, "device-1", {
          action: "play-lost-mode-sound",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    db.store.device_apple[0]!.lostModeEnabled = true;

    await runEffect(
      service.deviceAction(request(headers), tenant.id, "device-1", {
        action: "play-lost-mode-sound",
      }),
    );

    expect(commands(db)).toEqual([
      expect.objectContaining({ requestType: "PlayLostModeSound", status: "queued" }),
    ]);
  });

  it("queues UserList for a Mac and records the local-account request time", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    seed(db, tenant.id);
    db.store.device[0]!.osEdition = "macOS";

    await runEffect(
      service.deviceAction(request(headers), tenant.id, "device-1", {
        action: "refresh-local-accounts",
      }),
    );

    expect(commands(db)).toEqual([
      expect.objectContaining({ requestType: "UserList", status: "queued" }),
    ]);
    expect(db.store.device_apple[0]!.localAccountsRequestedAt).toBeInstanceOf(Date);
  });

  it("refuses local administrator rotation without a reported GUID", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    seed(db, tenant.id);
    db.store.device[0]!.osEdition = "macOS";

    const failure = await runEffect(
      service.deviceAction(request(headers), tenant.id, "device-1", {
        action: "rotate-local-admin-password",
      }),
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(EnterpriseBadRequest);
    expect(failure).toMatchObject({ message: expect.stringContaining("GUID") });
    expect(commands(db)).toHaveLength(0);
  });

  it("queues SetAutoAdminPassword with the reported GUID and a pending secret", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    seed(db, tenant.id);
    db.store.device[0]!.osEdition = "macOS";
    db.store.device_apple[0]!.localAdminGuid = "11111111-AAAA-BBBB-CCCC-222222222222";

    const now = new Date();
    db.store.device_secret.push({
      deviceId: "device-1",
      organizationId: tenant.id,
      kind: "local_admin_password",
      sealedValue: "sealed-current",
      format: "plaintext",
      createdAt: now,
      updatedAt: now,
      rotatedAt: now,
    });

    await runEffect(
      service.deviceAction(request(headers), tenant.id, "device-1", {
        action: "rotate-local-admin-password",
      }),
    );

    const [command] = commands(db);

    expect(command).toMatchObject({ requestType: "SetAutoAdminPassword", status: "queued" });
    expect(command!.payload).toMatchObject({
      GUID: "11111111-AAAA-BBBB-CCCC-222222222222",
      passwordHash: expect.any(String),
    });
    expect(atob(command!.payload.passwordHash)).toContain("SALTED-SHA512-PBKDF2");
    expect(db.store.device_secret).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "local_admin_password_pending",
          sealedValue: expect.not.stringMatching(/^sealed-current$/),
        }),
      ]),
    );
  });

  it("refuses a concurrent local administrator rotation", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    seed(db, tenant.id);
    db.store.device[0]!.osEdition = "macOS";
    db.store.device_apple[0]!.localAdminGuid = "11111111-AAAA-BBBB-CCCC-222222222222";

    const now = new Date();
    db.store.device_secret.push({
      deviceId: "device-1",
      organizationId: tenant.id,
      kind: "local_admin_password",
      sealedValue: "sealed-current",
      format: "plaintext",
      createdAt: now,
      updatedAt: now,
      rotatedAt: now,
    });
    db.store.device_command.push({
      id: "rotation-1",
      organizationId: tenant.id,
      deviceId: "device-1",
      requestType: "SetAutoAdminPassword",
      payload: { GUID: "11111111-AAAA-BBBB-CCCC-222222222222", passwordHash: "hash" },
      status: "queued",
      dedupeKey: null,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      resultStatus: null,
      resultDetail: null,
      createdAt: now,
      updatedAt: now,
    });

    const failure = await runEffect(
      service.deviceAction(request(headers), tenant.id, "device-1", {
        action: "rotate-local-admin-password",
      }),
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(EnterpriseConflict);
    expect(failure).toMatchObject({ message: expect.stringContaining("already in progress") });
  });

  it("filters the fleet by Lost Mode and local-account risk", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    seed(db, tenant.id);
    db.store.device[0]!.osEdition = "iOS";
    db.store.device_apple[0]!.lostModeEnabled = true;

    const active = await runEffect(
      service.searchDevices(request(headers), tenant.id, {
        lostMode: "active",
        limit: 50,
      }),
    );

    expect(active.devices.map((device) => device.id)).toEqual(["device-1"]);

    db.store.device_apple[0]!.lostModeEnabled = false;

    const inactive = await runEffect(
      service.searchDevices(request(headers), tenant.id, {
        lostMode: "inactive",
        limit: 50,
      }),
    );

    expect(inactive.devices.map((device) => device.id)).toEqual(["device-1"]);

    const now = new Date();
    db.store.device.push({
      id: "windows-1",
      organizationId: tenant.id,
      proto: "win",
      status: "enrolled",
      name: "DESKTOP-1",
      enrolledAt: now,
      lastSeenAt: now,
    });

    const inactiveAfterWindows = await runEffect(
      service.searchDevices(request(headers), tenant.id, {
        lostMode: "inactive",
        limit: 50,
      }),
    );

    expect(inactiveAfterWindows.devices.map((device) => device.id)).toEqual(["device-1"]);

    // A Mac that has never reported a local-account inventory is included in
    // the stale-inventory filter, not silently excluded.
    db.store.device[0]!.osEdition = "macOS 15.1";

    const staleInventory = await runEffect(
      service.searchDevices(request(headers), tenant.id, {
        localAccount: "not-seen-30-days",
        limit: 50,
      }),
    );

    expect(staleInventory.devices.map((device) => device.id)).toEqual(["device-1"]);

    db.store.device_local_account.push({
      id: "local-account-1",
      organizationId: tenant.id,
      deviceId: "device-1",
      username: "shared",
      fullName: "Shared",
      uid: 502,
      guid: null,
      isAdmin: null,
      isManaged: false,
      hasSecureToken: false,
      isLoggedIn: false,
      mobileAccount: false,
      dataQuota: null,
      dataUsed: null,
      lastLoginAt: null,
      firstSeenAt: now,
      lastSeenAt: now,
      reportedAt: now,
    });

    const noToken = await runEffect(
      service.searchDevices(request(headers), tenant.id, {
        localAccount: "without-secure-token",
        limit: 50,
      }),
    );

    expect(noToken.devices.map((device) => device.id)).toEqual(["device-1"]);
  });

  it("advertises the Lost Mode sound and rotation only when their state allows it", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    seed(db, tenant.id);
    db.store.device[0]!.osEdition = "iOS";
    db.store.device_apple[0]!.lostModeEnabled = true;

    const lost = await runEffect(service.getDevice(request(headers), tenant.id, "device-1"));

    expect(lost.actions).toContain("play-lost-mode-sound");

    db.store.device[0]!.osEdition = "macOS";
    db.store.device_apple[0]!.lostModeEnabled = false;

    const withoutGuid = await runEffect(service.getDevice(request(headers), tenant.id, "device-1"));

    expect(withoutGuid.actions).not.toContain("rotate-local-admin-password");

    db.store.device_apple[0]!.localAdminGuid = "11111111-AAAA-BBBB-CCCC-222222222222";

    const withGuid = await runEffect(service.getDevice(request(headers), tenant.id, "device-1"));

    expect(withGuid.actions).toContain("rotate-local-admin-password");
  });
});

describe("enterprise policy validation and enrollment", () => {
  it("rejects undeployable policy configurations", async () => {
    const { service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const policy = await runEffect(
      service.createPolicy(request(headers), tenant.id, { name: "Baseline" }),
    );

    await expect(
      runEffect(
        service.patchPolicy(request(headers), tenant.id, policy.id, {
          configurations: { passcode: { minLength: 8 } },
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    await expect(
      runEffect(
        service.patchPolicy(request(headers), tenant.id, policy.id, {
          configurations: { "mttx.apple.application.office": { fileName: "Office.pkg" } },
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
  });

  it("embeds a per-enrollment SCEP challenge in the Apple profile", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    Object.assign(db.store.enterprise_enrollment[0], {
      enabledApple: true,
      enabledWindows: true,
      enabledAndroid: false,
      enabledAssetTag: false,
      maxDevices: 100,
    });
    db.store.apple_push_certificate.push({
      organizationId: tenant.id,
      email: "admin@example.com",
      topic: "com.apple.mgmt.External.acme",
      certPem: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----",
      encryptedKey: null,
      updatedAt: new Date(),
    });

    const enrollment = await runEffect(service.getTenantEnrollment(request(headers), tenant.id));
    const result = await runEffect(service.getEnrollment(enrollment.id, undefined));
    expect(result.authenticated).toBe(true);

    if (!result.authenticated || !("profile" in result.apple)) throw new Error("expected profile");
    const profile = result.apple.profile;
    expect(profile).toContain("com.apple.security.scep");
    expect(profile).toContain("Acme Identity");
    expect(profile).toContain("<string>OU</string>");
    expect(profile).toContain(tenant.id);
    expect(profile).toContain("<key>Challenge</key>");
    expect(profile).toContain(`<string>${enrollment.id}.`);
    // GetToken is not implemented, so the capability must not be advertised.
    expect(profile).not.toContain("com.apple.mdm.token");
    expect(profile).toContain("com.apple.mdm.per-user-connections");
  });

  it("brands the Apple enrollment profile and enrollment payload", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), {
        name: "Acme",
        slug: "acme",
        displayName: "Acme Corp",
        supportEmail: "help@acme.test",
        brandColor: "#2563eb",
        logo: "https://cdn.example.com/acme.png",
      }),
    );

    Object.assign(db.store.enterprise_enrollment[0], {
      enabledApple: true,
      enabledWindows: true,
      enabledAndroid: false,
      enabledAssetTag: false,
      maxDevices: 100,
    });
    db.store.apple_push_certificate.push({
      organizationId: tenant.id,
      email: "admin@example.com",
      topic: "com.apple.mgmt.External.acme",
      certPem: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----",
      encryptedKey: null,
      updatedAt: new Date(),
    });

    const enrollment = await runEffect(service.getTenantEnrollment(request(headers), tenant.id));
    const result = await runEffect(service.getEnrollment(enrollment.id, undefined));

    if (!result.authenticated || !("profile" in result.apple)) throw new Error("expected profile");

    expect(result.branding).toEqual({
      displayName: "Acme Corp",
      logo: "https://cdn.example.com/acme.png",
      supportEmail: "help@acme.test",
      brandColor: "#2563eb",
    });
    expect(result.apple.profile).toContain("<string>Acme Corp Enrollment</string>");
    expect(result.apple.profile).toContain("<string>Acme Corp</string>");
    expect(result.apple.profile).toContain("help@acme.test");
    expect(result.apple.profile).not.toContain("hello@mattrax.app");
    // Branding must not disturb the identifiers devices already trust.
    expect(result.apple.profile).toContain("com.mattrax.scep");
    expect(result.apple.profile).toContain("com.mattrax.mdm");
  });

  it("uses the display name for the downloaded profile filename", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), {
        name: "Acme",
        slug: "acme",
        displayName: "Acme Corp",
      }),
    );

    Object.assign(db.store.enterprise_enrollment[0], {
      enabledApple: true,
      maxDevices: 100,
    });
    db.store.apple_push_certificate.push({
      organizationId: tenant.id,
      email: "admin@example.com",
      topic: "com.apple.mgmt.External.acme",
      certPem: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----",
      encryptedKey: null,
      updatedAt: new Date(),
    });

    const enrollment = await runEffect(service.getTenantEnrollment(request(headers), tenant.id));
    const profile = await runEffect(service.getAppleEnrollmentProfile(enrollment.id, undefined));
    expect(profile.filename).toBe("acme-enrollment.mobileconfig");
  });

  it("treats maxDevices=0 as unlimited when enrolling", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const now = new Date();
    db.store.device.push({
      id: "device-1",
      organizationId: tenant.id,
      proto: "apple",
      status: "enrolled",
      name: "Existing Mac",
      enrolledAt: now,
      lastSeenAt: now,
    });

    // A finite cap of 1 is already used, so enrollment is blocked.
    Object.assign(db.store.enterprise_enrollment[0], {
      enabledWindows: true,
      maxDevices: 1,
    });
    const blocked = await runEffect(service.getEnrollment(tenant.id, undefined));

    if (!blocked.authenticated) throw new Error("expected authenticated enrollment");
    expect(blocked.windows).toEqual({
      error: "Windows enrollment is disabled! Contact your administrator.",
    });

    // 0 means unlimited, even with devices already enrolled.
    Object.assign(db.store.enterprise_enrollment[0], { maxDevices: 0 });
    const unlimited = await runEffect(service.getEnrollment(tenant.id, undefined));

    if (!unlimited.authenticated) throw new Error("expected authenticated enrollment");
    expect(unlimited.windows).toMatchObject({ tenantScoped: true });

    if (!("discoveryUrl" in unlimited.windows)) throw new Error("expected a Windows URL");
    expect(unlimited.windows.discoveryUrl).toMatch(
      new RegExp(`^${origin}/mdm/windows/discovery\\?tenant=mttxw1\\.`),
    );
    expect(unlimited.windows.discoveryUrl).toContain(
      encodeURIComponent(Buffer.from(tenant.id).toString("base64url")),
    );

    // The dashboard settings response carries the same tenant-scoped URL.
    const settings = await runEffect(service.getTenantEnrollment(request(headers), tenant.id));
    expect(settings.windowsDiscoveryUrl).toMatch(
      new RegExp(`^${origin}/mdm/windows/discovery\\?tenant=mttxw1\\.`),
    );
    expect(settings.windowsDiscoveryExpiresAt).toBeTruthy();
  });

  it("scopes device search and CSV export to the tenant", async () => {
    const { db, service, headers } = await makeContext();

    const first = await runEffect(
      service.createTenant(request(headers), { name: "First", slug: "first" }),
    );

    const second = await runEffect(
      service.createTenant(request(headers), { name: "Second", slug: "second" }),
    );

    const now = new Date("2026-11-10T12:00:00.000Z");

    const device = (id: string, organizationId: string, name: string) => ({
      id,
      organizationId,
      proto: "apple",
      status: "enrolled",
      name,
      serial: `SERIAL-${id}`,
      model: "MacBook Pro",
      enrolledAt: now,
      lastSeenAt: now,
    });

    db.store.device.push(
      device("device-first", first.id, "First Mac"),
      device("device-second", second.id, "Second Mac"),
    );
    db.store.enterprise_group.push({
      id: "group-second",
      organizationId: second.id,
      name: "Second Ops",
      createdAt: now,
      updatedAt: now,
    });
    db.store.group_device.push({ groupId: "group-second", deviceId: "device-second" });
    Object.assign(db.store.device[0], {
      fileVaultEnabled: false,
      batteryHealth: "Service Recommended",
      capabilities: ["declarative-management"],
      modelNumber: "MLH12LL/A",
      inventoryUpdatedAt: now,
    });

    const found = await runEffect(service.searchDevices(request(headers), first.id, { limit: 50 }));
    expect(found.total).toBe(1);
    expect(found.devices.map((row: any) => row.id)).toEqual(["device-first"]);
    expect(found.devices[0].groups).toEqual([]);
    expect(found.devices[0]).toMatchObject({
      fileVaultEnabled: false,
      batteryHealth: "Service Recommended",
      capabilities: ["declarative-management"],
      modelNumber: "MLH12LL/A",
    });

    const exported = await runEffect(service.exportDevices(request(headers), first.id, {}));
    const csv = exported.csv;
    expect(exported.truncated).toBe(false);
    expect(exported.rowCount).toBe(1);
    expect(csv).toContain("Name,Serial,Model,Platform,Status,OS version,OS build");
    expect(csv).toContain("First Mac,SERIAL-device-first,MacBook Pro,Apple,enrolled");
    expect(csv).toContain("MLH12LL/A,Disabled,,Service Recommended,declarative-management");
    expect(csv).not.toContain("Second Mac");

    // A group belonging to another tenant is not addressable from this tenant.
    await expect(
      runEffect(service.searchDevices(request(headers), first.id, { groupId: "group-second" })),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);
  });

  it("searches every column the device table shows", async () => {
    const { db, service, headers } = await makeContext();

    const first = await runEffect(
      service.createTenant(request(headers), { name: "First", slug: "first" }),
    );

    const second = await runEffect(
      service.createTenant(request(headers), { name: "Second", slug: "second" }),
    );

    // Distinct enrolled/last-seen instants so each column can be searched on
    // its own; the decoy in the second tenant shares every non-timestamp value.
    const macEnrolled = new Date("2026-03-04T05:06:07.000Z");
    const macSeen = new Date("2026-05-06T07:08:09.000Z");
    const winEnrolled = new Date("2026-10-11T00:00:00.000Z");
    const winSeen = new Date("2026-07-08T09:10:11.000Z");
    const decoySeen = new Date("2026-09-09T09:09:09.000Z");

    db.store.device.push(
      {
        id: "device-mac",
        organizationId: first.id,
        proto: "apple",
        status: "enrolled",
        name: "Ada's MacBook",
        serial: "C02SERIAL",
        model: "MacBook Pro",
        modelIdentifier: "Mac16,1",
        assetTag: "ASSET-42",
        osVersion: "14.4.1",
        osEdition: "Sonoma",
        osBuild: "23E224",
        notes: "Design laptop",
        enrolledAt: macEnrolled,
        lastSeenAt: macSeen,
      },
      {
        id: "device-win",
        organizationId: first.id,
        proto: "win",
        status: "unenrolling",
        name: "Build Server",
        serial: "WINSERIAL",
        model: "ThinkPad X1",
        modelIdentifier: "21HM",
        assetTag: "ASSET-99",
        osVersion: "10.0.22631",
        osEdition: "Enterprise",
        osBuild: "22631.4169",
        notes: "Lab machine",
        enrolledAt: winEnrolled,
        lastSeenAt: winSeen,
      },
      {
        id: "device-decoy",
        organizationId: second.id,
        proto: "apple",
        status: "enrolled",
        name: "Search Decoy",
        serial: "DECOY-SERIAL",
        model: "MacBook Pro",
        modelIdentifier: "Mac16,1",
        assetTag: "ASSET-42",
        osVersion: "14.4.1",
        osEdition: "Sonoma",
        osBuild: "23E224",
        notes: "Design laptop",
        enrolledAt: macEnrolled,
        lastSeenAt: decoySeen,
      },
    );

    db.store.enterprise_group.push(
      {
        id: "group-design",
        organizationId: first.id,
        name: "Design Guild",
        createdAt: macEnrolled,
        updatedAt: macEnrolled,
      },
      {
        id: "group-ada",
        organizationId: first.id,
        name: "Ada Group",
        createdAt: macEnrolled,
        updatedAt: macEnrolled,
      },
      {
        id: "group-decoy",
        organizationId: second.id,
        name: "Design Guild",
        createdAt: macEnrolled,
        updatedAt: macEnrolled,
      },
    );
    db.store.group_device.push(
      { groupId: "group-design", deviceId: "device-mac" },
      { groupId: "group-ada", deviceId: "device-mac" },
      { groupId: "group-decoy", deviceId: "device-decoy" },
    );
    db.store.device_attribute.push(
      {
        organizationId: first.id,
        deviceId: "device-mac",
        attributeId: "attribute-owner",
        value: "Platform Team",
      },
      {
        organizationId: second.id,
        deviceId: "device-decoy",
        attributeId: "attribute-owner",
        value: "Platform Team",
      },
    );

    const search = async (tenantId: string, query: DeviceSearchQuery) =>
      runEffect(service.searchDevices(request(headers), tenantId, { limit: 50, ...query }));

    const ids = async (query: DeviceSearchQuery) =>
      (await search(first.id, query)).devices.map((row: any) => row.id);

    // Platform labels (stored as short codes), status and the OS/model columns.
    expect(await ids({ q: "windows" })).toEqual(["device-win"]);
    expect(await ids({ q: "Apple" })).toEqual(["device-mac"]);
    expect(await ids({ q: "linux" })).toEqual([]);
    expect(await ids({ q: "unenrolling" })).toEqual(["device-win"]);
    expect(await ids({ q: "mac16" })).toEqual(["device-mac"]);
    expect(await ids({ q: "14.4.1" })).toEqual(["device-mac"]);
    expect(await ids({ q: "sonoma" })).toEqual(["device-mac"]);
    expect(await ids({ q: "23e224" })).toEqual(["device-mac"]);
    expect(await ids({ q: "22631" })).toEqual(["device-win"]);

    // Group names and attribute values, without leaving the tenant.
    expect(await ids({ q: "design guild" })).toEqual(["device-mac"]);
    expect(await ids({ q: "guild" })).toEqual(["device-mac"]);
    expect(await ids({ q: "platform team" })).toEqual(["device-mac"]);
    expect(await ids({ q: "search decoy" })).toEqual([]);

    // Each timestamp column is searchable on its own.
    expect(await ids({ q: "2026-03-04" })).toEqual(["device-mac"]); // enrolled
    expect(await ids({ q: "2026-05-06" })).toEqual(["device-mac"]); // last seen
    expect(await ids({ q: "2026-10-11" })).toEqual(["device-win"]); // enrolled
    expect(await ids({ q: "2026-07-08" })).toEqual(["device-win"]); // last seen
    expect(await ids({ q: "2026-09-09" })).toEqual([]); // other tenant only
    expect(await ids({ q: "4 mar 2026" })).toEqual(["device-mac"]);
    expect(await ids({ q: "05:06" })).toEqual(["device-mac"]);
    // Slash dates are accepted in either order; `10/11/2026` is month-first
    // here (11 October 2026, the Windows device's enrolment).
    expect(await ids({ q: "10/11/2026" })).toEqual(["device-win"]);

    // The second tenant's decoy is not reachable through the first tenant.
    expect(
      (await search(second.id, { q: "design guild" })).devices.map((row: any) => row.id),
    ).toEqual(["device-decoy"]);
    expect(
      (await search(second.id, { q: "2026-09-09" })).devices.map((row: any) => row.id),
    ).toEqual(["device-decoy"]);
    expect(
      (await search(second.id, { q: "platform team" })).devices.map((row: any) => row.id),
    ).toEqual(["device-decoy"]);

    // A device can match several branches, but the OR must not duplicate it.
    const deduped = await search(first.id, { q: "ada" });
    expect(deduped.total).toBe(1);
    expect(deduped.devices.map((row: any) => row.id)).toEqual(["device-mac"]);

    // Filters still combine with the free-text search.
    expect(await ids({ q: "build", status: "unenrolling" })).toEqual(["device-win"]);
    expect(await ids({ q: "design", status: "unenrolling" })).toEqual([]);

    // No false positives: unknown text, reversed words and raw ids match nothing.
    expect(await ids({ q: "zzz" })).toEqual([]);
    expect(await ids({ q: "guild design" })).toEqual([]);
    expect(await ids({ q: "device-mac" })).toEqual([]);

    // Sorting and paging still work with the wider search, and the CSV export
    // reuses the same WHERE clause.
    const sorted = await search(first.id, {
      q: "2026",
      sort: "lastSeenAt",
      direction: "desc",
    });

    expect(sorted.devices.map((row: any) => row.id)).toEqual(["device-win", "device-mac"]);

    const exported = await runEffect(
      service.exportDevices(request(headers), first.id, { q: "design guild" }),
    );

    expect(exported.rowCount).toBe(1);
    expect(exported.csv).toContain("Ada's MacBook");
    expect(exported.csv).not.toContain("Build Server");
  });

  it("treats bare numbers as text, not timestamps", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    db.store.device.push(
      {
        id: "device-plain",
        organizationId: tenant.id,
        proto: "apple",
        status: "enrolled",
        name: "Plain Device",
        serial: "SERIAL",
        model: "Model",
        enrolledAt: new Date("2026-03-04T00:00:00.000Z"),
        lastSeenAt: new Date("2026-05-06T00:00:00.000Z"),
      },
      {
        id: "device-rack",
        organizationId: tenant.id,
        proto: "apple",
        status: "enrolled",
        name: "Rack 26",
        serial: "RACK",
        model: "Model",
        enrolledAt: new Date("2026-03-04T00:00:00.000Z"),
        lastSeenAt: new Date("2026-05-06T00:00:00.000Z"),
      },
    );

    const ids = async (q: string) => {
      const found = await runEffect(
        service.searchDevices(request(headers), tenant.id, { q, limit: 50 }),
      );

      return found.devices.map((row: any) => row.id);
    };

    // If a bare number were treated as a date, these would match every device
    // enrolled or last seen in 2026.
    expect(await ids("2")).toEqual(["device-rack"]); // the name, not the fleet
    expect(await ids("4")).toEqual([]); // "2026-03-04" contains a 4
    expect(await ids("26")).toEqual(["device-rack"]);
    expect(await ids("2026")).toEqual(["device-plain", "device-rack"]);
  });

  it("signals truncation and neutralises formula cells in CSV exports", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const now = new Date("2026-11-10T12:00:00.000Z");

    for (let index = 0; index < 10_001; index++)
      db.store.device.push({
        id: `device-${index}`,
        organizationId: tenant.id,
        proto: "apple",
        status: "enrolled",
        name: index === 0 ? '=HYPERLINK("https://evil.example")' : `Device ${index}`,
        serial: `SERIAL-${index}`,
        enrolledAt: now,
        lastSeenAt: now,
      });

    const exported = await runEffect(service.exportDevices(request(headers), tenant.id, {}));
    expect(exported.truncated).toBe(true);
    expect(exported.rowCount).toBe(10_000);
    // Header plus exactly the capped number of rows.
    expect(exported.csv.trimEnd().split("\r\n")).toHaveLength(10_001);
    expect(exported.csv).toContain("'=HYPERLINK");
    expect(exported.csv).not.toContain(",=HYPERLINK");
  });

  it("records enrollment attempts with a secret-free diagnostic", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const enrollment = await runEffect(service.getTenantEnrollment(request(headers), tenant.id));
    Object.assign(db.store.enterprise_enrollment[0], {
      enabledApple: true,
      enabledWindows: true,
      maxDevices: 100,
    });

    const result = await runEffect(
      service.getEnrollment(enrollment.id, undefined, {
        platform: "win",
        ip: "203.0.113.5",
        userAgent: `Windows NT 10.0 ${"x".repeat(400)}`,
      }),
    );

    expect(result.authenticated).toBe(true);
    expect(db.store.enrollment_attempt).toHaveLength(1);
    const attempt = db.store.enrollment_attempt[0];
    expect(attempt).toMatchObject({
      organizationId: tenant.id,
      enrollmentId: enrollment.id,
      platform: "win",
      outcome: "ok",
    });
    expect(attempt.detail).toBe("Windows discovery details issued");
    expect(attempt.ipHash).toHaveLength(32);
    expect(attempt.ipHash).not.toContain("203.0.113.5");
    expect(attempt.userAgent).toHaveLength(255);

    // Diagnostics are tenant-scoped, and the read requires membership.
    const other = await runEffect(
      service.createTenant(request(headers), { name: "Other", slug: "other" }),
    );

    expect(
      (await runEffect(service.listEnrollmentAttempts(request(headers), tenant.id))).attempts,
    ).toHaveLength(1);
    expect(
      (await runEffect(service.listEnrollmentAttempts(request(headers), other.id))).attempts,
    ).toHaveLength(0);
  });

  it("dedupes repeated public enrollment visits within the short window", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const enrollment = await runEffect(service.getTenantEnrollment(request(headers), tenant.id));

    const visit = () =>
      runEffect(
        service.getEnrollment(enrollment.id, undefined, {
          platform: "win",
          ip: "203.0.113.5",
          userAgent: "Windows NT 10.0",
        }),
      );

    await visit();
    await visit();
    await visit();
    expect(db.store.enrollment_attempt).toHaveLength(1);

    // Outside the short window the same visit is a new diagnostic again.
    db.store.enrollment_attempt[0]!.createdAt = new Date(Date.now() - 6 * 60 * 1000);
    await visit();
    expect(db.store.enrollment_attempt).toHaveLength(2);

    // A different outcome or client address is a distinct diagnostic.
    await runEffect(
      service.getEnrollment(enrollment.id, undefined, {
        platform: "win",
        ip: "198.51.100.9",
        userAgent: "Windows NT 10.0",
      }),
    );
    expect(db.store.enrollment_attempt).toHaveLength(3);
  });

  it("does not persist an address hash when no deployment secret is configured", async () => {
    const { db, service, headers } = await makeContext({ authSecret: null });

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const enrollment = await runEffect(service.getTenantEnrollment(request(headers), tenant.id));

    await runEffect(
      service.getEnrollment(enrollment.id, undefined, {
        platform: "win",
        ip: "203.0.113.5",
        userAgent: "Windows NT 10.0",
      }),
    );
    expect(db.store.enrollment_attempt).toHaveLength(1);
    expect(db.store.enrollment_attempt[0]!.ipHash).toBeNull();
  });

  it("classifies bad passwords, disabled platforms, limits and missing APNs", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const enrollment = await runEffect(service.getTenantEnrollment(request(headers), tenant.id));
    Object.assign(db.store.enterprise_enrollment[0], {
      code: "secret-code",
      enabledApple: true,
      enabledWindows: true,
      maxDevices: 100,
    });

    await runEffect(service.getEnrollment(enrollment.id, "wrong", { platform: "apple" }));
    expect(db.store.enrollment_attempt.at(-1)).toMatchObject({
      outcome: "bad_code",
      platform: "apple",
    });

    // Correct password, Apple enabled but no APNs certificate.
    await runEffect(service.getEnrollment(enrollment.id, "secret-code", { platform: "apple" }));
    expect(db.store.enrollment_attempt.at(-1)).toMatchObject({ outcome: "no_apns" });

    Object.assign(db.store.enterprise_enrollment[0], { enabledWindows: false });
    await runEffect(service.getEnrollment(enrollment.id, "secret-code", { platform: "win" }));
    expect(db.store.enrollment_attempt.at(-1)).toMatchObject({
      outcome: "disabled",
      platform: "win",
    });

    const now = new Date();
    db.store.device.push({
      id: "device-1",
      organizationId: tenant.id,
      proto: "apple",
      status: "enrolled",
      name: "Existing Mac",
      enrolledAt: now,
      lastSeenAt: now,
    });
    Object.assign(db.store.enterprise_enrollment[0], { maxDevices: 1 });
    await runEffect(service.getEnrollment(enrollment.id, "secret-code", { platform: "win" }));
    expect(db.store.enrollment_attempt.at(-1)).toMatchObject({ outcome: "limit" });
  });

  it("previews a mobileconfig with friendly payload categories", async () => {
    const { service } = await makeContext();

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>PayloadType</key><string>Configuration</string>
<key>PayloadDisplayName</key><string>Acme Profile</string>
<key>PayloadDescription</key><string>Corporate settings</string>
<key>PayloadOrganization</key><string>Acme</string>
<key>PayloadIdentifier</key><string>app.acme.profile</string>
<key>PayloadUUID</key><string>11111111-1111-1111-1111-111111111111</string>
<key>PayloadVersion</key><integer>1</integer>
<key>PayloadContent</key><array>
<dict>
<key>PayloadType</key><string>com.apple.wifi.managed</string>
<key>PayloadDisplayName</key><string>Corporate Wi-Fi</string>
<key>PayloadIdentifier</key><string>app.acme.wifi</string>
</dict>
</array>
</dict></plist>`;

    const preview = await runEffect(service.previewMobileconfig({ mobileconfig: btoa(xml) }));
    expect(preview).toMatchObject({
      displayName: "Acme Profile",
      description: "Corporate settings",
      organization: "Acme",
      identifier: "app.acme.profile",
      type: "Configuration",
    });
    expect(preview.payloads).toEqual([
      expect.objectContaining({ type: "com.apple.wifi.managed", category: "Wi-Fi" }),
    ]);
  });

  it("rejects an invalid mobileconfig preview", async () => {
    const { service } = await makeContext();
    await expect(
      runEffect(service.previewMobileconfig({ mobileconfig: "not base64!" })),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
  });
});

describe("Apple enrollment profile download", () => {
  const setupEnrollment = async () => {
    const context = await makeContext();

    const tenant = await runEffect(
      context.service.createTenant(request(context.headers), {
        name: "Profile Tenant",
        slug: "profile-tenant",
      }),
    );

    Object.assign(context.db.store.enterprise_enrollment[0], {
      enabledApple: true,
      maxDevices: 100,
    });
    context.db.store.apple_push_certificate.push({
      organizationId: tenant.id,
      email: "admin@example.com",
      topic: "com.apple.mgmt.External.profile",
      certPem: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----",
      encryptedKey: null,
      updatedAt: new Date(),
    });

    const enrollment = await runEffect(
      context.service.getTenantEnrollment(request(context.headers), tenant.id),
    );

    return { ...context, tenant, enrollment };
  };

  it("signs the profile, bootstrapping the tenant CA on first use", async () => {
    const { db, service, tenant, enrollment } = await setupEnrollment();

    const result = await runEffect(
      service.getAppleEnrollmentProfile(enrollment.id, undefined, { ip: "profile-ok" }),
    );

    expect(result.filename).toBe("profile-tenant-enrollment.mobileconfig");

    const buffer = new ArrayBuffer(result.profile.byteLength);

    new Uint8Array(buffer).set(result.profile);

    const contentInfo = pkijs.ContentInfo.fromBER(buffer);
    expect(contentInfo.contentType).toBe(pkijs.ContentInfo.SIGNED_DATA);

    const signedData = new pkijs.SignedData({ schema: contentInfo.content });

    const plist = new TextDecoder().decode(
      new Uint8Array(signedData.encapContentInfo.eContent!.getValue()),
    );

    expect(plist).toContain("<plist");
    expect(plist).toContain("com.apple.security.scep");
    expect(plist).toContain(`/mdm/apple/scep/${tenant.id}`);
    expect(plist).toContain("com.apple.mdm.per-user-connections");
    expect(plist).not.toContain("com.apple.mdm.token");

    const verification = await signedData.verify({
      signer: 0,
      checkChain: false,
      extendedMode: true,
    });

    expect(verification.signatureVerified).toBe(true);
    // The tenant CA was created and is the signer.
    expect(db.store.scep_ca).toHaveLength(1);
    expect(db.store.scep_ca[0]?.organizationId).toBe(tenant.id);

    const response = appleEnrollmentProfileResponse(result);
    expect(response.headers["content-type"]).toBe("application/x-apple-aspen-config");
    expect(response.headers["content-disposition"]).toBe(
      'attachment; filename="profile-tenant-enrollment.mobileconfig"',
    );
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("signs with the tenant's existing CA and seals a legacy plaintext key", async () => {
    const { db, service, tenant, enrollment } = await setupEnrollment();
    const caKeys = await generateCaKeyPair();
    const caCertPem = await testCertificate({ keyPair: caKeys });

    db.store.scep_ca.push({
      id: 1,
      organizationId: tenant.id,
      certPem: caCertPem,
      privateKeyJwk: await exportPrivateKeyJwk(caKeys.privateKey),
      source: "generated",
      createdAt: new Date(),
      rotatedAt: null,
    });

    const result = await runEffect(
      service.getAppleEnrollmentProfile(enrollment.id, undefined, { ip: "profile-signed" }),
    );

    const buffer = new ArrayBuffer(result.profile.byteLength);

    new Uint8Array(buffer).set(result.profile);

    const contentInfo = pkijs.ContentInfo.fromBER(buffer);

    expect(contentInfo.contentType).toBe(pkijs.ContentInfo.SIGNED_DATA);

    const signedData = new pkijs.SignedData({ schema: contentInfo.content });

    expect(signedData.signerInfos).toHaveLength(1);
    expect(
      new TextDecoder().decode(new Uint8Array(signedData.encapContentInfo.eContent!.getValue())),
    ).toContain("com.apple.security.scep");

    const verification = await signedData.verify({
      signer: 0,
      checkChain: false,
      extendedMode: true,
    });

    expect(verification.signatureVerified).toBe(true);
    expect(result.filename).toBe("profile-tenant-enrollment.mobileconfig");
    // The legacy plaintext key row is sealed as it is read.
    expect(db.store.scep_ca[0]?.privateKeyJwk).toMatchObject({ v: 1 });
  });

  it("rejects a bad password and disabled/APNs-missing enrollments", async () => {
    const { db, service, enrollment } = await setupEnrollment();
    Object.assign(db.store.enterprise_enrollment[0], { code: "secret" });
    await expect(
      runEffect(
        service.getAppleEnrollmentProfile(enrollment.id, "wrong", { ip: "profile-bad-code" }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);

    // Try the missing APNs branch with the correct password.
    db.store.apple_push_certificate.length = 0;
    await expect(
      runEffect(
        service.getAppleEnrollmentProfile(enrollment.id, "secret", { ip: "profile-no-apns" }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    Object.assign(db.store.enterprise_enrollment[0], { enabledApple: false });
    await expect(
      runEffect(
        service.getAppleEnrollmentProfile(enrollment.id, "secret", { ip: "profile-disabled" }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
  });

  it("returns not found for an unknown enrollment", async () => {
    const { service } = await makeContext();
    await expect(
      runEffect(service.getAppleEnrollmentProfile("missing", undefined, { ip: "profile-missing" })),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);
  });
});

describe("device pre-registration", () => {
  const setup = async () => {
    const context = await makeContext();

    const first = await runEffect(
      context.service.createTenant(request(context.headers), { name: "First", slug: "first" }),
    );

    const second = await runEffect(
      context.service.createTenant(request(context.headers), { name: "Second", slug: "second" }),
    );

    const firstGroup = await runEffect(
      context.service.createGroup(request(context.headers), first.id, {
        name: "Staff",
      }),
    );

    const secondGroup = await runEffect(
      context.service.createGroup(request(context.headers), second.id, {
        name: "Other Tenant",
      }),
    );

    return { ...context, first, second, firstGroup, secondGroup };
  };

  it("imports rows, resolves tenant groups and upserts by serial", async () => {
    const { db, service, headers, first, second, secondGroup } = await setup();

    const imported = await runEffect(
      service.importDevicePreRegistrations(request(headers), first.id, {
        rows: [
          {
            serial: "C02A",
            name: "Alice Mac",
            assetTag: "AT-1",
            notes: "Front desk",
            groupName: "Staff",
          },
          { serial: "C02B", name: "Bob Mac", groupName: "Missing" },
          { serial: "", name: "No serial" },
        ],
      }),
    );

    expect(imported).toMatchObject({ created: 1, updated: 0, failed: 2 });
    expect(imported.results.map((row) => row.status)).toEqual(["created", "error", "error"]);
    expect(db.store.device_pre_registration).toMatchObject([
      {
        organizationId: first.id,
        serial: "C02A",
        name: "Alice Mac",
        assetTag: "AT-1",
        notes: "Front desk",
        groupId: expect.any(String),
        consumedDeviceId: null,
      },
    ]);

    // Cross-tenant group ids are rejected, not silently applied.
    const crossTenant = await runEffect(
      service.importDevicePreRegistrations(request(headers), first.id, {
        rows: [{ serial: "C02C", groupId: secondGroup.id }],
      }),
    );

    expect(crossTenant.failed).toBe(1);

    // Re-importing the same serial updates the row rather than duplicating it.
    const updated = await runEffect(
      service.importDevicePreRegistrations(request(headers), first.id, {
        rows: [{ serial: "C02A", name: "Alice MacBook", assetTag: "AT-2", groupName: "Staff" }],
      }),
    );

    expect(updated).toMatchObject({ created: 0, updated: 1, failed: 0 });
    expect(db.store.device_pre_registration).toHaveLength(1);
    expect(db.store.device_pre_registration[0]).toMatchObject({
      name: "Alice MacBook",
      assetTag: "AT-2",
      notes: "Front desk",
    });

    const listed = await runEffect(service.listDevicePreRegistrations(request(headers), first.id));
    expect(listed.rows).toEqual([
      expect.objectContaining({ serial: "C02A", groupName: "Staff", assetTag: "AT-2" }),
    ]);

    // The other tenant cannot see or delete the registration.
    const otherList = await runEffect(
      service.listDevicePreRegistrations(request(headers), second.id),
    );

    expect(otherList.rows).toEqual([]);
    await expect(
      runEffect(
        service.deleteDevicePreRegistration(request(headers), second.id, listed.rows[0].id),
      ),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);
  });

  it("bulk-deletes only rows in the requested tenant", async () => {
    const { db, service, headers, first } = await setup();

    const imported = await runEffect(
      service.importDevicePreRegistrations(request(headers), first.id, {
        rows: [{ serial: "C02A" }, { serial: "C02B" }],
      }),
    );

    expect(imported.created).toBe(2);
    const ids = db.store.device_pre_registration.map((row: { id: string }) => row.id);
    await runEffect(service.deleteDevicePreRegistrations(request(headers), first.id, ids));
    expect(db.store.device_pre_registration).toHaveLength(0);
  });

  it("requires write access to import", async () => {
    const { db, service, headers, first } = await setup();
    db.store.member[0]!.role = "member";
    await expect(
      runEffect(
        service.importDevicePreRegistrations(request(headers), first.id, {
          rows: [{ serial: "C02A" }],
        }),
      ),
    ).rejects.toBeInstanceOf(EnterprisePermissionDenied);
  });
});

describe("audit search and export", () => {
  const setup = async () => {
    const context = await makeContext();

    const first = await runEffect(
      context.service.createTenant(request(context.headers), { name: "First", slug: "first" }),
    );

    const second = await runEffect(
      context.service.createTenant(request(context.headers), { name: "Second", slug: "second" }),
    );

    return { ...context, first, second };
  };

  const auditRow = (
    organizationId: string,
    id: string,
    createdAt: Date,
    overrides: Schema.JsonObject = {},
  ) => ({
    id,
    organizationId,
    actorAccountId: "user-1",
    actorEmail: "owner@example.com",
    action: "device.action",
    targetType: "device",
    targetId: `device-${id}`,
    metadata: { id },
    createdAt,
    ...overrides,
  });

  it("scopes to the tenant and pages newest first with a stable cursor", async () => {
    const { db, service, headers, first, second } = await setup();
    const at = (hour: number) => new Date(`2026-01-01T${String(hour).padStart(2, "0")}:00:00.000Z`);
    db.store.audit_log.push(
      auditRow(first.id, "audit-a", at(10)),
      auditRow(first.id, "audit-b", at(12)),
      auditRow(first.id, "audit-c", at(12)),
      auditRow(first.id, "audit-d", at(11)),
      auditRow(second.id, "audit-other", at(13)),
    );

    const firstPage = await runEffect(
      service.searchAuditLog(request(headers), first.id, { action: "device.action", limit: 2 }),
    );

    expect(firstPage.entries.map((entry: any) => entry.id)).toEqual(["audit-c", "audit-b"]);
    expect(firstPage.nextCursor).toBeTruthy();
    expect(firstPage.entries.every((entry: any) => entry.id !== "audit-other")).toBe(true);

    const secondPage = await runEffect(
      service.searchAuditLog(request(headers), first.id, {
        action: "device.action",
        limit: 2,
        cursor: firstPage.nextCursor!,
      }),
    );

    expect(secondPage.entries.map((entry: any) => entry.id)).toEqual(["audit-d", "audit-a"]);
    expect(secondPage.nextCursor).toBeNull();

    const all = [...firstPage.entries, ...secondPage.entries].map((entry: any) => entry.id);
    expect(new Set(all).size).toBe(4);
  });

  it("supports legacy offset paging", async () => {
    const { db, service, headers, first } = await setup();
    const at = (hour: number) => new Date(`2026-01-01T${String(hour).padStart(2, "0")}:00:00.000Z`);
    db.store.audit_log.push(
      auditRow(first.id, "audit-a", at(10)),
      auditRow(first.id, "audit-b", at(11)),
      auditRow(first.id, "audit-c", at(12)),
    );

    const page = await runEffect(
      service.searchAuditLog(request(headers), first.id, {
        action: "device.action",
        offset: 1,
        limit: 1,
      }),
    );

    expect(page.entries.map((entry: any) => entry.id)).toEqual(["audit-b"]);
    expect(page.nextCursor).toBeTruthy();

    const next = await runEffect(
      service.searchAuditLog(request(headers), first.id, {
        action: "device.action",
        cursor: page.nextCursor!,
        limit: 1,
      }),
    );

    expect(next.entries.map((entry: any) => entry.id)).toEqual(["audit-a"]);
  });

  it("filters by actor, target, dates and escapes LIKE wildcards", async () => {
    const { db, service, headers, first } = await setup();
    db.store.audit_log.push(
      auditRow(first.id, "audit-a", new Date("2026-01-01T10:00:00.000Z"), {
        actorEmail: "alice@example.com",
        targetId: "device-ABC",
      }),
      auditRow(first.id, "audit-b", new Date("2026-01-02T10:00:00.000Z"), {
        actorAccountId: "user-bob",
        actorEmail: "bob@example.com",
        targetId: "dev%1",
      }),
      auditRow(first.id, "audit-c", new Date("2026-01-03T10:00:00.000Z"), {
        targetId: "devZZ1",
        targetType: "policy",
        action: "policy.updated",
      }),
    );

    const byEmail = await runEffect(
      service.searchAuditLog(request(headers), first.id, { actor: "alice" }),
    );

    expect(byEmail.entries.map((entry: any) => entry.id)).toEqual(["audit-a"]);

    const byUserId = await runEffect(
      service.searchAuditLog(request(headers), first.id, { actor: "user-bob" }),
    );

    expect(byUserId.entries.map((entry: any) => entry.id)).toEqual(["audit-b"]);

    // `%` in the filter is literal, not a wildcard.
    const byTarget = await runEffect(
      service.searchAuditLog(request(headers), first.id, { targetId: "dev%1" }),
    );

    expect(byTarget.entries.map((entry: any) => entry.id)).toEqual(["audit-b"]);

    const byType = await runEffect(
      service.searchAuditLog(request(headers), first.id, { targetType: "policy" }),
    );

    expect(byType.entries.map((entry: any) => entry.id)).toEqual(["audit-c"]);

    const byRange = await runEffect(
      service.searchAuditLog(request(headers), first.id, {
        action: "device.action",
        from: "2026-01-01T10:00:00.000Z",
        to: "2026-01-02T10:00:00.000Z",
      }),
    );

    expect(byRange.entries.map((entry: any) => entry.id)).toEqual(["audit-b", "audit-a"]);

    await expect(
      runEffect(
        service.searchAuditLog(request(headers), first.id, {
          from: "2026-02-01T00:00:00.000Z",
          to: "2026-01-01T00:00:00.000Z",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
  });

  it("caps CSV exports, signals truncation and neutralises formulas", async () => {
    const { db, service, headers, first } = await setup();

    for (let index = 0; index < 10_001; index++)
      db.store.audit_log.push(
        auditRow(first.id, `audit-${index}`, new Date(2026, 0, 1, 0, 0, index), {
          // Newest row, so it survives the export cap and is the first CSV row.
          actorEmail: index === 10_000 ? '=HYPERLINK("https://evil.example")' : "owner@example.com",
          action: "device.action",
        }),
      );

    const exported = await runEffect(
      service.exportAuditLog(request(headers), first.id, {
        action: "device.action",
        format: "csv",
      }),
    );

    expect(exported.truncated).toBe(true);
    expect(exported.rowCount).toBe(10_000);
    expect(exported.body.trimEnd().split("\r\n")).toHaveLength(10_001);
    expect(exported.body).toContain("'=HYPERLINK");
    expect(exported.body).not.toContain(",=HYPERLINK");

    const json = await runEffect(
      service.exportAuditLog(request(headers), first.id, {
        action: "tenant.created",
        format: "json",
      }),
    );

    const entries = Schema.decodeUnknownSync(Schema.Array(AuditExportEntry))(JSON.parse(json.body));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: "tenant.created",
      actorEmail: "owner@example.com",
    });
  });
});

describe("Autopilot service configuration", () => {
  it("reports Graph/federated state and fails closed when unconfigured", async () => {
    const { service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const settings = await runEffect(service.getAutopilotSettings(request(headers), tenant.id));
    expect(settings).toMatchObject({
      configured: false,
      graphConfigured: false,
      azureTenantId: null,
      deviceCount: 0,
      profileCount: 0,
      federatedEnrollment: { enabled: false },
    });

    await expect(
      runEffect(
        service.importAutopilotDevices(request(headers), tenant.id, {
          content: "ABC123,aGFzaA==",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseNotConfigured);

    await expect(
      runEffect(
        service.createAutopilotProfile(request(headers), tenant.id, {
          name: "Standard",
          deploymentMode: "userDriven",
          joinType: "azureADJoin",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseNotConfigured);

    await expect(
      runEffect(service.syncAutopilotDevices(request(headers), tenant.id)),
    ).rejects.toBeInstanceOf(EnterpriseNotConfigured);
  });

  it("rejects an invalid profile before checking Graph configuration", async () => {
    const { service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    await expect(
      runEffect(
        service.createAutopilotProfile(request(headers), tenant.id, {
          name: "Hybrid",
          deploymentMode: "selfDeploying",
          joinType: "hybridAzureADJoin",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
  });
});

describe("tenant SCEP CA", () => {
  const prepareTenant = async (
    context: Awaited<ReturnType<typeof makeContext>>,
    name: string,
    slug: string,
  ) => {
    const tenant = await runEffect(
      context.service.createTenant(request(context.headers), { name, slug }),
    );

    const enrollmentRow = context.db.store.enterprise_enrollment.find(
      (row: any) => row.organizationId === tenant.id,
    )!;

    Object.assign(enrollmentRow, { enabledApple: true, maxDevices: 100 });
    context.db.store.apple_push_certificate.push({
      organizationId: tenant.id,
      email: `admin@${slug}.test`,
      topic: `com.apple.mgmt.External.${slug}`,
      certPem: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----",
      encryptedKey: null,
      updatedAt: new Date(),
    });

    const enrollment = await runEffect(
      context.service.getTenantEnrollment(request(context.headers), tenant.id),
    );

    return { tenant, enrollment };
  };

  const profileFor = (
    context: Awaited<ReturnType<typeof makeContext>>,
    enrollment: { id: string },
    ip: string,
  ) => runEffect(context.service.getAppleEnrollmentProfile(enrollment.id, undefined, { ip }));

  it("reports an unconfigured CA and the tenant SCEP URL before first use", async () => {
    const context = await makeContext();

    const tenant = await runEffect(
      context.service.createTenant(request(context.headers), { name: "Acme", slug: "acme" }),
    );

    const info = await runEffect(
      context.service.getTenantScepCa(request(context.headers), tenant.id),
    );

    expect(info.configured).toBe(false);
    expect(info.scepUrl).toBe(`${origin}/mdm/apple/scep/${tenant.id}`);
    expect(info.fingerprintSha256).toBeNull();
    expect(context.db.store.scep_ca).toHaveLength(0);
  });

  it("bootstraps an isolated CA per tenant", async () => {
    const context = await makeContext();
    const first = await prepareTenant(context, "Alpha", "alpha");
    const second = await prepareTenant(context, "Beta", "beta");

    await profileFor(context, first.enrollment, "profile-alpha");
    await profileFor(context, second.enrollment, "profile-beta");

    const firstInfo = await runEffect(
      context.service.getTenantScepCa(request(context.headers), first.tenant.id),
    );

    const secondInfo = await runEffect(
      context.service.getTenantScepCa(request(context.headers), second.tenant.id),
    );

    expect(firstInfo).toMatchObject({
      configured: true,
      source: "generated",
      commonName: "Mattrax SCEP CA",
    });
    expect(secondInfo).toMatchObject({ configured: true, source: "generated" });
    expect(firstInfo.fingerprintSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(firstInfo.fingerprintSha256).not.toBe(secondInfo.fingerprintSha256);

    const rows = context.db.store.scep_ca;
    expect(rows).toHaveLength(2);
    expect(rows.find((row: any) => row.organizationId === first.tenant.id)?.certPem).not.toBe(
      rows.find((row: any) => row.organizationId === second.tenant.id)?.certPem,
    );
  });

  it("rotates a tenant CA without invalidating another tenant", async () => {
    const context = await makeContext();
    const first = await prepareTenant(context, "Alpha", "alpha");
    const second = await prepareTenant(context, "Beta", "beta");

    await profileFor(context, first.enrollment, "profile-alpha");
    await profileFor(context, second.enrollment, "profile-beta");

    const before = await runEffect(
      context.service.getTenantScepCa(request(context.headers), first.tenant.id),
    );

    const beforeCertPem = context.db.store.scep_ca.find(
      (row: any) => row.organizationId === first.tenant.id,
    )?.certPem;

    const otherBefore = await runEffect(
      context.service.getTenantScepCa(request(context.headers), second.tenant.id),
    );

    context.db.store.scep_issued_certificate.push({
      serial: "alpha-serial",
      organizationId: first.tenant.id,
      enrollmentId: null,
      deviceId: null,
      notAfter: new Date(Date.now() + 86_400_000),
      revokedAt: null,
      createdAt: new Date(),
    });

    const rotated = await runEffect(
      context.service.rotateTenantScepCa(request(context.headers), first.tenant.id),
    );

    expect(rotated.configured).toBe(true);
    expect(rotated.fingerprintSha256).not.toBe(before.fingerprintSha256);
    expect(rotated.rotatedAt).toBeTruthy();

    const otherAfter = await runEffect(
      context.service.getTenantScepCa(request(context.headers), second.tenant.id),
    );

    expect(otherAfter.fingerprintSha256).toBe(otherBefore.fingerprintSha256);

    // Rotation is not revocation: the identity issued by the retired CA stays
    // valid for its lifetime and can renew during the overlap.
    expect(context.db.store.scep_issued_certificate[0]?.revokedAt).toBeNull();

    const trust = context.db.store.scep_ca_trust.filter(
      (row: any) => row.organizationId === first.tenant.id,
    );

    expect(trust).toHaveLength(1);
    expect(trust[0]?.certPem).toBe(beforeCertPem);
    // The retired CA stays a trust anchor until its own expiry.
    expect(trust[0]?.trustUntil).toEqual(new Date(before.notAfter!));
    // The seeded identity predates issuing-CA attribution, so it is counted as
    // unattributed while still being covered by the retired anchor.
    expect(rotated.retiring).toMatchObject([
      { fingerprintSha256: before.fingerprintSha256, identities: 0 },
    ]);
    expect(rotated.unattributedIdentities).toBe(1);
    expect(rotated.rotationDue).toBe(false);
  });

  it("requires step-up for CA rotation and import", async () => {
    const context = await makeContext({
      auth: {
        requireStepUp: (_request: any, action: any) =>
          Effect.fail(
            new StepUpRequired({
              message: "Confirm this action with your authenticator or passkey.",
              action,
              methods: ["passkey", "totp"],
            }),
          ),
      },
    });

    const tenant = await runEffect(
      context.service.createTenant(request(context.headers), { name: "Acme", slug: "acme" }),
    );

    await expect(
      runEffect(context.service.rotateTenantScepCa(request(context.headers), tenant.id)),
    ).rejects.toBeInstanceOf(StepUpRequired);

    await expect(
      runEffect(
        context.service.importTenantScepCa(request(context.headers), tenant.id, {
          certificatePem: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----",
          privateKeyPem: "-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----",
        }),
      ),
    ).rejects.toBeInstanceOf(StepUpRequired);

    // Step-up happens before any CA read or write.
    expect(context.db.store.scep_ca).toHaveLength(0);
    expect(context.db.store.audit_log.some((row: any) => row.action.startsWith("scep_ca."))).toBe(
      false,
    );
  });

  it("audits a CA rotation with its source and fingerprint", async () => {
    const context = await makeContext();
    const { tenant, enrollment } = await prepareTenant(context, "Alpha", "alpha");
    await profileFor(context, enrollment, "profile-alpha");

    const rotated = await runEffect(
      context.service.rotateTenantScepCa(request(context.headers), tenant.id),
    );

    const entry = context.db.store.audit_log.find((row: any) => row.action === "scep_ca.rotated");

    expect(entry).toMatchObject({
      organizationId: tenant.id,
      actorAccountId: "user-1",
      actorEmail: "owner@example.com",
      targetType: "scep_ca",
      metadata: {
        mode: "overlap",
        source: "generated",
        fingerprintSha256: rotated.fingerprintSha256,
        commonName: "Mattrax SCEP CA",
        revokedCertificates: 0,
      },
    });
    expect(entry.metadata.fingerprintSha256).not.toBe(entry.metadata.previousFingerprintSha256);
    expect(entry.metadata.previousFingerprintSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("leaves the current CA in place when the successor cannot be stored", async () => {
    const context = await makeContext();
    const { tenant, enrollment } = await prepareTenant(context, "Alpha", "alpha");
    await profileFor(context, enrollment, "profile-alpha");

    const before = await runEffect(
      context.service.getTenantScepCa(request(context.headers), tenant.id),
    );

    const certPem = context.db.store.scep_ca[0]?.certPem;

    const update = context.db.update;
    context.db.update = (table: any) => {
      if (table === schema.scepCa)
        return {
          set: () => ({
            where: () => Effect.fail(new Error("replacement failed")),
          }),
        };

      return update(table);
    };

    await expect(
      runEffect(context.service.rotateTenantScepCa(request(context.headers), tenant.id)),
    ).rejects.toBeTruthy();

    // The retired anchor is written before the current CA is replaced, so a
    // failed replacement leaves the original CA current — devices keep working.
    expect(context.db.store.scep_ca[0]?.certPem).toBe(certPem);
    expect(context.db.store.audit_log.some((row: any) => row.action === "scep_ca.rotated")).toBe(
      false,
    );

    const after = await runEffect(
      context.service.getTenantScepCa(request(context.headers), tenant.id),
    );

    expect(after.fingerprintSha256).toBe(before.fingerprintSha256);
  });

  it("issues a short-lived enrollment challenge and invalidates it on reset", async () => {
    const context = await makeContext();
    const { tenant, enrollment } = await prepareTenant(context, "Alpha", "alpha");

    await profileFor(context, enrollment, "profile-alpha");

    const challenges = () =>
      context.db.store.scep_challenge.filter((row: any) => row.organizationId === tenant.id);

    const challenge = challenges().at(-1)!;
    const lifetime = challenge.expiresAt.getTime() - Date.now();

    expect(lifetime).toBeGreaterThan(59 * 60 * 1000);
    expect(lifetime).toBeLessThanOrEqual(60 * 60 * 1000 + 5_000);

    // Changing the enrollment settings invalidates profiles already handed out.
    await runEffect(
      context.service.patchTenantEnrollment(request(context.headers), tenant.id, {
        enabledApple: true,
      }),
    );

    expect(challenges()).toHaveLength(0);

    await profileFor(context, enrollment, "profile-beta");
    expect(challenges()).toHaveLength(1);

    // Resetting issues a new enrollment id and drops every unused challenge.
    await runEffect(context.service.resetTenantEnrollment(request(context.headers), tenant.id));
    expect(challenges()).toHaveLength(0);
  });

  it("honours a configured enrollment challenge lifetime", async () => {
    const context = await makeContext({ enrollmentProfileTtlSeconds: 120 });
    const { enrollment } = await prepareTenant(context, "Alpha", "alpha");

    await profileFor(context, enrollment, "profile-alpha");

    const challenge = context.db.store.scep_challenge.at(-1)!;
    const lifetime = challenge.expiresAt.getTime() - Date.now();

    expect(lifetime).toBeGreaterThan(115_000);
    expect(lifetime).toBeLessThanOrEqual(125_000);
  });

  it("imports a tenant-supplied CA and rejects a mismatched key", async () => {
    const context = await makeContext();

    const tenant = await runEffect(
      context.service.createTenant(request(context.headers), { name: "Acme", slug: "acme" }),
    );

    const keys = await generateCaKeyPair();

    const caCert = await createCaCertificate(keys, "Acme Trusted CA", {
      organizationalUnit: tenant.id,
    });

    const certificatePem = certToPem(caCert);

    const privateKeyPem = pemEncode(
      "PRIVATE KEY",
      await crypto.subtle.exportKey("pkcs8", keys.privateKey),
    );

    const fingerprint = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", caCert.toSchema().toBER(false))),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");

    const imported = await runEffect(
      context.service.importTenantScepCa(request(context.headers), tenant.id, {
        certificatePem,
        privateKeyPem,
      }),
    );

    expect(imported).toMatchObject({
      configured: true,
      source: "imported",
      commonName: "Acme Trusted CA",
      fingerprintSha256: fingerprint,
    });
    expect(context.db.store.scep_ca[0]?.certPem).toBe(certificatePem);

    expect(
      context.db.store.audit_log.find((row: any) => row.action === "scep_ca.imported"),
    ).toMatchObject({
      organizationId: tenant.id,
      actorAccountId: "user-1",
      metadata: { source: "imported", fingerprintSha256: fingerprint },
    });

    // A key that does not match the certificate is rejected before it is stored.
    const otherKeys = await generateCaKeyPair();

    const mismatchedKeyPem = pemEncode(
      "PRIVATE KEY",
      await crypto.subtle.exportKey("pkcs8", otherKeys.privateKey),
    );

    await expect(
      runEffect(
        context.service.importTenantScepCa(request(context.headers), tenant.id, {
          certificatePem,
          privateKeyPem: mismatchedKeyPem,
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
    expect(context.db.store.scep_ca[0]?.certPem).toBe(certificatePem);
  });
});

describe("Windows activation reporting", () => {
  const seedDevice = (
    db: any,
    organizationId: string,
    input: {
      id: string;
      proto?: string;
      status?: string;
      windowsActivationStatus?: string | null;
    },
  ) => {
    const now = new Date();

    db.store.device.push({
      id: input.id,
      organizationId,
      proto: input.proto ?? "win",
      status: input.status ?? "enrolled",
      name: input.id,
      enrolledAt: now,
      lastSeenAt: now,
      windowsActivationStatus: input.windowsActivationStatus ?? null,
    });
  };

  const authorization = async (deviceId: string) => ({
    authorization: `Bearer ${await scriptAgentToken(deviceId, authSecret)}`,
  });

  const tenantFor = async () => {
    const context = await makeContext();

    const tenant = await runEffect(
      context.service.createTenant(request(context.headers), { name: "Acme", slug: "acme" }),
    );

    return { ...context, tenantId: tenant.id };
  };

  it("stores the raw reading and a normalised state for a Windows device", async () => {
    const { db, service, headers, tenantId } = await tenantFor();

    seedDevice(db, tenantId, { id: "win-1" });

    const result = await runEffect(
      service.reportWindowsActivation(request(await authorization("win-1")), {
        licenseStatus: 5,
        licenseName: "Windows(R), Professional edition",
        productKeyChannel: "Retail",
        edition: "Microsoft Windows 11 Pro",
        sampledAt: "2020-01-01T10:00:00.000Z",
      }),
    );

    expect(result).toEqual({ status: "ok", applied: true, activation: "not-activated" });

    const row = db.store.device.find((device: any) => device.id === "win-1");

    expect(row).toMatchObject({
      windowsActivationStatus: "not-activated",
      windowsActivationLicenseStatus: 5,
      windowsActivationEdition: "Microsoft Windows 11 Pro",
      windowsActivationChannel: "Retail",
      windowsActivationLicenseName: "Windows(R), Professional edition",
    });
    expect(row.windowsActivationUpdatedAt).toEqual(new Date("2020-01-01T10:00:00.000Z"));

    const detail = await runEffect(service.getDevice(request(headers), tenantId, "win-1"));

    expect(detail.windows?.security.activation).toMatchObject({
      status: "not-activated",
      licenseStatus: 5,
      licenseName: "Windows(R), Professional edition",
      productKeyChannel: "Retail",
      edition: "Microsoft Windows 11 Pro",
      updatedAt: "2020-01-01T10:00:00.000Z",
    });
  });

  it("leaves activation absent until the agent reports it", async () => {
    const { db, service, headers, tenantId } = await tenantFor();

    seedDevice(db, tenantId, { id: "win-1" });

    const detail = await runEffect(service.getDevice(request(headers), tenantId, "win-1"));

    expect(detail.windowsActivationStatus).toBeNull();
    expect(detail.windows?.security.activation).toBeUndefined();
  });

  it("records an unreadable reading as unknown rather than not activated", async () => {
    const { db, service, tenantId } = await tenantFor();

    seedDevice(db, tenantId, { id: "win-1" });

    const result = await runEffect(
      service.reportWindowsActivation(request(await authorization("win-1")), {}),
    );

    expect(result.activation).toBe("unknown");
  });

  it("ignores a sample older than the stored one", async () => {
    const { db, service, tenantId } = await tenantFor();

    seedDevice(db, tenantId, { id: "win-1", windowsActivationStatus: "activated" });

    const row = db.store.device.find((device: any) => device.id === "win-1")!;
    row.windowsActivationLicenseStatus = 1;
    row.windowsActivationEdition = "Microsoft Windows 11 Pro";
    row.windowsActivationUpdatedAt = new Date("2026-01-02T00:00:00.000Z");

    const result = await runEffect(
      service.reportWindowsActivation(request(await authorization("win-1")), {
        licenseStatus: 5,
        edition: "Microsoft Windows 10 Pro",
        sampledAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    expect(result).toEqual({ status: "ok", applied: false, activation: "activated" });
    expect(row).toMatchObject({
      windowsActivationStatus: "activated",
      windowsActivationLicenseStatus: 1,
      windowsActivationEdition: "Microsoft Windows 11 Pro",
    });
    expect(row.windowsActivationUpdatedAt).toEqual(new Date("2026-01-02T00:00:00.000Z"));
  });

  it("clamps a future or unstorable sample timestamp to the ingest time", async () => {
    const { db, service, tenantId } = await tenantFor();

    seedDevice(db, tenantId, { id: "win-1" });

    const before = Date.now();

    const future = await runEffect(
      service.reportWindowsActivation(request(await authorization("win-1")), {
        licenseStatus: 1,
        sampledAt: "9999-12-31T23:59:59.000Z",
      }),
    );

    expect(future.applied).toBe(true);

    const row = db.store.device.find((device: any) => device.id === "win-1")!;
    // SAFETY: the handler always writes a Date to windowsActivationUpdatedAt.
    const stored = row.windowsActivationUpdatedAt as Date;

    expect(stored.getTime()).toBeGreaterThanOrEqual(before);
    expect(stored.getTime()).toBeLessThanOrEqual(Date.now() + 1_000);

    // A clock before MySQL's `datetime` floor (year 1000) is corrupt, not a
    // reason to fail the report.
    const ancient = await runEffect(
      service.reportWindowsActivation(request(await authorization("win-1")), {
        licenseStatus: 0,
        sampledAt: "0001-01-01T00:00:00.000Z",
      }),
    );

    expect(ancient).toMatchObject({ applied: true, activation: "not-activated" });
    // SAFETY: the handler always writes a Date to windowsActivationUpdatedAt.
    const ancientStored = row.windowsActivationUpdatedAt as Date;

    expect(ancientStored.getUTCFullYear()).toBeGreaterThanOrEqual(2020);
  });

  it("drops fractional, out-of-range and huge licence status values", async () => {
    const { db, service, tenantId } = await tenantFor();

    seedDevice(db, tenantId, { id: "win-1" });

    const samples: ReadonlyArray<{ licenseStatus: number; sampledAt: string }> = [
      { licenseStatus: 1.5, sampledAt: "2020-01-01T00:00:00.000Z" },
      { licenseStatus: 7, sampledAt: "2020-01-02T00:00:00.000Z" },
      { licenseStatus: -1, sampledAt: "2020-01-03T00:00:00.000Z" },
      { licenseStatus: 1e20, sampledAt: "2020-01-04T00:00:00.000Z" },
    ];

    for (const sample of samples) {
      const result = await runEffect(
        service.reportWindowsActivation(request(await authorization("win-1")), sample),
      );

      expect(result.activation).toBe("unknown");

      const row = db.store.device.find((device: any) => device.id === "win-1")!;

      expect(row.windowsActivationStatus).toBe("unknown");
      expect(row.windowsActivationLicenseStatus).toBeNull();
    }
  });

  it("rejects a non-Windows device", async () => {
    const { db, service, tenantId } = await tenantFor();

    seedDevice(db, tenantId, { id: "mac-1", proto: "apple" });

    await expect(
      runEffect(
        service.reportWindowsActivation(request(await authorization("mac-1")), {
          licenseStatus: 1,
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    const row = db.store.device.find((device: any) => device.id === "mac-1");

    expect(row.windowsActivationStatus).toBeNull();
  });

  it("requires a valid device token", async () => {
    const { db, service, tenantId } = await tenantFor();

    seedDevice(db, tenantId, { id: "win-1" });

    await expect(
      runEffect(
        service.reportWindowsActivation(request({ authorization: "Bearer forged" }), {
          licenseStatus: 1,
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseUnauthorized);
  });

  it("filters the device list by activation and never matches other platforms", async () => {
    const { db, service, headers, tenantId } = await tenantFor();

    seedDevice(db, tenantId, { id: "win-activated", windowsActivationStatus: "activated" });
    seedDevice(db, tenantId, { id: "win-not-activated", windowsActivationStatus: "not-activated" });
    seedDevice(db, tenantId, { id: "win-unreported" });
    seedDevice(db, tenantId, { id: "mac-1", proto: "apple" });

    const notActivated = await runEffect(
      service.searchDevices(request(headers), tenantId, { activation: "not-activated" }),
    );

    expect(notActivated.devices.map((device) => device.id)).toEqual(["win-not-activated"]);

    const unknown = await runEffect(
      service.searchDevices(request(headers), tenantId, { activation: "unknown" }),
    );

    expect(unknown.devices.map((device) => device.id)).toEqual(["win-unreported"]);

    const mac = unknown.devices.find((device) => device.id === "mac-1");

    expect(mac).toBeUndefined();
  });

  it("sorts Windows devices by activation", async () => {
    const { db, service, headers, tenantId } = await tenantFor();

    seedDevice(db, tenantId, { id: "win-unreported" });
    seedDevice(db, tenantId, { id: "win-not-activated", windowsActivationStatus: "not-activated" });
    seedDevice(db, tenantId, { id: "win-activated", windowsActivationStatus: "activated" });
    seedDevice(db, tenantId, { id: "mac-1", proto: "apple" });

    const ascending = await runEffect(
      service.searchDevices(request(headers), tenantId, {
        proto: "win",
        sort: "activation",
        direction: "asc",
      }),
    );

    expect(ascending.devices.map((device) => device.id)).toEqual([
      "win-unreported",
      "win-activated",
      "win-not-activated",
    ]);

    const descending = await runEffect(
      service.searchDevices(request(headers), tenantId, {
        proto: "win",
        sort: "activation",
        direction: "desc",
      }),
    );

    expect(descending.devices.map((device) => device.id)).toEqual([
      "win-not-activated",
      "win-activated",
      "win-unreported",
    ]);

    // The structured-query path sorts in memory rather than in SQL. It must
    // agree with the database order, including unreported devices first.
    const structured = await runEffect(
      service.searchDevices(request(headers), tenantId, {
        query: "name starts with win",
        sort: "activation",
        direction: "asc",
      }),
    );

    expect(structured.devices.map((device) => device.id)).toEqual([
      "win-unreported",
      "win-activated",
      "win-not-activated",
    ]);
  });

  it("exports Windows activation in the device CSV", async () => {
    const { db, service, headers, tenantId } = await tenantFor();

    seedDevice(db, tenantId, { id: "win-activated", windowsActivationStatus: "activated" });
    seedDevice(db, tenantId, { id: "win-unreported" });
    seedDevice(db, tenantId, { id: "mac-1", proto: "apple" });

    const exported = await runEffect(service.exportDevices(request(headers), tenantId, {}));
    const lines = exported.csv.trim().split("\r\n");
    const header = lines[0].split(",");
    const activation = header.indexOf("Activation");

    expect(activation).toBeGreaterThanOrEqual(0);

    const rowFor = (id: string) => lines.find((line) => line.startsWith(`${id},`))!.split(",");

    expect(rowFor("win-activated")[activation]).toBe("Activated");
    expect(rowFor("win-unreported")[activation]).toBe("Not reported");
    expect(rowFor("mac-1")[activation]).toBe("");
  });

  it("serialises activation on the device row and detail payload", async () => {
    const { db, service, headers, tenantId } = await tenantFor();

    seedDevice(db, tenantId, { id: "win-1", windowsActivationStatus: "activated" });

    const search = await runEffect(service.searchDevices(request(headers), tenantId, {}));

    expect(search.devices[0]?.windowsActivationStatus).toBe("activated");

    seedDevice(db, tenantId, { id: "mac-2", proto: "apple" });

    const macRow = await runEffect(service.getDevice(request(headers), tenantId, "mac-2"));

    expect(macRow.windowsActivationStatus).toBeNull();
    expect(macRow.windows).toBeNull();
  });
});

describe("dashboard reports", () => {
  it("maps report methods to dashboard read/write permissions", () => {
    expect(permissionForMethod("listDashboardReports")).toBe("dashboards.read");
    expect(permissionForMethod("listDashboardReportRuns")).toBe("dashboards.read");
    expect(permissionForMethod("exportDashboardReport")).toBe("dashboards.read");
    expect(permissionForMethod("createDashboardReport")).toBe("dashboards.write");
    expect(permissionForMethod("patchDashboardReport")).toBe("dashboards.write");
    expect(permissionForMethod("deleteDashboardReport")).toBe("dashboards.write");
    expect(permissionForMethod("sendDashboardReport")).toBe("dashboards.write");
  });

  it("creates, edits, queues and deletes a report scoped to its dashboard", async () => {
    const { db, service, headers } = await makeContext({
      email: makeEmailTransport(async () => undefined),
    });

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const dashboard = await runEffect(
      service.createDashboard(request(headers), tenant.id, { name: "Fleet" }),
    );

    const created = await runEffect(
      service.createDashboardReport(request(headers), tenant.id, dashboard.id, {
        name: "Weekly digest",
        frequency: "weekly",
        hourUtc: 8,
        format: "csv",
        recipients: { memberAccountIds: [], emails: ["owner@example.com"] },
      }),
    );

    expect(created).toMatchObject({
      name: "Weekly digest",
      frequency: "weekly",
      hourUtc: 8,
      format: "csv",
      enabled: true,
      recipients: { memberAccountIds: [], emails: ["owner@example.com"] },
    });
    expect(created.nextRunAt).not.toBeNull();

    const listed = await runEffect(
      service.listDashboardReports(request(headers), tenant.id, dashboard.id),
    );

    expect(listed.reports).toHaveLength(1);

    await runEffect(
      service.patchDashboardReport(request(headers), tenant.id, dashboard.id, created.id, {
        enabled: false,
        hourUtc: 9,
      }),
    );

    const afterPatch = await runEffect(
      service.listDashboardReports(request(headers), tenant.id, dashboard.id),
    );

    expect(afterPatch.reports[0]).toMatchObject({ enabled: false, hourUtc: 9 });

    // Send now renders the dashboard and queues the attachment.
    const run = await runEffect(
      service.sendDashboardReport(request(headers), tenant.id, dashboard.id, created.id),
    );

    expect(run.status).toBe("queued");
    expect(run.recipients).toEqual(["owner@example.com"]);
    expect(db.store.email_outbox).toHaveLength(1);

    const runs = await runEffect(
      service.listDashboardReportRuns(request(headers), tenant.id, dashboard.id, created.id),
    );

    expect(runs.runs[0]?.id).toBe(run.id);

    await runEffect(
      service.deleteDashboardReport(request(headers), tenant.id, dashboard.id, created.id),
    );

    const afterDelete = await runEffect(
      service.listDashboardReports(request(headers), tenant.id, dashboard.id),
    );

    expect(afterDelete.reports).toHaveLength(0);
  });

  it("requires dashboards.write to manage a report", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const dashboard = await runEffect(
      service.createDashboard(request(headers), tenant.id, { name: "Fleet" }),
    );

    // Demote the owner to a plain member: reads stay available, writes do not.
    db.store.member[0]!.role = "member";

    await expect(
      runEffect(
        service.createDashboardReport(request(headers), tenant.id, dashboard.id, {
          name: "Nope",
          frequency: "daily",
          format: "csv",
          recipients: { memberAccountIds: [], emails: [] },
        }),
      ),
    ).rejects.toBeInstanceOf(EnterprisePermissionDenied);
  });

  it("cannot reach a report through another tenant", async () => {
    const { service, headers } = await makeContext();

    const first = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const second = await runEffect(
      service.createTenant(request(headers), { name: "Globex", slug: "globex" }),
    );

    const dashboard = await runEffect(
      service.createDashboard(request(headers), first.id, { name: "Fleet" }),
    );

    const report = await runEffect(
      service.createDashboardReport(request(headers), first.id, dashboard.id, {
        name: "Digest",
        frequency: "daily",
        format: "csv",
        recipients: { memberAccountIds: [], emails: ["owner@example.com"] },
      }),
    );

    await expect(
      runEffect(service.listDashboardReports(request(headers), second.id, dashboard.id)),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);

    await expect(
      runEffect(
        service.deleteDashboardReport(request(headers), second.id, dashboard.id, report.id),
      ),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);
  });
});
