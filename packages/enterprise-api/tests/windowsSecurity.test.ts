import { Effect, Schema, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { openSecret, verifyScopedToken } from "@mattrax/crypto";
import {
  EnterpriseBadRequest,
  StepUpRequired,
  windowsLapsPolicyNodes,
} from "@mattrax/enterprise-domain";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { makeDb, request, requireField, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";
const authSecret = "windows-security-test-secret";

const at = new Date("2026-11-24T10:00:00.000Z");

const makeStorage = () => {
  const objects = new Map<string, Uint8Array>();

  const object = (key: string, bytes: Uint8Array) => ({
    key,
    version: "v1",
    size: bytes.byteLength,
    etag: "etag",
    httpEtag: '"etag"',
    uploaded: at,
    customMetadata: {},
    body: new ReadableStream(),
    bodyUsed: false,
    text: async () => new TextDecoder().decode(bytes),
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
    json: async () => JSON.parse(new TextDecoder().decode(bytes)),
    blob: async () => new Blob([new Uint8Array(bytes)]),
  });

  return {
    objects,
    head: async (key: string) => {
      const bytes = objects.get(key);

      return bytes === undefined ? null : object(key, bytes);
    },
    get: async (key: string) => {
      const bytes = objects.get(key);

      return bytes === undefined ? null : object(key, bytes);
    },
    put: async (key: string, value: string | ArrayBuffer | Uint8Array) => {
      const bytes =
        typeof value === "string"
          ? new TextEncoder().encode(value)
          : value instanceof Uint8Array
            ? value
            : new Uint8Array(value);

      objects.set(key, bytes);

      return object(key, bytes);
    },
    delete: async (keys: string | ReadonlyArray<string>) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    },
    list: async () => ({ objects: [], truncated: false, delimitedPrefixes: [] }),
  };
};

const base64Utf16 = (value: string) => {
  const bytes = new Uint8Array(value.length * 2);

  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    bytes[index * 2] = code & 0xff;
    bytes[index * 2 + 1] = code >> 8;
  }

  return Buffer.from(bytes).toString("base64");
};

const makeContext = async (options?: {
  readonly requireStepUp?: () => Effect.Effect<void, unknown>;
  readonly credentials?: {
    readonly accountName: string;
    readonly accountSid?: string;
    readonly password: string;
    readonly backupDateTime?: string;
  };
  readonly bitlockerKeys?: ReadonlyArray<{
    readonly id: string;
    readonly volumeType: number | string;
    readonly createdDateTime: string;
    readonly key: string;
  }>;
  readonly windowsDiagnosticsMaxBytes?: number;
  readonly lapsError?: boolean;
  readonly graphDeviceId?: string;
}) => {
  const db = makeDb();
  const storage = makeStorage();

  db.store.account.push({
    id: "user-1",
    name: "Owner",
    email: "owner@example.com",
    emailVerified: true,
    image: null,
    createdAt: at,
    updatedAt: at,
  });

  const auth = {
    requireUser: (input: any) => {
      const headers = input instanceof Request ? Object.fromEntries(input.headers) : input.headers;

      return headers.cookie
        ? Effect.succeed({ user: db.store.account[0], apiToken: undefined })
        : Effect.fail(new Error("unauthenticated"));
    },
    listApiTokens: () => Effect.succeed({ tokens: [] }),
    createApiToken: () => Effect.die("not used"),
    revokeApiToken: () => Effect.succeed({ status: "ok" }),
    requestEmailChange: () => Effect.succeed({ status: "ok" }),
    requireStepUp: options?.requireStepUp ?? (() => Effect.void),
    verifyEmailChange: () => Effect.succeed({ status: "ok" }),
  };

  const credential = options?.credentials ?? {
    accountName: "MattraxAdmin",
    accountSid: "S-1-5-21-1",
    password: "correct-horse-battery-42!",
    backupDateTime: "2026-11-20T00:00:00.000Z",
  };

  const bitlockerKeys = options?.bitlockerKeys ?? [
    {
      id: "recovery-key-1",
      volumeType: 1,
      createdDateTime: "2026-11-01T00:00:00.000Z",
      key: "111111-222222-333333-444444-555555-666666-777777-888888",
    },
  ];

  let bitlockerListCalls = 0;

  const azureGraph = {
    deviceLocalCredentials: () =>
      options?.lapsError
        ? Effect.fail({ _tag: "RequestFailed", message: "graph unavailable" })
        : Effect.succeed({
            id: "entra-device",
            deviceName: "WIN-1",
            lastBackupDateTime: credential.backupDateTime,
            refreshDateTime: "2026-12-20T00:00:00.000Z",
            credentials: [
              {
                accountName: credential.accountName,
                accountSid: credential.accountSid,
                backupDateTime: credential.backupDateTime,
                passwordBase64: base64Utf16(credential.password),
              },
            ],
          }),
    listBitlockerRecoveryKeys: () => {
      bitlockerListCalls++;

      return Effect.succeed(
        bitlockerKeys.map(({ key: _key, ...metadata }) => ({
          ...metadata,
          deviceId: options?.graphDeviceId ?? "entra-device",
        })),
      );
    },
    getBitlockerRecoveryKey: (_tenantId: string, keyId: string) => {
      const key = bitlockerKeys.find((entry) => entry.id === keyId);

      return key
        ? Effect.succeed({ ...key, deviceId: options?.graphDeviceId ?? "entra-device" })
        : Effect.fail({ _tag: "NotFound", message: "not found" });
    },
  };

  const service = createEnterpriseService({
    db,
    schema,
    origin,
    storage: storage as any,
    auth: auth as never,
    authSecret,
    azureGraph: azureGraph as never,
    windowsDiagnosticsMaxBytes: options?.windowsDiagnosticsMaxBytes,
  });

  const headers = { cookie: "mattrax_session=test" };
  const tenant = await runEffect(
    service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
  );

  db.store.sso_config.push({
    organizationId: tenant.id,
    azureTenantId: "tenant-entra-id",
  });

  return {
    db,
    service,
    storage,
    headers,
    tenant,
    bitlockerKeys,
    bitlockerListCalls: () => bitlockerListCalls,
  };
};

