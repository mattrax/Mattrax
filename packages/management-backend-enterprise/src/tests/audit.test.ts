import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { schema } from "@mattrax/enterprise-core";
import { MdmOrigin } from "@mattrax/management-backend";
import { ManagementBackendEnterpriseLive } from "../index.js";
import {
  commandFailureTransition,
  declarationFailedTransition,
  isDeclarationFailure,
  pushInvalidTokenTransition,
} from "../index.js";
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

const scope = (udid: string, organizationId = "org-1") => ({
  _tag: "device" as const,
  udid,
  identityCertificate: `CN=Device,OU=${organizationId}`,
  identityCertificateFingerprintSha256: "fingerprint-1",
  mdmOrigin,
});

const auditRows = (db: ReturnType<typeof makeDb>) => dbRows(db, tableName(schema.auditLog));

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

    const tokenUpdate = {
      _tag: "TokenUpdate" as const,
      pushToken: "push-token",
      pushMagic: "push-magic",
      topic: "com.apple.mgmt.External.acme",
      channel: "device" as const,
    };

    await run(backend.appleDeviceEvent(scope("udid-device-1"), tokenUpdate));
    expect(auditRows(db)).toHaveLength(1);
    expect(auditRows(db)[0]).toMatchObject({
      organizationId: "org-1",
      actorEmail: "system",
      action: "device.enrolled",
      targetType: "device",
      targetId: "device-1",
    });

    // A later token update must not repeat the enrollment event.
    await run(backend.appleDeviceEvent(scope("udid-device-1"), tokenUpdate));
    expect(auditRows(db)).toHaveLength(1);
  });

  it("records a device check-out once and keeps it tenant scoped", async () => {
    const { db, backend } = setup();
    await run(
      backend.appleDeviceEvent(scope("udid-device-2", "org-2"), { _tag: "CheckOut" as const }),
    );
    await run(
      backend.appleDeviceEvent(scope("udid-device-2", "org-2"), { _tag: "CheckOut" as const }),
    );

    expect(auditRows(db)).toHaveLength(1);
    expect(auditRows(db)[0]).toMatchObject({
      organizationId: "org-2",
      action: "device.checked_out",
      targetId: "device-2",
      actorEmail: "system",
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

    expect(auditRows(db)).toHaveLength(1);
    expect(auditRows(db)[0]).toMatchObject({
      action: "device.command_failed",
      targetType: "device_command",
      targetId: "command-1",
    });
    expect(JSON.stringify(auditRows(db)[0]!.metadata)).not.toContain("secret-looking");
  });

  it("records declaration failures only when the state changes", async () => {
    const { db, backend } = setup();

    // Compliance transitions also produce audit rows, so assertions here stay
    // scoped to declaration failures.
    const declarationRows = () =>
      auditRows(db).filter((row) => row.action === "device.declaration_invalid");

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
