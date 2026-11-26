import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { schema } from "@mattrax/enterprise-core";
import { sealSecret } from "@mattrax/crypto";
import { configurationDeclarationIdentifier } from "@mattrax/mdm-core";
import { MdmOrigin } from "@mattrax/management-backend";
import { ManagementBackendEnterpriseLive } from "@mattrax/mdm-apple";
import { appleIdentityCertificate, dbRows, makeDb, tableName } from "./fake-db.js";
import type { Row, Store } from "./fake-db.js";

const origin = "https://apple-security.test";
const authSecret = "apple-security-test-secret";
const mdmOrigin = new MdmOrigin({ url: origin });
const now = new Date("2026-11-24T10:00:00.000Z");
const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect);

const organization = {
  id: "org-1",
  name: "First",
  slug: "first",
  logo: null,
  metadata: null,
  billingPlan: "free",
  billingStatus: "active",
  createdAt: now,
  updatedAt: now,
};

const deviceRow = (overrides: Row = {}) => ({
  id: "device-1",
  organizationId: "org-1",
  proto: "apple",
  status: "enrolled",
  name: "Managed Mac",
  dmIdentifier: "udid-1",
  dmIdentityFingerprint: "fingerprint-1",
  osEdition: "macOS 14.5",
  enrolledAt: now,
  lastSeenAt: now,
  ...overrides,
});

const appleState = (overrides: Row = {}) => ({
  deviceId: "device-1",
  enrollmentMode: "device",
  declarationMode: "ddm",
  token: "646576696365",
  pushMagic: "device-magic",
  topic: "com.apple.mgmt.External.org-1",
  tokenUpdatedAt: now,
  ...overrides,
});

const deviceScope = (overrides: Row = {}) => ({
  _tag: "device" as const,
  udid: "udid-1",
  identityCertificate: "CN=Device,OU=org-1",
  identityCertificateFingerprintSha256: "fingerprint-1",
  identityCertificateSerial: "A1:B2:C3",
  mdmOrigin,
  ...overrides,
});

const userScope = (overrides: Row = {}) => ({
  _tag: "user" as const,
  udid: "udid-1",
  userId: "apple-user-1",
  source: "user-channel" as const,
  identityCertificate: "CN=Device,OU=org-1",
  identityCertificateFingerprintSha256: "fingerprint-1",
  identityCertificateSerial: "A1:B2:C3",
  mdmOrigin,
  ...overrides,
});

const configurationKind = "mttx.apple.declaration.test";
const declarationIdentifier = configurationDeclarationIdentifier("policy-1", configurationKind);

const setup = async (
  options: {
    device?: Row;
    certificate?: Row;
    certificateMissing?: boolean;
    userChannel?: Row;
    command?: Row;
    secrets?: boolean;
  } = {},
) => {
  const initial: Store = {
    [tableName(schema.organization)]: [organization],
    [tableName(schema.device)]: [deviceRow(options.device)],
    [tableName(schema.deviceApple)]: [appleState()],
    [tableName(schema.policy)]: [
      {
        id: "policy-1",
        organizationId: "org-1",
        name: "Security regression policy",
        priority: 0,
        createdAt: now,
        updatedAt: now,
      },
    ],
    [tableName(schema.configuration)]: [
      {
        policyId: "policy-1",
        kind: configurationKind,
        scope: "device",
        data: {
          kind: "com.apple.configuration.app.settings",
          configuration: { SECURITY_TEST_MARKER: "dummy" },
        },
        hash: "hash-security-test",
      },
    ],
    [tableName(schema.devicePolicy)]: [
      { deviceId: "device-1", policyId: "policy-1", mode: "include" },
    ],
  };

  if (!options.certificateMissing)
    initial[tableName(schema.scepIssuedCertificate)] = [
      appleIdentityCertificate(options.certificate),
    ];

  if (options.userChannel)
    initial[tableName(schema.deviceAppleUser)] = [
      {
        deviceId: "device-1",
        userId: "apple-user-1",
        token: "75736572",
        pushMagic: "user-magic",
        topic: "com.apple.mgmt.External.org-1",
        lastSeenAt: now,
        updatedAt: now,
        ...options.userChannel,
      },
    ];

  if (options.command)
    initial[tableName(schema.deviceCommand)] = [
      {
        id: "erase-1",
        organizationId: "org-1",
        deviceId: "device-1",
        userId: null,
        requestType: "EraseDevice",
        payload: { PIN: "1234" },
        status: "sent",
        dedupeKey: null,
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        createdAt: now,
        updatedAt: now,
        ...options.command,
      },
    ];

  if (options.secrets !== false) {
    const token = btoa("dummy-bootstrap-token");
    const sealedBootstrapToken = await sealSecret(authSecret, token);
    const kinds = [
      "bootstrap_token",
      "filevault_recovery_key",
      "activation_lock_bypass_code",
      "recovery_lock_password",
      "local_admin_password",
      "local_admin_password_pending",
    ];

    initial[tableName(schema.deviceSecret)] = kinds.map((kind) => ({
      deviceId: "device-1",
      organizationId: "org-1",
      kind,
      sealedValue: kind === "bootstrap_token" ? sealedBootstrapToken : `sealed-${kind}`,
      format: "plaintext",
      createdAt: now,
      updatedAt: now,
    }));
  }

  const db = makeDb(initial);
  const backend = ManagementBackendEnterpriseLive.make({
    db: db as any,
    origin,
    authSecret,
    requireAppleDeviceIdentity: true,
  });

  return { db, backend };
};