const seedDevice = (
  db: ReturnType<typeof makeDb>,
  organizationId: string,
  id: string,
  overrides: Record<string, Schema.Json> = {},
) => {
  db.store.device.push({
    id,
    organizationId,
    proto: "win",
    status: "enrolled",
    name: "WIN-1",
    model: "Surface Laptop 5",
    osEdition: "Windows 11 Enterprise",
    osVersion: "10.0.22631",
    osBuild: "22631.3155",
    serial: "SERIAL-1",
    bitLockerEnabled: true,
    bitLockerStatus: 0,
    entraDeviceId: "entra-device",
    domainName: null,
    enrolledAt: at,
    lastSeenAt: at,
    inventoryUpdatedAt: at,
    capabilities: null,
    ...overrides,
  });
};

const seedLapsPolicy = async (
  db: ReturnType<typeof makeDb>,
  service: ReturnType<typeof createEnterpriseService>,
  headers: Record<string, string>,
  tenantId: string,
  deviceId: string,
  data: Record<string, Schema.Json>,
) => {
  const policy = await runEffect(
    service.createPolicy(request(headers), tenantId, {
      name: "LAPS",
      configurations: { "mttx.windows.laps": data },
    }),
  );

  db.store.device_policy.push({ deviceId, policyId: policy.id, mode: "include" });

  return policy;
};

