import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { schema } from "@mattrax/enterprise-core";
import { MdmOrigin } from "@mattrax/management-backend";
import { ManagementBackendEnterpriseLive } from "@mattrax/mdm-apple";
import {
  commandFailureTransition,
  declarationFailedTransition,
  isDeclarationFailure,
  pushInvalidTokenTransition,
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
