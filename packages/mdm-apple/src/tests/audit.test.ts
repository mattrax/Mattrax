import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { schema } from "@mattrax/enterprise-core";
import { MdmOrigin } from "@mattrax/management-backend";
import { ManagementBackendEnterpriseLive } from "@mattrax/mdm-apple";
import {
  commandFailureTransition,
  declarationFailedTransition,
  defaultAuditCategory,
  isDeclarationFailure,
  pushInvalidTokenTransition,
  writeSystemAudit,
} from "@mattrax/mdm-apple";
import { dbRows, makeDb, tableName, type Row } from "./fake-db.js";

const origin = "https://enterprise.test";

const authSecret = "enterprise-test-secret";

const mdmOrigin = new MdmOrigin({ url: origin });

const now = new Date("2026-11-11T10:00:00.000Z");

const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect);

const organization = (id: string, slug: string) => ({
  id,
  name: id,
  slug,
  logo: null,
  metadata: null,
  stripeCustomerId: null,
  createdAt: now,
  updatedAt: now,
});

const device = (id: string, organizationId: string, overrides: Row = {}) => ({
  id,
  organizationId,
  proto: "apple",
  status: "enrolled",
  name: id,
  serial: `SERIAL-${id}`,
  model: "MacBookPro18,3",
  dmIdentifier: `udid-${id}`,
  dmIdentityFingerprint: "fingerprint-1",
  enrolledAt: now,
  lastSeenAt: now,
  ...overrides,
});

const setup = () => {
  const db = makeDb({
    [tableName(schema.organization)]: [
      organization("org-1", "first"),
      organization("org-2", "second"),
    ],
    [tableName(schema.device)]: [device("device-1", "org-1"), device("device-2", "org-2")],
  });

  // SAFETY: The fake store implements only the query chains these tests exercise.
  const backend = ManagementBackendEnterpriseLive.make({ db: db as any, origin, authSecret });

  return { db, backend };
};

const scope = (udid: string, organizationId = "org-1", overrides: Row = {}) => ({
  _tag: "device" as const,
  udid,
  identityCertificate: `CN=Device,OU=${organizationId}`,
  identityCertificateFingerprintSha256: "fingerprint-1",
  identityCertificateSerial: "0a1b2c",
  clientIp: "203.0.113.9",
  userAgent: "MDM/1.0",
  mdmOrigin,
  ...overrides,
});

const auditRows = (db: ReturnType<typeof makeDb>) => dbRows(db, tableName(schema.auditLog));

const rowsFor = (db: ReturnType<typeof makeDb>, action: string) =>
  auditRows(db).filter((row) => row.action === action);

const declarationStatus = (valid: string) => ({
  _tag: "DeclarationStatus" as const,
  statusItems: {
    management: {
      declarations: {
        configurations: [{ Identifier: "decl-1", Valid: valid, Active: true }],
      },
    },
  },
});

const tokenUpdate = {
  _tag: "TokenUpdate" as const,
  pushToken: "push-token",
  pushMagic: "push-magic",
  topic: "com.apple.mgmt.External.acme",
  channel: "device" as const,
};

