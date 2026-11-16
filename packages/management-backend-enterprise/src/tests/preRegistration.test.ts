import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import { Effect } from "effect";
import { schema } from "@mattrax/enterprise-core";
import { MdmOrigin } from "@mattrax/management-backend";
import { ManagementBackendEnterpriseLive } from "../index.js";
import { dbRows, makeDb, tableName, type Row } from "./fake-db.js";

const origin = "https://enterprise.test";
const authSecret = "enterprise-test-secret";
const mdmOrigin = new MdmOrigin({ url: origin });

const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect);

const now = new Date("2026-11-11T10:00:00.000Z");

const preRegistration = (overrides: Row) => ({
  id: `pre-${Schema.is(Schema.String)(overrides.serial) ? overrides.serial : "unknown"}`,
  organizationId: "org-1",
  serial: "C02A",
  name: null,
  assetTag: null,
  notes: null,
  groupId: null,
  consumedDeviceId: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

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
      {
        id: "org-2",
        name: "Second",
        slug: "second",
        logo: null,
        metadata: null,
        stripeCustomerId: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    [tableName(schema.devicePreRegistration)]: [
      preRegistration({
        id: "pre-1",
        serial: "C02A",
        name: "Alice MacBook",
        assetTag: "AT-1001",
        notes: "Front desk",
        groupId: "group-1",
      }),
      preRegistration({
        id: "pre-2",
        organizationId: "org-2",
        serial: "C02A",
        name: "Wrong Tenant",
        assetTag: "OTHER",
        groupId: "group-2",
      }),
      preRegistration({
        id: "pre-3",
        serial: "C02B",
        name: "Bob MacBook",
        assetTag: "AT-2002",
        groupId: "group-1",
      }),
    ],
    [tableName(schema.enterpriseGroup)]: [
      {
        id: "group-1",
        organizationId: "org-1",
        name: "Staff",
        notes: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "group-2",
        organizationId: "org-2",
        name: "Other",
        notes: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
  });

  // SAFETY: The fake store implements only the query chains these tests exercise.
  const backend = ManagementBackendEnterpriseLive.make({ db: db as any, origin, authSecret });

  return { db, backend };
};

const scope = (udid: string) => ({
  _tag: "device" as const,
  udid,
  identityCertificate: "CN=Device,OU=org-1",
  identityCertificateFingerprintSha256: "fingerprint-1",
  mdmOrigin,
});

describe("Apple Authenticate pre-registration", () => {
  it("applies metadata and the tenant group to a new device", async () => {
    const { db, backend } = setup();
    await run(
      backend.appleDeviceEvent(scope("udid-1"), {
        _tag: "Authenticate" as const,
        serialNumber: "C02A",
        model: "MacBookPro18,3",
        osVersion: "15.1",
        enrollmentMode: "device" as const,
      }),
    );

    const [device] = dbRows(db, tableName(schema.device));
    expect(device).toMatchObject({
      organizationId: "org-1",
      serial: "C02A",
      name: "Alice MacBook",
      assetTag: "AT-1001",
      notes: "Front desk",
    });
    expect(dbRows(db, tableName(schema.groupDevice))).toEqual([
      { groupId: "group-1", deviceId: device!.id },
    ]);
    expect(
      dbRows(db, tableName(schema.devicePreRegistration)).find((row) => row.id === "pre-1"),
    ).toMatchObject({ consumedDeviceId: device!.id });
  });

  it("does not apply a pre-registration from another tenant", async () => {
    const { db, backend } = setup();
    // The event's certificate OU selects the tenant; the org-2 row shares the
    // serial but must never leak into org-1.
    await run(
      backend.appleDeviceEvent(scope("udid-1"), {
        _tag: "Authenticate" as const,
        serialNumber: "C02A",
        model: "MacBookPro18,3",
        enrollmentMode: "device" as const,
      }),
    );
    const [device] = dbRows(db, tableName(schema.device));
    expect(device).toMatchObject({ organizationId: "org-1", assetTag: "AT-1001" });
    expect(
      dbRows(db, tableName(schema.devicePreRegistration)).find((row) => row.id === "pre-2"),
    ).toMatchObject({ consumedDeviceId: null });
  });

  it("applies metadata to an already-enrolled row with the same serial", async () => {
    const { db, backend } = setup();
    db.store[tableName(schema.device)]!.push({
      __table: tableName(schema.device),
      id: "existing-device",
      organizationId: "org-1",
      proto: "apple",
      status: "enrolled",
      name: "Old Name",
      serial: "C02B",
      enrolledAt: now,
      lastSeenAt: now,
      dmIdentifier: "old-udid",
      dmIdentityFingerprint: "old-fingerprint",
      assetTag: "OLD-TAG",
    });

    await run(
      backend.appleDeviceEvent(scope("new-udid"), {
        _tag: "Authenticate" as const,
        serialNumber: "C02B",
        model: "MacBookPro18,3",
        enrollmentMode: "device" as const,
      }),
    );

    const devices = dbRows(db, tableName(schema.device));
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      id: "existing-device",
      serial: "C02B",
      name: "Bob MacBook",
      assetTag: "AT-2002",
      dmIdentifier: "new-udid",
    });
    expect(dbRows(db, tableName(schema.groupDevice))).toEqual([
      { groupId: "group-1", deviceId: "existing-device" },
    ]);
  });
});
