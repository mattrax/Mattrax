import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { sealSecret } from "@mattrax/crypto";
import { createEnterpriseService } from "../src/enterpriseHandlers.js";
import { makeDb, makeStripeClient, request, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";
const authSecret = "device-secret-test-secret";
const key = "AAAA-BBBB-CCCC-DDDD-EEEE";

const deviceRow = (id: string, organizationId: string, overrides: Record<string, unknown> = {}) => {
  const now = new Date();

  return {
    id,
    organizationId,
    proto: "apple",
    status: "enrolled",
    name: id,
    serial: `SERIAL-${id}`,
    model: "MacBookPro18,3",
    dmIdentifier: `udid-${id}`,
    enrolledAt: now,
    lastSeenAt: now,
    ...overrides,
  };
};

const makeContext = async () => {
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

      if (!headers.cookie) return Effect.fail({ _tag: "EnterpriseUnauthorized" });
      const member = headers.cookie.includes("member") ? db.store.user[1] : user;

      return Effect.succeed({ user: member, apiToken: undefined });
    },
    listApiTokens: () => Effect.succeed({ tokens: [] }),
    createApiToken: () => Effect.die("not used"),
    revokeApiToken: () => Effect.succeed({ status: "ok" }),
    requestEmailChange: () => Effect.succeed({ status: "ok" }),
    requireStepUp: () => Effect.void,
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
  });

  return { db, service, auth, headers: { cookie: "mattrax_session=test" } };
};

const seedSecret = async (
  db: ReturnType<typeof makeDb>,
  deviceId: string,
  organizationId: string,
) => {
  const now = new Date();
  db.store.device_secret.push({
    deviceId,
    organizationId,
    kind: "filevault_recovery_key",
    sealedValue: await sealSecret(authSecret, key),
    createdAt: now,
    updatedAt: now,
    rotatedAt: now,
  });
};

describe("device recovery key reveal", () => {
  it("returns the decrypted key to an owner and records an audit event without the key", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    db.store.device.push(deviceRow("device-1", tenant.id));
    await seedSecret(db, "device-1", tenant.id);

    const detail = await runEffect(service.getDevice(request(headers), tenant.id, "device-1"));
    expect(detail).toMatchObject({
      recoveryKeyEscrowed: true,
      fileVaultStatus: null,
    });
    // Device payloads carry presence metadata only.
    expect(JSON.stringify(detail)).not.toContain(key);

    const revealed = await runEffect(
      service.getDeviceRecoveryKey(request(headers), tenant.id, "device-1"),
    );

    expect(revealed.recoveryKey).toBe(key);

    const audit = db.store.audit_log.find(
      (entry: any) => entry.action === "device.recovery_key_viewed",
    );

    expect(audit).toMatchObject({
      organizationId: tenant.id,
      targetType: "device",
      targetId: "device-1",
    });
    expect(JSON.stringify(audit)).not.toContain(key);
  });

  it("rejects members and auditors while leaving the key unread", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    db.store.device.push(deviceRow("device-1", tenant.id));
    await seedSecret(db, "device-1", tenant.id);
    const now = new Date();
    db.store.user.push({
      id: "user-2",
      name: "Member",
      email: "member@example.com",
      emailVerified: true,
      image: null,
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
      runEffect(
        service.getDeviceRecoveryKey(
          request({ cookie: "mattrax_session=member" }),
          tenant.id,
          "device-1",
        ),
      ),
    ).rejects.toMatchObject({ _tag: "EnterprisePermissionDenied" });
    expect(
      db.store.audit_log.some((entry: any) => entry.action === "device.recovery_key_viewed"),
    ).toBe(false);
  });

  it("does not reveal another tenant's key", async () => {
    const { db, service, headers } = await makeContext();

    const first = await runEffect(
      service.createTenant(request(headers), { name: "First", slug: "first" }),
    );

    const second = await runEffect(
      service.createTenant(request(headers), { name: "Second", slug: "second" }),
    );

    db.store.device.push(deviceRow("device-2", second.id));
    await seedSecret(db, "device-2", second.id);

    await expect(
      runEffect(service.getDeviceRecoveryKey(request(headers), first.id, "device-2")),
    ).rejects.toMatchObject({ _tag: "EnterpriseNotFound" });
  });
});

describe("device security and software actions", () => {
  it("queues SecurityInfo and InstalledApplicationList commands", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    db.store.device.push(deviceRow("device-1", tenant.id));

    await runEffect(
      service.deviceAction(request(headers), tenant.id, "device-1", {
        action: "collect-security-info",
      }),
    );
    await runEffect(
      service.deviceAction(request(headers), tenant.id, "device-1", {
        action: "refresh-applications",
      }),
    );

    expect(db.store.device_command.map((command: any) => command.requestType)).toEqual([
      "SecurityInfo",
      "InstalledApplicationList",
    ]);
    expect(db.store.device_command[1]!.payload).toMatchObject({
      ManagedAppsOnly: false,
      Items: expect.arrayContaining(["Identifier", "Name", "Version", "BundleSize"]),
    });
  });
});

