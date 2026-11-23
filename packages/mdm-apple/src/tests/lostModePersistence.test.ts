import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { schema } from "@mattrax/enterprise-core";
import { AppleDeviceEvent, MdmOrigin } from "@mattrax/management-backend";
import { ManagementBackendEnterpriseLive } from "@mattrax/mdm-apple";
import { dbRows, makeDb, tableName } from "./fake-db.js";
import type { Row } from "./fake-db.js";

const origin = "https://enterprise.test";
const authSecret = "enterprise-test-secret";
const mdmOrigin = new MdmOrigin({ url: origin });
const now = new Date("2026-11-23T10:00:00.000Z");
const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect);

const CommandResultEvent = AppleDeviceEvent.members[5];

const scope = {
  _tag: "device" as const,
  udid: "udid-local-1",
  identityCertificate: "CN=Device,OU=org-1",
  identityCertificateFingerprintSha256: "fingerprint-local-1",
  mdmOrigin,
};

const setup = (apple: Row = {}, commands: Array<Row> = [], secrets: Array<Row> = []) => {
  const db = makeDb({
    [tableName(schema.organization)]: [
      {
        id: "org-1",
        name: "First",
        slug: "first",
        logo: null,
        metadata: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    [tableName(schema.device)]: [
      {
        id: "device-1",
        organizationId: "org-1",
        proto: "apple",
        status: "enrolled",
        name: "Mac",
        dmIdentifier: "udid-local-1",
        osEdition: "macOS 15.1",
        enrolledAt: now,
        lastSeenAt: now,
      },
    ],
    [tableName(schema.deviceApple)]: [
      {
        deviceId: "device-1",
        lostModeEnabled: false,
        lostModeCommandId: null,
        localAdminGuid: null,
        ...apple,
      },
    ],
    [tableName(schema.deviceCommand)]: commands.map((command) => ({
      id: "command-1",
      organizationId: "org-1",
      deviceId: "device-1",
      requestType: "UserList",
      payload: {},
      status: "sent",
      dedupeKey: null,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      resultStatus: null,
      resultDetail: null,
      createdAt: now,
      updatedAt: now,
      ...command,
    })),
    [tableName(schema.deviceSecret)]: secrets,
  });

  // SAFETY: the fake store implements only the query chains this test exercises.
  const backend = ManagementBackendEnterpriseLive.make({ db: db as any, origin, authSecret });

  return { db, backend };
};

const rows = (db: ReturnType<typeof setup>["db"], table: any) => dbRows(db, tableName(table));

const acknowledge = (
  backend: ReturnType<typeof setup>["backend"],
  commandUUID: string,
  queryResponses: Row,
) =>
  run(
    backend.appleDeviceEvent(
      scope,
      CommandResultEvent.make({
        commandUUID,
        status: "Acknowledged",
        queryResponses,
      }),
    ),
  );

describe("Apple check-in persistence", () => {
  it("stores the local accounts and the managed GUID from UserList", async () => {
    const { db, backend } = setup({}, [{ id: "cmd-users", requestType: "UserList" }]);

    await acknowledge(backend, "cmd-users", {
      Users: [
        {
          UserName: "mattrax-admin",
          FullName: "Mattrax Administrator",
          UID: 501,
          UserGUID: "11111111-AAAA-BBBB-CCCC-222222222222",
          HasSecureToken: true,
          IsLoggedIn: true,
        },
        { UserName: "shared", FullName: "Shared", UID: 502, HasSecureToken: false },
      ],
    });

    expect(rows(db, schema.deviceLocalAccount)).toHaveLength(2);
    expect(rows(db, schema.deviceLocalAccount)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          username: "mattrax-admin",
          isAdmin: true,
          isManaged: true,
          hasSecureToken: true,
          guid: "11111111-AAAA-BBBB-CCCC-222222222222",
        }),
        expect.objectContaining({
          username: "shared",
          isAdmin: null,
          isManaged: false,
          hasSecureToken: false,
        }),
      ]),
    );
    expect(rows(db, schema.deviceApple)[0]).toMatchObject({
      localAdminGuid: "11111111-AAAA-BBBB-CCCC-222222222222",
    });
    expect(rows(db, schema.deviceApple)[0]!.localAccountsUpdatedAt).toBeInstanceOf(Date);
  });

  it("stores the DeviceLocation fix only while Lost Mode is active", async () => {
    const { db, backend } = setup({ lostModeEnabled: true }, [
      { id: "cmd-location", requestType: "DeviceLocation" },
    ]);

    await acknowledge(backend, "cmd-location", {
      Latitude: -33.8688,
      Longitude: 151.2093,
      HorizontalAccuracy: 12,
      VerticalAccuracy: 8,
      Timestamp: "2026-11-23T09:55:00Z",
    });

    expect(rows(db, schema.deviceApple)[0]).toMatchObject({
      lostModeLatitude: "-33.8688",
      lostModeLongitude: "151.2093",
      lostModeHorizontalAccuracy: "12",
      lostModeVerticalAccuracy: "8",
    });
    expect(rows(db, schema.deviceApple)[0]!.lostModeLocationReportedAt).toBeInstanceOf(Date);
  });

  it("does not clear a live Lost Mode state when an update fails", async () => {
    const ackedAt = new Date("2026-11-23T08:00:00.000Z");
    const { db, backend } = setup(
      {
        lostModeEnabled: true,
        lostModeAcknowledgedAt: ackedAt,
        lostModeCommandId: "cmd-enable",
      },
      [{ id: "cmd-enable", requestType: "EnableLostMode" }],
    );

    await run(
      backend.appleDeviceEvent(
        scope,
        CommandResultEvent.make({
          commandUUID: "cmd-enable",
          status: "Error",
          errorDetail: "Rejected",
        }),
      ),
    );

    expect(rows(db, schema.deviceApple)[0]).toMatchObject({
      lostModeEnabled: true,
      lostModeAcknowledgedAt: ackedAt,
    });
  });

  it("ignores a delayed Lost Mode acknowledgement from an older command", async () => {
    const { db, backend } = setup({ lostModeEnabled: false, lostModeCommandId: "cmd-newer" }, [
      { id: "cmd-older", requestType: "EnableLostMode" },
    ]);

    await acknowledge(backend, "cmd-older", {});

    expect(rows(db, schema.deviceApple)[0]).toMatchObject({ lostModeEnabled: false });
  });

  it("promotes the pending rotation only when the acknowledged command matches", async () => {
    const { db, backend } = setup(
      {},
      [{ id: "cmd-rotation", requestType: "SetAutoAdminPassword" }],
      [
        {
          deviceId: "device-1",
          organizationId: "org-1",
          kind: "local_admin_password",
          sealedValue: "old",
          format: "plaintext",
          createdAt: now,
          updatedAt: now,
          rotatedAt: now,
        },
        {
          deviceId: "device-1",
          organizationId: "org-1",
          kind: "local_admin_password_pending",
          sealedValue: "new",
          format: "plaintext",
          pendingCommandId: "cmd-rotation",
          createdAt: now,
          updatedAt: now,
          rotatedAt: now,
        },
      ],
    );

    await acknowledge(backend, "cmd-rotation", {});

    expect(rows(db, schema.deviceSecret)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "local_admin_password", sealedValue: "new" }),
      ]),
    );
    expect(
      rows(db, schema.deviceSecret).some((row: any) => row.kind === "local_admin_password_pending"),
    ).toBe(false);
  });

  it("does not promote a pending secret bound to another command", async () => {
    const { db, backend } = setup(
      {},
      [{ id: "cmd-rotation", requestType: "SetAutoAdminPassword" }],
      [
        {
          deviceId: "device-1",
          organizationId: "org-1",
          kind: "local_admin_password",
          sealedValue: "old",
          format: "plaintext",
          createdAt: now,
          updatedAt: now,
          rotatedAt: now,
        },
        {
          deviceId: "device-1",
          organizationId: "org-1",
          kind: "local_admin_password_pending",
          sealedValue: "new",
          format: "plaintext",
          pendingCommandId: "cmd-other",
          createdAt: now,
          updatedAt: now,
          rotatedAt: now,
        },
      ],
    );

    await acknowledge(backend, "cmd-rotation", {});

    expect(rows(db, schema.deviceSecret)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "local_admin_password", sealedValue: "old" }),
        expect.objectContaining({ kind: "local_admin_password_pending", sealedValue: "new" }),
      ]),
    );
  });
});