const expectUnknownDevice = async (effect: Effect.Effect<unknown, unknown, never>) => {
  await expect(run(effect)).rejects.toMatchObject({ _tag: "UnknownDevice" });
};

describe("Apple erase acknowledgement escrow retention", () => {
  it("retains every escrow secret across an acknowledgement and duplicate result", async () => {
    const { db, backend } = await setup({ command: {} });
    const before = dbRows(db, tableName(schema.deviceSecret));

    await run(
      backend.appleDeviceEvent(deviceScope(), {
        _tag: "CommandResult",
        commandUUID: "erase-1",
        status: "Acknowledged",
      }),
    );

    expect(dbRows(db, tableName(schema.deviceSecret))).toEqual(before);
    expect(dbRows(db, tableName(schema.deviceCommand))[0]).toMatchObject({
      status: "succeeded",
      resultStatus: "Acknowledged",
    });

    await run(
      backend.appleDeviceEvent(deviceScope(), {
        _tag: "CommandResult",
        commandUUID: "erase-1",
        status: "Acknowledged",
      }),
    );

    expect(dbRows(db, tableName(schema.deviceSecret))).toEqual(before);
  });
});

describe("Apple legacy identity binding", () => {
  it("refuses to rebind an enrolled legacy row with no fingerprint", async () => {
    const { db, backend } = await setup({
      device: { dmIdentityFingerprint: null },
      command: { requestType: "DeviceInformation", status: "queued" },
      userChannel: { userId: "apple-user-1", authenticatedAt: now },
    });
    db.store[tableName(schema.deviceUserDeclaration)] = [
      {
        deviceId: "device-1",
        userId: "apple-user-1",
        identifier: declarationIdentifier,
        declarationType: "configuration",
        active: true,
        valid: true,
        serverToken: "server-token",
        updatedAt: now,
      },
    ];

    await expectUnknownDevice(
      backend.appleDeviceEvent(deviceScope(), {
        _tag: "Authenticate",
        model: "MacBookPro18,3",
        enrollmentMode: "device",
      }),
    );

    expect(dbRows(db, tableName(schema.device))[0]).toMatchObject({
      status: "enrolled",
      dmIdentityFingerprint: null,
    });
    expect(dbRows(db, tableName(schema.deviceCommand))[0]).toMatchObject({ status: "queued" });
    expect(dbRows(db, tableName(schema.deviceAppleUser))).toHaveLength(1);
    expect(dbRows(db, tableName(schema.deviceUserDeclaration))).toHaveLength(1);
  });

  it("refuses to rebind an enrolled row with a mismatched fingerprint", async () => {
    const { db, backend } = await setup();

    await expectUnknownDevice(
      backend.appleDeviceEvent(
        deviceScope({ identityCertificateFingerprintSha256: "attacker-fingerprint" }),
        {
          _tag: "Authenticate",
          model: "MacBookPro18,3",
          enrollmentMode: "device",
        },
      ),
    );

    expect(dbRows(db, tableName(schema.device))[0]).toMatchObject({
      status: "enrolled",
      dmIdentityFingerprint: "fingerprint-1",
    });
  });

  it("refuses shared check-ins for null and mismatched enrolled fingerprints", async () => {
    const tokenUpdate = {
      _tag: "TokenUpdate" as const,
      pushToken: "646576696365",
      pushMagic: "device-magic",
      topic: "com.apple.mgmt.External.org-1",
      channel: "device" as const,
    };
    const legacy = await setup({ device: { dmIdentityFingerprint: null } });
    await expectUnknownDevice(legacy.backend.appleDeviceEvent(deviceScope(), tokenUpdate));

    const mismatched = await setup();
    await expectUnknownDevice(
      mismatched.backend.appleDeviceEvent(
        deviceScope({ identityCertificateFingerprintSha256: "attacker-fingerprint" }),
        tokenUpdate,
      ),
    );
  });

  it("refuses reads for null and mismatched enrolled fingerprints", async () => {
    const legacy = await setup({ device: { dmIdentityFingerprint: null } });
    await expectUnknownDevice(legacy.backend.getAppleBootstrapToken(deviceScope()));

    const mismatched = await setup();
    await expectUnknownDevice(
      mismatched.backend.getAppleBootstrapToken(
        deviceScope({ identityCertificateFingerprintSha256: "attacker-fingerprint" }),
      ),
    );
  });
});

