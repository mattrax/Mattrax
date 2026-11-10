import { Effect } from "effect";
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
import { generateApnsKeyPair, makeApnsService } from "@mattrax/apns";
import { ScepRepositoryLive, makeWindowsBackend } from "@mattrax/management-backend-enterprise";
import { createEnterpriseService } from "../src/enterpriseHandlers.js";
import { makeDb, makeStripeClient, request, runEffect, schema } from "./helpers.js";

if (typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined") {
  try {
    pkijs.getEngine();
  } catch {
    pkijs.setEngine("WebCrypto", crypto as unknown as Crypto, crypto.subtle);
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

const makeContext = async (overrides: { apns?: any; pushes?: Array<any> } = {}) => {
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
  db.store.user.push(user);

  const auth = {
    requireUser: (input: any) => {
      const headers = input instanceof Request ? Object.fromEntries(input.headers) : input.headers;
      return headers.cookie
        ? Effect.succeed({ user })
        : Effect.fail({ _tag: "EnterpriseUnauthorized", message: "Unauthenticated" });
    },
    listApiTokens: () => Effect.succeed({ tokens: [] }),
    createApiToken: () => Effect.die("not used"),
    revokeApiToken: () => Effect.succeed({ status: "ok" }),
    requestEmailChange: () => Effect.succeed({ status: "ok" }),
    verifyEmailChange: () => Effect.succeed({ status: "ok" }),
  };

  const service = createEnterpriseService({
    db: db as any,
    schema,
    origin,
    stripeClient: makeStripeClient(),
    storage: {} as any,
    auth: auth as any,
    authSecret,
    apns: overrides.apns,
  });

  return { db, service, auth, headers: { cookie: "mattrax_session=test" } };
};

describe("enterprise service tenant flow", () => {
  it("requires authentication to create tenants", async () => {
    const { service } = await makeContext();
    await expect(
      runEffect(service.createTenant(request(), { name: "Acme", slug: "acme" })),
    ).rejects.toMatchObject({ _tag: "EnterpriseUnauthorized" });
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

  it("lists only tenants for the authenticated user", async () => {
    const { service, headers } = await makeContext();
    const owned = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const result = await runEffect(service.listTenants(request(headers)));
    expect(result.tenants).toEqual([
      { id: owned.id, name: "Acme", slug: "acme", logo: null, role: "owner" },
    ]);
  });

  it("enforces tenant role access", async () => {
    const { db, service, headers } = await makeContext();
    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );
    db.store.member[0].role = "member";

    await expect(
      runEffect(service.patchTenant(request(headers), tenant.id, { name: "Denied" })),
    ).rejects.toMatchObject({ _tag: "EnterpriseForbidden" });

    db.store.member[0].role = "admin";
    await runEffect(service.patchTenant(request(headers), tenant.id, { name: "Allowed" }));
    expect(db.store.organization[0].name).toBe("Allowed");

    await expect(
      runEffect(service.deleteTenant(request(headers), tenant.id)),
    ).rejects.toMatchObject({ _tag: "EnterpriseForbidden" });
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
    ).rejects.toMatchObject({ _tag: "EnterpriseTenantHasMembers" });
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
    const listed = await runEffect(service.listTenantInvitations(request(headers), tenant.id));
    expect(listed.invitations[0]).toMatchObject({
      id: invitation.id,
      email: "new@example.com",
      role: "admin",
      status: "pending",
    });

    await runEffect(service.cancelTenantInvitation(request(headers), tenant.id, invitation.id));
    expect(db.store.invitation[0].status).toBe("canceled");
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
    ).rejects.toMatchObject({ _tag: "EnterpriseLastTenantUser" });
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
      subscriptionId: "stripe-sub-1",
    });
  });

  it("creates and persists a Stripe customer before opening the billing portal", async () => {
    const { db, auth, headers } = await makeContext();
    const createdCustomers: any[] = [];
    const portalSessions: any[] = [];
    const stripeClient = makeStripeClient({
      customers: {
        create: async (payload: any) => {
          createdCustomers.push(payload);
          return { id: "cus_new" };
        },
      },
      billingPortal: {
        sessions: {
          create: async (payload: any) => {
            portalSessions.push(payload);
            return { url: "https://billing.test/session" };
          },
        },
      },
    });
    const service = createEnterpriseService({
      db: db as any,
      schema,
      origin,
      stripeClient,
      storage: {} as any,
      auth: auth as any,
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
    ).resolves.toEqual({ url: "https://billing.test/session" });
    expect(createdCustomers).toEqual([
      { name: "Acme", metadata: { organizationId: tenant.id, customerType: "organization" } },
    ]);
    expect(db.store.organization[0].stripeCustomerId).toBe("cus_new");
    expect(portalSessions).toEqual([
      { customer: "cus_new", return_url: "https://app.test/settings" },
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
    ).rejects.toMatchObject({ _tag: "EnterpriseForbidden" });
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
    expect(db.store.group_device).toEqual([{ groupId: group.id, deviceId: "device-1" }]);
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
    ).rejects.toMatchObject({ _tag: "EnterpriseNotFound" });
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
    expect(db.store.group_device).toEqual([{ groupId: group.id, deviceId: "device-2" }]);
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
    expect(db.store.group_device).toContainEqual({ groupId: duplicated.id, deviceId: "device-1" });

    const result = await runEffect(
      service.deleteGroups(request(headers), tenant.id, [group.id, "missing-group"]),
    );
    expect(result).toEqual({
      deleted: [group.id],
      failed: [{ id: "missing-group", reason: "notFound" }],
    });
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
    ).rejects.toMatchObject({ _tag: "EnterpriseNotFound" });
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
    });
    expect(info.expiresAt).toBeTruthy();
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
    ).rejects.toMatchObject({ _tag: "EnterpriseBadRequest" });

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
    ).rejects.toMatchObject({ _tag: "EnterpriseBadRequest" });

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
    ).rejects.toMatchObject({ _tag: "EnterpriseBadRequest" });
  });

  it("pushes on device action and unenroll", async () => {
    const { apns, pushes } = makeFakeApns();
    const { db, service, headers } = await makeContext({ apns });
    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );
    await seedCertificate(db, tenant.id);
    await seedDevice(db, tenant.id, "device-1");

    await runEffect(service.deviceAction(request(headers), tenant.id, "device-1"));
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({
      pushToken: "device-1-token",
      pushMagic: "device-1-magic",
      topic: "com.apple.mgmt.External.acme",
    });

    // A device that is not enrolled must not be pushed.
    await seedDevice(db, tenant.id, "device-2", { status: "unenrolled" });
    await runEffect(service.deviceAction(request(headers), tenant.id, "device-2"));
    expect(pushes).toHaveLength(1);

    await runEffect(service.deviceUnenroll(request(headers), tenant.id, "device-1"));
    expect(db.store.device.find((item: any) => item.id === "device-1")?.status).toBe("unenrolling");
    expect(pushes).toHaveLength(2);
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
    ).rejects.toMatchObject({ _tag: "EnterpriseNotFound" });
  });

  it("rejects identity revocation when no certificates are recorded", async () => {
    const { db, service, headers } = await makeContext();
    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );
    await seedDevice(db, tenant.id, "device-1");
    await expect(
      runEffect(service.revokeDeviceIdentity(request(headers), tenant.id, "device-1")),
    ).rejects.toMatchObject({ _tag: "EnterpriseConflict" });
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
      db: db as any,
      origin,
      authSecret,
      windowsOrganizationId: tenant.id,
    });
    const policy = await runEffect(windows.getWindowsEnrollmentPolicy(""));
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

    const scep = ScepRepositoryLive.make(db as any, { authSecret });
    // Renewal resolves through the internal id before revocation.
    await expect(
      Effect.runPromise(scep.findIssuedCertificate!(certificate.serial)),
    ).resolves.toMatchObject({ deviceId: device.id, organizationId: tenant.id });

    const revoked = await runEffect(
      service.revokeDeviceIdentity(request(headers), tenant.id, device.id),
    );
    expect(revoked).toEqual({ status: "ok", revoked: 1 });
    expect(certificate.revokedAt).toBeInstanceOf(Date);

    // The renewed identity can no longer be used to renew.
    await expect(
      Effect.runPromise(scep.findIssuedCertificate!(certificate.serial)),
    ).rejects.toMatchObject({
      _tag: "ScepError",
      message: expect.stringContaining("revoked"),
    });

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

    const scep = ScepRepositoryLive.make(db as any, { authSecret });
    await expect(
      Effect.runPromise(scep.findIssuedCertificate!("legacy-serial")),
    ).rejects.toMatchObject({
      _tag: "ScepError",
      message: expect.stringContaining("revoked"),
    });
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

    await expect(
      runEffect(service.getDeviceHealth(request(headers), tenant.id, "missing")),
    ).rejects.toMatchObject({ _tag: "EnterpriseNotFound" });
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
    ).rejects.toMatchObject({ _tag: "EnterpriseBadRequest" });

    await expect(
      runEffect(
        service.patchPolicy(request(headers), tenant.id, policy.id, {
          configurations: { "mttx.apple.application.office": { fileName: "Office.pkg" } },
        }),
      ),
    ).rejects.toMatchObject({ _tag: "EnterpriseBadRequest" });
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
    expect(profile).toContain("com.apple.mdm.token");
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
    expect(unlimited.windows).toEqual({
      discoveryUrl: `${origin}/mdm/windows/discovery`,
      tenantScoped: false,
    });
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
    ).rejects.toMatchObject({ _tag: "EnterpriseNotFound" });
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
    ).rejects.toMatchObject({ _tag: "EnterpriseBadRequest" });
  });
});
