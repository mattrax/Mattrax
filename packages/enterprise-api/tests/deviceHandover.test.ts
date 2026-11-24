import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { openWithPassphrase, sealSecret, verifyScopedToken } from "@mattrax/crypto";
import type { PassphraseEnvelope } from "@mattrax/crypto";
import { encryptCmsEnvelopedData } from "@mattrax/scep";
import {
  DeviceHandoverArchiveInfo,
  DeviceHandoverImpactResponse,
  EnterprisePermissionDenied,
  StepUpRequired,
} from "@mattrax/enterprise-domain";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { makeDb, request, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";
const authSecret = "device-handover-test-secret";
const passphrase = "correct horse battery staple";

const now = () => new Date();

const deviceRow = (id: string, organizationId: string, overrides: Schema.JsonObject = {}) => {
  const at = now();

  return {
    id,
    organizationId,
    proto: "apple",
    status: "enrolled",
    name: id,
    serial: `SERIAL-${id}`,
    assetTag: `AST-${id}`,
    notes: `note for ${id}`,
    model: "MacBookPro18,3",
    dmIdentifier: `udid-${id}`,
    enrolledAt: at,
    lastSeenAt: at,
    ...overrides,
  };
};

/** A minimal R2 bucket: enough of the interface for put, get and delete. */
const makeStorage = () => {
  const objects = new Map<string, string>();
  const object = (key: string, value: string) => ({
    key,
    version: "v1",
    size: new TextEncoder().encode(value).byteLength,
    etag: "etag",
    httpEtag: '"etag"',
    uploaded: now(),
    customMetadata: {},
    body: new ReadableStream(),
    bodyUsed: false,
    text: async () => value,
    arrayBuffer: async () => new TextEncoder().encode(value).buffer,
    json: async () => JSON.parse(value),
    blob: async () => new Blob([value]),
  });

  return {
    objects,
    head: async (key: string) => {
      const value = objects.get(key);

      return value === undefined ? null : object(key, value);
    },
    get: async (key: string) => {
      const value = objects.get(key);

      return value === undefined ? null : object(key, value);
    },
    put: async (key: string, value: string) => {
      objects.set(key, value);

      return object(key, value);
    },
    delete: async (keys: string | ReadonlyArray<string>) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    },
    list: async () => ({ objects: [], truncated: false, delimitedPrefixes: [] }),
  };
};

const makeContext = async (options?: {
  readonly requireStepUp?: () => Effect.Effect<void, unknown>;
}) => {
  const db = makeDb();
  const storage = makeStorage();
  const at = now();

  const user = {
    id: "user-1",
    name: "Owner",
    email: "owner@example.com",
    emailVerified: true,
    image: null,
    createdAt: at,
    updatedAt: at,
  };

  db.store.account.push(user);

  const auth = {
    requireUser: (input: any) => {
      const headers = input instanceof Request ? Object.fromEntries(input.headers) : input.headers;

      if (!headers.cookie) return Effect.fail(new Error("unauthenticated"));
      const member = headers.cookie.includes("member") ? db.store.account[1] : user;

      return Effect.succeed({ user: member, apiToken: undefined });
    },
    listApiTokens: () => Effect.succeed({ tokens: [] }),
    createApiToken: () => Effect.die("not used"),
    revokeApiToken: () => Effect.succeed({ status: "ok" }),
    requestEmailChange: () => Effect.succeed({ status: "ok" }),
    requireStepUp: options?.requireStepUp ?? (() => Effect.void),
    verifyEmailChange: () => Effect.succeed({ status: "ok" }),
  };

  const service = createEnterpriseService({
    db,
    schema,
    origin,
    storage: storage as any,
    // SAFETY: the fake only implements the auth methods these tests exercise.
    auth: auth as any,
    authSecret,
  });

  return { db, service, storage, headers: { cookie: "mattrax_session=test" } };
};