describe("system audit device lifecycle", () => {
  it("records enrollment once, on the enrolling -> enrolled transition", async () => {
    const { db, backend } = setup();
    await run(
      backend.appleDeviceEvent(scope("udid-device-1"), {
        _tag: "Authenticate" as const,
        serialNumber: "SERIAL-device-1",
        model: "MacBookPro18,3",
        enrollmentMode: "device" as const,
      }),
    );
    expect(auditRows(db)).toHaveLength(0);

    await run(backend.appleDeviceEvent(scope("udid-device-1"), tokenUpdate));

    expect(rowsFor(db, "device.enrolled")).toHaveLength(1);
    expect(rowsFor(db, "device.enrolled")[0]).toMatchObject({
      organizationId: "org-1",
      actorEmail: "system",
      action: "device.enrolled",
      targetType: "device",
      targetId: "device-1",
    });

    const checkIns = rowsFor(db, "mdm.checkin");
    expect(checkIns).toHaveLength(1);
    expect(checkIns[0]).toMatchObject({
      organizationId: "org-1",
      actorAccountId: null,
      actorType: "system",
      category: "mdm",
      protocol: "apple",
      targetType: "device",
      targetId: "device-1",
      deviceId: "device-1",
      ip: "203.0.113.9",
      userAgent: "MDM/1.0",
      deviceCertificateFingerprint: "fingerprint-1",
      deviceCertificateSerial: "0a1b2c",
    });

    // A later token update folds into the check-in row and must not repeat the
    // enrollment event.
    await run(backend.appleDeviceEvent(scope("udid-device-1"), tokenUpdate));
    expect(rowsFor(db, "device.enrolled")).toHaveLength(1);
    expect(rowsFor(db, "mdm.checkin")).toHaveLength(1);
    expect(rowsFor(db, "mdm.checkin")[0]!.metadata).toMatchObject({ checkIns: 2 });
  });

  it("never coalesces check-ins from two devices", async () => {
    const { db, backend } = setup();

    await run(backend.appleDeviceEvent(scope("udid-device-1"), tokenUpdate));
    await run(backend.appleDeviceEvent(scope("udid-device-2", "org-2"), tokenUpdate));

    expect(rowsFor(db, "mdm.checkin")).toHaveLength(2);
    expect(
      rowsFor(db, "mdm.checkin")
        .map((row) => String(row.organizationId))
        .sort((left, right) => left.localeCompare(right)),
    ).toEqual([
      "org-1",
      "org-2",
    ]);
  });

  it("records a device check-out once and keeps it tenant scoped", async () => {
    const { db, backend } = setup();
    await run(
      backend.appleDeviceEvent(scope("udid-device-2", "org-2"), { _tag: "CheckOut" as const }),
    );
    await run(
      backend.appleDeviceEvent(scope("udid-device-2", "org-2"), { _tag: "CheckOut" as const }),
    );

    const rows = rowsFor(db, "device.checked_out");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId: "org-2",
      action: "device.checked_out",
      targetId: "device-2",
      actorEmail: "system",
      deviceId: "device-2",
      protocol: "apple",
    });
  });

  it("records a failed command only on the status transition", async () => {
    const { db, backend } = setup();
    const commandTable = tableName(schema.deviceCommand);
    (db.store[commandTable] ??= []).push({
      __table: commandTable,
      id: "command-1",
      organizationId: "org-1",
      deviceId: "device-1",
      requestType: "DeviceInformation",
      payload: {},
      status: "sent",
      createdAt: now,
      updatedAt: now,
    });

    const failure = {
      _tag: "CommandResult" as const,
      commandUUID: "command-1",
      status: "Error",
      errorDetail: "secret-looking device detail",
    };

    await run(backend.appleDeviceEvent(scope("udid-device-1"), failure));
    await run(backend.appleDeviceEvent(scope("udid-device-1"), failure));

    const rows = rowsFor(db, "device.command_failed");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "device.command_failed",
      targetType: "device_command",
      targetId: "command-1",
      deviceId: "device-1",
      ip: "203.0.113.9",
    });
    expect(JSON.stringify(rows[0]!.metadata)).not.toContain("secret-looking");
  });

  it("records a successful command result once", async () => {
    const { db, backend } = setup();
    const commandTable = tableName(schema.deviceCommand);
    (db.store[commandTable] ??= []).push({
      __table: commandTable,
      id: "command-2",
      organizationId: "org-1",
      deviceId: "device-1",
      requestType: "DeviceInformation",
      payload: {},
      status: "sent",
      createdAt: now,
      updatedAt: now,
    });

    const success = {
      _tag: "CommandResult" as const,
      commandUUID: "command-2",
      status: "Acknowledged",
    };

    await run(backend.appleDeviceEvent(scope("udid-device-1"), success));
    await run(backend.appleDeviceEvent(scope("udid-device-1"), success));

    const rows = rowsFor(db, "mdm.command_result");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "mdm.command_result",
      targetType: "device_command",
      targetId: "command-2",
      protocol: "apple",
    });
  });

  it("records declaration failures only when the state changes", async () => {
    const { db, backend } = setup();

    // Compliance transitions also produce audit rows, so assertions here stay
    // scoped to declaration failures.
    const declarationRows = () => rowsFor(db, "device.declaration_invalid");

    await run(backend.appleDeviceEvent(scope("udid-device-1"), declarationStatus("invalid")));
    await run(backend.appleDeviceEvent(scope("udid-device-1"), declarationStatus("invalid")));
    expect(declarationRows()).toHaveLength(1);
    expect(declarationRows()[0]).toMatchObject({
      action: "device.declaration_invalid",
      targetId: "device-1",
      metadata: { identifier: "decl-1", valid: "invalid", previousValid: null },
    });

    await run(backend.appleDeviceEvent(scope("udid-device-1"), declarationStatus("valid")));
    expect(declarationRows()).toHaveLength(1);

    await run(backend.appleDeviceEvent(scope("udid-device-1"), declarationStatus("invalid")));
    expect(declarationRows()).toHaveLength(2);
    expect(declarationRows()[1]!.metadata).toMatchObject({
      previousValid: "valid",
      valid: "invalid",
    });
  });

  it("records a status report only when the report changed something", async () => {
    const { db, backend } = setup();

    await run(backend.appleDeviceEvent(scope("udid-device-1"), declarationStatus("invalid")));
    const first = rowsFor(db, "mdm.status_report");
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      action: "mdm.status_report",
      deviceId: "device-1",
      protocol: "apple",
      metadata: { declarationsChanged: true },
    });

    // The same report again changes nothing: the check-in proves liveness, but
    // there is no second "status changed" event.
    await run(backend.appleDeviceEvent(scope("udid-device-1"), declarationStatus("invalid")));
    expect(rowsFor(db, "mdm.status_report")).toHaveLength(1);
  });

  it("records a rejected check-in as a bounded failure", async () => {
    const { db, backend } = setup();

    await run(
      backend.appleRecordFailure!({
        code: "invalid_ddm_status",
        phase: "declaration_status",
        message: "SyntaxError: Invalid DDM status report at position 42 (secret payload ignored)",
        udid: "udid-device-1",
        identityCertificate: "CN=Device,OU=org-1",
        identityCertificateFingerprintSha256: "fingerprint-1",
        identityCertificateSerial: "0a1b2c",
        clientIp: "203.0.113.9",
        userAgent: "MDM/1.0",
      }),
    );

    const rows = rowsFor(db, "mdm.failure");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId: "org-1",
      actorAccountId: null,
      actorType: "system",
      category: "mdm",
      action: "mdm.failure",
      targetType: "device",
      targetId: "device-1",
      deviceId: "device-1",
      protocol: "apple",
      ip: "203.0.113.9",
      userAgent: "MDM/1.0",
      deviceCertificateFingerprint: "fingerprint-1",
      deviceCertificateSerial: "0a1b2c",
      metadata: {
        phase: "declaration_status",
        code: "invalid_ddm_status",
        reason: "SyntaxError: Invalid DDM status report at position 42 (secret payload ignored)",
      },
    });
  });

  it("drops an unattributable failure instead of guessing a tenant", async () => {
    const { db, backend } = setup();

    await run(
      backend.appleRecordFailure!({
        code: "invalid_signature",
        message: "Mdm-Signature verification failed",
        clientIp: "203.0.113.9",
      }),
    );

    expect(rowsFor(db, "mdm.failure")).toHaveLength(0);
  });
});