describe("Windows LAPS", () => {
  it("resolves the policy, reveals the Entra-backed password and audits it", async () => {
    const { db, service, headers, tenant } = await makeContext();

    seedDevice(db, tenant.id, "win-1");
    await seedLapsPolicy(db, service, headers, tenant.id, "win-1", {
      backupDirectory: "entra-id",
      accountName: "MattraxAdmin",
      passwordAgeDays: 30,
      passwordLength: 20,
      passwordComplexity: 4,
    });

    const security = await runEffect(
      service.getDeviceWindowsSecurity(request(headers), tenant.id, "win-1"),
    );

    expect(security.laps).toMatchObject({
      supported: true,
      configured: true,
      retrievable: true,
      backupDirectory: "entra-id",
      accountName: "MattraxAdmin",
    });

    const revealed = await runEffect(
      service.getDeviceLapsPassword(request(headers), tenant.id, "win-1", {
        reason: "help desk recovery",
      }),
    );

    expect(revealed.body.password).toBe("correct-horse-battery-42!");
    expect(revealed.body.expired).toBe(false);
    expect(revealed.headers["cache-control"]).toBe("no-store");

    const secret = db.store.device_secret.find((row: any) => row.kind === "windows_laps_password");

    expect(secret).toBeDefined();
    expect(await openSecret(authSecret, secret.sealedValue)).toBe("correct-horse-battery-42!");

    expect(
      db.store.audit_log.some((row: any) => row.action === "device.windows_laps_password_viewed"),
    ).toBe(true);

    // Presence metadata only: no secret value is returned by the status read.
    expect(JSON.stringify(security)).not.toContain("correct-horse-battery-42!");
  });

  it("refuses AD-only backup, unsupported builds and a missing reason", async () => {
    const { db, service, headers, tenant } = await makeContext();

    seedDevice(db, tenant.id, "win-ad", { osBuild: "22631.1" });
    await seedLapsPolicy(db, service, headers, tenant.id, "win-ad", {
      backupDirectory: "active-directory",
    });

    await expect(
      runEffect(
        service.getDeviceLapsPassword(request(headers), tenant.id, "win-ad", {
          reason: "help desk recovery",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    seedDevice(db, tenant.id, "win-old", { osBuild: "19045.1" });

    await expect(
      runEffect(service.getDeviceWindowsSecurity(request(headers), tenant.id, "win-old")),
    ).resolves.toMatchObject({ laps: { supported: false } });

    await expect(
      runEffect(
        service.getDeviceLapsPassword(request(headers), tenant.id, "win-ad", {
          reason: "",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
  });

  it("persists a bounded Graph failure on the LAPS metadata", async () => {
    const { db, service, headers, tenant } = await makeContext({ lapsError: true });
    seedDevice(db, tenant.id, "win-1");
    await seedLapsPolicy(db, service, headers, tenant.id, "win-1", {
      backupDirectory: "entra-id",
    });

    await expect(
      runEffect(
        service.getDeviceLapsPassword(request(headers), tenant.id, "win-1", {
          reason: "help desk recovery",
        }),
      ),
    ).rejects.toMatchObject({ _tag: "EnterpriseUpstreamError" });

    expect(db.store.device_windows_laps[0].lastError).toContain("graph unavailable");
  });

  it("rejects rotation when the LAPS policy stores the password nowhere", async () => {
    const { db, service, headers, tenant } = await makeContext();
    seedDevice(db, tenant.id, "win-disabled");
    await seedLapsPolicy(db, service, headers, tenant.id, "win-disabled", {
      backupDirectory: "disabled",
    });

    await expect(
      runEffect(
        service.deviceAction(request(headers), tenant.id, "win-disabled", {
          action: "rotate-local-admin-password",
        }),
      ),
    ).rejects.toMatchObject({ _tag: "EnterpriseBadRequest" });

    expect(
      db.store.device_command.some((row: any) => row.requestType === "WindowsLapsResetPassword"),
    ).toBe(false);
  });

  it("requires step-up and never crosses tenant boundaries", async () => {
    const { db, service, headers, tenant } = await makeContext({
      requireStepUp: () =>
        Effect.fail(
          new StepUpRequired({
            message: "Confirm this action",
            action: "recovery-key-reveal",
            methods: ["passkey"],
          }),
        ),
    });

    seedDevice(db, tenant.id, "win-1");
    await seedLapsPolicy(db, service, headers, tenant.id, "win-1", {
      backupDirectory: "entra-id",
    });

    await expect(
      runEffect(
        service.getDeviceLapsPassword(request(headers), tenant.id, "win-1", {
          reason: "help desk recovery",
        }),
      ),
    ).rejects.toMatchObject({ _tag: "StepUpRequired" });

    const other = await runEffect(
      service.createTenant(request(headers), { name: "Other", slug: "other" }),
    );

    await expect(
      runEffect(service.getDeviceWindowsSecurity(request(headers), other.id, "win-1")),
    ).rejects.toMatchObject({ _tag: "EnterpriseNotFound" });
  });

  it("emits the documented LAPS nodes", () => {
    const nodes = windowsLapsPolicyNodes({
      backupDirectory: "entra-id",
      passwordAgeDays: 30,
      passwordLength: 20,
      passwordComplexity: 4,
      postAuthenticationActions: 1,
      postAuthenticationResetDelayHours: 12,
    });

    expect(nodes.map((node) => node.omaUri)).toEqual(
      expect.arrayContaining([
        "./Device/Vendor/MSFT/LAPS/Policies/BackupDirectory",
        "./Device/Vendor/MSFT/LAPS/Policies/PostAuthenticationResetDelay",
      ]),
    );
  });
});

describe("BitLocker escrow", () => {
  it("syncs Entra metadata, reveals through Graph and caches the sealed key", async () => {
    const { db, service, headers, tenant } = await makeContext();
    seedDevice(db, tenant.id, "win-1");

    const security = await runEffect(
      service.getDeviceWindowsSecurity(request(headers), tenant.id, "win-1"),
    );

    expect(security.bitlocker.keys).toHaveLength(1);
    expect(security.bitlocker.keys[0]).toMatchObject({
      volumeType: "operating-system",
      keyId: "recovery-key-1",
      source: "entra-id",
      keyAvailable: false,
      rotatedAt: null,
    });
    expect(security.bitlocker.lastSyncedAt).toBeTruthy();
    expect(security.bitlocker.escrowMissing).toBe(false);
    expect(JSON.stringify(security)).not.toContain("111111-222222");

    const revealed = await runEffect(
      service.revealDeviceBitlockerKey(
        request(headers),
        tenant.id,
        "win-1",
        security.bitlocker.keys[0].id,
        { reason: "motherboard replacement" },
      ),
    );

    expect(revealed.body.recoveryKey).toContain("111111-222222");
    expect(revealed.headers["cache-control"]).toBe("no-store");
    expect(
      db.store.audit_log.some((row: any) => row.action === "device.bitlocker_key_viewed"),
    ).toBe(true);

    const stored = db.store.device_bitlocker_key[0];
    expect(stored.sealedValue).toBeTruthy();
    expect(await openSecret(authSecret, stored.sealedValue)).toContain("111111-222222");

    // The second read is served from the sealed cache without another Graph
    // key read.
    const cached = await runEffect(
      service.revealDeviceBitlockerKey(
        request(headers),
        tenant.id,
        "win-1",
        security.bitlocker.keys[0].id,
        { reason: "second attempt" },
      ),
    );

    expect(cached.body.recoveryKey).toContain("111111-222222");
  });

  it("retires replaced keys without treating a metadata refresh as a rotation", async () => {
    const first = {
      id: "recovery-key-1",
      volumeType: 1,
      createdDateTime: "2026-11-01T00:00:00.000Z",
      key: "111111-222222",
    };
    const { db, service, headers, tenant, bitlockerKeys } = await makeContext({
      bitlockerKeys: [first],
    });
    seedDevice(db, tenant.id, "win-1");

    await runEffect(service.getDeviceWindowsSecurity(request(headers), tenant.id, "win-1"));
    const firstRow = db.store.device_bitlocker_key[0];

    // A repeated list is not a rotation. The capture time and rotatedAt stay
    // stable; only reportedAt advances.
    await runEffect(service.getDeviceWindowsSecurity(request(headers), tenant.id, "win-1"));
    expect(db.store.device_bitlocker_key[0].capturedAt).toBe(firstRow.capturedAt);
    expect(db.store.device_bitlocker_key[0].rotatedAt).toBeNull();

    // Replace the same volume with a new protector id.
    (bitlockerKeys as any).splice(0, 1, {
      id: "recovery-key-2",
      volumeType: 1,
      createdDateTime: "2026-11-23T00:00:00.000Z",
      key: "999999-888888",
    });
    db.store.device[0].bitLockerKeysSyncedAt = null;

    const security = await runEffect(
      service.getDeviceWindowsSecurity(request(headers), tenant.id, "win-1"),
    );
    const rows = db.store.device_bitlocker_key;
    const oldRow = rows.find((row: any) => row.keyId === "recovery-key-1");
    const newRow = rows.find((row: any) => row.keyId === "recovery-key-2");

    expect(oldRow.retiredAt).toBeTruthy();
    expect(newRow.rotatedAt).toBeTruthy();
    expect(security.bitlocker.keys).toHaveLength(1);
    expect(security.bitlocker.lastRotationAt).toBe(newRow.rotatedAt.toISOString());
  });

  it("marks a replacement only when a second sync adds a key to an existing one", async () => {
    const oldKey = {
      id: "recovery-key-old",
      volumeType: 1,
      createdDateTime: "2026-11-01T00:00:00.000Z",
      key: "111111-222222",
    };
    const { db, service, headers, tenant, bitlockerKeys } = await makeContext({
      bitlockerKeys: [oldKey],
    });
    seedDevice(db, tenant.id, "win-1");

    await runEffect(service.getDeviceWindowsSecurity(request(headers), tenant.id, "win-1"));
    expect(db.store.device_bitlocker_key[0].rotatedAt).toBeNull();

    (bitlockerKeys as any).push({
      id: "recovery-key-new",
      volumeType: 1,
      createdDateTime: "2026-11-23T00:00:00.000Z",
      key: "999999-888888",
    });
    db.store.device[0].bitLockerKeysSyncedAt = null;

    const security = await runEffect(
      service.getDeviceWindowsSecurity(request(headers), tenant.id, "win-1"),
    );
    // The in-memory fake does not enforce the composite unique index, so
    // compare unique Graph key ids rather than raw inserted rows.
    const rows = [
      ...new Map(db.store.device_bitlocker_key.map((row: any) => [row.keyId, row])).values(),
    ];
    const oldRow = rows.find((row: any) => row.keyId === "recovery-key-old");
    const newRow = rows.find((row: any) => row.keyId === "recovery-key-new");

    expect(rows).toHaveLength(2);
    expect(oldRow.rotatedAt).toBeNull();
    expect(newRow.rotatedAt).toBeTruthy();
    expect(security.bitlocker.lastRotationAt).toBe(newRow.rotatedAt.toISOString());
  });

  it("does not mark a rotation when the first sync already has two keys", async () => {
    const { db, service, headers, tenant } = await makeContext({
      bitlockerKeys: [
        {
          id: "recovery-key-1",
          volumeType: 1,
          createdDateTime: "2026-11-01T00:00:00.000Z",
          key: "111111-222222",
        },
        {
          id: "recovery-key-2",
          volumeType: 1,
          createdDateTime: "2026-11-02T00:00:00.000Z",
          key: "999999-888888",
        },
      ],
    });
    seedDevice(db, tenant.id, "win-1");

    const security = await runEffect(
      service.getDeviceWindowsSecurity(request(headers), tenant.id, "win-1"),
    );

    expect(db.store.device_bitlocker_key.every((row: any) => row.rotatedAt === null)).toBe(true);
    expect(security.bitlocker.lastRotationAt).toBeNull();
  });

  it("forces a metadata refresh for a reveal that misses the TTL cache", async () => {
    const first = {
      id: "recovery-key-1",
      volumeType: 1,
      createdDateTime: "2026-11-01T00:00:00.000Z",
      key: "111111-222222",
    };
    const { db, service, headers, tenant, bitlockerKeys } = await makeContext({
      bitlockerKeys: [first],
    });
    seedDevice(db, tenant.id, "win-1");

    await runEffect(service.getDeviceWindowsSecurity(request(headers), tenant.id, "win-1"));

    (bitlockerKeys as any).splice(0, 1, {
      id: "recovery-key-new",
      volumeType: 1,
      createdDateTime: "2026-11-24T00:00:00.000Z",
      key: "999999-888888",
    });

    const revealed = await runEffect(
      service.revealDeviceBitlockerKey(request(headers), tenant.id, "win-1", "recovery-key-new", {
        reason: "post-rotation recovery",
      }),
    );

    expect(revealed.body.recoveryKey).toContain("999999-888888");
    expect(db.store.device_bitlocker_key.some((row: any) => row.keyId === "recovery-key-new")).toBe(
      true,
    );
  });

  it("coalesces force refreshes from repeated reveal misses", async () => {
    const { db, service, headers, tenant, bitlockerListCalls } = await makeContext();
    seedDevice(db, tenant.id, "win-1");

    await runEffect(service.getDeviceWindowsSecurity(request(headers), tenant.id, "win-1"));
    expect(bitlockerListCalls()).toBe(1);

    await expect(
      runEffect(
        service.revealDeviceBitlockerKey(request(headers), tenant.id, "win-1", "missing-1", {
          reason: "firmware update",
        }),
      ),
    ).rejects.toMatchObject({ _tag: "EnterpriseNotFound" });
    expect(bitlockerListCalls()).toBe(2);

    await expect(
      runEffect(
        service.revealDeviceBitlockerKey(request(headers), tenant.id, "win-1", "missing-2", {
          reason: "firmware update",
        }),
      ),
    ).rejects.toMatchObject({ _tag: "EnterpriseNotFound" });
    expect(bitlockerListCalls()).toBe(2);
  });

  it("normalises the Graph device id on reveal and rejects a different device", async () => {
    const normalised = await makeContext({ graphDeviceId: " ENTRA-DEVICE " });
    seedDevice(normalised.db, normalised.tenant.id, "win-1");
    const security = await runEffect(
      normalised.service.getDeviceWindowsSecurity(
        request(normalised.headers),
        normalised.tenant.id,
        "win-1",
      ),
    );

    await expect(
      runEffect(
        normalised.service.revealDeviceBitlockerKey(
          request(normalised.headers),
          normalised.tenant.id,
          "win-1",
          security.bitlocker.keys[0].id,
          { reason: "firmware update" },
        ),
      ),
    ).resolves.toBeDefined();

    const mismatch = await makeContext({ graphDeviceId: "another-device" });
    seedDevice(mismatch.db, mismatch.tenant.id, "win-1");
    const second = await runEffect(
      mismatch.service.getDeviceWindowsSecurity(
        request(mismatch.headers),
        mismatch.tenant.id,
        "win-1",
      ),
    );

    await expect(
      runEffect(
        mismatch.service.revealDeviceBitlockerKey(
          request(mismatch.headers),
          mismatch.tenant.id,
          "win-1",
          second.bitlocker.keys[0].id,
          { reason: "firmware update" },
        ),
      ),
    ).rejects.toMatchObject({ _tag: "EnterpriseBadRequest" });
  });

  it("offers rotation only for Entra/hybrid devices, not a plain AD join", async () => {
    const { db, service, headers, tenant } = await makeContext();
    seedDevice(db, tenant.id, "ad-only", {
      entraDeviceId: null,
      domainName: "corp.example.com",
    });
    seedDevice(db, tenant.id, "hybrid", { domainName: "corp.example.com" });

    await expect(
      runEffect(
        service.deviceAction(request(headers), tenant.id, "ad-only", {
          action: "rotate-bitlocker-key",
        }),
      ),
    ).rejects.toMatchObject({ _tag: "EnterpriseBadRequest" });

    const queued = await runEffect(
      service.deviceAction(request(headers), tenant.id, "hybrid", {
        action: "rotate-bitlocker-key",
      }),
    );

    expect(requireField(queued, "commandId").commandId).toBeTruthy();
    expect(
      db.store.device_command.some((row: any) => row.requestType === "WindowsBitLockerRotate"),
    ).toBe(true);
    // The status poll is not queued in the same batch.
    expect(
      db.store.device_command.some(
        (row: any) => row.requestType === "WindowsBitLockerRotateStatus",
      ),
    ).toBe(false);

    const exec = db.store.device_command.find(
      (row: any) => row.requestType === "WindowsBitLockerRotate",
    );
    expect(exec.expiresAt).toBeInstanceOf(Date);

    // Simulate the device accepting the async Exec and an unresolved status.
    exec.status = "accepted";
    exec.resultStatus = "0x4000000";

    db.store.device_command.push({
      id: "status-1",
      organizationId: tenant.id,
      deviceId: "hybrid",
      requestType: "WindowsBitLockerRotateStatus",
      payload: { kind: "Get", execCommandId: exec.id },
      status: "sent",
      dedupeKey: null,
      expiresAt: null,
      resultStatus: null,
      resultDetail: null,
      createdAt: new Date(Date.now() + 1),
      updatedAt: new Date(),
    });

    await expect(
      runEffect(
        service.deviceAction(request(headers), tenant.id, "hybrid", {
          action: "rotate-bitlocker-key",
        }),
      ),
    ).rejects.toMatchObject({ _tag: "EnterpriseConflict" });

    expect(
      (await runEffect(service.getDeviceWindowsSecurity(request(headers), tenant.id, "hybrid")))
        .bitlocker.rotationInProgress,
    ).toBe(true);

    // A terminal status closes the parent Exec and clears in-progress.
    const statusRow = db.store.device_command.find((row: any) => row.id === "status-1");
    statusRow.status = "succeeded";
    statusRow.resultDetail = "Status 0";
    statusRow.resultStatus = "200";

    expect(
      (await runEffect(service.getDeviceWindowsSecurity(request(headers), tenant.id, "hybrid")))
        .bitlocker.rotationInProgress,
    ).toBe(false);
    expect(db.store.device_command.find((row: any) => row.id === exec.id).status).toBe("succeeded");

    const second = await runEffect(
      service.deviceAction(request(headers), tenant.id, "hybrid", {
        action: "rotate-bitlocker-key",
      }),
    );
    const secondCommand = requireField(second, "commandId");
    expect(secondCommand.commandId).toBeTruthy();

    // A rotation that never terminates expires through the 24-hour budget.
    const secondExec = db.store.device_command.find(
      (row: any) =>
        row.requestType === "WindowsBitLockerRotate" && row.id === secondCommand.commandId,
    );
    secondExec.status = "accepted";
    secondExec.expiresAt = new Date(Date.now() - 1_000);

    db.store.device_command.push({
      id: "status-2",
      organizationId: tenant.id,
      deviceId: "hybrid",
      requestType: "WindowsBitLockerRotateStatus",
      payload: { kind: "Get", execCommandId: secondCommand.commandId },
      status: "sent",
      dedupeKey: null,
      expiresAt: new Date(Date.now() - 1_000),
      resultStatus: null,
      resultDetail: "Status 1",
      createdAt: new Date(Date.now() + 2),
      updatedAt: new Date(),
    });

    await expect(
      runEffect(
        service.deviceAction(request(headers), tenant.id, "hybrid", {
          action: "rotate-bitlocker-key",
        }),
      ),
    ).resolves.toMatchObject({ status: "ok" });
  });

  it("requires step-up, a reason and tenant isolation for a reveal", async () => {
    const { db, service, headers, tenant } = await makeContext();
    seedDevice(db, tenant.id, "win-1");

    const security = await runEffect(
      service.getDeviceWindowsSecurity(request(headers), tenant.id, "win-1"),
    );
    const keyId = security.bitlocker.keys[0].id;

    await expect(
      runEffect(
        service.revealDeviceBitlockerKey(request(headers), tenant.id, "win-1", keyId, {
          reason: "x",
        }),
      ),
    ).rejects.toMatchObject({ _tag: "EnterpriseBadRequest" });

    const other = await runEffect(
      service.createTenant(request(headers), { name: "Other", slug: "other" }),
    );

    await expect(
      runEffect(
        service.revealDeviceBitlockerKey(request(headers), other.id, "win-1", keyId, {
          reason: "valid reason",
        }),
      ),
    ).rejects.toMatchObject({ _tag: "EnterpriseNotFound" });

    const stepUp = await makeContext({
      requireStepUp: () =>
        Effect.fail(
          new StepUpRequired({
            message: "Confirm this action",
            action: "recovery-key-reveal",
            methods: ["passkey"],
          }),
        ),
    });
    seedDevice(stepUp.db, stepUp.tenant.id, "win-1");

    await expect(
      runEffect(
        stepUp.service.revealDeviceBitlockerKey(
          request(stepUp.headers),
          stepUp.tenant.id,
          "win-1",
          "missing",
          { reason: "valid reason" },
        ),
      ),
    ).rejects.toMatchObject({ _tag: "StepUpRequired" });
  });
});

describe("Windows diagnostics and Fresh Start", () => {
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);

  it("queues a DiagnosticLog collection, accepts the CSP upload and serves a short-lived link", async () => {
    const { db, service, headers, tenant, storage } = await makeContext();
    seedDevice(db, tenant.id, "win-1");

    const action = await runEffect(
      service.deviceAction(request(headers), tenant.id, "win-1", {
        action: "collect-diagnostics",
      }),
    );

    expect(requireField(action, "diagnostics").diagnostics?.archiveId).toBeTruthy();
    const command = db.store.device_command.find(
      (row: any) => row.requestType === "WindowsCollectDiagnostics",
    );

    expect(command).toBeDefined();
    expect(command.payload.locURI).toBe(
      "./Vendor/MSFT/DiagnosticLog/DiagnosticArchive/ArchiveDefinition",
    );
    expect(command.payload.data).toContain("<SasUrl>");
    expect(command.payload.data).toContain("/api/v1/windows-diagnostics/upload?token=");

    const pending = await runEffect(
      service.listDeviceDiagnostics(request(headers), tenant.id, "win-1"),
    );

    expect(pending.archives[0]).toMatchObject({ status: "pending", downloadPath: null });

    const match = /https:\/\/[^"\]]+\?token=[^&"]+&archiveId=[^"\]]+/.exec(command.payload.data);

    expect(match).toBeTruthy();

    const upload = await runEffect(
      service.uploadWindowsDiagnostics(new Request(match![0], { method: "POST", body: zip })),
    );

    expect(upload.status).toBe(200);
    expect(storage.objects.size).toBe(1);

    const uploaded = await runEffect(
      service.listDeviceDiagnostics(request(headers), tenant.id, "win-1"),
    );
    const archive = uploaded.archives[0];

    expect(archive.status).toBe("uploaded");
    expect(archive.downloadPath).toBeTruthy();

    const token = new URL(origin + archive.downloadPath).searchParams.get("token")!;
    expect(
      await verifyScopedToken(
        authSecret,
        "windows-diagnostics-download",
        tenant.id + ":" + archive.id + ":win-1",
        token,
        Date.now(),
      ),
    ).toBe(true);

    const bytes = await runEffect(
      service.downloadDeviceDiagnostics(request(headers), tenant.id, "win-1", archive.id, {
        token,
      }),
    );

    expect(Array.from(bytes.body)).toEqual(Array.from(zip));
    expect(bytes.headers["cache-control"]).toBe("no-store");

    const other = await runEffect(
      service.createTenant(request(headers), { name: "Other", slug: "other" }),
    );

    await expect(
      runEffect(
        service.downloadDeviceDiagnostics(request(headers), other.id, "win-1", archive.id, {
          token,
        }),
      ),
    ).rejects.toMatchObject({ _tag: "EnterpriseNotFound" });
  });

  it("rejects an upload with a forged token and a non-ZIP body", async () => {
    const { db, service, headers, tenant } = await makeContext();
    seedDevice(db, tenant.id, "win-1");

    await runEffect(
      service.deviceAction(request(headers), tenant.id, "win-1", {
        action: "collect-diagnostics",
      }),
    );

    const command = db.store.device_command.find(
      (row: any) => row.requestType === "WindowsCollectDiagnostics",
    );
    const match = /https:\/\/[^"\]]+\?token=[^&"]+&archiveId=[^"\]]+/.exec(command.payload.data);
    const url = new URL(match![0]);
    url.searchParams.set("token", "forged");

    expect(
      (
        await runEffect(
          service.uploadWindowsDiagnostics(new Request(url, { method: "POST", body: zip })),
        )
      ).status,
    ).toBe(401);

    url.searchParams.set("token", new URL(match![0]).searchParams.get("token")!);

    expect(
      (
        await runEffect(
          service.uploadWindowsDiagnostics(
            new Request(url, { method: "POST", body: new Uint8Array([1, 2, 3, 4]) }),
          ),
        )
      ).status,
    ).toBe(400);
  });

  it("rejects expiry, replay and an over-size stream without content-length", async () => {
    const { db, service, headers, tenant } = await makeContext({
      windowsDiagnosticsMaxBytes: 8,
    });
    seedDevice(db, tenant.id, "win-1");

    await runEffect(
      service.deviceAction(request(headers), tenant.id, "win-1", {
        action: "collect-diagnostics",
      }),
    );

    const command = db.store.device_command.find(
      (row: any) => row.requestType === "WindowsCollectDiagnostics",
    );
    const match = /https:\/\/[^"\]]+\?token=[^&"]+&archiveId=[^"\]]+/.exec(command.payload.data);

    // No content-length: the handler must stop at the byte cap while reading.
    const fakeRequest = {
      url: match![0],
      headers: {},
      stream: Stream.make(
        new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]),
        new Uint8Array([5, 6, 7, 8]),
      ),
    } as never;

    expect((await runEffect(service.uploadWindowsDiagnostics(fakeRequest))).status).toBe(413);

    const failedStream = {
      url: match![0],
      headers: {},
      stream: Stream.fail(new Error("stream broke")),
    } as never;

    expect((await runEffect(service.uploadWindowsDiagnostics(failedStream))).status).toBe(400);

    // A successful upload consumes the pending archive; replaying the same
    // signed URL cannot overwrite it.
    const first = await runEffect(
      service.uploadWindowsDiagnostics(
        new Request(match![0], { method: "PUT", body: new Uint8Array([0x50, 0x4b, 0x05, 0x06]) }),
      ),
    );
    expect(first.status).toBe(200);

    expect(
      (
        await runEffect(
          service.uploadWindowsDiagnostics(
            new Request(match![0], {
              method: "PUT",
              body: new Uint8Array([0x50, 0x4b, 0x05, 0x06]),
            }),
          ),
        )
      ).status,
    ).toBe(401);

    const archive = db.store.device_diagnostics_archive[0];
    archive.expiresAt = new Date(Date.now() - 1_000);

    const listed = await runEffect(
      service.listDeviceDiagnostics(request(headers), tenant.id, "win-1"),
    );
    expect(listed.archives[0].status).toBe("expired");

    await expect(
      runEffect(
        service.downloadDeviceDiagnostics(request(headers), tenant.id, "win-1", archive.id, {
          token: "anything",
        }),
      ),
    ).rejects.toMatchObject({ _tag: "EnterpriseBadRequest" });
  });

  it("requires an explicit Fresh Start choice and uses the correct CleanPC node", async () => {
    const { db, service, headers, tenant } = await makeContext();
    seedDevice(db, tenant.id, "win-1");

    await expect(
      runEffect(
        service.deviceAction(request(headers), tenant.id, "win-1", { action: "fresh-start" }),
      ),
    ).rejects.toMatchObject({ _tag: "EnterpriseBadRequest" });

    const keep = await runEffect(
      service.deviceAction(request(headers), tenant.id, "win-1", {
        action: "fresh-start",
        freshStartRetainUserData: true,
      }),
    );

    expect(requireField(keep, "freshStart").freshStart).toMatchObject({
      mode: "retain-user-data",
      retainUserData: true,
    });

    const remove = await runEffect(
      service.deviceAction(request(headers), tenant.id, "win-1", {
        action: "fresh-start",
        freshStartRetainUserData: false,
      }),
    );

    expect(requireField(remove, "freshStart").freshStart?.warning).toMatch(/out-of-box/);

    const commands = db.store.device_command.filter(
      (row: any) => row.requestType === "WindowsFreshStart",
    );

    expect(commands.map((row: any) => row.payload.locURI)).toEqual(
      expect.arrayContaining([
        "./Device/Vendor/MSFT/CleanPC/CleanPCRetainingUserData",
        "./Device/Vendor/MSFT/CleanPC/CleanPCWithoutRetainingUserData",
      ]),
    );
  });

  it("rejects unsupported Windows builds and editions instead of queueing", async () => {
    const { db, service, headers, tenant } = await makeContext();
    seedDevice(db, tenant.id, "win-old", { osBuild: "17763.1" });
    seedDevice(db, tenant.id, "win-pro", { osEdition: "Windows 11 Pro" });

    await expect(
      runEffect(
        service.deviceAction(request(headers), tenant.id, "win-old", {
          action: "collect-diagnostics",
        }),
      ),
    ).rejects.toMatchObject({ _tag: "EnterpriseBadRequest" });

    await expect(
      runEffect(
        service.deviceAction(request(headers), tenant.id, "win-pro", {
          action: "fresh-start",
          freshStartRetainUserData: true,
        }),
      ),
    ).rejects.toMatchObject({ _tag: "EnterpriseBadRequest" });
  });
});