describe("Apple escrow and declaration read boundary", () => {
  it.each(["enrolled", "enrolling"] as const)(
    "serves bootstrap and DDM data to an active %s device-bound certificate",
    async (status) => {
      const { backend } = await setup({ device: { status } });

      await expect(run(backend.getAppleBootstrapToken(deviceScope()))).resolves.toBe(
        btoa("dummy-bootstrap-token"),
      );

      const items = await run(backend.getAppleDeclarationItems(deviceScope()));
      expect(items.configurations.map((item) => item.identifier)).toContain(declarationIdentifier);

      const declaration = await run(
        backend.getAppleDeclaration(deviceScope(), "configuration", declarationIdentifier),
      );
      expect(declaration).toMatchObject({
        Type: "com.apple.configuration.app.settings",
        Identifier: declarationIdentifier,
        Payload: { SECURITY_TEST_MARKER: "dummy" },
      });
    },
  );

  it.each([
    ["unenrolled", { device: { status: "unenrolled" } }],
    ["revoked", { certificate: { revokedAt: now } }],
    ["expired", { certificate: { notAfter: new Date("2026-11-23T10:00:00.000Z") } }],
    ["cross-device", { certificate: { deviceId: "other-device" } }],
    ["missing", { certificateMissing: true }],
  ] as const)(
    "rejects bootstrap and DDM reads for a %s certificate/device",
    async (_name, options) => {
      const { backend } = await setup(options);

      await expectUnknownDevice(backend.getAppleBootstrapToken(deviceScope()));
      await expectUnknownDevice(backend.getAppleDeclarationTokens(deviceScope()));
      await expectUnknownDevice(backend.getAppleDeclarationItems(deviceScope()));
      await expectUnknownDevice(
        backend.getAppleDeclaration(deviceScope(), "configuration", declarationIdentifier),
      );
    },
  );

  it("rejects escrow and declaration reads after device CheckOut", async () => {
    const { db, backend } = await setup();

    await run(backend.appleDeviceEvent(deviceScope(), { _tag: "CheckOut" }));

    expect(dbRows(db, tableName(schema.device))[0]).toMatchObject({ status: "unenrolled" });
    expect(dbRows(db, tableName(schema.scepIssuedCertificate))[0]?.revokedAt).toBeInstanceOf(Date);
    await expectUnknownDevice(backend.getAppleBootstrapToken(deviceScope()));
    await expectUnknownDevice(backend.getAppleDeclarationItems(deviceScope()));
  });

  it("rejects a scope without the presented certificate serial", async () => {
    const { backend } = await setup();

    await expectUnknownDevice(
      backend.getAppleBootstrapToken(deviceScope({ identityCertificateSerial: undefined })),
    );
    await expectUnknownDevice(
      backend.getAppleDeclarationItems(deviceScope({ identityCertificateSerial: undefined })),
    );
  });

  it("does not let a user channel read the device bootstrap token", async () => {
    const { backend } = await setup({ userChannel: {} });

    await expectUnknownDevice(backend.getAppleBootstrapToken(userScope()));
  });

  it("does not let a user channel bypass lifecycle or certificate revocation", async () => {
    const revoked = await setup({
      certificate: { revokedAt: now },
      userChannel: { authenticatedAt: now },
    });
    await expectUnknownDevice(revoked.backend.getAppleDeclarationItems(userScope()));
    await expectUnknownDevice(revoked.backend.appleManagementCheckin(userScope()));

    const unenrolled = await setup({
      device: { status: "unenrolled" },
      userChannel: { authenticatedAt: now },
    });
    await expectUnknownDevice(unenrolled.backend.getAppleDeclarationTokens(userScope()));
    await expectUnknownDevice(unenrolled.backend.appleManagementCheckin(userScope()));
  });
});