describe("system audit actor invariant", () => {
  it("never attributes an MDM action to an account", async () => {
    const { db, backend } = setup();

    await run(backend.appleDeviceEvent(scope("udid-device-1"), tokenUpdate));
    await run(backend.appleDeviceEvent(scope("udid-device-1"), { _tag: "CheckOut" as const }));

    const mdmRows = auditRows(db).filter((row) => row.category === "mdm");

    expect(mdmRows.length).toBeGreaterThan(0);

    for (const row of mdmRows) {
      expect(row.actorAccountId).toBeNull();
      expect(row.actorType).toBe("system");
      expect(row.actorEmail).toBe("system");
      // Every stored reason is bounded; no payload body is retained.
      expect(JSON.stringify(row.metadata ?? {})).not.toContain("BEGIN CERTIFICATE");
    }
  });
});

describe("system audit transition helpers", () => {
  it("flags only the first invalid-token push state", () => {
    expect(pushInvalidTokenTransition(null, "invalid_token")).toBe(true);
    expect(pushInvalidTokenTransition("delivery_failed", "invalid_token")).toBe(true);
    expect(pushInvalidTokenTransition("invalid_token", "invalid_token")).toBe(false);
    expect(pushInvalidTokenTransition("invalid_token", "delivery_failed")).toBe(false);
    expect(pushInvalidTokenTransition(null, "delivery_failed")).toBe(false);
  });

  it("flags declarations only when they enter a failure state", () => {
    expect(isDeclarationFailure("invalid")).toBe(true);
    expect(isDeclarationFailure("failed")).toBe(true);
    expect(isDeclarationFailure("valid")).toBe(false);
    expect(isDeclarationFailure("unknown")).toBe(false);
    expect(declarationFailedTransition(undefined, "invalid")).toBe(true);
    expect(declarationFailedTransition("valid", "invalid")).toBe(true);
    expect(declarationFailedTransition("invalid", "invalid")).toBe(false);
    expect(declarationFailedTransition("invalid", "valid")).toBe(false);
  });

  it("dedupes command terminal states", () => {
    expect(commandFailureTransition("sent", "failed")).toBe(true);
    expect(commandFailureTransition("sent", "deferred")).toBe(true);
    expect(commandFailureTransition("failed", "failed")).toBe(false);
    expect(commandFailureTransition("sent", "succeeded")).toBe(false);
  });
});


