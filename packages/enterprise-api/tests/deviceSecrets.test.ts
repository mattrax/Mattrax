import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { sealSecret } from "@mattrax/crypto";
import { createEscrowCertificate, encryptCmsEnvelopedData, pemEncode } from "@mattrax/scep";
import {
  EnterpriseNotFound,
  EnterprisePermissionDenied,
  EnterpriseUnauthorized,
} from "@mattrax/enterprise-domain";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { makeDb, makeStripeClient, request, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";

const authSecret = "device-secret-test-secret";

const key = "AAAA-BBBB-CCCC-DDDD-EEEE";

const deviceRow = (id: string, organizationId: string, overrides: Schema.JsonObject = {}) => {
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

  db.store.account.push(user);

  const auth = {
    requireUser: (input: any) => {
      const headers = input instanceof Request ? Object.fromEntries(input.headers) : input.headers;

      if (!headers.cookie)
        return Effect.fail(new EnterpriseUnauthorized({ message: "Unauthenticated" }));
      const member = headers.cookie.includes("member") ? db.store.account[1] : user;

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
    db,
    schema,
    origin,
    stripeClient: makeStripeClient(),
    // SAFETY: this test never reaches R2; the service only stores the binding.
    storage: {} as any,
    // SAFETY: the fake only implements the auth methods these tests exercise.
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
    db.store.account.push({
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
      accountId: "user-2",
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
    ).rejects.toBeInstanceOf(EnterprisePermissionDenied);
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
    ).rejects.toBeInstanceOf(EnterpriseNotFound);
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
    ).rejects.toBeInstanceOf(EnterpriseNotFound);
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

const escrowKeyPair = async (commonName: string) => {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );

  const certificate = await createEscrowCertificate(keyPair, commonName);
  const certificatePem = pemEncode("CERTIFICATE", certificate.toSchema().toBER(false));
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);

  return { keyPair, certificatePem, privateKeyPem: pemEncode("PRIVATE KEY", pkcs8) };
};

const cmsWrappedKey = async (certificatePem: string, plaintext: string) => {
  const wrapped = await encryptCmsEnvelopedData(
    new TextEncoder().encode(plaintext),
    certificatePem,
  );

  let binary = "";

  for (const byte of wrapped) binary += String.fromCharCode(byte);

  return btoa(binary);
};

const seedCmsSecret = async (
  db: ReturnType<typeof makeDb>,
  deviceId: string,
  organizationId: string,
  wrapped: string,
) => {
  const now = new Date();
  db.store.device_secret.push({
    deviceId,
    organizationId,
    kind: "filevault_recovery_key",
    sealedValue: await sealSecret(authSecret, wrapped),
    format: "cms",
    createdAt: now,
    updatedAt: now,
    rotatedAt: now,
  });
};

describe("FileVault escrow key lifecycle", () => {
  it("generates a tenant escrow key and reports only the certificate", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const info = await runEffect(service.generateAppleFdeEscrowKey(request(headers), tenant.id));

    expect(info.configured).toBe(true);
    expect(info.certificatePem).toContain("BEGIN CERTIFICATE");
    expect(info.fingerprintSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(info.source).toBe("generated");
    expect(JSON.stringify(info)).not.toContain("PRIVATE KEY");
    // The private key is sealed at rest.
    expect(db.store.apple_fde_escrow_key[0]).toMatchObject({ organizationId: tenant.id });
    expect(db.store.apple_fde_escrow_key[0]!.sealedPrivateKey).not.toContain("PRIVATE KEY");
  });

  it("unwraps a CMS-wrapped recovery key on reveal", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const info = await runEffect(service.generateAppleFdeEscrowKey(request(headers), tenant.id));

    db.store.device.push(deviceRow("device-1", tenant.id));
    await seedCmsSecret(db, "device-1", tenant.id, await cmsWrappedKey(info.certificatePem!, key));

    const revealed = await runEffect(
      service.getDeviceRecoveryKey(request(headers), tenant.id, "device-1"),
    );

    expect(revealed.recoveryKey).toBe(key);
    expect(
      db.store.audit_log.some((entry: any) => entry.action === "device.recovery_key_viewed"),
    ).toBe(true);
  });

  it("refuses a key wrapped for a certificate it holds no private key for", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    await runEffect(service.generateAppleFdeEscrowKey(request(headers), tenant.id));

    const foreign = await escrowKeyPair("Foreign escrow");
    db.store.device.push(deviceRow("device-1", tenant.id));
    await seedCmsSecret(
      db,
      "device-1",
      tenant.id,
      await cmsWrappedKey(foreign.certificatePem, key),
    );

    await expect(
      runEffect(service.getDeviceRecoveryKey(request(headers), tenant.id, "device-1")),
    ).rejects.toMatchObject({ message: expect.stringContaining("could not be decrypted") });
  });

  it("accepts only a matching certificate/key pair on upload", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const pair = await escrowKeyPair("Uploaded escrow");
    const other = await escrowKeyPair("Other escrow");

    const uploaded = await runEffect(
      service.uploadAppleFdeEscrowKey(request(headers), tenant.id, {
        certificatePem: pair.certificatePem,
        privateKeyPem: pair.privateKeyPem,
      }),
    );

    expect(uploaded.source).toBe("uploaded");
    expect(uploaded.subject).toBe("Uploaded escrow");
    expect(db.store.apple_fde_escrow_key).toHaveLength(1);

    await expect(
      runEffect(
        service.uploadAppleFdeEscrowKey(request(headers), tenant.id, {
          certificatePem: pair.certificatePem,
          privateKeyPem: other.privateKeyPem,
        }),
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining("do not match") });
  });
});