const seedSecrets = async (
  db: ReturnType<typeof makeDb>,
  deviceId: string,
  organizationId: string,
  secrets: Partial<Record<string, string>>,
) => {
  const at = now();

  for (const [kind, value] of Object.entries(secrets)) {
    if (value === undefined) continue;

    db.store.device_secret.push({
      deviceId,
      organizationId,
      kind,
      sealedValue: await sealSecret(authSecret, value),
      format: "plaintext",
      createdAt: at,
      updatedAt: at,
      rotatedAt: at,
    });
  }
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
  sealedCms: string,
) => {
  const at = now();

  db.store.device_secret.push({
    deviceId,
    organizationId,
    kind: "filevault_recovery_key",
    sealedValue: await sealSecret(authSecret, sealedCms),
    format: "cms",
    createdAt: at,
    updatedAt: at,
    rotatedAt: at,
  });
};

const addMember = (
  db: ReturnType<typeof makeDb>,
  organizationId: string,
  options?: { customRoleId?: string },
) => {
  const at = now();

  db.store.account.push({
    id: "user-2",
    name: "Operator",
    email: "operator@example.com",
    emailVerified: true,
    image: null,
    createdAt: at,
    updatedAt: at,
  });
  db.store.member.push({
    id: "member-2",
    organizationId,
    accountId: "user-2",
    role: "member",
    customRoleId: options?.customRoleId ?? null,
    createdAt: at,
    updatedAt: at,
  });
};

const addRole = (
  db: ReturnType<typeof makeDb>,
  organizationId: string,
  permissions: ReadonlyArray<string>,
) => {
  const at = now();

  db.store.tenant_role.push({
    id: "role-1",
    organizationId,
    name: "Device operator",
    description: null,
    permissions,
    createdByAccountId: "user-1",
    createdAt: at,
    updatedAt: at,
  });

  return "role-1";
};

