import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { schema } from "@mattrax/enterprise-core";
import { AppleDeviceEvent, MdmOrigin } from "@mattrax/management-backend";
import {
  ManagementBackendEnterpriseLive,
  appleLockScreenProfileIdentifier,
  buildAppleLockScreenProfile,
  installProfilePayload,
  profileDigest,
} from "@mattrax/mdm-apple";
import { appleIdentityCertificate, dbRows, makeDb, tableName } from "./fake-db.js";
import type { Row } from "./fake-db.js";

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
    [tableName(schema.scepIssuedCertificate)]: [appleIdentityCertificate({ deviceId: null })],
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
  identityCertificateSerial: "A1:B2:C3",
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

const profileCommands = (db: ReturnType<typeof setup>["db"]) =>
  commands(db).filter(
    (row) => row.requestType === "InstallProfile" || row.requestType === "RemoveProfile",
  );

const installedProfiles = (db: ReturnType<typeof setup>["db"]) =>
  profileCommands(db).filter((row) => row.requestType === "InstallProfile");

/** Decode an InstallProfile payload enough to read the profile XML. */
const profileText = (command: Row): string => {
  const payload = command.payload as { Payload?: string };
  const encoded = payload.Payload ?? "";

  return new TextDecoder().decode(
    Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0)),
  );
};

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

const acknowledge = async (backend: ReturnType<typeof setup>["backend"], command: Row) => {
  await run(
    backend.appleDeviceEvent(
      scope,
      CommandResultEvent.make({
        commandUUID: String(command.id),
        status: "Acknowledged",
      }),
    ),
  );
};

describe("Apple lock screen profile check-in", () => {
  it("installs the shared-device profile with the message and asset tag", async () => {
    const { db, backend } = setup();

    await enroll(backend);
    configure(db, {
      lockScreenMessage: "If found, return to the IT desk",
      lockScreenIncludeAssetTag: true,
    });

    await checkin(backend);

    expect(installedProfiles(db)).toHaveLength(1);
    expect(installedProfiles(db)[0]!.status).toBe("queued");

    const text = profileText(installedProfiles(db)[0]!);

    expect(text).toContain("com.apple.shareddeviceconfiguration");
    expect(text).toContain("LockScreenFootnote");
    expect(text).toContain("If found, return to the IT desk");
    expect(text).toContain("AssetTagInformation");
    expect(text).toContain("AST-1042");
    expect(
      dbRows(db, tableName(schema.auditLog)).some(
        (row) => row.action === "device.lock_screen_message_pushed",
      ),
    ).toBe(true);
  });

  it("keeps the lock screen profile across legacy policy reconciliation", async () => {
    const { db, backend } = setup();

    await enroll(backend);
    configure(db, { osVersion: "14.8" });

    const deviceId = String(storedDevice(db).id);
    const profile = await buildAppleLockScreenProfile({
      deviceId,
      message: "If found, return to the IT desk",
      assetTagInfo: null,
    });

    Object.assign(storedDevice(db), {
      lockScreenMessage: "If found, return to the IT desk",
      lockScreenIncludeAssetTag: false,
      queuedLockScreenName: storedDevice(db).name,
      queuedLockScreenDigest: await profileDigest(profile.content),
      queuedLockScreenAt: now,
    });
    db.store[tableName(schema.deviceCommand)]!.push({
      id: "profile-installed",
      organizationId: "org-1",
      deviceId,
      requestType: "InstallProfile",
      payload: installProfilePayload(profile),
      status: "succeeded",
      dedupeKey: null,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      resultStatus: "Acknowledged",
      resultDetail: null,
      createdAt: now,
      updatedAt: now,
      __table: tableName(schema.deviceCommand),
    });

    await checkin(backend);

    const removals = profileCommands(db).filter((row) => row.requestType === "RemoveProfile");

    expect(
      removals.filter(
        (row) =>
          (row.payload as { Identifier?: string }).Identifier ===
          appleLockScreenProfileIdentifier(deviceId),
      ),
    ).toHaveLength(0);
  });

  it("does not queue another profile while the installed profile is unchanged", async () => {
    const { db, backend } = setup();

    await enroll(backend);
    configure(db, {
      lockScreenMessage: "If found, return to the IT desk",
      lockScreenIncludeAssetTag: true,
    });

    await checkin(backend);
    const command = installedProfiles(db)[0]!;

    await acknowledge(backend, command);
    expect(installedProfiles(db)).toHaveLength(1);

    await checkin(backend);
    expect(installedProfiles(db)).toHaveLength(1);
  });

  it("re-installs when the asset tag or device name changes", async () => {
    const { db, backend } = setup();

    await enroll(backend);
    configure(db, {
      lockScreenMessage: "If found, return to the IT desk",
      lockScreenIncludeAssetTag: true,
    });

    await checkin(backend);
    await acknowledge(backend, installedProfiles(db)[0]!);

    Object.assign(storedDevice(db), { assetTag: "AST-9999" });
    await checkin(backend);

    expect(installedProfiles(db)).toHaveLength(2);
    expect(profileText(installedProfiles(db)[1]!)).toContain("AST-9999");

    await acknowledge(backend, installedProfiles(db)[1]!);
    Object.assign(storedDevice(db), { name: "Cart iPad renamed" });
    await checkin(backend);

    expect(installedProfiles(db)).toHaveLength(3);
  });

  it("removes the profile when no message remains", async () => {
    const { db, backend } = setup();

    await enroll(backend);
    configure(db, {
      lockScreenMessage: "If found, return to the IT desk",
      lockScreenIncludeAssetTag: true,
    });

    await checkin(backend);
    await acknowledge(backend, installedProfiles(db)[0]!);

    configure(db, { lockScreenMessage: null, lockScreenIncludeAssetTag: null });
    await checkin(backend);

    const removals = profileCommands(db).filter((row) => row.requestType === "RemoveProfile");

    expect(removals).toHaveLength(1);
    expect(removals[0]!.payload).toMatchObject({
      Identifier: appleLockScreenProfileIdentifier(String(storedDevice(db).id)),
    });
  });

  it("records the applied message when the device acknowledges the profile", async () => {
    const { db, backend } = setup();

    await enroll(backend);
    configure(db, {
      lockScreenMessage: "If found, return to the IT desk",
      lockScreenIncludeAssetTag: true,
    });

    await checkin(backend);

    const command = installedProfiles(db)[0]!;

    await acknowledge(backend, command);

    expect(deviceRow(db)).toMatchObject({
      appliedLockScreenMessage: "If found, return to the IT desk",
      appliedLockScreenAssetTag: "AST-1042",
    });
    expect(deviceRow(db).appliedLockScreenAt).toBeInstanceOf(Date);
    expect(installedProfiles(db)[0]!.resultDetail).toContain("AST-1042");
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

    expect(installedProfiles(db)).toHaveLength(1);
    expect(profileText(installedProfiles(db)[0]!)).toContain("Please return to the IT desk");
  });
});
