import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { schema } from "@mattrax/enterprise-core";
import { sealSecret } from "@mattrax/crypto";
import { AppleDeviceEvent, MdmOrigin } from "@mattrax/management-backend";
import { ManagementBackendEnterpriseLive } from "@mattrax/mdm-apple";
import { dbRows, makeDb, tableName } from "./fake-db.js";

const origin = "https://enterprise.test";

const authSecret = "enterprise-test-secret";

const mdmOrigin = new MdmOrigin({ url: origin });

const now = new Date("2026-11-11T10:00:00.000Z");

const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect);

const AuthenticateEvent = AppleDeviceEvent.members[0];

const TokenUpdateEvent = AppleDeviceEvent.members[2];

const CommandResultEvent = AppleDeviceEvent.members[5];

const DeclarationStatusEvent = AppleDeviceEvent.members[6];

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
  udid: "udid-ade-1",
  identityCertificate: "CN=Device,OU=org-1",
  identityCertificateFingerprintSha256: "fingerprint-1",
  mdmOrigin,
};

const authenticate = () =>
  AuthenticateEvent.make({
    serialNumber: "C02ADE001",
    model: "MacBookPro18,2",
    enrollmentMode: "device",
  });

const tokenUpdate = (awaitingConfiguration: boolean) =>
  TokenUpdateEvent.make({
    pushToken: "deadbeef",
    pushMagic: "push-magic",
    topic: "com.apple.mgmt.External.test",
    channel: "device",
    awaitingConfiguration,
  });

const commands = (db: ReturnType<typeof setup>["db"]) =>
  dbRows(db, tableName(schema.deviceCommand));

const commandByType = (db: ReturnType<typeof setup>["db"], requestType: string) =>
  commands(db).find((row) => row.requestType === requestType);

const deviceRow = (db: ReturnType<typeof setup>["db"]) => dbRows(db, tableName(schema.device))[0];

const appleRow = (db: ReturnType<typeof setup>["db"]) =>
  dbRows(db, tableName(schema.deviceApple))[0];

/** Assign one non-application configuration so the setup report is expected. */
const assignPolicy = (db: ReturnType<typeof setup>["db"], deviceId: string) => {
  db.store[tableName(schema.policy)] = [
    {
      id: "policy-1",
      organizationId: "org-1",
      name: "Baseline",
      priority: 0,
      createdAt: now,
      updatedAt: now,
      __table: tableName(schema.policy),
    },
  ];
  db.store[tableName(schema.devicePolicy)] = [
    {
      deviceId,
      policyId: "policy-1",
      organizationId: "org-1",
      createdAt: now,
      __table: tableName(schema.devicePolicy),
    },
  ];
  db.store[tableName(schema.configuration)] = [
    {
      policyId: "policy-1",
      kind: "mttx.apple.custom.wifi",
      data: { content: btoa("<plist>wifi</plist>") },
      hash: "hash-1",
      __table: tableName(schema.configuration),
    },
  ];
};