describe("Activation Lock bypass code", () => {
  it("reveals a sealed bypass code behind step-up and audits it", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    db.store.device.push(deviceRow("device-1", tenant.id));
    const now = new Date();
    db.store.device_secret.push({
      deviceId: "device-1",
      organizationId: tenant.id,
      kind: "activation_lock_bypass_code",
      sealedValue: await sealSecret(authSecret, "BYPASS-1234"),
      format: "plaintext",
      createdAt: now,
      updatedAt: now,
      rotatedAt: now,
    });

    const revealed = await runEffect(
      service.getDeviceActivationLockBypassCode(request(headers), tenant.id, "device-1"),
    );

    expect(revealed.bypassCode).toBe("BYPASS-1234");
    expect(
      db.store.audit_log.some(
        (entry: any) => entry.action === "device.activation_lock_bypass_code_viewed",
      ),
    ).toBe(true);
    expect(JSON.stringify(db.store.audit_log)).not.toContain("BYPASS-1234");
  });

  it("explains that no code was collected instead of claiming Activation Lock is clear", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    db.store.device.push(deviceRow("device-1", tenant.id));

    await expect(
      runEffect(service.getDeviceActivationLockBypassCode(request(headers), tenant.id, "device-1")),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);
  });

  it("requests the bypass code with its own command", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    db.store.device.push(deviceRow("device-1", tenant.id));

    await runEffect(
      service.deviceAction(request(headers), tenant.id, "device-1", {
        action: "collect-activation-lock-code",
      }),
    );

    expect(db.store.device_command[0]).toMatchObject({
      requestType: "ActivationLockBypassCode",
      payload: {},
    });
  });
});

