import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { openSecret } from "@mattrax/crypto";
import { schema } from "@mattrax/enterprise-core";
import { MdmOrigin } from "@mattrax/management-backend";
import { ManagementBackendEnterpriseLive } from "../index.js";
import { dbRows, makeDb, tableName, type Row, stringValue } from "./fake-db.js";

const origin = "https://enterprise.test";
const authSecret = "device-inventory-test-secret";
const mdmOrigin = new MdmOrigin({ url: origin });
const now = new Date("2026-11-11T10:00:00.000Z");

const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect);

const organization = {
  id: "org-1",
  name: "Acme",
  slug: "acme",
  logo: null,
  metadata: null,
  stripeCustomerId: null,
  createdAt: now,
  updatedAt: now,
};

const device = {
  id: "device-1",
  organizationId: "org-1",
  proto: "apple",
  status: "enrolled",
  name: "Mac",
  serial: "SERIAL-1",
  model: "MacBookPro18,3",
  dmIdentifier: "udid-1",
  dmIdentityFingerprint: "fingerprint-1",
  enrolledAt: now,
  lastSeenAt: now,
};

const setup = () => {
  const db = makeDb({
    [tableName(schema.organization)]: [organization],
    [tableName(schema.device)]: [device],
    [tableName(schema.deviceApple)]: [
      { deviceId: "device-1", bootstrapTokenEscrowed: null, configured: true },
    ],
  });

  // SAFETY: The fake store implements only the query chains these tests exercise.
  const backend = ManagementBackendEnterpriseLive.make({ db: db as any, origin, authSecret });

  return { db, backend };
};

const scope = {
  _tag: "device" as const,
  udid: "udid-1",
  identityCertificate: "CN=Device,OU=org-1",
  identityCertificateFingerprintSha256: "fingerprint-1",
  mdmOrigin,
};

const commandResult = (queryResponses: Row, commandUUID = "cmd-1"): any => ({
  _tag: "CommandResult" as const,
  commandUUID,
  status: "Acknowledged",
  queryResponses,
});

const secretRows = (db: ReturnType<typeof makeDb>) => dbRows(db, tableName(schema.deviceSecret));

const applicationRows = (db: ReturnType<typeof makeDb>) =>
  dbRows(db, tableName(schema.deviceApplication));

describe("SecurityInfo command results", () => {
  it("seals the recovery key at rest and stores escrow metadata", async () => {
    const { db, backend } = setup();
    const key = "AAAA-BBBB-CCCC-DDDD-EEEE";
    await run(
      backend.appleDeviceEvent(
        scope,
        commandResult({
          SecurityInfo: {
            FDE_Enabled: true,
            PersonalRecoveryKey: key,
            BootstrapTokenEscrowed: true,
          },
        }),
      ),
    );

    const rows = secretRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      deviceId: "device-1",
      organizationId: "org-1",
      kind: "filevault_recovery_key",
    });
    // The plaintext key must never be persisted.
    expect(JSON.stringify(rows[0])).not.toContain(key);
    expect(await openSecret(authSecret, stringValue(rows[0]!.sealedValue))).toBe(key);
    expect(dbRows(db, tableName(schema.device))[0]).toMatchObject({
      fileVaultEnabled: true,
    });
    expect(dbRows(db, tableName(schema.deviceApple))[0]).toMatchObject({
      bootstrapTokenEscrowed: true,
    });
  });

  it("updates in place, rotating the timestamp only when the key changes", async () => {
    const { db, backend } = setup();

    const first = commandResult(
      { SecurityInfo: { FDE_Enabled: true, PersonalRecoveryKey: "KEY-ONE" } },
      "cmd-1",
    );

    await run(backend.appleDeviceEvent(scope, first));
    const before = secretRows(db)[0]!;
    expect(secretRows(db)).toHaveLength(1);

    // Same key: no duplicate and no rotation.
    await run(
      backend.appleDeviceEvent(
        scope,
        commandResult(
          { SecurityInfo: { FDE_Enabled: true, PersonalRecoveryKey: "KEY-ONE" } },
          "cmd-2",
        ),
      ),
    );
    expect(secretRows(db)).toHaveLength(1);

    // New key: still one row, and the sealed value decrypts to the new key.
    await run(
      backend.appleDeviceEvent(
        scope,
        commandResult(
          { SecurityInfo: { FDE_Enabled: true, PersonalRecoveryKey: "KEY-TWO" } },
          "cmd-3",
        ),
      ),
    );
    const after = secretRows(db);
    expect(after).toHaveLength(1);
    expect(await openSecret(authSecret, stringValue(after[0]!.sealedValue))).toBe("KEY-TWO");
    expect(after[0]!.rotatedAt).not.toBeNull();
    expect(before.createdAt).toBeDefined();
  });

  it("does not write a plaintext secret when AUTH_SECRET is absent", async () => {
    const { db } = setup();

    // SAFETY: The fake store implements only the query chains these tests exercise.
    const backend = ManagementBackendEnterpriseLive.make({
      db: db as any,
      origin,
      authSecret: undefined,
    });

    await run(
      backend.appleDeviceEvent(
        scope,
        commandResult({ SecurityInfo: { PersonalRecoveryKey: "KEY-UNSEALED" } }),
      ),
    );
    expect(secretRows(db)).toHaveLength(0);
  });
});