describe("device handover archives", () => {
  it("exports only the kinds a device has and records them without the values", async () => {
    const { db, service, storage, headers } = await makeContext();
    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    db.store.device.push(deviceRow("device-1", tenant.id));
    await seedSecrets(db, "device-1", tenant.id, {
      filevault_recovery_key: "fv-key-1234",
      local_admin_password: "admin-password-1234",
      recovery_lock_password: "",
    });

    const created = await runEffect(
      service.createDeviceHandover(request(headers), tenant.id, {
        ids: ["device-1"],
        passphrase,
        reason: "Lease returned to IT",
      }),
    );

    expect(created).toMatchObject({
      deviceCount: 1,
      secretKinds: ["filevault_recovery_key", "local_admin_password"],
    });
    expect(created.filename).toMatch(/^device-handover-acme-/);
    expect(JSON.stringify(created)).not.toContain("fv-key-1234");
    expect(JSON.stringify(created)).not.toContain(passphrase);

    // The archive lives in R2 as a sealed envelope, never in MySQL.
    const key = `handovers/${tenant.id}/${created.id}.json`;
    const stored = storage.objects.get(key);

    expect(stored).toBeDefined();

    const envelope = JSON.parse(stored!) as PassphraseEnvelope;

    expect(envelope).toMatchObject({
      version: 1,
      kdf: { name: "PBKDF2", hash: "SHA-256", iterations: 600_000 },
      cipher: { name: "AES-GCM" },
    });
    expect(stored).not.toContain("fv-key-1234");
    expect(stored).not.toContain(passphrase);

    // Only the operator with the passphrase can read it back.
    await expect(openWithPassphrase("wrong passphrase", envelope)).rejects.toThrow();
    const document = JSON.parse(await openWithPassphrase(passphrase, envelope));

    expect(document).toMatchObject({
      format: "mattrax.device-handover",
      version: 1,
      secretKinds: ["filevault_recovery_key", "local_admin_password"],
      devices: [
        {
          id: "device-1",
          name: "device-1",
          serial: "SERIAL-device-1",
          assetTag: "AST-device-1",
          notes: "note for device-1",
          secretKinds: ["filevault_recovery_key", "local_admin_password"],
          secrets: {
            filevault_recovery_key: "fv-key-1234",
            local_admin_password: "admin-password-1234",
          },
        },
      ],
    });
    // The empty Recovery Lock password is omitted rather than exported blank.
    expect(document.devices[0].secrets.recovery_lock_password).toBeUndefined();

    const audit = db.store.audit_log.filter(
      (entry: any) => entry.action === "device.handover_exported",
    );

    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      organizationId: tenant.id,
      targetType: "device",
      targetId: "device-1",
      metadata: {
        archiveId: created.id,
        reason: "Lease returned to IT",
        deviceCount: 1,
        secretKinds: ["filevault_recovery_key", "local_admin_password"],
      },
    });
    expect(JSON.stringify(audit)).not.toContain("fv-key-1234");
    expect(JSON.stringify(audit)).not.toContain("admin-password-1234");
    expect(JSON.stringify(audit)).not.toContain(passphrase);

    // The row describes the archive but does not store the passphrase or values.
    const row = db.store.device_handover_archive[0];

    expect(row).toMatchObject({ organizationId: tenant.id, downloadedAt: null });
    expect(JSON.stringify(row)).not.toContain(passphrase);
    expect(JSON.stringify(row)).not.toContain("fv-key-1234");
  });

  it("downloads once, then refuses the archive and audits the read", async () => {
    const { db, service, storage, headers } = await makeContext();
    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    db.store.device.push(deviceRow("device-1", tenant.id));
    await seedSecrets(db, "device-1", tenant.id, { filevault_recovery_key: "fv-key-1234" });

    const created = await runEffect(
      service.createDeviceHandover(request(headers), tenant.id, {
        ids: ["device-1"],
        passphrase,
        reason: "Device replaced",
      }),
    );

    expect(
      await verifyScopedToken(
        authSecret,
        "device-handover",
        `${tenant.id}:${created.id}`,
        created.downloadToken,
      ),
    ).toBe(true);

    const downloaded = await runEffect(
      service.downloadDeviceHandover(request(headers), tenant.id, created.id, {
        token: created.downloadToken,
      }),
    );

    expect(downloaded.filename).toBe(created.filename);

    const document = JSON.parse(
      await openWithPassphrase(passphrase, JSON.parse(downloaded.content)),
    );

    expect(document.devices[0].secrets.filevault_recovery_key).toBe("fv-key-1234");

    // The row is the one-time authority. The object stays until the daily
    // sweep but a second request cannot claim it again.
    expect(storage.objects.has(`handovers/${tenant.id}/${created.id}.json`)).toBe(true);
    expect(db.store.device_handover_archive[0].downloadedAt).toBeInstanceOf(Date);
    await expect(
      runEffect(
        service.downloadDeviceHandover(request(headers), tenant.id, created.id, {
          token: created.downloadToken,
        }),
      ),
    ).rejects.toMatchObject({ _tag: "EnterpriseConflict" });

    const audits = db.store.audit_log.filter(
      (entry: any) => entry.action === "device.handover_downloaded",
    );

    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      targetType: "device",
      targetId: "device-1",
      metadata: { archiveId: created.id, secretKinds: ["filevault_recovery_key"] },
    });
    expect(JSON.stringify(audits)).not.toContain("fv-key-1234");
  });

  it("requires the permission, a fresh step-up and a reason", async () => {
    const stepUpRequired = await makeContext({
      requireStepUp: () =>
        Effect.fail(
          new StepUpRequired({
            message: "Step up to export",
            action: "device-handover",
            methods: ["totp", "passkey"],
          }),
        ),
    });
    const tenant = await runEffect(
      stepUpRequired.service.createTenant(request(stepUpRequired.headers), {
        name: "Acme",
        slug: "acme",
      }),
    );

    stepUpRequired.db.store.device.push(deviceRow("device-1", tenant.id));
    await seedSecrets(stepUpRequired.db, "device-1", tenant.id, {
      filevault_recovery_key: "fv-key-1234",
    });

    await expect(
      runEffect(
        stepUpRequired.service.createDeviceHandover(request(stepUpRequired.headers), tenant.id, {
          ids: ["device-1"],
          passphrase,
          reason: "Lease returned",
        }),
      ),
    ).rejects.toBeInstanceOf(StepUpRequired);
    expect(stepUpRequired.storage.objects.size).toBe(0);

    const { db, service, headers } = await makeContext();
    const second = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    db.store.device.push(deviceRow("device-1", second.id));
    await seedSecrets(db, "device-1", second.id, { filevault_recovery_key: "fv-key-1234" });

    await expect(
      runEffect(
        service.createDeviceHandover(request(headers), second.id, {
          ids: ["device-1"],
          passphrase,
          reason: "",
        }),
      ),
    ).rejects.toMatchObject({ _tag: "EnterpriseBadRequest" });

    await expect(
      runEffect(
        service.createDeviceHandover(request(headers), second.id, {
          ids: ["device-1"],
          passphrase: "short",
          reason: "Lease returned",
        }),
      ),
    ).rejects.toMatchObject({ _tag: "EnterpriseBadRequest" });

    addMember(db, second.id);
    await expect(
      runEffect(
        service.createDeviceHandover(request({ cookie: "mattrax_session=member" }), second.id, {
          ids: ["device-1"],
          passphrase,
          reason: "Lease returned",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterprisePermissionDenied);
    expect(db.store.device_handover_archive).toHaveLength(0);
  });

  it("reports secret presence for the delete warning without values", async () => {
    const { db, service, headers } = await makeContext();
    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    db.store.device.push(deviceRow("device-1", tenant.id), deviceRow("device-2", tenant.id));
    await seedSecrets(db, "device-1", tenant.id, {
      activation_lock_bypass_code: "bypass-1234",
      recovery_lock_password: "recovery-lock-1234",
    });

    const impact = await runEffect(
      service.deviceHandoverImpact(request(headers), tenant.id, {
        ids: ["device-1", "device-2"],
      }),
    );

    expect(impact).toEqual({
      devices: [
        {
          id: "device-1",
          name: "device-1",
          secretKinds: ["activation_lock_bypass_code", "recovery_lock_password"],
        },
      ],
      canExport: true,
    });
    expect(JSON.stringify(impact)).not.toContain("bypass-1234");
  });

  it("reports and exports BitLocker keys through the handover schemas", async () => {
    const { db, service, storage, headers } = await makeContext();
    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );
    const at = now();

    db.store.device.push(deviceRow("device-1", tenant.id));
    db.store.device_bitlocker_key.push({
      id: "key-row-1",
      organizationId: tenant.id,
      deviceId: "device-1",
      volumeType: "operating-system",
      volumeId: "operating-system",
      keyId: "graph-key-1",
      keyType: "numeric-password",
      protectorType: "RecoveryPassword",
      sealedValue: await sealSecret(authSecret, "111111-222222"),
      source: "entra-id",
      capturedAt: at,
      rotatedAt: null,
      reportedAt: at,
      retiredAt: null,
      createdAt: at,
      updatedAt: at,
    });

    const impact = await runEffect(
      service.deviceHandoverImpact(request(headers), tenant.id, { ids: ["device-1"] }),
    );
    const decodedImpact = Schema.decodeUnknownSync(DeviceHandoverImpactResponse)(impact);

    expect(decodedImpact.devices[0].secretKinds).toEqual(["bitlocker_recovery_key"]);

    const created = await runEffect(
      service.createDeviceHandover(request(headers), tenant.id, {
        ids: ["device-1"],
        passphrase,
        reason: "Laptop returned",
      }),
    );

    expect(created.secretKinds).toEqual(["bitlocker_recovery_key"]);
    expect(Schema.decodeUnknownSync(DeviceHandoverArchiveInfo)(created)).toMatchObject({
      secretKinds: ["bitlocker_recovery_key"],
    });

    const stored = storage.objects.get(`handovers/${tenant.id}/${created.id}.json`)!;
    const document = JSON.parse(
      await openWithPassphrase(passphrase, JSON.parse(stored) as PassphraseEnvelope),
    );

    expect(document.secretKinds).toEqual(["bitlocker_recovery_key"]);
    expect(JSON.parse(document.devices[0].secrets.bitlocker_recovery_key)).toEqual([
      expect.objectContaining({
        keyId: "graph-key-1",
        recoveryKey: "111111-222222",
      }),
    ]);
  });

  it("does not block deletion on a re-readable Windows LAPS password", async () => {
    const { db, service, headers } = await makeContext();
    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    db.store.device.push(deviceRow("device-1", tenant.id));
    await seedSecrets(db, "device-1", tenant.id, {
      windows_laps_password: "laps-password-1234",
    });

    const impact = await runEffect(
      service.deviceHandoverImpact(request(headers), tenant.id, { ids: ["device-1"] }),
    );

    expect(impact.devices).toEqual([]);

    await expect(
      runEffect(service.deleteDevices(request(headers), tenant.id, ["device-1"])),
    ).resolves.toMatchObject({ status: "ok" });
  });

  it("refuses to delete secret-bearing devices without the handover permission", async () => {
    const { db, service, headers } = await makeContext();
    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );
    const roleId = addRole(db, tenant.id, ["devices.read", "devices.write"]);

    addMember(db, tenant.id, { customRoleId: roleId });
    db.store.device.push(deviceRow("device-1", tenant.id));
    await seedSecrets(db, "device-1", tenant.id, { filevault_recovery_key: "fv-key-1234" });

    await expect(
      runEffect(
        service.deleteDevices(request({ cookie: "mattrax_session=member" }), tenant.id, [
          "device-1",
        ]),
      ),
    ).rejects.toMatchObject({
      _tag: "EnterprisePermissionDenied",
      permission: "devices.handover",
    });

    expect(db.store.device.some((row: any) => row.id === "device-1")).toBe(true);
    expect(db.store.audit_log.some((entry: any) => entry.action === "device.deleted")).toBe(false);
  });

  it("deletes with the handover permission and records the destroyed kinds", async () => {
    const { db, service, headers } = await makeContext();
    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    db.store.device.push(deviceRow("device-1", tenant.id));
    await seedSecrets(db, "device-1", tenant.id, {
      filevault_recovery_key: "fv-key-1234",
      bootstrap_token: "bootstrap-1234",
    });

    await runEffect(service.deleteDevices(request(headers), tenant.id, ["device-1"]));

    expect(db.store.device.some((row: any) => row.id === "device-1")).toBe(false);

    const audit = db.store.audit_log.find((entry: any) => entry.action === "device.deleted");

    expect(audit).toMatchObject({
      targetType: "device",
      metadata: {
        ids: ["device-1"],
        destroyedSecretKinds: ["filevault_recovery_key", "bootstrap_token"],
      },
    });
    expect(JSON.stringify(audit)).not.toContain("fv-key-1234");
    expect(JSON.stringify(audit)).not.toContain("bootstrap-1234");
  });

  it("reports canExport even when no ids are supplied", async () => {
    const { db, service, headers } = await makeContext();
    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );
    const roleId = addRole(db, tenant.id, ["devices.read"]);

    addMember(db, tenant.id, { customRoleId: roleId });

    await expect(
      runEffect(service.deviceHandoverImpact(request(headers), tenant.id, { ids: [] })),
    ).resolves.toEqual({ devices: [], canExport: true });
    await expect(
      runEffect(
        service.deviceHandoverImpact(request({ cookie: "mattrax_session=member" }), tenant.id, {
          ids: [],
        }),
      ),
    ).resolves.toEqual({ devices: [], canExport: false });
  });

  it("keeps the row metadata to its declared fields", async () => {
    const { db, service, headers } = await makeContext();
    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    db.store.device.push(deviceRow("device-1", tenant.id));
    await seedSecrets(db, "device-1", tenant.id, { filevault_recovery_key: "fv-key-1234" });

    await runEffect(
      service.createDeviceHandover(request(headers), tenant.id, {
        ids: ["device-1"],
        passphrase,
        reason: "Lease returned",
      }),
    );

    expect(db.store.device_handover_archive[0].devices).toEqual([
      {
        id: "device-1",
        name: "device-1",
        serial: "SERIAL-device-1",
        secretKinds: ["filevault_recovery_key"],
      },
    ]);
    expect(JSON.stringify(db.store.device_handover_archive[0])).not.toContain("AST-device-1");
    expect(JSON.stringify(db.store.device_handover_archive[0])).not.toContain("note for");
  });

  it("allows exactly one of two concurrent downloads", async () => {
    const { db, service, headers } = await makeContext();
    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    db.store.device.push(deviceRow("device-1", tenant.id));
    await seedSecrets(db, "device-1", tenant.id, { filevault_recovery_key: "fv-key-1234" });

    const created = await runEffect(
      service.createDeviceHandover(request(headers), tenant.id, {
        ids: ["device-1"],
        passphrase,
        reason: "Lease returned",
      }),
    );

    const results = await Promise.allSettled([
      runEffect(
        service.downloadDeviceHandover(request(headers), tenant.id, created.id, {
          token: created.downloadToken,
        }),
      ),
      runEffect(
        service.downloadDeviceHandover(request(headers), tenant.id, created.id, {
          token: created.downloadToken,
        }),
      ),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");

    expect(rejected?.status === "rejected" ? rejected.reason : undefined).toMatchObject({
      _tag: "EnterpriseConflict",
    });
  });

  it("refuses foreign tenant archives and foreign devices", async () => {
    const { db, service, headers } = await makeContext();
    const first = await runEffect(
      service.createTenant(request(headers), { name: "First", slug: "first" }),
    );
    const second = await runEffect(
      service.createTenant(request(headers), { name: "Second", slug: "second" }),
    );

    db.store.device.push(deviceRow("device-2", second.id));
    await seedSecrets(db, "device-2", second.id, { filevault_recovery_key: "fv-key-1234" });

    await expect(
      runEffect(
        service.createDeviceHandover(request(headers), first.id, {
          ids: ["device-2"],
          passphrase,
          reason: "Lease returned",
        }),
      ),
    ).rejects.toMatchObject({ _tag: "EnterpriseNotFound" });

    const created = await runEffect(
      service.createDeviceHandover(request(headers), second.id, {
        ids: ["device-2"],
        passphrase,
        reason: "Lease returned",
      }),
    );

    await expect(
      runEffect(
        service.downloadDeviceHandover(request(headers), first.id, created.id, {
          token: created.downloadToken,
        }),
      ),
    ).rejects.toMatchObject({ _tag: "EnterpriseNotFound" });
  });

  it("refuses an expired archive", async () => {
    const { db, service, headers } = await makeContext();
    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    db.store.device.push(deviceRow("device-1", tenant.id));
    await seedSecrets(db, "device-1", tenant.id, { filevault_recovery_key: "fv-key-1234" });

    const created = await runEffect(
      service.createDeviceHandover(request(headers), tenant.id, {
        ids: ["device-1"],
        passphrase,
        reason: "Lease returned",
      }),
    );

    db.store.device_handover_archive[0].expiresAt = new Date(Date.now() - 1_000);

    await expect(
      runEffect(
        service.downloadDeviceHandover(request(headers), tenant.id, created.id, {
          token: created.downloadToken,
        }),
      ),
    ).rejects.toMatchObject({ _tag: "EnterpriseConflict" });
  });

  it("unwraps a CMS-escrowed FileVault key", async () => {
    const { db, service, headers } = await makeContext();
    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    await runEffect(service.generateAppleFdeEscrowKey(request(headers), tenant.id));
    const escrow = await runEffect(service.getAppleFdeEscrowKey(request(headers), tenant.id));

    expect(escrow.certificatePem).toContain("BEGIN CERTIFICATE");
    db.store.device.push(deviceRow("device-1", tenant.id));
    await seedCmsSecret(
      db,
      "device-1",
      tenant.id,
      await cmsWrappedKey(escrow.certificatePem!, "cms-filevault-key"),
    );

    const created = await runEffect(
      service.createDeviceHandover(request(headers), tenant.id, {
        ids: ["device-1"],
        passphrase,
        reason: "Lease returned",
      }),
    );
    const downloaded = await runEffect(
      service.downloadDeviceHandover(request(headers), tenant.id, created.id, {
        token: created.downloadToken,
      }),
    );
    const document = JSON.parse(
      await openWithPassphrase(passphrase, JSON.parse(downloaded.content)),
    );

    expect(document.devices[0].secrets.filevault_recovery_key).toBe("cms-filevault-key");
  });

  it("uses a fresh salt and nonce for every archive", async () => {
    const { db, service, storage, headers } = await makeContext();
    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    db.store.device.push(deviceRow("device-1", tenant.id));
    await seedSecrets(db, "device-1", tenant.id, { filevault_recovery_key: "fv-key-1234" });

    const first = await runEffect(
      service.createDeviceHandover(request(headers), tenant.id, {
        ids: ["device-1"],
        passphrase,
        reason: "First export",
      }),
    );
    const second = await runEffect(
      service.createDeviceHandover(request(headers), tenant.id, {
        ids: ["device-1"],
        passphrase,
        reason: "Second export",
      }),
    );
    const firstEnvelope = JSON.parse(
      storage.objects.get(`handovers/${tenant.id}/${first.id}.json`)!,
    ) as PassphraseEnvelope;
    const secondEnvelope = JSON.parse(
      storage.objects.get(`handovers/${tenant.id}/${second.id}.json`)!,
    ) as PassphraseEnvelope;

    expect(firstEnvelope.kdf.salt).not.toBe(secondEnvelope.kdf.salt);
    expect(firstEnvelope.cipher.iv).not.toBe(secondEnvelope.cipher.iv);
    expect(first.filename).not.toBe(second.filename);
  });

  it("permits export with devices.handover but without devices.write", async () => {
    const { db, service, headers } = await makeContext();
    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );
    const roleId = addRole(db, tenant.id, ["devices.handover"]);

    addMember(db, tenant.id, { customRoleId: roleId });
    db.store.device.push(deviceRow("device-1", tenant.id));
    await seedSecrets(db, "device-1", tenant.id, { filevault_recovery_key: "fv-key-1234" });

    const created = await runEffect(
      service.createDeviceHandover(request({ cookie: "mattrax_session=member" }), tenant.id, {
        ids: ["device-1"],
        passphrase,
        reason: "Lease returned",
      }),
    );

    expect(created.secretKinds).toEqual(["filevault_recovery_key"]);
  });

  it("deletes a secretless device for a custom role without handover", async () => {
    const { db, service, headers } = await makeContext();
    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );
    const roleId = addRole(db, tenant.id, ["devices.read", "devices.write"]);

    addMember(db, tenant.id, { customRoleId: roleId });
    db.store.device.push(deviceRow("device-1", tenant.id));

    await runEffect(
      service.deleteDevices(request({ cookie: "mattrax_session=member" }), tenant.id, ["device-1"]),
    );

    expect(db.store.device.some((row: any) => row.id === "device-1")).toBe(false);
    const audit = db.store.audit_log.find((entry: any) => entry.action === "device.deleted");

    expect(audit).toMatchObject({ metadata: { destroyedSecretKinds: [] } });
  });

  it("maps R2 failures separately from a missing archive", async () => {
    const { db, service, storage, headers } = await makeContext();
    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    db.store.device.push(deviceRow("device-1", tenant.id));
    await seedSecrets(db, "device-1", tenant.id, { filevault_recovery_key: "fv-key-1234" });

    const created = await runEffect(
      service.createDeviceHandover(request(headers), tenant.id, {
        ids: ["device-1"],
        passphrase,
        reason: "Lease returned",
      }),
    );

    const originalGet = storage.get;
    storage.get = async () => {
      throw new Error("R2 outage");
    };

    await expect(
      runEffect(
        service.downloadDeviceHandover(request(headers), tenant.id, created.id, {
          token: created.downloadToken,
        }),
      ),
    ).rejects.toMatchObject({ _tag: "EnterpriseR2InternalError" });

    storage.get = async () => null;

    await expect(
      runEffect(
        service.downloadDeviceHandover(request(headers), tenant.id, created.id, {
          token: created.downloadToken,
        }),
      ),
    ).rejects.toMatchObject({ _tag: "EnterpriseR2FileNotFound" });

    storage.get = originalGet;
  });

  it("refuses a payload larger than the archive bound", async () => {
    const { db, service, headers } = await makeContext();
    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    db.store.device.push(
      deviceRow("device-1", tenant.id, { notes: "x".repeat(8 * 1024 * 1024 + 1) }),
    );

    await expect(
      runEffect(
        service.createDeviceHandover(request(headers), tenant.id, {
          ids: ["device-1"],
          passphrase,
          reason: "Lease returned",
        }),
      ),
    ).rejects.toMatchObject({ _tag: "EnterpriseBadRequest" });
  });

  it("still returns a claimed archive when the download audit write fails", async () => {
    const { db, service, headers } = await makeContext();
    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    db.store.device.push(deviceRow("device-1", tenant.id));
    await seedSecrets(db, "device-1", tenant.id, { filevault_recovery_key: "fv-key-1234" });

    const created = await runEffect(
      service.createDeviceHandover(request(headers), tenant.id, {
        ids: ["device-1"],
        passphrase,
        reason: "Lease returned",
      }),
    );

    const insert = db.insert;

    db.insert = ((table: any) => {
      if (table === schema.auditLog)
        return {
          values: () => Effect.fail(new Error("audit outage")),
        } as any;

      return insert(table);
    }) as typeof db.insert;

    const downloaded = await runEffect(
      service.downloadDeviceHandover(request(headers), tenant.id, created.id, {
        token: created.downloadToken,
      }),
    );

    expect(downloaded.content).toContain("ciphertext");
    expect(db.store.device_handover_archive[0].downloadedAt).toBeInstanceOf(Date);
  });

  it("removes the R2 object when the archive row cannot be written", async () => {
    const { db, service, storage, headers } = await makeContext();
    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    db.store.device.push(deviceRow("device-1", tenant.id));
    await seedSecrets(db, "device-1", tenant.id, { filevault_recovery_key: "fv-key-1234" });

    const insert = db.insert;

    db.insert = ((table: any) => {
      if (table === schema.deviceHandoverArchive)
        return {
          values: () => Effect.fail(new Error("insert failed")),
        } as any;

      return insert(table);
    }) as typeof db.insert;

    await expect(
      runEffect(
        service.createDeviceHandover(request(headers), tenant.id, {
          ids: ["device-1"],
          passphrase,
          reason: "Lease returned",
        }),
      ),
    ).rejects.toBeDefined();

    expect([...storage.objects.keys()].filter((key) => key.startsWith("handovers/"))).toEqual([]);
  });
});