describe("ADE setup gating", () => {
  it("keeps an awaiting device enrolling and queues the setup payload", async () => {
    const { db, backend } = setup();

    await run(backend.appleDeviceEvent(scope, authenticate()));
    await run(backend.appleDeviceEvent(scope, tokenUpdate(true)));

    assignPolicy(db, String(deviceRow(db).id));

    expect(deviceRow(db).status).toBe("enrolling");

    const apple = appleRow(db);
    expect(apple.awaitingConfiguration).toBe(true);
    expect(apple.configured).toBe(false);

    const admin = commandByType(db, "AccountConfiguration");
    expect(admin?.status).toBe("queued");

    // SAFETY: the queued AccountConfiguration payload is the JSON object this
    // test just asserted is present.
    const payload = admin?.payload as any;
    expect(payload.SkipPrimarySetupAccountCreation).toBe(true);
    expect(payload.AutoSetupAdminAccounts[0]).toMatchObject({
      shortName: "mattrax-admin",
      hidden: true,
    });
    expect(payload.AutoSetupAdminAccounts[0].passwordHash).toEqual(expect.any(String));

    const secret = dbRows(db, tableName(schema.deviceSecret)).find(
      (row) => row.kind === "local_admin_password",
    );

    expect(secret).toBeDefined();
  });

  it("does not release while declarations are missing or invalid", async () => {
    const { db, backend } = setup();

    await run(backend.appleDeviceEvent(scope, authenticate()));
    await run(backend.appleDeviceEvent(scope, tokenUpdate(true)));

    assignPolicy(db, String(deviceRow(db).id));

    const admin = commandByType(db, "AccountConfiguration")!;
    await run(
      backend.appleDeviceEvent(
        scope,
        CommandResultEvent.make({
          commandUUID: String(admin.id),
          status: "Acknowledged",
        }),
      ),
    );

    expect(commandByType(db, "DeviceConfigured")).toBeUndefined();

    await run(
      backend.appleDeviceEvent(
        scope,
        DeclarationStatusEvent.make({
          statusItems: {
            management: {
              declarations: {
                configurations: [{ Identifier: "config.one", Valid: "invalid", Active: true }],
              },
            },
          },
        }),
      ),
    );

    expect(commandByType(db, "DeviceConfigured")).toBeUndefined();
  });

  it("sends DeviceConfigured once every declaration is valid, then marks the device enrolled", async () => {
    const { db, backend } = setup();

    await run(backend.appleDeviceEvent(scope, authenticate()));
    await run(backend.appleDeviceEvent(scope, tokenUpdate(true)));

    assignPolicy(db, String(deviceRow(db).id));

    const admin = commandByType(db, "AccountConfiguration")!;
    await run(
      backend.appleDeviceEvent(
        scope,
        CommandResultEvent.make({
          commandUUID: String(admin.id),
          status: "Acknowledged",
        }),
      ),
    );

    await run(
      backend.appleDeviceEvent(
        scope,
        DeclarationStatusEvent.make({
          statusItems: {
            management: {
              declarations: {
                configurations: [{ Identifier: "config.one", Valid: "valid", Active: true }],
              },
            },
          },
        }),
      ),
    );

    const release = commandByType(db, "DeviceConfigured")!;
    expect(release.status).toBe("queued");

    // Still enrolling until the device acknowledges the release.
    expect(deviceRow(db).status).toBe("enrolling");

    await run(
      backend.appleDeviceEvent(
        scope,
        CommandResultEvent.make({
          commandUUID: String(release.id),
          status: "Acknowledged",
        }),
      ),
    );

    expect(deviceRow(db).status).toBe("enrolled");

    const apple = appleRow(db);
    expect(apple.configured).toBe(true);
    expect(apple.awaitingConfiguration).toBe(false);
    expect(apple.setupReleasedAt).toBeInstanceOf(Date);
  });

  it("marks a non-awaiting TokenUpdate enrolled immediately", async () => {
    const { db, backend } = setup();

    await run(backend.appleDeviceEvent(scope, authenticate()));
    await run(backend.appleDeviceEvent(scope, tokenUpdate(false)));

    expect(deviceRow(db).status).toBe("enrolled");
    expect(appleRow(db).configured).toBe(true);
    expect(commandByType(db, "AccountConfiguration")).toBeUndefined();
  });
});

describe("Return to Service check-in", () => {
  it("returns the assigned Wi-Fi profile and escrowed bootstrap token", async () => {
    const { db, backend } = setup();

    await run(backend.appleDeviceEvent(scope, authenticate()));
    await run(backend.appleDeviceEvent(scope, tokenUpdate(false)));

    const deviceId = String(deviceRow(db).id);
    const wifiProfile = btoa("<plist>wifi</plist>");

    db.store[tableName(schema.policy)] = [
      {
        id: "policy-1",
        organizationId: "org-1",
        name: "Wi-Fi",
        priority: 0,
        createdAt: now,
        updatedAt: now,
        __table: tableName(schema.policy),
      },
    ];
    db.store[tableName(schema.devicePolicy)] = [
      {
        deviceId,
        policyId: "policy-1",
        organizationId: "org-1",
        createdAt: now,
        __table: tableName(schema.devicePolicy),
      },
    ];
    db.store[tableName(schema.configuration)] = [
      {
        policyId: "policy-1",
        kind: "mttx.apple.custom.wifi",
        data: { content: wifiProfile, ssid: "Corp", security: "wpa2" },
        hash: "hash-1",
        __table: tableName(schema.configuration),
      },
    ];

    const token = btoa("bootstrap-token");
    const sealed = await sealSecret(authSecret, token);

    db.store[tableName(schema.deviceSecret)] = [
      {
        deviceId,
        organizationId: "org-1",
        kind: "bootstrap_token",
        sealedValue: sealed,
        format: "plaintext",
        createdAt: now,
        updatedAt: now,
        __table: tableName(schema.deviceSecret),
      },
    ];

    const configuration = await run(backend.appleReturnToServiceConfiguration(scope));

    expect(configuration.enabled).toBe(true);
    expect(configuration.wifiProfileData).toEqual(
      Uint8Array.from(atob(wifiProfile), (char) => char.charCodeAt(0)),
    );
    expect(configuration.bootstrapToken).toEqual(
      Uint8Array.from(atob(token), (char) => char.charCodeAt(0)),
    );
  });

  it("does not enable Return to Service without an assigned Wi-Fi profile", async () => {
    const { backend } = setup();

    await run(backend.appleDeviceEvent(scope, authenticate()));
    await run(backend.appleDeviceEvent(scope, tokenUpdate(false)));

    const configuration = await run(backend.appleReturnToServiceConfiguration(scope));

    expect(configuration.enabled).toBe(false);
    expect(configuration.reason).toContain("Wi-Fi");
  });
});
