import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { schema } from "@mattrax/enterprise-core";
import { MdmOrigin } from "@mattrax/management-backend";
import { ManagementBackendEnterpriseLive } from "@mattrax/mdm-apple";
import { dbRows, makeDb, tableName, type Row } from "./fake-db.js";

const origin = "https://enterprise.test";

const authSecret = "enterprise-test-secret";

const mdmOrigin = new MdmOrigin({ url: origin });

const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect);

const now = new Date("2026-11-11T10:00:00.000Z");

const organization = (id: string): Row => ({
  id,
  name: id,
  slug: id,
  logo: null,
  metadata: null,
  stripeCustomerId: null,
  createdAt: now,
  updatedAt: now,
});

const device = (overrides: Row): Row => ({
  id: "device-1",
  organizationId: "org-1",
  proto: "apple",
  status: "enrolled",
  name: "Existing Mac",
  model: "MacBookPro18,3",
  serial: "C02A",
  enrolledAt: now,
  lastSeenAt: now,
  dmIdentifier: "old-udid",
  dmIdentityFingerprint: "old-fingerprint",
  ...overrides,
});

const setup = (initial: Record<string, Row[]> = {}) => {
  const db = makeDb({
    [tableName(schema.organization)]: [organization("org-1"), organization("org-2")],
    ...initial,
  });

  // SAFETY: The fake store implements only the query chains these tests exercise.
  const backend = ManagementBackendEnterpriseLive.make({ db: db as any, origin, authSecret });

  return { db, backend };
};

const scope = (udid: string, organizationId = "org-1") => ({
  _tag: "device" as const,
  udid,
  identityCertificate: `CN=Device,OU=${organizationId}`,
  identityCertificateFingerprintSha256: `fingerprint-${udid}`,
  mdmOrigin,
});

describe("Apple device re-enrollment", () => {
  it("reclaims a same-serial row without a pre-registration", async () => {
    const { db, backend } = setup({
      [tableName(schema.device)]: [
        device({
          id: "existing-device",
          serial: "C02A",
          dmIdentifier: "old-udid",
        }),
      ],
    });

    await run(
      backend.appleDeviceEvent(scope("new-udid"), {
        _tag: "Authenticate" as const,
        serialNumber: "C02A",
        model: "MacBookPro18,3",
        enrollmentMode: "device" as const,
      }),
    );

    const devices = dbRows(db, tableName(schema.device));
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      id: "existing-device",
      organizationId: "org-1",
      serial: "C02A",
      dmIdentifier: "new-udid",
    });
  });

  it("removes the previous tenant's device and its relations", async () => {
    const { db, backend } = setup({
      [tableName(schema.device)]: [
        device({
          id: "old-tenant-device",
          organizationId: "org-2",
          serial: "C02A",
          dmIdentifier: "old-udid",
        }),
      ],
      [tableName(schema.deviceApple)]: [
        { deviceId: "old-tenant-device", enrollmentMode: "device", deviceToken: "token" },
      ],
      [tableName(schema.deviceAppleUser)]: [{ deviceId: "old-tenant-device", userId: "user-1" }],
      [tableName(schema.deviceCommand)]: [
        {
          id: "command-1",
          organizationId: "org-2",
          deviceId: "old-tenant-device",
          requestType: "DeviceInformation",
          payload: {},
          status: "queued",
          createdAt: now,
          updatedAt: now,
        },
      ],
      [tableName(schema.groupDevice)]: [{ groupId: "group-1", deviceId: "old-tenant-device" }],
      [tableName(schema.deviceSecret)]: [
        {
          deviceId: "old-tenant-device",
          organizationId: "org-2",
          kind: "bootstrap_token",
          sealedValue: "sealed",
          updatedAt: now,
        },
      ],
      [tableName(schema.scepIssuedCertificate)]: [
        {
          serial: "A1B2C3",
          organizationId: "org-2",
          deviceId: "old-tenant-device",
          notAfter: new Date("2027-01-01T00:00:00Z"),
          createdAt: now,
          revokedAt: null,
        },
      ],
    });

    await run(
      backend.appleDeviceEvent(scope("new-udid"), {
        _tag: "Authenticate" as const,
        serialNumber: "C02A",
        model: "MacBookPro18,3",
        enrollmentMode: "device" as const,
      }),
    );

    const devices = dbRows(db, tableName(schema.device));
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({ organizationId: "org-1", serial: "C02A" });

    for (const table of [
      schema.deviceApple,
      schema.deviceAppleUser,
      schema.deviceCommand,
      schema.groupDevice,
      schema.deviceSecret,
    ])
      expect(
        dbRows(db, tableName(table)).filter((row) => row.deviceId === "old-tenant-device"),
      ).toEqual([]);

    expect(dbRows(db, tableName(schema.scepIssuedCertificate))[0]).toMatchObject({
      organizationId: "org-2",
      deviceId: "old-tenant-device",
      revokedAt: expect.any(Date),
    });
  });
});
