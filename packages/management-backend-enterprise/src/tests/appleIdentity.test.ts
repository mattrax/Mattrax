import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { parsePlanLimits, schema } from "@mattrax/enterprise-core";
import { MdmOrigin } from "@mattrax/management-backend";
import { ManagementBackendEnterpriseLive } from "../index.js";
import {   dbRows, makeDb, tableName, type Row, type Store } from "./fake-db.js";

const origin = "https://enterprise.test";
const authSecret = "enterprise-test-secret";
const mdmOrigin = new MdmOrigin({ url: origin });
const now = new Date("2026-11-11T10:00:00.000Z");

const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect);

const organization = (id: string, slug: string) => ({
  id,
  name: slug,
  slug,
  logo: null,
  metadata: null,
  stripeCustomerId: null,
  createdAt: now,
  updatedAt: now,
});

const issuedCertificate = (overrides: Row = {}) => ({
  serial: "a1b2c3",
  organizationId: "org-1",
  enrollmentId: "enrollment-1",
  deviceId: null,
  notAfter: new Date("2027-11-11T10:00:00.000Z"),
  revokedAt: null,
  createdAt: now,
  ...overrides,
});

const setup = (
  certificates: Array<ReturnType<typeof issuedCertificate>> = [],
  options: {
    planLimits?: ReturnType<typeof parsePlanLimits>;
    subscription?: Row;
    devices?: Array<Row>;
  } = {},
) => {
  const initial: Store = {
    [tableName(schema.organization)]: [
      organization("org-1", "first"),
      organization("org-2", "second"),
    ],
    [tableName(schema.scepIssuedCertificate)]: certificates,
  };

  if (options.subscription) initial[tableName(schema.subscription)] = [options.subscription];

  if (options.devices) initial[tableName(schema.device)] = options.devices;

  const db = makeDb(initial);

  // SAFETY: The fake store implements only the query chains these tests exercise.
  const backend = ManagementBackendEnterpriseLive.make({
    db: db as any,
    origin,
    authSecret,
    planLimits: options.planLimits,
  });

  return { db, backend };
};

const planLimits = (devices: number | null) =>
  parsePlanLimits(JSON.stringify({ free: { devices } }));

const subscription = {
  id: "sub-1",
  plan: "free",
  referenceId: "org-1",
  status: "active",
  createdAt: now,
  updatedAt: now,
};

const deviceRow = (id: string, udid: string) => ({
  id,
  organizationId: "org-1",
  proto: "apple",
  status: "enrolled",
  name: id,
  dmIdentifier: udid,
  enrolledAt: now,
  lastSeenAt: now,
});

const scope = (overrides: Row = {}) => ({
  _tag: "device" as const,
  udid: "udid-1",
  identityCertificate: "CN=Device,OU=org-1",
  identityCertificateFingerprintSha256: "fingerprint-1",
  // mTLS forwarders may format the serial with colons and uppercase hex.
  identityCertificateSerial: "A1:B2:C3",
  mdmOrigin,
  ...overrides,
});

const authenticate = (overrides: Row = {}) => ({
  _tag: "Authenticate" as const,
  serialNumber: "C02A",
  model: "MacBookPro18,3",
  ...overrides,
});

const certificateRows = (db: ReturnType<typeof makeDb>) =>
  dbRows(db, tableName(schema.scepIssuedCertificate));

