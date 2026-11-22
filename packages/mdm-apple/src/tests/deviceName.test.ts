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
    expect(
      dbRows(db, tableName(schema.auditLog)).some(
        (row) => row.action === "device.name_pushed",
      ),
    ).toBe(true);
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