describe("fixed-window check-in coalescing", () => {
  const windowMs = 15 * 60 * 1_000;

  const checkin = (
    db: ReturnType<typeof makeDb>,
    at: Date,
    targetId = "device-1",
    overrides: Row = {},
  ) =>
    run(
      writeSystemAudit(
        // SAFETY: the fake store implements the select/update/insert chains.
        db as any,
        {
          organizationId: "org-1",
          action: "mdm.checkin",
          targetType: "device",
          targetId,
          deviceId: targetId,
          protocol: "apple",
          metadata: { platform: "apple", channels: ["device"] },
          coalesce: true,
          ...overrides,
        },
        { coalesceWindowMs: windowMs, now: at },
      ),
    );

  it("rolls over to a new row when the fixed bucket ends", async () => {
    const db = makeDb();
    const base = new Date("2026-11-11T10:00:00.000Z");

    await checkin(db, base);
    await checkin(db, new Date(base.getTime() + 10 * 60_000));
    await checkin(db, new Date(base.getTime() + 20 * 60_000));

    const rows = auditRows(db);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.createdAt).toEqual(base);
    expect(rows[1]!.createdAt).toEqual(new Date(base.getTime() + 15 * 60_000));
    expect(rows[0]!.metadata).toMatchObject({ checkIns: 2 });
    expect(rows[1]!.metadata).toMatchObject({ checkIns: 1 });

    // A repeat in the second bucket updates that row; the first bucket's
    // timestamp never moves.
    await checkin(db, new Date(base.getTime() + 21 * 60_000));
    expect(auditRows(db)).toHaveLength(2);
    expect(auditRows(db)[0]!.createdAt).toEqual(base);
    expect(auditRows(db)[1]!.metadata).toMatchObject({ checkIns: 2 });
  });

  it("keeps two devices in separate rows", async () => {
    const db = makeDb();
    const at = new Date("2026-11-11T10:00:00.000Z");

    await checkin(db, at, "device-1");
    await checkin(db, at, "device-2");

    expect(auditRows(db)).toHaveLength(2);
  });

  it("starts a new row when the presenting identity changes", async () => {
    const db = makeDb();
    const at = new Date("2026-11-11T10:00:00.000Z");

    await checkin(db, at, "device-1", {
      certificateFingerprint: "fingerprint-1",
      certificateSerial: "0a1b",
      ip: "203.0.113.9",
    });
    await checkin(db, at, "device-1", {
      certificateFingerprint: "fingerprint-2",
      certificateSerial: "0a1b",
      ip: "203.0.113.9",
    });
    await checkin(db, at, "device-1", {
      certificateFingerprint: "fingerprint-2",
      certificateSerial: "0a1b",
      ip: "198.51.100.4",
    });

    expect(auditRows(db)).toHaveLength(3);
  });
});