describe("Apple per-device SCEP identity binding", () => {
  it("binds the issued certificate to the device on Authenticate", async () => {
    const { db, backend } = setup([issuedCertificate()]);
    await run(backend.appleDeviceEvent(scope(), authenticate()));

    const [device] = dbRows(db, tableName(schema.device));
    expect(device).toMatchObject({ organizationId: "org-1", dmIdentifier: "udid-1" });
    expect(certificateRows(db)[0]).toMatchObject({ deviceId: device!.id });
  });

  it("binds on TokenUpdate when Authenticate had no serial", async () => {
    const { db, backend } = setup([issuedCertificate()]);
    await run(
      backend.appleDeviceEvent(scope({ identityCertificateSerial: undefined }), authenticate()),
    );
    expect(certificateRows(db)[0]).toMatchObject({ deviceId: null });

    const [device] = dbRows(db, tableName(schema.device));
    await run(
      backend.appleDeviceEvent(scope(), {
        _tag: "TokenUpdate" as const,
        pushToken: "746f6b656e",
        pushMagic: "magic-1",
        topic: "com.apple.mgmt.External.test",
        channel: "device",
      }),
    );

    expect(certificateRows(db)[0]).toMatchObject({ deviceId: device!.id });
    expect(dbRows(db, tableName(schema.device)).find((row) => row.id === device!.id)).toMatchObject(
      { status: "enrolled" },
    );
  });

  it("revokes the bound Apple certificate on check-out", async () => {
    const { db, backend } = setup([issuedCertificate()]);
    await run(backend.appleDeviceEvent(scope(), authenticate()));

    const [device] = dbRows(db, tableName(schema.device));
    expect(certificateRows(db)[0]).toMatchObject({ deviceId: device!.id, revokedAt: null });

    await run(
      backend.appleDeviceEvent(scope(), {
        _tag: "CheckOut" as const,
      }),
    );

    expect(dbRows(db, tableName(schema.device)).find((row) => row.id === device!.id)).toMatchObject(
      { status: "unenrolled" },
    );
    expect(certificateRows(db)[0]!.revokedAt).toBeInstanceOf(Date);
  });

  it("does not bind a certificate issued to another tenant", async () => {
    const { db, backend } = setup([issuedCertificate({ organizationId: "org-2" })]);
    await run(backend.appleDeviceEvent(scope(), authenticate()));

    expect(dbRows(db, tableName(schema.device))).toHaveLength(1);
    expect(certificateRows(db)[0]).toMatchObject({
      organizationId: "org-2",
      deviceId: null,
    });
  });

  it("does not rebind a certificate already bound to another device", async () => {
    const { db, backend } = setup([issuedCertificate({ deviceId: "other-device" })]);
    await run(backend.appleDeviceEvent(scope(), authenticate()));

    expect(certificateRows(db)[0]).toMatchObject({
      deviceId: "other-device",
    });
  });

  it("works without an mTLS serial (self-hosted deployments)", async () => {
    const { db, backend } = setup([issuedCertificate()]);
    await run(
      backend.appleDeviceEvent(scope({ identityCertificateSerial: undefined }), authenticate()),
    );

    expect(dbRows(db, tableName(schema.device))).toHaveLength(1);
    expect(certificateRows(db)[0]).toMatchObject({ deviceId: null });
  });

  it("rejects a new device when the plan device limit is reached", async () => {
    const { db, backend } = setup([issuedCertificate()], {
      planLimits: planLimits(1),
      subscription,
      devices: [deviceRow("existing", "udid-existing")],
    });

    await expect(
      run(backend.appleDeviceEvent(scope({ udid: "udid-new" }), authenticate())),
    ).rejects.toMatchObject({ _tag: "UnknownDevice" as const });
    expect(dbRows(db, tableName(schema.device))).toHaveLength(1);
  });

  it("allows re-authentication of an existing device above the plan limit", async () => {
    const { db, backend } = setup([issuedCertificate()], {
      planLimits: planLimits(1),
      subscription,
      devices: [deviceRow("existing", "udid-1")],
    });

    await run(backend.appleDeviceEvent(scope(), authenticate()));
    expect(dbRows(db, tableName(schema.device))).toHaveLength(1);
    expect(dbRows(db, tableName(schema.device))[0]).toMatchObject({
      id: "existing",
      dmIdentifier: "udid-1",
    });
  });

  it("does not enforce limits when the catalogue is absent", async () => {
    const { db, backend } = setup([issuedCertificate()], {
      devices: [deviceRow("existing", "udid-existing")],
    });

    await run(backend.appleDeviceEvent(scope(), authenticate()));
    expect(dbRows(db, tableName(schema.device))).toHaveLength(2);
  });
});
