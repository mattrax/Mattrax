import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { schema } from "@mattrax/enterprise-core";
import { MdmOrigin } from "@mattrax/management-backend";
import { ManagementBackendEnterpriseLive } from "@mattrax/mdm-apple";
import { configurationDeclarationIdentifier } from "@mattrax/mdm-core";
import { dbRows, makeDb, tableName } from "./fake-db.js";
import type { Row } from "./fake-db.js";

const origin = "https://user-policies.test";

const authSecret = "user-policy-delivery-secret";

const mdmOrigin = new MdmOrigin({ url: origin });

const now = new Date("2026-11-19T10:00:00.000Z");

const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect);

const organization = (id: string) => ({
  id,
  name: id,
  slug: id,
  logo: null,
  metadata: null,
  stripeCustomerId: null,
  createdAt: now,
  updatedAt: now,
});

const device = (id: string, udid: string) => ({
  id,
  organizationId: "org-1",
  proto: "apple",
  status: "enrolled",
  name: id,
  dmIdentifier: udid,
  dmIdentityFingerprint: "fingerprint-1",
  enrolledAt: now,
  lastSeenAt: now,
});

const appleState = (deviceId: string) => ({
  deviceId,
  enrollmentMode: "device",
  token: "646576696365",
  pushMagic: "device-magic",
  topic: "com.apple.mgmt.External.org-1",
  tokenUpdatedAt: now,
});

const appleUser = (overrides: Row = {}) => ({
  deviceId: "device-1",
  userId: "user-1",
  token: "75736572",
  pushMagic: "user-magic",
  topic: "com.apple.mgmt.External.org-1",
  authenticatedAt: now,
  lastSeenAt: now,
  updatedAt: now,
  ...overrides,
});

const policy = {
  id: "policy-1",
  organizationId: "org-1",
  name: "Policy",
  notes: null,
  priority: 0,
  createdAt: now,
  updatedAt: now,
};

const userKind = "mttx.apple.declaration.usersettings";

const userConfiguration = (scope: "device" | "user") => ({
  policyId: "policy-1",
  kind: userKind,
  scope,
  data: { kind: "com.apple.configuration.app.settings", configuration: {} },
  hash: "hash-user",
});

const setup = (options: {
  bound: boolean;
  scope?: "device" | "user";
  sharedIpad?: boolean;
  identitySource?: "manual" | "managed-apple-account";
  seedUserChannel?: boolean;
  channelUserId?: string;
}) => {
  const db = makeDb({
    [tableName(schema.organization)]: [organization("org-1")],
    [tableName(schema.device)]: [
      {
        ...device("device-1", "udid-1"),
        ...(options.sharedIpad ? { osEdition: "iPadOS 18.4" } : {}),
      },
    ],
    [tableName(schema.deviceApple)]: [appleState("device-1")],
    [tableName(schema.scepIssuedCertificate)]: [
      {
        serial: "a1b2c3",
        organizationId: "org-1",
        deviceId: "device-1",
        notAfter: new Date("2099-01-01T00:00:00.000Z"),
        revokedAt: null,
        createdAt: now,
      },
    ],
    [tableName(schema.policy)]: [policy],
    [tableName(schema.configuration)]: [userConfiguration(options.scope ?? "user")],
    [tableName(schema.devicePolicy)]: [
      { deviceId: "device-1", policyId: "policy-1", mode: "include" },
    ],
    [tableName(schema.user)]: [
      {
        id: "dir-1",
        organizationId: "org-1",
        name: "Directory Person",
        email: "person@example.test",
        externalId: "entra-1",
        source: "entra",
        disabled: false,
        createdAt: now,
        updatedAt: now,
      },
    ],
    ...(options.seedUserChannel === false
      ? {}
      : {
          [tableName(schema.deviceAppleUser)]: [
            appleUser({
              userId: options.channelUserId ?? "user-1",
              ...(options.bound
                ? {
                    directoryUserId: "dir-1",
                    identitySource: options.identitySource ?? "manual",
                    identityUpn: "person@example.test",
                    identityVerifiedAt: now,
                  }
                : {}),
            }),
          ],
        }),
  });

  // SAFETY: The fake store implements the query chains these tests exercise.
  const backend = ManagementBackendEnterpriseLive.make({ db: db as any, origin, authSecret });

  return { db, backend };
};

const deviceScope = {
  _tag: "device" as const,
  udid: "udid-1",
  identityCertificate: "CN=Device,OU=org-1",
  identityCertificateFingerprintSha256: "fingerprint-1",
  identityCertificateSerial: "A1:B2:C3",
  mdmOrigin,
};

const userScope = {
  _tag: "user" as const,
  udid: "udid-1",
  userId: "user-1",
  source: "user-channel" as const,
  identityCertificate: "CN=Device,OU=org-1",
  identityCertificateFingerprintSha256: "fingerprint-1",
  identityCertificateSerial: "A1:B2:C3",
  mdmOrigin,
};

const identifier = configurationDeclarationIdentifier("policy-1", userKind);

