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
  udid: "udid-name-1",
  identityCertificate: "CN=Device,OU=org-1",
  identityCertificateFingerprintSha256: "fingerprint-name-1",
  mdmOrigin,
};

const authenticate = () =>
  AuthenticateEvent.make({
    serialNumber: "C02NAME01",
    model: "MacBookPro18,2",
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

const deviceRow = (db: ReturnType<typeof setup>["db"]) => dbRows(db, tableName(schema.device))[0];

/** `dbRows` copies rows, so a test that changes state must write the store. */
const storedDevice = (db: ReturnType<typeof setup>["db"]) =>
  db.store[tableName(schema.device)]![0]!;

const commands = (db: ReturnType<typeof setup>["db"]) =>
  dbRows(db, tableName(schema.deviceCommand));

const settingsCommands = (db: ReturnType<typeof setup>["db"]) =>
  commands(db).filter((row) => row.requestType === "Settings");

const audits = (db: ReturnType<typeof setup>["db"]) =>
  dbRows(db, tableName(schema.auditLog)).filter((row) =>
    String(row.action).startsWith("device.name_push_"),
  );

const enroll = async (backend: ReturnType<typeof setup>["backend"]) => {
  await run(backend.appleDeviceEvent(scope, authenticate()));
  await run(backend.appleDeviceEvent(scope, tokenUpdate()));
};

describe("Apple device name check-in", () => {
  it("queues Settings/DeviceName on check-in while apply-name is enabled", async () => {
    const { db, backend } = setup();

    await enroll(backend);

    // The administrator chose a management name and opted into pushing it.
    Object.assign(storedDevice(db), {
      name: "Reception Mac",
      physicalName: "C02NAME01",
      namePushEnabled: true,
    });

    await run(backend.appleManagementCheckin(scope));

    expect(settingsCommands(db)).toHaveLength(1);
    expect(settingsCommands(db)[0]!.payload).toEqual({
      Settings: [{ Item: "DeviceName", DeviceName: "Reception Mac" }],
    });
    expect(settingsCommands(db)[0]!.status).toBe("queued");
    expect(audits(db).map((row) => row.action)).toEqual(["device.name_push_queued"]);

    // A second poll must not duplicate the command or its audit row.
    await run(backend.appleManagementCheckin(scope));
    expect(settingsCommands(db)).toHaveLength(1);
    expect(audits(db)).toHaveLength(1);
  });

  it("does nothing when the option is off or the name already matches", async () => {
    const { db, backend } = setup();

    await enroll(backend);

    Object.assign(storedDevice(db), {
      name: "Reception Mac",
      physicalName: "C02NAME01",
      namePushEnabled: false,
    });
    await run(backend.appleManagementCheckin(scope));
    expect(settingsCommands(db)).toHaveLength(0);

    Object.assign(storedDevice(db), {
      physicalName: "Reception Mac",
      namePushEnabled: true,
    });
    await run(backend.appleManagementCheckin(scope));
    expect(settingsCommands(db)).toHaveLength(0);
  });

  it("queues 63 characters and audits a skipped 64-character name", async () => {
    const { db, backend } = setup();

    await enroll(backend);

    Object.assign(storedDevice(db), {
      name: "x".repeat(64),
      physicalName: "C02NAME01",
      namePushEnabled: true,
    });
    await run(backend.appleManagementCheckin(scope));

    expect(settingsCommands(db)).toHaveLength(0);
    expect(audits(db).map((row) => row.action)).toEqual(["device.name_push_skipped"]);

    // The skip is throttled like a push; another poll must not spam the feed.
    await run(backend.appleManagementCheckin(scope));
    expect(audits(db)).toHaveLength(1);

    Object.assign(storedDevice(db), { name: "y".repeat(63) });
    await run(backend.appleManagementCheckin(scope));
    expect(settingsCommands(db)).toHaveLength(1);
    expect(settingsCommands(db)[0]!.payload).toEqual({
      Settings: [{ Item: "DeviceName", DeviceName: "y".repeat(63) }],
    });
  });

  it("retries when the previous command expired instead of suppressing for a day", async () => {
    const { db, backend } = setup();

    await enroll(backend);

    const expiredAt = new Date(Date.now() - 5 * 60 * 1000);
    Object.assign(storedDevice(db), {
      name: "Reception Mac",
      physicalName: "C02NAME01",
      namePushEnabled: true,
    });
    db.store[tableName(schema.deviceCommand)]!.push({
      id: "expired-settings",
      organizationId: "org-1",
      deviceId: storedDevice(db).id,
      requestType: "Settings",
      payload: { Settings: [{ Item: "DeviceName", DeviceName: "Reception Mac" }] },
      status: "queued",
      dedupeKey: "expired-dedupe",
      expiresAt: expiredAt,
      resultStatus: null,
      resultDetail: null,
      createdAt: new Date(expiredAt.getTime() - 30 * 60 * 1000),
      updatedAt: new Date(expiredAt.getTime() - 30 * 60 * 1000),
      __table: tableName(schema.deviceCommand),
    });

    await run(backend.appleManagementCheckin(scope));

    const settings = settingsCommands(db);
    expect(settings).toHaveLength(2);
    expect(settings.find((row) => row.id === "expired-settings")).toMatchObject({
      status: "expired",
      dedupeKey: null,
    });
    expect(settings.find((row) => row.id !== "expired-settings")).toMatchObject({
      status: "queued",
    });
  });

  it("pushes on a rename back when the acknowledgement is newer than the report", async () => {
    const { db, backend } = setup();

    await enroll(backend);

    const reportedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const appliedAt = new Date(Date.now() - 60 * 60 * 1000);

    Object.assign(storedDevice(db), {
      name: "Reception Mac",
      physicalName: "Reception Mac",
      physicalNameAt: reportedAt,
      appliedName: "Front Desk",
      appliedNameAt: appliedAt,
      namePushEnabled: true,
    });

    await run(backend.appleManagementCheckin(scope));

    expect(settingsCommands(db)).toHaveLength(1);
    expect(settingsCommands(db)[0]!.payload).toEqual({
      Settings: [{ Item: "DeviceName", DeviceName: "Reception Mac" }],
    });
  });

  it("does not let a duplicate acknowledgement overwrite a newer applied name", async () => {
    const { db, backend } = setup();

    await enroll(backend);

    Object.assign(storedDevice(db), {
      name: "Reception Mac",
      physicalName: "C02NAME01",
      namePushEnabled: true,
    });
    await run(backend.appleManagementCheckin(scope));

    const command = settingsCommands(db)[0]!;
    const ack = CommandResultEvent.make({
      commandUUID: String(command.id),
      status: "Acknowledged",
    });

    await run(backend.appleDeviceEvent(scope, ack));
    expect(deviceRow(db)).toMatchObject({ appliedName: "Reception Mac" });

    // Simulate a newer acknowledgement having already won the race.
    Object.assign(storedDevice(db), {
      appliedName: "Newer Name",
      appliedNameAt: new Date(Date.now() + 60_000),
    });

    await run(backend.appleDeviceEvent(scope, ack));

    expect(deviceRow(db)).toMatchObject({ appliedName: "Newer Name" });
  });

  it("records the applied name when the device acknowledges the command", async () => {
    const { db, backend } = setup();

    await enroll(backend);

    Object.assign(storedDevice(db), {
      name: "Reception Mac",
      physicalName: "C02NAME01",
      namePushEnabled: true,
    });

    await run(backend.appleManagementCheckin(scope));

    const command = settingsCommands(db)[0]!;

    await run(
      backend.appleDeviceEvent(
        scope,
        CommandResultEvent.make({
          commandUUID: String(command.id),
          status: "Acknowledged",
        }),
      ),
    );

    expect(deviceRow(db)).toMatchObject({ appliedName: "Reception Mac" });
    expect(deviceRow(db).appliedNameAt).toBeInstanceOf(Date);
    expect(settingsCommands(db)[0]!.resultDetail).toContain("Reception Mac");
  });
});
