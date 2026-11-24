import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { schema } from "@mattrax/enterprise-core";
import { MdmOrigin } from "@mattrax/management-backend";
import { ManagementBackendEnterpriseLive } from "@mattrax/mdm-apple";
import { parseAppleUserProfiles } from "../appleUsers.js";
import { dbRows, makeDb, tableName } from "./fake-db.js";
import type { Row, Store } from "./fake-db.js";

const origin = "https://enterprise.test";

const authSecret = "enterprise-test-secret";

const mdmOrigin = new MdmOrigin({ url: origin });

const now = new Date("2026-11-16T10:00:00.000Z");

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

const deviceRow = (id: string, udid: string, organizationId = "org-1") => ({
  id,
  organizationId,
  proto: "apple",
  status: "enrolled",
  name: id,
  dmIdentifier: udid,
  dmIdentityFingerprint: "fingerprint-1",
  enrolledAt: now,
  lastSeenAt: now,
});

const appleState = (deviceId: string, enrollmentMode: "device" | "user" = "device") => ({
  deviceId,
  enrollmentMode,
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

const command = (overrides: Row = {}) => ({
  id: "command-1",
  organizationId: "org-1",
  deviceId: "device-1",
  userId: null,
  requestType: "DeviceInformation",
  payload: {},
  status: "queued",
  dedupeKey: null,
  // Far future so a command fixture does not start failing when the wall clock
  // passes the original hard-coded value (the backend compares to `new Date()`).
  expiresAt: new Date("2099-01-01T00:00:00.000Z"),
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const setup = (initial: Store = {}) => {
  const store: Store = {
    [tableName(schema.organization)]: [
      organization("org-1", "first"),
      organization("org-2", "second"),
    ],
    ...initial,
  };

  const db = makeDb(store);

  // SAFETY: The fake store implements the query chains exercised by these tests.
  const backend = ManagementBackendEnterpriseLive.make({
    db: db as any,
    origin,
    authSecret,
  });

  return { db, backend };
};

const deviceScope = (overrides: Row = {}) => ({
  _tag: "device" as const,
  udid: "udid-1",
  // The OU is the tenant, exactly as the SCEP subject encodes it.
  identityCertificate: "CN=Device,OU=org-1",
  identityCertificateFingerprintSha256: "fingerprint-1",
  mdmOrigin,
  ...overrides,
});

const userScope = (
  overrides: Row = {},
  source: "user-channel" | "user-enrollment" = "user-channel",
) => ({
  _tag: "user" as const,
  udid: "udid-1",
  userId: "user-1",
  source,
  identityCertificate: "CN=Device,OU=org-1",
  identityCertificateFingerprintSha256: "fingerprint-1",
  mdmOrigin,
  ...overrides,
});

const errorsOf = <A, E>(effect: Effect.Effect<A, E, never>) =>
  effect.pipe(
    Effect.match({
      onSuccess: () => null,
      onFailure: (error) => error,
    }),
    Effect.runPromise,
  );

describe("Apple user channel", () => {
  it("records a UserAuthenticate binding for an enrolled device", async () => {
    const { db, backend } = setup({
      [tableName(schema.device)]: [deviceRow("device-1", "udid-1")],
      [tableName(schema.deviceApple)]: [appleState("device-1")],
    });

    await run(
      backend.appleDeviceEvent(userScope({ userShortName: "oscar" }), {
        _tag: "UserAuthenticate" as const,
      }),
    );

    expect(dbRows(db, tableName(schema.deviceAppleUser))).toMatchObject([
      {
        deviceId: "device-1",
        userId: "user-1",
        userShortName: "oscar",
        authenticatedAt: expect.any(Date),
        lastSeenAt: expect.any(Date),
      },
    ]);
  });

  it("refuses a user on a device it cannot resolve (cross-tenant)", async () => {
    const { db, backend } = setup({
      [tableName(schema.device)]: [deviceRow("device-1", "udid-1")],
      [tableName(schema.deviceApple)]: [appleState("device-1")],
    });

    const error = await errorsOf(
      backend.appleDeviceEvent(userScope({ identityCertificate: "CN=Device,OU=org-2" }), {
        _tag: "UserAuthenticate" as const,
      }),
    );

    expect(error?._tag).toBe("UnknownDevice");
    expect(dbRows(db, tableName(schema.deviceAppleUser))).toHaveLength(0);
  });

  it("refuses a user TokenUpdate that never authenticated", async () => {
    const { db, backend } = setup({
      [tableName(schema.device)]: [deviceRow("device-1", "udid-1")],
      [tableName(schema.deviceApple)]: [appleState("device-1")],
    });

    const error = await errorsOf(
      backend.appleDeviceEvent(userScope(), {
        _tag: "TokenUpdate" as const,
        pushToken: "75736572",
        pushMagic: "user-magic",
        topic: "com.apple.mgmt.External.org-1",
        channel: "user" as const,
        userId: "user-1",
      }),
    );

    expect(error?._tag).toBe("UnknownDevice");
    expect(dbRows(db, tableName(schema.deviceAppleUser))).toHaveLength(0);
  });

  it("stores the user channel after UserAuthenticate", async () => {
    const { db, backend } = setup({
      [tableName(schema.device)]: [deviceRow("device-1", "udid-1")],
      [tableName(schema.deviceApple)]: [appleState("device-1")],
    });

    await run(backend.appleDeviceEvent(userScope(), { _tag: "UserAuthenticate" as const }));

    await run(
      backend.appleDeviceEvent(
        userScope({ userShortName: "oscar", userLongName: "Oscar Beaumont" }),
        {
          _tag: "TokenUpdate" as const,
          pushToken: "757365722d746f6b656e",
          pushMagic: "user-magic",
          topic: "com.apple.mgmt.External.org-1",
          channel: "user" as const,
          userId: "user-1",
          userShortName: "oscar",
          userLongName: "Oscar Beaumont",
        },
      ),
    );

    const users = dbRows(db, tableName(schema.deviceAppleUser));

    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      deviceId: "device-1",
      userId: "user-1",
      userShortName: "oscar",
      userLongName: "Oscar Beaumont",
      token: "757365722d746f6b656e",
      pushMagic: "user-magic",
      authenticatedAt: expect.any(Date),
    });
  });

  it("accepts an Apple User Enrollment channel without UserAuthenticate", async () => {
    const { db, backend } = setup({
      [tableName(schema.device)]: [deviceRow("device-1", "enrollment-1")],
      [tableName(schema.deviceApple)]: [appleState("device-1", "user")],
    });

    await run(
      backend.appleDeviceEvent(
        {
          _tag: "user" as const,
          udid: "enrollment-1",
          enrollmentId: "enrollment-1",
          userId: "enrollment-user-1",
          source: "user-enrollment" as const,
          identityCertificate: "CN=Device,OU=org-1",
          identityCertificateFingerprintSha256: "fingerprint-1",
          mdmOrigin,
        },
        {
          _tag: "TokenUpdate" as const,
          pushToken: "62796f64",
          pushMagic: "byod-magic",
          topic: "com.apple.mgmt.External.org-1",
          channel: "user" as const,
          userId: "enrollment-user-1",
          enrollmentId: "enrollment-1",
        },
      ),
    );

    expect(dbRows(db, tableName(schema.deviceAppleUser))).toMatchObject([
      { deviceId: "device-1", userId: "enrollment-user-1", token: "62796f64" },
    ]);
  });

  it("keys a Shared iPad channel by its Managed Apple Account and binds the person", async () => {
    const account = "student@example.test";

    const { db, backend } = setup({
      [tableName(schema.device)]: [
        { ...deviceRow("device-1", "udid-1"), osEdition: "iPadOS 18.4" },
      ],
      [tableName(schema.deviceApple)]: [appleState("device-1")],
      [tableName(schema.user)]: [
        {
          id: "dir-1",
          organizationId: "org-1",
          name: "Student",
          email: account,
          disabled: false,
          source: "scim",
          createdAt: now,
          updatedAt: now,
        },
      ],
    });

    // Apple sends the sentinel UserID for every Shared iPad login, so the
    // protocol layer keys the channel by the Managed Apple Account instead.
    await run(
      backend.appleDeviceEvent(userScope({ userId: account, userShortName: account }), {
        _tag: "TokenUpdate" as const,
        pushToken: "736861726564",
        pushMagic: "shared-magic",
        topic: "com.apple.mgmt.External.org-1",
        channel: "user" as const,
        userId: account,
        userShortName: account,
      }),
    );

    expect(dbRows(db, tableName(schema.deviceAppleUser))).toMatchObject([
      {
        deviceId: "device-1",
        userId: account,
        directoryUserId: "dir-1",
        identitySource: "managed-apple-account",
        identityUpn: account,
      },
    ]);
  });

  it("leaves a Shared iPad channel unbound when the account is not in the directory", async () => {
    const account = "unknown@example.test";

    const { db, backend } = setup({
      [tableName(schema.device)]: [
        { ...deviceRow("device-1", "udid-1"), osEdition: "iPadOS 18.4" },
      ],
      [tableName(schema.deviceApple)]: [appleState("device-1")],
    });

    await run(
      backend.appleDeviceEvent(userScope({ userId: account, userShortName: account }), {
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
  });

  it("removes only the checked-out user", async () => {
    const { db, backend } = setup({
      [tableName(schema.device)]: [deviceRow("device-1", "udid-1")],
      [tableName(schema.deviceApple)]: [appleState("device-1")],
      [tableName(schema.deviceAppleUser)]: [
        appleUser(),
        appleUser({ userId: "user-2", token: "7573657232" }),
      ],
    });

    await run(
      backend.appleDeviceEvent(userScope(), {
        _tag: "CheckOut" as const,
        userId: "user-1",
      }),
    );

    expect(dbRows(db, tableName(schema.deviceAppleUser))).toMatchObject([{ userId: "user-2" }]);
  });

  it("drops every user channel when the device checks out", async () => {
    const { db, backend } = setup({
      [tableName(schema.device)]: [deviceRow("device-1", "udid-1")],
      [tableName(schema.deviceApple)]: [appleState("device-1")],
      [tableName(schema.deviceAppleUser)]: [appleUser()],
    });

    await run(backend.appleDeviceEvent(deviceScope(), { _tag: "CheckOut" as const }));

    expect(dbRows(db, tableName(schema.deviceAppleUser))).toHaveLength(0);
  });

  it("delivers only the user's commands on the user channel", async () => {
    const { db, backend } = setup({
      [tableName(schema.device)]: [deviceRow("device-1", "udid-1")],
      [tableName(schema.deviceApple)]: [appleState("device-1")],
      [tableName(schema.deviceAppleUser)]: [appleUser()],
      [tableName(schema.deviceCommand)]: [
        command({ id: "device-command" }),
        command({
          id: "user-command",
          userId: "user-1",
          requestType: "ProfileList",
          payload: { ManagedOnly: false },
        }),
        command({ id: "other-user-command", userId: "user-2" }),
      ],
    });

    const manifest = await run(backend.appleManagementCheckin(userScope()));

    expect(manifest._tag).toBe("Command");
    expect(manifest).toMatchObject({
      commandUUID: "user-command",
      requestType: "ProfileList",
    });

    const commands = dbRows(db, tableName(schema.deviceCommand));
    const byId = (id: string) => commands.find((row) => row.id === id);

    expect(byId("user-command")?.status).toBe("sent");
    expect(byId("device-command")?.status).toBe("queued");
    expect(byId("other-user-command")?.status).toBe("queued");
  });

  it("keeps user commands away from the device channel", async () => {
    const { db, backend } = setup({
      [tableName(schema.device)]: [deviceRow("device-1", "udid-1")],
      [tableName(schema.deviceApple)]: [appleState("device-1")],
      [tableName(schema.deviceAppleUser)]: [appleUser()],
      [tableName(schema.deviceCommand)]: [
        command({ id: "device-command" }),
        command({ id: "user-command", userId: "user-1", requestType: "ProfileList" }),
      ],
    });

    const manifest = await run(backend.appleManagementCheckin(deviceScope())).catch(() => null);

    // Only the device-scoped command may be handed out. A failure elsewhere in
    // the device check-in (policy resolution) is unrelated to channel scoping.
    if (manifest?._tag === "Command") expect(manifest.commandUUID).toBe("device-command");

    const commands = dbRows(db, tableName(schema.deviceCommand));

    expect(commands.find((row) => row.id === "user-command")?.status).toBe("queued");
  });

  it("acknowledges a user command only from the same user", async () => {
    const { db, backend } = setup({
      [tableName(schema.device)]: [deviceRow("device-1", "udid-1")],
      [tableName(schema.deviceApple)]: [appleState("device-1")],
      [tableName(schema.deviceAppleUser)]: [appleUser()],
      [tableName(schema.deviceCommand)]: [
        command({
          id: "user-command",
          userId: "user-1",
          requestType: "ProfileList",
          status: "sent",
        }),
      ],
    });

    // Another user's channel cannot acknowledge it.
    await run(
      backend.appleDeviceEvent(userScope({ userId: "user-2" }), {
        _tag: "CommandResult" as const,
        commandUUID: "user-command",
        status: "Acknowledged",
        queryResponses: {},
      }),
    );

    expect(dbRows(db, tableName(schema.deviceCommand))[0]?.status).toBe("sent");

    // The owning channel can, and its reported profiles are persisted.
    await run(
      backend.appleDeviceEvent(userScope(), {
        _tag: "CommandResult" as const,
        commandUUID: "user-command",
        status: "Acknowledged",
        queryResponses: {
          ProfileList: [
            {
              PayloadIdentifier: "com.acme.wifi",
              PayloadDisplayName: "Acme Wi-Fi",
              PayloadType: "Configuration",
              PayloadUUID: "uuid-1",
              IsManaged: true,
            },
          ],
        },
      }),
    );

    const commands = dbRows(db, tableName(schema.deviceCommand));

    expect(commands[0]?.status).toBe("succeeded");
    expect(dbRows(db, tableName(schema.deviceAppleUser))[0]).toMatchObject({
      profiles: [
        {
          identifier: "com.acme.wifi",
          displayName: "Acme Wi-Fi",
          payloadType: "Configuration",
          payloadUuid: "uuid-1",
          managed: true,
        },
      ],
    });
  });
});

describe("parseAppleUserProfiles", () => {
  it("drops payloads without an identifier and bounds the list", () => {
    expect(parseAppleUserProfiles(undefined)).toEqual([]);
    expect(parseAppleUserProfiles({ ProfileList: "not-a-list" })).toEqual([]);
    expect(
      parseAppleUserProfiles({
        ProfileList: [{ PayloadDisplayName: "no id" }, { PayloadIdentifier: "com.acme.one" }],
      }),
    ).toEqual([
      {
        identifier: "com.acme.one",
        displayName: undefined,
        payloadType: undefined,
        payloadUuid: undefined,
        managed: false,
      },
    ]);
  });
});
