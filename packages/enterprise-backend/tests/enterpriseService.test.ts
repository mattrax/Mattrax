import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { exportPrivateKeyJwk, generateCaKeyPair, pemEncode, sealSecret } from "@mattrax/crypto";
import { generateApnsKeyPair, makeApnsService } from "@mattrax/apns";
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
    options: { status?: string; proto?: string; token?: string } = {},
  ) => {
    const now = new Date();
    db.store.device.push({
      id,
      organizationId: tenantId,
      proto: options.proto ?? "apple",
      status: options.status ?? "enrolled",
      name: id,
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