describe("installed application inventory", () => {
  it("lists a device's applications within its tenant", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    db.store.device.push(deviceRow("device-1", tenant.id));
    const now = new Date();
    db.store.device_application.push(
      {
        deviceId: "device-1",
        organizationId: tenant.id,
        bundleId: "com.apple.Safari",
        name: "Safari",
        version: "18.1",
        shortVersion: "18.1",
        bundleSize: 1200,
        dynamicSize: 900,
        hasUpdateAvailable: true,
        isManaged: false,
        lastReportedAt: now,
      },
      {
        deviceId: "device-1",
        organizationId: tenant.id,
        bundleId: "com.example.Slack",
        name: "Slack",
        version: "4.40.0",
        shortVersion: "4.40",
        bundleSize: 5000,
        dynamicSize: 4000,
        hasUpdateAvailable: false,
        isManaged: true,
        lastReportedAt: now,
      },
    );

    const response = await runEffect(
      service.listDeviceApplications(request(headers), tenant.id, "device-1"),
    );

    expect(response.applications).toHaveLength(2);
    expect(response.applications[0]).toMatchObject({
      bundleId: "com.apple.Safari",
      hasUpdateAvailable: true,
      isManaged: false,
    });
  });

  it("aggregates inventory per tenant and excludes other tenants", async () => {
    const { db, service, headers } = await makeContext();

    const first = await runEffect(
      service.createTenant(request(headers), { name: "First", slug: "first" }),
    );

    const second = await runEffect(
      service.createTenant(request(headers), { name: "Second", slug: "second" }),
    );

    const now = new Date();
    db.store.device.push(deviceRow("device-1", first.id), deviceRow("device-2", first.id));
    db.store.device.push(deviceRow("device-3", second.id));

    const app = (deviceId: string, organizationId: string, bundleId: string) => ({
      deviceId,
      organizationId,
      bundleId,
      name: bundleId,
      version: "1.0",
      shortVersion: "1.0",
      bundleSize: 100,
      dynamicSize: 50,
      hasUpdateAvailable: false,
      isManaged: true,
      lastReportedAt: now,
    });

    db.store.device_application.push(
      app("device-1", first.id, "com.example.Shared"),
      app("device-2", first.id, "com.example.Shared"),
      app("device-3", second.id, "com.example.Shared"),
      app("device-3", second.id, "com.example.Other"),
    );

    const inventory = await runEffect(
      service.getApplicationInventory(request(headers), first.id, {}),
    );

    expect(inventory.total).toBe(1);
    expect(inventory.applications).toEqual([
      expect.objectContaining({
        bundleId: "com.example.Shared",
        deviceCount: 2,
        isManaged: true,
      }),
    ]);

    // Device-scoped lookups cannot cross the tenant boundary.
    await expect(
      runEffect(service.listDeviceApplications(request(headers), first.id, "device-3")),
    ).rejects.toMatchObject({ _tag: "EnterpriseNotFound" });
  });

  it("supports search, managed and update filters", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    db.store.device.push(deviceRow("device-1", tenant.id));
    const now = new Date();

    const app = (
      bundleId: string,
      name: string,
      isManaged: boolean,
      hasUpdateAvailable: boolean,
    ) => ({
      deviceId: "device-1",
      organizationId: tenant.id,
      bundleId,
      name,
      version: "1.0",
      shortVersion: "1.0",
      bundleSize: 100,
      dynamicSize: 50,
      hasUpdateAvailable,
      isManaged,
      lastReportedAt: now,
    });

    db.store.device_application.push(
      app("com.apple.Safari", "Safari", false, true),
      app("com.example.Slack", "Slack", true, false),
      app("com.example.Note", "Notes", true, true),
    );

    expect(
      (
        await runEffect(service.getApplicationInventory(request(headers), tenant.id, { q: "saf" }))
      ).applications.map((row: any) => row.bundleId),
    ).toEqual(["com.apple.Safari"]);
    expect(
      (
        await runEffect(
          service.getApplicationInventory(request(headers), tenant.id, {
            managed: "managed",
          }),
        )
      ).applications.map((row: any) => row.bundleId),
    ).toEqual(["com.example.Note", "com.example.Slack"]);
    expect(
      (
        await runEffect(
          service.getApplicationInventory(request(headers), tenant.id, {
            updates: "available",
          }),
        )
      ).applications.map((row: any) => row.bundleId),
    ).toEqual(["com.example.Note", "com.apple.Safari"]);
  });
});