describe("Apple user-channel coalescing", () => {
  const userTokenUpdate = (userId: string) => ({
    _tag: "TokenUpdate" as const,
    pushToken: `push-${userId}`,
    pushMagic: `magic-${userId}`,
    topic: "com.apple.mgmt.External.acme",
    channel: "user" as const,
    userId,
  });

  const userScope = (userId: string, overrides: Row = {}) => ({
    _tag: "user" as const,
    udid: "udid-device-1",
    userId,
    source: "user-channel" as const,
    identityCertificate: "CN=Device,OU=org-1",
    identityCertificateFingerprintSha256: "fingerprint-1",
    identityCertificateSerial: "0a1b2c",
    clientIp: "203.0.113.9",
    mdmOrigin,
    ...overrides,
  });

  it("never folds two users on one Shared iPad into one row", async () => {
    const { db, backend } = setup();
    db.store[tableName(schema.device)]![0]!.osEdition = "iOS";

    await run(backend.appleDeviceEvent(userScope("user-a"), userTokenUpdate("user-a")));
    await run(backend.appleDeviceEvent(userScope("user-b"), userTokenUpdate("user-b")));

    const rows = rowsFor(db, "mdm.checkin");
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.principalId).sort()).toEqual(["user-a", "user-b"]);
  });

  it("starts a new row when the certificate rotates", async () => {
    const { db, backend } = setup();
    db.store[tableName(schema.device)]![0]!.osEdition = "iOS";

    await run(backend.appleDeviceEvent(userScope("user-a"), userTokenUpdate("user-a")));

    // Simulate a renewed identity: the device row now trusts the new
    // certificate, so the check-in is accepted and must start a new row.
    db.store[tableName(schema.device)]![0]!.dmIdentityFingerprint = "fingerprint-2";

    await run(
      backend.appleDeviceEvent(
        userScope("user-a", {
          identityCertificateFingerprintSha256: "fingerprint-2",
          identityCertificateSerial: "ffff",
        }),
        userTokenUpdate("user-a"),
      ),
    );

    const rows = rowsFor(db, "mdm.checkin");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      deviceCertificateFingerprint: "fingerprint-2",
      deviceCertificateSerial: "ffff",
      metadata: { checkIns: 1 },
    });
  });
});

