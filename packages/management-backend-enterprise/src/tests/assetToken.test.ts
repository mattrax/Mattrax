import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { schema } from "@mattrax/enterprise-core";
import { appleAssetTokenExpiresAt, signAppleAssetToken } from "@mattrax/dm-apple";
import { ManagementBackendEnterpriseLive } from "../index.js";
import { configurationAssetIdentifier } from "../policy.js";
import { makeDb, tableName, type Store } from "./fake-db.js";

const origin = "https://enterprise.test";

const authSecret = "asset-token-test-secret";

const now = new Date("2026-11-15T10:00:00.000Z");

const policyId = "policy-1";

const kind = "mttx.apple.certificate.root";

const identifier = configurationAssetIdentifier(policyId, kind);

const pem = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";

const device = (id: string, organizationId: string, status: string) => ({
  id,
  organizationId,
  proto: "apple",
  status,
  name: id,
  dmIdentifier: `udid-${id}`,
  enrolledAt: now,
  lastSeenAt: now,
});

const setup = () => {
  const initial: Store = {
    [tableName(schema.organization)]: [
      { id: "org-1", name: "One", slug: "one", metadata: null },
      { id: "org-2", name: "Two", slug: "two", metadata: null },
    ],
    [tableName(schema.policy)]: [{ id: policyId, organizationId: "org-1", name: "Policy" }],
    [tableName(schema.configuration)]: [
      {
        id: "configuration-1",
        policyId,
        kind,
        data: { pem },
        hash: "certificate-hash",
      },
    ],
    [tableName(schema.device)]: [
      device("device-enrolled", "org-1", "enrolled"),
      device("device-unenrolled", "org-1", "unenrolled"),
      device("device-foreign", "org-2", "enrolled"),
    ],
    [tableName(schema.deviceApple)]: [
      { deviceId: "device-enrolled", deviceToken: "token-enrolled" },
      { deviceId: "device-unenrolled", deviceToken: "token-unenrolled" },
      { deviceId: "device-foreign", deviceToken: "token-foreign" },
    ],
  };

  const db = makeDb(initial);

  // SAFETY: The fake store implements only the query chains these tests exercise.
  const backend = ManagementBackendEnterpriseLive.make({ db: db as any, origin, authSecret });

  return { db, backend };
};

const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect);

const tokenFor = (deviceId: string, at = Date.now()) =>
  signAppleAssetToken(authSecret, {
    policyId,
    kind,
    deviceId,
    expiresAt: appleAssetTokenExpiresAt(at),
  });

describe("DDM asset URLs", () => {
  it("serves an asset to the device it was issued for", async () => {
    const { backend } = setup();
    const token = await tokenFor("device-enrolled");

    await expect(run(backend.getAppleAsset(undefined, identifier, token))).resolves.toMatchObject({
      contentType: "application/pem",
    });
  });

  it("rejects an asset token bound to another device", async () => {
    const { backend } = setup();
    const foreignToken = await tokenFor("device-foreign");

    // The policy belongs to org-1; the token's device belongs to org-2.
    await expect(
      run(backend.getAppleAsset(undefined, identifier, foreignToken)),
    ).resolves.toBeNull();
  });

  it("revokes a leaked link once the device is unenrolled", async () => {
    const { backend } = setup();
    const token = await tokenFor("device-unenrolled");

    await expect(run(backend.getAppleAsset(undefined, identifier, token))).resolves.toBeNull();
  });

  it("rejects an expired token", async () => {
    const { backend } = setup();
    const token = await tokenFor("device-enrolled", Date.now() - 2 * 60 * 60 * 1000);

    await expect(run(backend.getAppleAsset(undefined, identifier, token))).resolves.toBeNull();
  });

  it("rejects a token for a different policy or kind", async () => {
    const { backend } = setup();
    const token = await tokenFor("device-enrolled");

    await expect(
      run(backend.getAppleAsset(undefined, configurationAssetIdentifier("policy-2", kind), token)),
    ).resolves.toBeNull();
    await expect(
      run(
        backend.getAppleAsset(
          undefined,
          configurationAssetIdentifier(policyId, "mttx.apple.certificate.other"),
          token,
        ),
      ),
    ).resolves.toBeNull();
  });

  it("still accepts an mTLS identity certificate from the owning tenant", async () => {
    const { backend } = setup();

    await expect(
      run(backend.getAppleAsset("CN=Device,OU=org-1", identifier, undefined)),
    ).resolves.toMatchObject({ contentType: "application/pem" });
    await expect(
      run(backend.getAppleAsset("CN=Device,OU=org-2", identifier, undefined)),
    ).resolves.toBeNull();
  });
});
