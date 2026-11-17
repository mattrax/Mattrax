import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
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
import {
  EnterpriseBadRequest,
  EnterpriseConflict,
  EnterpriseForbidden,
  EnterpriseLastTenantUser,
  EnterpriseNotFound,
  EnterpriseNotConfigured,
  EnterprisePermissionDenied,
  EnterpriseStripeError,
  EnterpriseTenantHasMembers,
  EnterpriseUnauthorized,
  StepUpRequired,
  type DeviceSearchQuery,
} from "@mattrax/enterprise-domain";
import { ScepRepositoryLive, makeWindowsBackend } from "@mattrax/mdm-apple";
import { certToPem, createCaCertificate } from "@mattrax/scep";
import {
  appleEnrollmentProfileResponse,
  createEnterpriseService,
} from "@mattrax/enterprise-api";
import { makeEmailTransport } from "@mattrax/enterprise-backend";
import type { EmailTransport, OutboundEmailMessage } from "@mattrax/email";
import { makeDb, makeStripeClient, request, runEffect, schema } from "./helpers.js";

if (typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined") {
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
    stripeClient?: any;
    apiToken?: any;
    db?: any;
    analytics?: any;
    auth?: { requireStepUp?: (request: any, action: any) => Effect.Effect<any, any> };
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

  db.store.user.push(user);

  const auth = {
    requireUser: (input: any) => {
      const headers = input instanceof Request ? Object.fromEntries(input.headers) : input.headers;

      return headers.cookie
        ? Effect.succeed({ user, apiToken: overrides.apiToken })
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
    stripeClient:
      overrides.stripeClient === null ? undefined : (overrides.stripeClient ?? makeStripeClient()),
    // SAFETY: this test never reaches R2; the service only stores the binding.
    storage: {} as any,
    // SAFETY: the fake only implements the auth methods these tests exercise.
    auth: auth as any,
    authSecret: overrides.authSecret === null ? undefined : (overrides.authSecret ?? authSecret),
    apns: overrides.apns,
    email: overrides.email,
    analytics: overrides.analytics,
    enrollmentProfileTtlSeconds: overrides.enrollmentProfileTtlSeconds,
  });

  return { db, service, auth, headers: { cookie: "mattrax_session=test" } };
};

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
      { organizationId: result.id, userId: db.store.user[0].id, role: "owner" },
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
      service.inviteTenantUser(request(headers), tenant.id, {
        email: "auditor@example.com",
        role: "auditor",
      }),
    );
    expect(db.store.invitation[0]).toMatchObject({ role: "auditor" });

    const now = new Date();
    db.store.user.push({
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
      userId: "user-2",
      role: "member",
      createdAt: now,
      updatedAt: now,
    });
    await runEffect(
      service.patchTenantUser(request(headers), tenant.id, "member-2", { role: "auditor" }),
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
    ).rejects.toBeInstanceOf(EnterpriseForbidden);
    await expect(
      runEffect(first.service.deleteTenant(request(first.headers), firstTenant.id)),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);

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

  it("prevents deleting tenants with more than one member", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const now = new Date();
    db.store.user.push({
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
      userId: "user-2",
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
      service.inviteTenantUser(request(headers), tenant.id, {
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
      service.inviteTenantUser(request(headers), tenant.id, {
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
    expect(sent[0]!.text).toContain("Acme <Corp>");
    expect(sent[0]!.text).toContain("help@acme.test");
    // Tenant names are escaped before entering the HTML body.
    expect(sent[0]!.html).toContain("Acme &lt;Corp&gt;");
    expect(sent[0]!.html).not.toContain("Acme <Corp>");
  });

  it("supports tenant user role updates and removal while protecting the last user", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const now = new Date();
    db.store.user.push({
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
      userId: "user-2",
      role: "member",
      createdAt: now,
      updatedAt: now,
    });

    await runEffect(
      service.patchTenantUser(request(headers), tenant.id, "member-2", { role: "admin" }),
    );
    expect(db.store.member.find((member: any) => member.id === "member-2")?.role).toBe("admin");

    await runEffect(service.removeTenantUser(request(headers), tenant.id, "member-2"));
    await expect(
      runEffect(service.removeTenantUser(request(headers), tenant.id, db.store.member[0].id)),
    ).rejects.toBeInstanceOf(EnterpriseLastTenantUser);
  });
});

describe("enterprise service billing flow", () => {
  it("summarizes subscription and enrolled device usage", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const now = new Date();
    db.store.subscription.push({
      id: "sub-1",
      plan: "business",
      referenceId: tenant.id,
      stripeSubscriptionId: "stripe-sub-1",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    db.store.device.push({
      id: "device-1",
      organizationId: tenant.id,
      proto: "apple",
      status: "enrolled",
      name: "Mac",
      enrolledAt: now,
      lastSeenAt: now,
    });
    db.store.device.push({
      id: "device-2",
      organizationId: tenant.id,
      proto: "apple",
      status: "unenrolled",
      name: "Old Mac",
      enrolledAt: now,
      lastSeenAt: now,
    });

    await expect(runEffect(service.billing(request(headers), tenant.id))).resolves.toEqual({
      plan: "business",
      status: "active",
      billableDevices: 1,
      deviceLimit: null,
      tenantLimit: null,
      devicesUsed: 2,
      tenantsUsed: 1,
      overDeviceLimit: false,
      overTenantLimit: false,
      limitsConfigured: false,
      subscriptionId: "stripe-sub-1",
      periodEnd: null,
      cancelAtPeriodEnd: false,
      configured: true,
    });
  });

  it("creates and persists a Stripe customer before opening the billing portal", async () => {
    const { db, auth, headers } = await makeContext();
    const createdCustomers: any[] = [];
    const portalSessions: any[] = [];

    const stripeClient = makeStripeClient();

    // The Stripe SDK's `create` takes a params object; the shared fake types
    // the no-argument shape, so the recorder is attached to the untyped fake.
    stripeClient.customers.create = async (payload: any) => {
      createdCustomers.push(payload);

      return { id: "cus_new" };
    };

    stripeClient.billingPortal.sessions.create = async (payload: any) => {
      portalSessions.push(payload);

      return { url: "https://billing.test/session" };
    };

    const service = createEnterpriseService({
      db,
      schema,
      origin,
      stripeClient,
      // SAFETY: this test never reaches R2; the service only stores the binding.
      storage: {} as any,
      // SAFETY: the fake only implements the auth methods these tests exercise.
      auth: auth as any,
    });

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    await expect(
      runEffect(
        service.billingPortal(request(headers), tenant.id, {
          // Only a same-origin return URL is forwarded; see billing.test.ts for
          // the cross-origin fallback.
          returnUrl: "https://enterprise.test/settings",
        }),
      ),
    ).resolves.toEqual({ url: "https://billing.test/session" });
    expect(createdCustomers).toEqual([
      { name: "Acme", metadata: { organizationId: tenant.id, customerType: "organization" } },
    ]);
    expect(db.store.organization[0].stripeCustomerId).toBe("cus_new");
    expect(portalSessions).toEqual([
      { customer: "cus_new", return_url: "https://enterprise.test/settings" },
    ]);

    await expect(
      runEffect(auth.requireUser(new Request(origin, { headers: { cookie: headers.cookie } }))),
    ).resolves.toBeDefined();
  });

  it("uses an existing Stripe customer and requires write access", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    db.store.organization[0].stripeCustomerId = "cus_existing";
    db.store.member[0].role = "member";

    await expect(
      runEffect(
        service.billingPortal(request(headers), tenant.id, {
          returnUrl: "https://app.test/settings",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterprisePermissionDenied);
  });

  it("reports unconfigured billing without failing the summary", async () => {
    const { service, headers } = await makeContext({ stripeClient: null });

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    await expect(runEffect(service.billing(request(headers), tenant.id))).resolves.toMatchObject({
      billableDevices: 0,
      configured: false,
    });
    await expect(
      runEffect(
        service.billingPortal(request(headers), tenant.id, {
          returnUrl: "https://app.test/settings",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseStripeError);
  });

  it("maps Stripe failures to EnterpriseStripeError", async () => {
    const { service, headers } = await makeContext({
      stripeClient: makeStripeClient({
        billingPortal: {
          sessions: {
            create: async () => {
              throw new Error("stripe is down");
            },
          },
        },
      }),
    });

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    await expect(
      runEffect(
        service.billingPortal(request(headers), tenant.id, {
          returnUrl: "https://app.test/settings",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseStripeError);
  });

  it("bounds the customer-list fallback to one page", async () => {
    const { db, auth, headers } = await makeContext();

    const tenant = await runEffect(
      createEnterpriseService({
        db,
        schema,
        origin,
        stripeClient: makeStripeClient(),
        // SAFETY: this test never reaches R2; the service only stores the binding.
        storage: {} as any,
        // SAFETY: the fake only implements the auth methods these tests exercise.
        auth: auth as any,
        authSecret,
      }).createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const listCalls: any[] = [];

    const stripeClient = makeStripeClient({
      customers: {
        search: async () => {
          throw new Error("search is unavailable");
        },
        create: async () => {
          throw new Error("should not create a customer");
        },
      },
    });

    // `list` is a page fetch in the billing path; the shared fake types it as
    // an iterator, so the bounded page is attached to the untyped fake.
    stripeClient.customers.list = async (args: any) => {
      listCalls.push(args);

      return {
        data: [
          {
            id: "cus_bounded",
            metadata: { organizationId: tenant.id, customerType: "organization" },
          },
        ],
      };
    };

    const boundedService = createEnterpriseService({
      db,
      schema,
      origin,
      stripeClient,
      // SAFETY: this test never reaches R2; the service only stores the binding.
      storage: {} as any,
      // SAFETY: the fake only implements the auth methods these tests exercise.
      auth: auth as any,
    });

    await expect(
      runEffect(
        boundedService.billingPortal(request(headers), tenant.id, {
          returnUrl: "https://enterprise.test/settings",
        }),
      ),
    ).resolves.toEqual({ url: "https://enterprise.test/settings" });
    expect(listCalls).toEqual([{ limit: 100 }]);
    expect(db.store.organization[0].stripeCustomerId).toBe("cus_bounded");
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
    db.store.device.push({
      id: "device-1",
      organizationId: tenant.id,
      proto: "apple",
      status: "enrolled",
      name: "Mac",
      enrolledAt: now,
      lastSeenAt: now,
    });
    db.store.device.push({
      id: "device-2",
      organizationId: tenant.id,
      proto: "apple",
      status: "enrolled",
      name: "Mac 2",
      enrolledAt: now,
      lastSeenAt: now,
    });

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
});

describe("enterprise service policy flow", () => {
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
    expect(result.users[0]!.actions).toEqual(["sync", "refresh-profiles"]);

    // Another tenant cannot read this device's users.
    const other = await runEffect(
      service.createTenant(request(headers), { name: "Other", slug: "other" }),
    );

    await expect(
      runEffect(service.listDeviceAppleUsers(request(headers), other.id, "device-1")),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);
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
    expect(history.commands[0]!.expiresAt).toBe(stale.toISOString());
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
    expect(csv).toContain("MLH12LL/A,Disabled,Service Recommended,declarative-management");
    expect(csv).not.toContain("Second Mac");

    // A group belonging to another tenant is not addressable from this tenant.
    await expect(
      runEffect(service.searchDevices(request(headers), first.id, { groupId: "group-second" })),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);
  });

  it("searches every column the device table shows", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const seen = new Date("2026-03-04T05:06:07.000Z");
    const later = new Date("2026-09-20T18:00:00.000Z");

    db.store.device.push(
      {
        id: "device-mac",
        organizationId: tenant.id,
        proto: "apple",
        status: "enrolled",
        name: "Ada's MacBook",
        serial: "C02SERIAL",
        model: "MacBook Pro",
        assetTag: "ASSET-42",
        osVersion: "14.4.1",
        osEdition: "Sonoma",
        osBuild: "23E224",
        notes: "Design laptop",
        enrolledAt: seen,
        lastSeenAt: seen,
      },
      {
        id: "device-win",
        organizationId: tenant.id,
        proto: "win",
        status: "unenrolling",
        name: "Build Server",
        serial: "WINSERIAL",
        model: "ThinkPad X1",
        assetTag: "ASSET-99",
        osVersion: "10.0.22631",
        osEdition: "Enterprise",
        osBuild: "22631.4169",
        notes: "Lab machine",
        enrolledAt: later,
        lastSeenAt: later,
      },
    );

    db.store.enterprise_group.push({
      id: "group-design",
      organizationId: tenant.id,
      name: "Design Guild",
      createdAt: seen,
      updatedAt: seen,
    });
    db.store.group_device.push({ groupId: "group-design", deviceId: "device-mac" });
    db.store.device_attribute.push({
      organizationId: tenant.id,
      deviceId: "device-win",
      attributeId: "attribute-owner",
      value: "Platform Team",
    });

    const ids = async (query: DeviceSearchQuery) => {
      const found = await runEffect(
        service.searchDevices(request(headers), tenant.id, { limit: 50, ...query }),
      );

      return found.devices.map((row: any) => row.id);
    };

    // Platform: the table shows labels, the column stores short codes.
    expect(await ids({ q: "windows" })).toEqual(["device-win"]);
    expect(await ids({ q: "apple" })).toEqual(["device-mac"]);
    // Status and OS fields.
    expect(await ids({ q: "unenrolling" })).toEqual(["device-win"]);
    expect(await ids({ q: "sonoma" })).toEqual(["device-mac"]);
    expect(await ids({ q: "22631" })).toEqual(["device-win"]);
    // Group names, not just group ids.
    expect(await ids({ q: "design guild" })).toEqual(["device-mac"]);
    expect(await ids({ q: "guild" })).toEqual(["device-mac"]);
    // Timestamps, as the table renders them and as ISO dates.
    expect(await ids({ q: "2026-03-04" })).toEqual(["device-mac"]);
    expect(await ids({ q: "4 mar 2026" })).toEqual(["device-mac"]);
    expect(await ids({ q: "2026-09-20" })).toEqual(["device-win"]);
    // Attribute columns remain searchable.
    expect(await ids({ q: "platform team" })).toEqual(["device-win"]);
    // Filters still combine with the free-text search.
    expect(await ids({ q: "build", status: "unenrolling" })).toEqual(["device-win"]);
    expect(await ids({ q: "design", status: "unenrolling" })).toEqual([]);
    // No false positives: unknown text and reversed words match nothing.
    expect(await ids({ q: "zzz" })).toEqual([]);
    expect(await ids({ q: "guild design" })).toEqual([]);
    expect(await ids({ q: "device-mac" })).toEqual([]);

    // Sorting and paging still work with the wider search, and the CSV export
    // reuses the same WHERE clause.
    const sorted = await runEffect(
      service.searchDevices(request(headers), tenant.id, {
        q: "2026",
        sort: "lastSeenAt",
        direction: "desc",
      }),
    );

    expect(sorted.devices.map((row: any) => row.id)).toEqual(["device-win", "device-mac"]);

    const exported = await runEffect(
      service.exportDevices(request(headers), tenant.id, { q: "design guild" }),
    );

    expect(exported.rowCount).toBe(1);
    expect(exported.csv).toContain("Ada's MacBook");
    expect(exported.csv).not.toContain("Build Server");
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
        service.deleteDevicePreRegistration(request(headers), second.id, listed.rows[0]!.id),
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
    actorUserId: "user-1",
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
        actorUserId: "user-bob",
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
      actorUserId: "user-1",
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
      actorUserId: "user-1",
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
