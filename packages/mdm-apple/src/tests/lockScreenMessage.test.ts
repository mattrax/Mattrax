import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { schema } from "@mattrax/enterprise-core";
import { AppleDeviceEvent, MdmOrigin } from "@mattrax/management-backend";
import { ManagementBackendEnterpriseLive } from "@mattrax/mdm-apple";
import { dbRows, makeDb, tableName } from "./fake-db.js";

const origin = "https://enterprise.test";

const authSecret = "enterprise-test-secret";

const mdmOrigin = new MdmOrigin({ url: origin });

const now = new Date("2026-11-23T10:00:00.000Z");

const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect);

const AuthenticateEvent = AppleDeviceEvent.members[0];

const TokenUpdateEvent = AppleDeviceEvent.members[2];

const CommandResultEvent = AppleDeviceEvent.members[5];

const setup = () => {
  const db = makeDb({
    [tableName(schema.organization)]: [
      {
        id: "org-1",
        name: "First",
        slug: "first",
        logo: null,
        metadata: null,
        stripeCustomerId: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
  });

  // SAFETY: the fake store implements only the query chains this test exercises.
  const backend = ManagementBackendEnterpriseLive.make({ db: db as any, origin, authSecret });

  return { db, backend };
};

const scope = {
  _tag: "device" as const,
  udid: "udid-lock-1",
  identityCertificate: "CN=Device,OU=org-1",
  identityCertificateFingerprintSha256: "fingerprint-lock-1",
  mdmOrigin,
};

const authenticate = () =>
  AuthenticateEvent.make({
    serialNumber: "DMPLOCK01",
    model: "iPad13,4",
    enrollmentMode: "device",
  });

const tokenUpdate = () =>
  TokenUpdateEvent.make({
    pushToken: "deadbeef",
    pushMagic: "push-magic",
    topic: "com.apple.mgmt.External.test",
    channel: "device",
    awaitingConfiguration: false,
  });

const storedDevice = (db: ReturnType<typeof setup>["db"]) =>
  db.store[tableName(schema.device)]![0]!;

const deviceRow = (db: ReturnType<typeof setup>["db"]) => dbRows(db, tableName(schema.device))[0];

const commands = (db: ReturnType<typeof setup>["db"]) =>
  dbRows(db, tableName(schema.deviceCommand));

const lockScreenCommands = (db: ReturnType<typeof setup>["db"]) =>
  commands(db).filter((row) => row.requestType === "LockScreenMessage");

const enroll = async (backend: ReturnType<typeof setup>["backend"]) => {
  await run(backend.appleDeviceEvent(scope, authenticate()));
  await run(backend.appleDeviceEvent(scope, tokenUpdate()));
};

type DeviceOverrides = {
  osEdition?: string;
  osVersion?: string;
  model?: string;
  assetTag?: string;
  lockScreenMessage?: string | null;
  lockScreenIncludeAssetTag?: boolean | null;
};

/** Give the enrolled device an iPad identity and the lock screen fields. */
const configure = (db: ReturnType<typeof setup>["db"], values: DeviceOverrides = {}) => {
  Object.assign(storedDevice(db), {
    osEdition: "iPadOS",
    osVersion: "18.1",
    model: "iPad (10th generation)",
    assetTag: "AST-1042",
    ...values,
  });
};

const checkin = (backend: ReturnType<typeof setup>["backend"]) =>
  run(backend.appleManagementCheckin(scope));

describe("Apple lock screen message check-in", () => {
  it("queues LockScreenMessage with the asset tag and audits the push", async () => {
    const { db, backend } = setup();

    await enroll(backend);
    configure(db, {
      lockScreenMessage: "If found, return to the IT desk",
      lockScreenIncludeAssetTag: true,
    });

    await checkin(backend);

    expect(lockScreenCommands(db)).toHaveLength(1);
    expect(lockScreenCommands(db)[0]!.payload).toEqual({
      Message: "If found, return to the IT desk",
      AssetTagInfo: "AST-1042",
    });
    expect(lockScreenCommands(db)[0]!.status).toBe("queued");
    expect(
      dbRows(db, tableName(schema.auditLog)).some(
        (row) => row.action === "device.lock_screen_message_pushed",
      ),
    ).toBe(true);
  });

  it("does not queue a duplicate while the applied state is unchanged", async () => {
    const { db, backend } = setup();

    await enroll(backend);
    configure(db, {
      lockScreenMessage: "If found, return to the IT desk",
      lockScreenIncludeAssetTag: true,
    });

    await checkin(backend);
    expect(lockScreenCommands(db)).toHaveLength(1);

    await checkin(backend);
    expect(lockScreenCommands(db)).toHaveLength(1);

    Object.assign(storedDevice(db), {
      appliedLockScreenMessage: "If found, return to the IT desk",
      appliedLockScreenAssetTag: "AST-1042",
      appliedLockScreenName: storedDevice(db).name,
      appliedLockScreenAt: new Date(),
    });

    await checkin(backend);
    expect(lockScreenCommands(db)).toHaveLength(1);
  });

  it("re-applies when the asset tag or device name changes", async () => {
    const { db, backend } = setup();

    await enroll(backend);
    configure(db, {
      lockScreenMessage: "If found, return to the IT desk",
      lockScreenIncludeAssetTag: true,
    });
    Object.assign(storedDevice(db), {
      appliedLockScreenMessage: "If found, return to the IT desk",
      appliedLockScreenAssetTag: "AST-1042",
      appliedLockScreenName: storedDevice(db).name,
      appliedLockScreenAt: new Date(),
    });

    Object.assign(storedDevice(db), { assetTag: "AST-9999" });
    await checkin(backend);

    expect(lockScreenCommands(db)).toHaveLength(1);
    expect(lockScreenCommands(db)[0]!.payload).toMatchObject({ AssetTagInfo: "AST-9999" });

    // A new command is blocked only while an identical one is recent; a
    // rename is a different desired state, so it queues another.
    Object.assign(storedDevice(db), {
      name: "Cart iPad renamed",
      appliedLockScreenName: "Cart iPad",
    });
    await checkin(backend);

    expect(lockScreenCommands(db)).toHaveLength(2);
  });

  it("records the applied message when the device acknowledges the command", async () => {
    const { db, backend } = setup();

    await enroll(backend);
    configure(db, {
      lockScreenMessage: "If found, return to the IT desk",
      lockScreenIncludeAssetTag: true,
    });

    await checkin(backend);

    const command = lockScreenCommands(db)[0]!;

    await run(
      backend.appleDeviceEvent(
        scope,
        CommandResultEvent.make({
          commandUUID: String(command.id),
          status: "Acknowledged",
        }),
      ),
    );

    expect(deviceRow(db)).toMatchObject({
      appliedLockScreenMessage: "If found, return to the IT desk",
      appliedLockScreenAssetTag: "AST-1042",
      appliedLockScreenName: storedDevice(db).name,
    });
    expect(deviceRow(db).appliedLockScreenAt).toBeInstanceOf(Date);
    expect(lockScreenCommands(db)[0]!.resultDetail).toContain("AST-1042");
  });

  it("uses the policy default when the device has no override", async () => {
    const { db, backend } = setup();

    await enroll(backend);
    configure(db);

    const deviceId = String(storedDevice(db).id);

    db.store[tableName(schema.enterpriseGroup)] = [
      {
        id: "group-1",
        organizationId: "org-1",
        name: "Shared iPads",
        notes: null,
        kind: "manual",
        rules: null,
        directoryGroupId: null,
        lastEvaluatedAt: now,
        createdAt: now,
        updatedAt: now,
        __table: tableName(schema.enterpriseGroup),
      },
    ];
    db.store[tableName(schema.groupDevice)] = [
      {
        groupId: "group-1",
        deviceId,
        source: "manual",
        __table: tableName(schema.groupDevice),
      },
    ];
    db.store[tableName(schema.groupPolicy)] = [
      {
        groupId: "group-1",
        policyId: "policy-1",
        mode: "include",
        __table: tableName(schema.groupPolicy),
      },
    ];
    db.store[tableName(schema.policy)] = [
      {
        id: "policy-1",
        organizationId: "org-1",
        name: "Shared iPads",
        notes: null,
        priority: 0,
        enabled: true,
        createdAt: now,
        updatedAt: now,
        __table: tableName(schema.policy),
      },
    ];
    db.store[tableName(schema.configuration)] = [
      {
        kind: "mttx.apple.lockScreenMessage",
        policyId: "policy-1",
        scope: "device",
        data: { message: "Please return to the IT desk", includeAssetTag: false },
        hash: "hash-1",
        __table: tableName(schema.configuration),
      },
    ];

    await checkin(backend);

    expect(lockScreenCommands(db)).toHaveLength(1);
    expect(lockScreenCommands(db)[0]!.payload).toEqual({
      Message: "Please return to the IT desk",
    });
  });
});