describe("user-scoped Apple policy delivery", () => {
  it("serves user-scoped configurations on a bound user channel", async () => {
    const { backend } = setup({ bound: true });

    const items = await run(backend.getAppleDeclarationItems(userScope));

    expect(items.configurations.map((item) => item.identifier)).toContain(identifier);
  });

  it("keeps user-scoped configurations off the device channel", async () => {
    const { backend } = setup({ bound: true });

    const items = await run(backend.getAppleDeclarationItems(deviceScope));

    expect(items.configurations.map((item) => item.identifier)).not.toContain(identifier);
  });

  it("serves nothing to an unbound user channel", async () => {
    const { backend } = setup({ bound: false });

    const items = await run(backend.getAppleDeclarationItems(userScope));

    expect(items.configurations).toEqual([]);
    expect(items.activations).toEqual([]);
  });

  it("does not bind or serve declarations to an attacker-chosen Shared iPad account", async () => {
    const account = "person@example.test";
    const { db, backend } = setup({
      bound: false,
      sharedIpad: true,
      seedUserChannel: false,
    });
    const sharedScope = { ...userScope, userId: account, userShortName: account };

    await run(
      backend.appleDeviceEvent(sharedScope, {
        _tag: "TokenUpdate" as const,
        pushToken: "736861726564",
        pushMagic: "shared-magic",
        topic: "com.apple.mgmt.External.org-1",
        channel: "user" as const,
        userId: account,
        userShortName: account,
      }),
    );

    const [channel] = dbRows(db, tableName(schema.deviceAppleUser));
    expect(channel).toMatchObject({ userId: account });
    expect(channel?.directoryUserId ?? null).toBeNull();
    expect(channel?.identitySource ?? null).toBeNull();
    expect(channel?.identityVerifiedAt ?? null).toBeNull();

    const items = await run(backend.getAppleDeclarationItems(sharedScope));
    expect(items.configurations).toEqual([]);

    const declaration = await run(
      backend.getAppleDeclaration(sharedScope, "configuration", identifier),
    );
    expect(declaration).toBeNull();
  });

  it("serves declarations to a pre-provisioned Shared iPad binding", async () => {
    const account = "person@example.test";
    const { backend } = setup({
      bound: true,
      sharedIpad: true,
      identitySource: "manual",
      channelUserId: account,
    });
    const sharedScope = { ...userScope, userId: account, userShortName: account };

    await run(
      backend.appleDeviceEvent(sharedScope, {
        _tag: "TokenUpdate" as const,
        pushToken: "736861726564",
        pushMagic: "shared-magic",
        topic: "com.apple.mgmt.External.org-1",
        channel: "user" as const,
        userId: account,
        userShortName: account,
      }),
    );

    const items = await run(backend.getAppleDeclarationItems(sharedScope));
    expect(items.configurations.map((item) => item.identifier)).toContain(identifier);
  });

  it("ignores legacy email-correlated Shared iPad bindings", async () => {
    const account = "person@example.test";
    const { backend } = setup({
      bound: true,
      sharedIpad: true,
      identitySource: "managed-apple-account",
      channelUserId: account,
    });
    const sharedScope = { ...userScope, userId: account, userShortName: account };

    const items = await run(backend.getAppleDeclarationItems(sharedScope));
    expect(items.configurations).toEqual([]);

    const declaration = await run(
      backend.getAppleDeclaration(sharedScope, "configuration", identifier),
    );
    expect(declaration).toBeNull();

    const manifest = await run(backend.appleManagementCheckin(sharedScope));
    expect(manifest._tag).toBe("Idle");
  });

  it("keeps device-scoped configurations off the user channel", async () => {
    const { backend } = setup({ bound: true, scope: "device" });

    const items = await run(backend.getAppleDeclarationItems(userScope));

    expect(items.configurations).toEqual([]);
  });

  it("asks a bound user channel to sync declarative management", async () => {
    const { backend } = setup({ bound: true });

    const manifest = await run(backend.appleManagementCheckin(userScope));

    expect(manifest._tag).toBe("DdmSync");
  });

  it("does not ask an unbound user channel to sync declarations", async () => {
    const { backend } = setup({ bound: false });

    const manifest = await run(backend.appleManagementCheckin(userScope));

    expect(manifest._tag).toBe("Idle");
  });

  it("stops asking for a sync once the channel has the same declaration set", async () => {
    const { backend } = setup({ bound: true });

    const first = await run(backend.appleManagementCheckin(userScope));

    expect(first._tag).toBe("DdmSync");

    // Fetching the items is what records the token: the device has the set.
    await run(backend.getAppleDeclarationItems(userScope));

    const second = await run(backend.appleManagementCheckin(userScope));

    expect(second._tag).toBe("Idle");
  });

  it("serves only declarations that belong to the user's set", async () => {
    const { backend } = setup({ bound: true });

    const declaration = await run(
      backend.getAppleDeclaration(userScope, "configuration", identifier),
    );

    expect(declaration).toMatchObject({
      Type: "com.apple.configuration.app.settings",
      Identifier: identifier,
    });

    const foreign = await run(
      backend.getAppleDeclaration(userScope, "configuration", "other-policy:other-kind"),
    );

    expect(foreign).toBeNull();
  });
});
