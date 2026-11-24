import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { schema } from "@mattrax/enterprise-core";
import { sealSecret } from "@mattrax/crypto";
import { appleAssetTokenExpiresAt, signAppleAssetToken } from "@mattrax/dm-apple";
import { ManagementBackendEnterpriseLive } from "@mattrax/mdm-apple";
import { configurationAssetIdentifier } from "@mattrax/mdm-core";
import { makeDb, tableName } from "./fake-db.js";
import type { Store } from "./fake-db.js";

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
    [tableName(schema.policy)]: [
      { id: policyId, organizationId: "org-1", name: "Policy", enabled: true },
    ],
    [tableName(schema.configuration)]: [
      {
        id: "configuration-1",
        policyId,
        kind,
        data: { pem },
        hash: "certificate-hash",
      },
      {
        id: "configuration-2",
        policyId,
        kind: "mttx.apple.device",
        data: { camera: false },
        hash: "device-hash",
      },
    ],
    [tableName(schema.device)]: [
      device("device-enrolled", "org-1", "enrolled"),
      device("device-unassigned", "org-1", "enrolled"),
      device("device-unenrolled", "org-1", "unenrolled"),
      device("device-foreign", "org-2", "enrolled"),
    ],
    [tableName(schema.devicePolicy)]: [
      { deviceId: "device-enrolled", policyId, mode: "include" },
    ],
    [tableName(schema.policyCertificateMaterial)]: [],
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

const tokenFor = (deviceId: string, at = Date.now(), assetKind = kind) =>
  signAppleAssetToken(authSecret, {
    policyId,
    kind: assetKind,
    deviceId,
    expiresAt: appleAssetTokenExpiresAt(at),
  });

const identityKind = "mttx.apple.pfx.smime";
const identityIdentifier = configurationAssetIdentifier(policyId, identityKind);

const setupIdentity = async () => {
  const context = setup();

  context.db.store[tableName(schema.configuration)].push({
    __table: tableName(schema.configuration),
    id: "configuration-identity",
    policyId,
    kind: identityKind,
    data: {
      materialSha256: "a".repeat(64),
      certificatePem: pem,
      subject: "person@example.com",
      notAfter: "2027-01-01T00:00:00.000Z",
      fingerprintSha256: "b".repeat(64),
    },
    hash: "identity-hash",
  });
  context.db.store[tableName(schema.policyCertificateMaterial)] ??= [];
  context.db.store[tableName(schema.policyCertificateMaterial)].push({
    __table: tableName(schema.policyCertificateMaterial),
    kind: identityKind,
    policyId,
    organizationId: "org-1",
    sealedPfx: await sealSecret(authSecret, Buffer.from("pkcs12").toString("base64")),
    sealedPassword: await sealSecret(authSecret, "pfx-secret"),
    fileName: "person.pfx",
    certificatePem: pem,
    subject: "person@example.com",
    notAfter: new Date("2027-01-01T00:00:00.000Z"),
    fingerprintSha256: "b".repeat(64),
    materialSha256: "a".repeat(64),
    createdAt: now,
    updatedAt: now,
  });
  return context;
};

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

  it("never serves a private identity to a tenant mTLS certificate alone", async () => {
    const { backend } = await setupIdentity();

    await expect(
      run(backend.getAppleAsset("CN=Device,OU=org-1", identityIdentifier, undefined)),
    ).resolves.toBeNull();
  });

  it("requires the identity token to belong to an assigned, enrolled device", async () => {
    const { backend } = await setupIdentity();
    const assigned = await tokenFor("device-enrolled", Date.now(), identityKind);
    const unassigned = await tokenFor("device-unassigned", Date.now(), identityKind);
    const foreign = await tokenFor("device-foreign", Date.now(), identityKind);

    await expect(run(backend.getAppleAsset(undefined, identityIdentifier, assigned))).resolves.toMatchObject({
      contentType: "application/json",
    });
    await expect(run(backend.getAppleAsset(undefined, identityIdentifier, unassigned))).resolves.toBeNull();
    await expect(run(backend.getAppleAsset(undefined, identityIdentifier, foreign))).resolves.toBeNull();
  });

  it("rejects an expired identity token", async () => {
    const { backend } = await setupIdentity();
    const expired = await tokenFor(
      "device-enrolled",
      Date.now() - 2 * 60 * 60 * 1000,
      identityKind,
    );

    await expect(run(backend.getAppleAsset(undefined, identityIdentifier, expired))).resolves.toBeNull();
  });

  it("stops serving signed assets and profiles once the policy is disabled", async () => {
    const { db, backend } = setup();
    const token = await tokenFor("device-enrolled");
    // SAFETY: the enterprise backend always implements the Apple profile route.
    const getProfile = backend.getAppleProfile!;

    await expect(run(backend.getAppleAsset(undefined, identifier, token))).resolves.toMatchObject({
      contentType: "application/pem",
    });
    await expect(
      run(getProfile(policyId, "mttx.apple.device", "device-enrolled")),
    ).resolves.toMatchObject({ contentType: "application/x-apple-aspen-config" });

    // The signed URL stays well-formed and the device stays enrolled; only
    // the policy's enabled state withdraws the content.
    db.store[tableName(schema.policy)][0].enabled = false;

    await expect(run(backend.getAppleAsset(undefined, identifier, token))).resolves.toBeNull();
    await expect(
      run(getProfile(policyId, "mttx.apple.device", "device-enrolled")),
    ).resolves.toBeNull();
  });
});