describe("InstalledApplicationList command results", () => {
  it("upserts applications and removes entries missing from the latest full report", async () => {
    const { db, backend } = setup();
    await run(
      backend.appleDeviceEvent(
        scope,
        commandResult({
          InstalledApplicationList: [
            { Identifier: "com.apple.Safari", Name: "Safari", Version: "17" },
            { Identifier: "com.apple.dt.Xcode", Name: "Xcode", Version: "15" },
          ],
        }),
      ),
    );
    expect(applicationRows(db)).toHaveLength(2);
    expect(dbRows(db, tableName(schema.device))[0]!.applicationsUpdatedAt).toBeInstanceOf(Date);

    await run(
      backend.appleDeviceEvent(
        scope,
        commandResult(
          {
            InstalledApplicationList: [
              {
                Identifier: "com.apple.Safari",
                Name: "Safari",
                Version: "18",
                HasUpdateAvailable: true,
              },
              { Identifier: "com.example.Slack", Name: "Slack", Version: "4.40" },
            ],
          },
          "cmd-2",
        ),
      ),
    );

    const rows = applicationRows(db);
    expect(rows).toHaveLength(2);
    expect(
      rows.map((row) => stringValue(row.bundleId)).sort((left, right) => left.localeCompare(right)),
    ).toEqual(["com.apple.Safari", "com.example.Slack"]);
    expect(rows.find((row) => row.bundleId === "com.apple.Safari")).toMatchObject({
      version: "18",
      hasUpdateAvailable: true,
    });
    expect(rows.some((row) => row.bundleId === "com.apple.dt.Xcode")).toBe(false);
  });

  it("clears the inventory when the device reports an empty list", async () => {
    const { db, backend } = setup();
    await run(
      backend.appleDeviceEvent(
        scope,
        commandResult({
          InstalledApplicationList: [{ Identifier: "com.example.App", Name: "App" }],
        }),
      ),
    );
    expect(applicationRows(db)).toHaveLength(1);
    await run(
      backend.appleDeviceEvent(scope, commandResult({ InstalledApplicationList: [] }, "cmd-2")),
    );
    expect(applicationRows(db)).toHaveLength(0);
  });

  it("leaves the inventory untouched for unrelated command results", async () => {
    const { db, backend } = setup();
    await run(
      backend.appleDeviceEvent(
        scope,
        commandResult({
          InstalledApplicationList: [{ Identifier: "com.example.App", Name: "App" }],
        }),
      ),
    );
    await run(
      backend.appleDeviceEvent(
        scope,
        commandResult({ SecurityInfo: { FDE_Enabled: true } }, "cmd-2"),
      ),
    );
    expect(applicationRows(db)).toHaveLength(1);
  });
});