describe("Apple status-report diffs", () => {
  it("records one status report for identical inventory reports", async () => {
    const { db, backend } = setup();
    db.store[tableName(schema.device)]![0]!.serial = "OLD-SERIAL";

    const report = {
      _tag: "DeclarationStatus" as const,
      statusItems: { "device.identifier.serial-number": "SERIAL-device-1" },
    };

    await run(backend.appleDeviceEvent(scope("udid-device-1"), report));
    await run(backend.appleDeviceEvent(scope("udid-device-1"), report));

    expect(rowsFor(db, "mdm.status_report")).toHaveLength(1);
    expect(rowsFor(db, "mdm.status_report")[0]!.metadata).toMatchObject({
      inventoryChanged: true,
    });
  });

  it("records one delivery for declaration items, not one per sync", async () => {
    const db = makeDb({
      [tableName(schema.organization)]: [organization("org-1", "first")],
      [tableName(schema.device)]: [device("device-1", "org-1")],
    });

    // SAFETY: the fake store implements only the query chains this test uses.
    const backend = ManagementBackendEnterpriseLive.make({ db: db as any, origin, authSecret });

    const manifest = await run(backend.appleManagementCheckin(scope("udid-device-1")));
    expect(manifest._tag).toBe("DdmSync");
    // Asking the device to sync is not a delivery on its own.
    expect(rowsFor(db, "mdm.policy_delivered")).toHaveLength(0);

    await run(backend.getAppleDeclarationItems(scope("udid-device-1")));
    await run(backend.getAppleDeclarationItems(scope("udid-device-1")));

    const rows = rowsFor(db, "mdm.policy_delivered");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "mdm.policy_delivered",
      protocol: "apple",
      metadata: { mode: "declarations", channel: "device" },
    });
  });
});

describe("failure attribution", () => {
  it("binds the failure to the certificate owner, not the asserted UDID", async () => {
    const { db, backend } = setup();

    // A second device in the same tenant owns the certificate the request
    // presents.
    db.store[tableName(schema.device)]!.push({
      __table: tableName(schema.device),
      ...device("device-3", "org-1"),
    });

    (db.store[tableName(schema.scepIssuedCertificate)] ??= []).push({
      __table: tableName(schema.scepIssuedCertificate),
      serial: "a1b2c",
      organizationId: "org-1",
      deviceId: "device-3",
      notAfter: new Date("2027-01-01T00:00:00Z"),
      createdAt: now,
      revokedAt: null,
    });

    await run(
      backend.appleRecordFailure!({
        code: "invalid_plist",
        message: "Invalid plist",
        // The device asserts another device's UDID.
        udid: "udid-device-1",
        identityCertificate: "CN=Device,OU=org-1",
        identityCertificateSerial: "0A:1B:2C",
        clientIp: "203.0.113.9",
      }),
    );

    const rows = rowsFor(db, "mdm.failure");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      targetId: "device-3",
      deviceId: "device-3",
      metadata: { attribution: "bound" },
    });
    expect(JSON.stringify(rows[0]!.metadata)).toContain('"attribution":"bound"');
  });

  it("falls back to the asserted device id when no identity is bound", async () => {
    const { db, backend } = setup();

    await run(
      backend.appleRecordFailure!({
        code: "invalid_plist",
        message: "Invalid plist",
        udid: "udid-device-1",
        identityCertificate: "CN=Device,OU=org-1",
        clientIp: "203.0.113.9",
      }),
    );

    expect(rowsFor(db, "mdm.failure")[0]).toMatchObject({
      deviceId: "device-1",
      metadata: { attribution: "asserted" },
    });
  });
});

describe("system audit category classifier", () => {
  it("classifies device protocol traffic, enrollment and background work", () => {
    expect(defaultAuditCategory("device.enrolled")).toBe("mdm");
    expect(defaultAuditCategory("mdm.checkin")).toBe("mdm");
    expect(defaultAuditCategory("enrollment.answers_submitted")).toBe("mdm");
    expect(defaultAuditCategory("android.signup_started")).toBe("system");
    expect(defaultAuditCategory("android.enterprise_connected")).toBe("system");
    expect(defaultAuditCategory("script.run_completed")).toBe("system");
    expect(defaultAuditCategory("scep_ca.auto_rotated")).toBe("system");
  });
});