describe("erase flags and Recovery Lock", () => {
  it("sends macOS erase keys to a Mac", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    db.store.device.push(
      deviceRow("device-1", tenant.id, { osEdition: "macOS 15", model: "MacBookPro18,2" }),
    );

    await runEffect(
      service.deviceAction(request(headers), tenant.id, "device-1", { action: "wipe" }),
    );

    const erase = db.store.device_command.find(
      (command: any) => command.requestType === "EraseDevice",
    );

    expect(erase?.payload).toMatchObject({
      ObliterationBehavior: "Default",
      PIN: expect.any(String),
    });
    expect(erase?.payload).not.toHaveProperty("DisallowProximitySetup");
  });

  it("sets erase flags explicitly and does not claim Activation Lock is clear", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    // An iPhone: proximity setup is an iOS erase key.
    db.store.device.push(
      deviceRow("device-1", tenant.id, { osEdition: "iOS", model: "iPhone15,2" }),
    );

    const response = await runEffect(
      service.deviceAction(request(headers), tenant.id, "device-1", { action: "wipe" }),
    );

    const erase = db.store.device_command.find(
      (command: any) => command.requestType === "EraseDevice",
    );

    expect(erase?.payload).toMatchObject({
      DisallowProximitySetup: true,
      PreserveDataPlan: false,
    });
    // `PIN` and `ObliterationBehavior` are macOS-only erase keys.
    expect(erase?.payload).not.toHaveProperty("PIN");
    expect(erase?.payload).not.toHaveProperty("ObliterationBehavior");

    // Supervised devices must not be able to re-enable Activation Lock after
    // the wipe, so the MDM option is queued before the erase.
    const settings = db.store.device_command.find(
      (command: any) => command.requestType === "Settings",
    );

    expect(settings?.payload).toEqual({
      Settings: [
        {
          MDMOptions: {
            Item: "MDMOptions",
            MDMOptions: { ActivationLockAllowedWhileSupervised: false },
          },
        },
      ],
    });

    const warning =
      "activationLockWarning" in response ? response.activationLockWarning : undefined;

    expect(warning).toContain("Activation Lock cannot be confirmed");
  });

  it("omits the iOS-only key on a Mac erase", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    db.store.device.push(deviceRow("device-1", tenant.id, { osEdition: "macOS" }));

    await runEffect(
      service.deviceAction(request(headers), tenant.id, "device-1", { action: "wipe" }),
    );

    const erase = db.store.device_command.find(
      (command: any) => command.requestType === "EraseDevice",
    );

    expect(erase?.payload).not.toHaveProperty("DisallowProximitySetup");
  });

  it("stores a generated Recovery Lock password and verifies it with the same value", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    db.store.device.push(deviceRow("device-1", tenant.id, { osEdition: "macOS" }));

    await runEffect(
      service.deviceAction(request(headers), tenant.id, "device-1", {
        action: "set-recovery-lock",
      }),
    );

    const set = db.store.device_command[0]!;
    expect(set.requestType).toBe("SetRecoveryLock");
    const setPayload = Schema.Struct({ NewPassword: Schema.String });
    const newPassword = Schema.is(setPayload)(set.payload) ? set.payload.NewPassword : undefined;
    expect(newPassword).toMatch(/^[0-9a-f]{24}$/);
    expect(db.store.device_secret[0]).toMatchObject({
      kind: "recovery_lock_password",
      format: "plaintext",
    });

    await runEffect(
      service.deviceAction(request(headers), tenant.id, "device-1", {
        action: "verify-recovery-lock",
      }),
    );

    expect(db.store.device_command[1]).toMatchObject({
      requestType: "VerifyRecoveryLock",
      payload: { Password: newPassword },
    });
  });

  it("rotates the FileVault key with the escrowed key and tenant certificate", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const info = await runEffect(service.generateAppleFdeEscrowKey(request(headers), tenant.id));

    db.store.device.push(deviceRow("device-1", tenant.id));
    await seedSecret(db, "device-1", tenant.id);

    await runEffect(
      service.deviceAction(request(headers), tenant.id, "device-1", {
        action: "rotate-filevault-key",
      }),
    );

    const command = db.store.device_command.find(
      (row: any) => row.requestType === "RotateFileVaultKey",
    );

    expect(command?.payload).toMatchObject({
      KeyType: "personal",
      FileVaultUnlock: { Password: key },
    });
    const rotatePayload = Schema.Struct({ ReplyEncryptionCertificate: Schema.String });
    const payload = command?.payload;

    const replyCertificate = Schema.is(rotatePayload)(payload)
      ? payload.ReplyEncryptionCertificate
      : undefined;

    expect(replyCertificate).toEqual(expect.any(String));
    expect(info.certificatePem).toContain("BEGIN CERTIFICATE");
  });

  it("explains why a rotation cannot run without an escrow key", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    db.store.device.push(deviceRow("device-1", tenant.id));
    await seedSecret(db, "device-1", tenant.id);

    await expect(
      runEffect(
        service.deviceAction(request(headers), tenant.id, "device-1", {
          action: "rotate-filevault-key",
        }),
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining("escrow key") });
  });
});
