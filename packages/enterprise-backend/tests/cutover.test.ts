import { Schema } from "effect";
import type { Effect } from "effect";
import { beforeAll, describe, expect, it } from "vitest";
import { decodeCutoverArchive, encodeCutoverArchive } from "@mattrax/enterprise-domain";
import type { CutoverPayload } from "@mattrax/enterprise-domain";
import { generateScepCa, openCaPrivateKey, sealCaPrivateKey } from "@mattrax/scep";
import { openSecret, sealSecret } from "@mattrax/crypto";
import type { EnterpriseOrganization } from "../src/schema.ts";
import { buildTenantCutover, preflightTenantOriginSwitch } from "../src/Tenant/cutover.ts";
import { importTenantCutover, previewTenantCutover } from "../src/Tenant/cutoverImport.ts";
import { makeDb, makeOrganization, runEffect } from "./helpers.js";

const passphrase = "correct horse battery staple";

const sourceSecret = "source-auth-secret";

const targetSecret = "target-auth-secret";

const sourceOrigin = "https://mdm.example.com";

const targetOrigin = "https://new.example.com";

const iterations = 10_000;

const at = new Date("2026-01-01T00:00:00.000Z");

const now = new Date("2026-11-20T00:00:00.000Z");

type Db = ReturnType<typeof makeDb>;

const organization = (input: { id: string; slug: string; name?: string }): EnterpriseOrganization =>
  makeOrganization({ ...input, name: input.name ?? "Acme", createdAt: at, updatedAt: at });

const addAccount = (db: Db, id: string, email: string) => {
  db.store.account.push({
    id,
    name: email.split("@")[0],
    email,
    emailVerified: true,
    image: null,
    createdAt: at,
    updatedAt: at,
  });

  return { id, email };
};

const seedOrganization = (db: Db, org: EnterpriseOrganization) => {
  db.store.organization.push({ ...org });
  db.store.enterprise_enrollment.push({
    id: org.id,
    organizationId: org.id,
    code: "enroll-acme",
    enabledApple: true,
    enabledWindows: true,
    enabledAndroid: false,
    enabledAssetTag: false,
    maxDevices: 100,
    createdAt: at,
    updatedAt: at,
  });
  db.store.enterprise_group.push({
    id: "gr_group-1",
    organizationId: org.id,
    name: "Staff",
    notes: null,
    kind: "manual",
    rules: null,
    directoryGroupId: null,
    createdAt: at,
    updatedAt: at,
  });
  db.store.policy.push({
    id: "pl_policy-1",
    organizationId: org.id,
    name: "Baseline",
    notes: null,
    enabled: true,
    createdAt: at,
    updatedAt: at,
  });
  db.store.group_policy.push({ groupId: "gr_group-1", policyId: "pl_policy-1" });
};

const buildSourceFixture = async () => {
  const db = makeDb();
  const org = organization({ id: "tn_org-source", slug: "acme" });
  seedOrganization(db, org);
  const owner = addAccount(db, "account-owner", "owner@example.com");
  db.store.member.push({
    id: "mb_member-owner",
    organizationId: org.id,
    accountId: owner.id,
    role: "owner",
    customRoleId: null,
    onboardingDismissedAt: null,
    createdAt: at,
    updatedAt: at,
  });

  db.store.device.push({
    id: "dv_device-1",
    organizationId: org.id,
    proto: "apple",
    status: "enrolled",
    name: "Reception Mac",
    model: "Mac14,2",
    modelIdentifier: null,
    serial: "C02TEST",
    enrolledAt: at,
    lastSeenAt: at,
    notes: null,
    assetTag: "AST-1",
    physicalName: "Reception Mac",
    vendor: "Apple",
    osEdition: null,
    osVersion: "15.1",
    osBuild: null,
    dmIdentifier: "00008030-000000000000000E",
    dmCertHash: "cert-hash",
    dmIdentityFingerprint: "fingerprint-1",
    capabilities: null,
  });
  db.store.device_apple.push({
    deviceId: "dv_device-1",
    enrollmentId: null,
    enrollmentMode: "device",
    token: "PUSH-TOKEN",
    pushMagic: "PUSH-MAGIC",
    topic: "com.apple.mgmt.External.acme",
    unlockToken: "UNLOCK",
    bootstrapToken: "BOOTSTRAP",
    bootstrapTokenEscrowed: true,
    awaitingConfiguration: false,
    configured: true,
    declarationMode: "ddm",
    tokenUpdatedAt: at,
  });
  db.store.group_device.push({ groupId: "gr_group-1", deviceId: "dv_device-1", source: "manual" });
  db.store.device_policy.push({ deviceId: "dv_device-1", policyId: "pl_policy-1", mode: "include" });

  const sealedRecovery = await sealSecret(sourceSecret, "RECOVERY-KEY");
  db.store.device_secret.push({
    deviceId: "dv_device-1",
    organizationId: org.id,
    kind: "filevault_recovery_key",
    sealedValue: sealedRecovery,
    format: "plaintext",
    createdAt: at,
    updatedAt: at,
    rotatedAt: null,
  });

  const sealedEscrow = await sealSecret(sourceSecret, "ESCROW-PRIVATE-KEY");
  db.store.apple_fde_escrow_key.push({
    organizationId: org.id,
    certificatePem: "ESCROW CERT",
    sealedPrivateKey: sealedEscrow,
    certificateFingerprintSha256: "e".repeat(64),
    subject: "FileVault Escrow",
    certificateNotAfter: new Date("2030-01-01T00:00:00.000Z"),
    source: "generated",
    createdAt: at,
    updatedAt: at,
  });

  const ca = await runEffect(generateScepCa(org.id, { now: at }));
  const sealedCa = await sealCaPrivateKey(sourceSecret, ca.privateKeyJwk);
  db.store.scep_ca.push({
    id: 1,
    organizationId: org.id,
    certPem: ca.certPem,
    privateKeyJwk: sealedCa,
    source: "generated",
    createdAt: at,
    rotatedAt: null,
  });
  db.store.scep_issued_certificate.push({
    serial: "cert-serial-1",
    organizationId: org.id,
    enrollmentId: org.id,
    deviceId: "dv_device-1",
    caFingerprintSha256: "a".repeat(64),
    notAfter: new Date("2027-01-01T00:00:00.000Z"),
    revokedAt: null,
    createdAt: at,
  });

  db.store.invitation.push({
    id: "iv_invitation-1",
    organizationId: org.id,
    inviterId: owner.id,
    email: "newstarter@example.com",
    role: "member",
    customRoleId: null,
    status: "pending",
    tokenHash: "HASHED-TOKEN",
    expiresAt: new Date("2026-12-01T00:00:00.000Z"),
    lastSentAt: at,
    sendCount: 1,
    acceptedAt: null,
    createdAt: at,
    updatedAt: at,
  });

  db.store.audit_log.push({
    id: "au_audit-1",
    organizationId: org.id,
    actorAccountId: owner.id,
    actorEmail: owner.email,
    actorType: "account",
    category: "mdm",
    action: "device.enrolled",
    targetType: "device",
    targetId: "dv_device-1",
    metadata: { note: "first" },
    createdAt: at,
  });

  db.store.apple_push_certificate.push({
    organizationId: org.id,
    email: "apns@example.com",
    topic: "com.apple.mgmt.External.acme",
    certPem: "APNS CERT",
    encryptedKey: "APNS KEY",
    updatedAt: at,
  });

  const archive = await runEffect(
    buildTenantCutover(db, org, {
      passphrase,
      origin: sourceOrigin,
      deploymentId: "dep_dp_source",
      authSecret: sourceSecret,
      sections: { audit: true },
      now,
      iterations,
    }),
  );

  return { db, org, owner, ca, archive };
};

// Building the source CA and encrypting the archive is the expensive part of
// every test here. None of the tests mutate it: they read the archive and CA,
// and the one that needs a writable source gets its own shallow copy of the
// rows. Share the built fixture across the file and vary only the DB.
let sourceFixture: Awaited<ReturnType<typeof buildSourceFixture>>;
type TargetFixture = {
  ca: Effect.Success<ReturnType<typeof generateScepCa>>;
  sealed: Awaited<ReturnType<typeof sealCaPrivateKey>>;
  replacingCa: Effect.Success<ReturnType<typeof generateScepCa>>;
  replacingSealed: Awaited<ReturnType<typeof sealCaPrivateKey>>;
};
let targetFixture: TargetFixture;

beforeAll(async () => {
  sourceFixture = await buildSourceFixture();
  const ca = await runEffect(generateScepCa("org-target", { now: at }));
  const replacingCa = await runEffect(generateScepCa("org-replacing", { now: at }));

  targetFixture = {
    ca,
    sealed: await sealCaPrivateKey(targetSecret, ca.privateKeyJwk),
    replacingCa,
    replacingSealed: await sealCaPrivateKey(targetSecret, replacingCa.privateKeyJwk),
  };
});

const buildSource = async () => ({
  ...sourceFixture,
  db: makeDb(sourceFixture.db.store),
});

const seedConflictingTarget = () => {
  const target = makeTarget();
  const org = seedTargetTenant(target);

  target.store.device.push({
    id: "dv_other-device",
    organizationId: org.id,
    proto: "apple",
    status: "enrolled",
    name: "Existing",
    serial: "C02TEST",
    enrolledAt: at,
    lastSeenAt: at,
  });

  return { target, org };
};

const seedTargetCa = (
  db: Db,
  org: EnterpriseOrganization,
  ca: TargetFixture["ca"],
  sealed: TargetFixture["sealed"],
) => {
  db.store.scep_ca.push({
    id: 1,
    organizationId: org.id,
    certPem: ca.certPem,
    privateKeyJwk: sealed,
    source: "generated",
    createdAt: at,
    rotatedAt: null,
  });
};

const actor = { accountId: "ac_account-target", email: "target@example.com" };

const makeTarget = () => {
  const db = makeDb();
  addAccount(db, actor.accountId, actor.email);

  return db;
};

const seedTargetTenant = (db: Db) => {
  const org = organization({ id: "tn_org-target", slug: "acme-target", name: "Target" });
  seedOrganization(db, org);
  db.store.member.push({
    id: "mb_member-target",
    organizationId: org.id,
    accountId: actor.accountId,
    role: "owner",
    customRoleId: null,
    onboardingDismissedAt: null,
    createdAt: at,
    updatedAt: at,
  });

  return org;
};

describe("cutover export", () => {
  it("omits members from the configuration when the section is off", async () => {
    const { db, org } = await buildSource();

    const archive = await runEffect(
      buildTenantCutover(db, org, {
        passphrase,
        origin: sourceOrigin,
        deploymentId: "dep_dp_source",
        authSecret: sourceSecret,
        sections: { members: false },
        now,
        iterations,
      }),
    );

    const decoded = await decodeCutoverArchive({ archive: archive.body, passphrase });

    expect(decoded.payload.members).toBeUndefined();
    expect(decoded.payload.configuration?.members).toEqual([]);
  });

  it("encrypts device credentials, the CA and escrow key", async () => {
    const { archive } = await buildSource();

    expect(archive.body).not.toContain("PUSH-TOKEN");
    expect(archive.body).not.toContain("RECOVERY-KEY");
    expect(archive.body).not.toContain("ESCROW-PRIVATE-KEY");
    expect(archive.body).not.toContain("CA-KEY");
    expect(archive.counts.devices).toBe(1);
    expect(archive.counts.deviceSecrets).toBe(1);
    expect(archive.sections).toContain("scepCa");
    expect(archive.needsReissue.map((item) => item.kind)).toContain("apns");
  });
});

describe("cutover import", () => {
  it("re-links a member whose account already exists on the target", async () => {
    const source = await buildSource();
    const target = makeTarget();
    addAccount(target, "account-existing", "owner@example.com");

    const result = await runEffect(
      importTenantCutover(target, {
        archive: source.archive.body,
        passphrase,
        confirm: "acme",
        target: { kind: "new" },
        actor,
        targetDeploymentId: "dep_dp_target",
        targetOrigin,
        authSecret: targetSecret,
        allowCrossDeployment: true,
        now,
      }),
    );

    const member = target.store.member.find(
      (row) => row.organizationId === result.tenantId && row.accountId === "account-existing",
    );

    expect(result.imported.members).toBe(1);
    expect(member?.role).toBe("owner");
  });

  it("restores devices, credentials, the CA, members and audit history", async () => {
    const source = await buildSource();
    const target = makeTarget();

    const result = await runEffect(
      importTenantCutover(target, {
        archive: source.archive.body,
        passphrase,
        confirm: "acme",
        target: { kind: "new" },
        actor,
        targetDeploymentId: "dep_dp_target",
        targetOrigin,
        authSecret: targetSecret,
        allowCrossDeployment: true,
        now,
      }),
    );

    expect(result.mode).toBe("new");
    expect(result.slug).toBe("acme");
    expect(result.imported.devices).toBe(1);
    expect(result.imported.certificates).toBe(1);
    expect(result.imported.auditEntries).toBe(1);

    const device = target.store.device.find((row) => row.id === "dv_device-1");
    expect(device).toMatchObject({
      organizationId: result.tenantId,
      serial: "C02TEST",
      dmIdentifier: "00008030-000000000000000E",
      status: "enrolled",
    });

    const apple = target.store.device_apple.find((row) => row.deviceId === "dv_device-1");
    expect(apple).toMatchObject({ token: "PUSH-TOKEN", pushMagic: "PUSH-MAGIC" });

    const secret = target.store.device_secret.find((row) => row.deviceId === "dv_device-1");
    expect(await openSecret(targetSecret, String(secret?.sealedValue))).toBe("RECOVERY-KEY");

    const escrow = target.store.apple_fde_escrow_key.find(
      (row) => row.organizationId === result.tenantId,
    );

    expect(await openSecret(targetSecret, String(escrow?.sealedPrivateKey))).toBe(
      "ESCROW-PRIVATE-KEY",
    );

    const ca = target.store.scep_ca.find((row) => row.organizationId === result.tenantId);
    expect(ca?.certPem).toBe(source.ca.certPem);
    expect(
      await openCaPrivateKey(
        Schema.decodeUnknownSync(Schema.Json)(ca?.privateKeyJwk),
        targetSecret,
      ).then((value) => value.privateKeyJwk.kty),
    ).toBe("RSA");

    const certificate = target.store.scep_issued_certificate.find(
      (row) => row.organizationId === result.tenantId,
    );

    expect(certificate).toMatchObject({
      serial: "cert-serial-1",
      deviceId: "dv_device-1",
      enrollmentId: result.tenantId,
    });

    // The group was recreated with a new id; membership must point at it.
    const group = target.store.enterprise_group.find(
      (row) => row.organizationId === result.tenantId,
    );

    expect(group).toBeTruthy();
    expect(
      target.store.group_device.some(
        (row) => row.groupId === group?.id && row.deviceId === "dv_device-1",
      ),
    ).toBe(true);

    // The source owner has no account here, so they become an invitation; the
    // source's pending invitation is carried over without its token.
    expect(result.imported.invitations).toBe(2);
    expect(
      target.store.invitation.some(
        (row) => row.organizationId === result.tenantId && row.email === "owner@example.com",
      ),
    ).toBe(true);
    expect(
      target.store.invitation.some(
        (row) => row.organizationId === result.tenantId && row.email === "newstarter@example.com",
      ),
    ).toBe(true);
    // Invitation bearer tokens are never carried across.
    expect(
      target.store.invitation.every((row) => row.tokenHash === null || row.tokenHash === undefined),
    ).toBe(true);

    expect(
      target.store.audit_log.some(
        (row) => row.organizationId === result.tenantId && row.action === "device.enrolled",
      ),
    ).toBe(true);
    expect(
      target.store.audit_log.some(
        (row) => row.organizationId === result.tenantId && row.action === "tenant.cutover_imported",
      ),
    ).toBe(true);

    expect(result.needsReissue.map((item) => item.kind)).toEqual(
      expect.arrayContaining(["apns", "invitation"]),
    );
  });

  it("strips foreign application keys and redacts imported audit metadata", async () => {
    const source = await buildSource();
    const decoded = await decodeCutoverArchive({
      archive: source.archive.body,
      passphrase,
    });

    const foreignKey = "a/org-victim/app-1/sha";
    const configuration = decoded.payload.configuration!;
    const auditEntry = decoded.payload.audit![0]!;

    const crafted: CutoverPayload = {
      ...decoded.payload,
      configuration: {
        ...configuration,
        applications: [
          {
            key: "app-foreign",
            name: "Foreign",
            platform: "apple",
            source: "upload",
            bundleId: null,
            version: null,
            manifestUrl: null,
            storeId: null,
            fileName: "Foreign.pkg",
            contentType: "application/octet-stream",
            size: 12,
            sha256: "a".repeat(64),
            r2Key: foreignKey,
            notes: null,
            groupKeys: [],
            userGroupIds: [],
            installers: [
              {
                platform: "apple",
                source: "upload",
                bundleId: null,
                version: null,
                manifestUrl: null,
                storeId: null,
                fileName: "Foreign.pkg",
                contentType: "application/octet-stream",
                size: 12,
                sha256: "a".repeat(64),
                r2Key: foreignKey,
                minOsVersion: null,
                requiredCapability: null,
                priority: 0,
              },
            ],
          },
        ],
      },
      audit: [
        {
          ...auditEntry,
          metadata: {
            note: "first",
            key: "backups/org-victim/run.json",
            r2Key: foreignKey,
          },
        },
      ],
    };

    const encoded = await encodeCutoverArchive({
      payload: crafted,
      passphrase,
      iterations,
    });

    const target = makeTarget();
    const result = await runEffect(
      importTenantCutover(target, {
        archive: encoded.archive,
        passphrase,
        confirm: "acme",
        target: { kind: "new" },
        actor,
        targetDeploymentId: "dep_dp_source",
        targetOrigin: sourceOrigin,
        authSecret: targetSecret,
        now,
      }),
    );

    const application = target.store.application.find(
      (row) => row.organizationId === result.tenantId,
    );
    const installer = target.store.application_installer.find(
      (row) => row.organizationId === result.tenantId,
    );

    expect(application?.r2Key ?? null).toBeNull();
    expect(installer?.r2Key ?? null).toBeNull();
    expect(result.needsReissue.map((item) => item.kind)).toContain("application_files");

    const importedAudit = target.store.audit_log.find(
      (row) => row.organizationId === result.tenantId && row.action === "device.enrolled",
    );

    expect(importedAudit?.metadata).toMatchObject({
      key: "[redacted]",
      r2Key: "[redacted]",
    });
    expect(JSON.stringify(importedAudit?.metadata)).not.toContain("org-victim");
  });

  it("requires an explicit cross-deployment acknowledgement", async () => {
    const source = await buildSource();
    const target = makeTarget();

    await expect(
      runEffect(
        importTenantCutover(target, {
          archive: source.archive.body,
          passphrase,
          confirm: "acme",
          target: { kind: "new" },
          actor,
          targetDeploymentId: "dep_dp_other",
          targetOrigin,
          authSecret: targetSecret,
          now,
        }),
      ),
    ).rejects.toMatchObject({ reason: "conflict" });
  });

  it("rejects a wrong passphrase without writing", async () => {
    const source = await buildSource();
    const target = makeTarget();
    const before = target.store.organization.length;

    await expect(
      runEffect(
        importTenantCutover(target, {
          archive: source.archive.body,
          passphrase: "wrong passphrase",
          confirm: "acme",
          target: { kind: "new" },
          actor,
          targetDeploymentId: "dep_dp_source",
          targetOrigin,
          authSecret: targetSecret,
          now,
        }),
      ),
    ).rejects.toMatchObject({ reason: "invalid" });

    expect(target.store.organization.length).toBe(before);
  });

  it("rejects a wrong confirmation without writing", async () => {
    const source = await buildSource();
    const target = makeTarget();
    const before = target.store.organization.length;

    await expect(
      runEffect(
        importTenantCutover(target, {
          archive: source.archive.body,
          passphrase,
          confirm: "not-acme",
          target: { kind: "new" },
          actor,
          targetDeploymentId: "dep_dp_source",
          targetOrigin,
          authSecret: targetSecret,
          now,
        }),
      ),
    ).rejects.toMatchObject({ reason: "invalid" });

    expect(target.store.organization.length).toBe(before);
  });

  it("previews conflicts without writing", async () => {
    const source = await buildSource();
    const target = makeTarget();
    const org = seedTargetTenant(target);
    target.store.device.push({
      id: "dv_other-device",
      organizationId: org.id,
      proto: "apple",
      status: "enrolled",
      name: "Existing",
      serial: "C02TEST",
      enrolledAt: at,
      lastSeenAt: at,
    });

    const before = target.store.device.length;

    const preview = await runEffect(
      previewTenantCutover(target, {
        archive: source.archive.body,
        passphrase,
        target: { kind: "existing", organization: org },
        targetDeploymentId: "dep_dp_source",
        targetOrigin,
      }),
    );

    expect(preview.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "device_serial" }),
        expect.objectContaining({ kind: "configuration" }),
      ]),
    );
    expect(preview.requirements.replaceConfiguration).toBe(true);
    expect(target.store.device.length).toBe(before);
    expect(target.store.organization.some((row) => row.id === "imported")).toBe(false);
  });

  it("fails on a duplicate serial by default", async () => {
    const source = await buildSource();
    const { target, org } = seedConflictingTarget();

    await expect(
      runEffect(
        importTenantCutover(target, {
          archive: source.archive.body,
          passphrase,
          confirm: "acme",
          target: { kind: "existing", organization: org },
          actor,
          targetDeploymentId: "dep_dp_source",
          targetOrigin,
          authSecret: targetSecret,
          replaceConfiguration: true,
          now,
        }),
      ),
    ).rejects.toMatchObject({ reason: "conflict" });
  });

  it("skips a duplicate serial on request", async () => {
    const source = await buildSource();
    const { target, org } = seedConflictingTarget();

    const result = await runEffect(
      importTenantCutover(target, {
        archive: source.archive.body,
        passphrase,
        confirm: "acme",
        target: { kind: "existing", organization: org },
        actor,
        targetDeploymentId: "dep_dp_source",
        targetOrigin,
        authSecret: targetSecret,
        replaceConfiguration: true,
        deviceConflicts: "skip",
        now,
      }),
    );

    expect(result.skipped.devices).toBe(1);
    expect(target.store.device.find((row) => row.id === "dv_other-device")).toBeTruthy();
  });

  it("keeps the target CA as a trust anchor", async () => {
    const source = await buildSource();
    const target = makeTarget();
    const org = seedTargetTenant(target);
    const { ca: targetCa, sealed } = targetFixture;
    seedTargetCa(target, org, targetCa, sealed);

    await runEffect(
      importTenantCutover(target, {
        archive: source.archive.body,
        passphrase,
        confirm: "acme",
        target: { kind: "existing", organization: org },
        actor,
        targetDeploymentId: "dep_dp_source",
        targetOrigin,
        authSecret: targetSecret,
        replaceConfiguration: true,
        now,
      }),
    );

    const current = target.store.scep_ca.find((row) => row.organizationId === org.id);
    expect(current?.certPem).toBe(targetCa.certPem);
    expect(
      target.store.scep_ca_trust.some(
        (row) => row.organizationId === org.id && row.certPem === source.ca.certPem,
      ),
    ).toBe(true);
  });

  it("replaces the target CA when requested", async () => {
    const source = await buildSource();
    const target = makeTarget();
    const org = seedTargetTenant(target);
    const { ca: replacingCa, replacingSealed } = targetFixture;
    seedTargetCa(target, org, replacingCa, replacingSealed);

    await runEffect(
      importTenantCutover(target, {
        archive: source.archive.body,
        passphrase,
        confirm: "acme",
        target: { kind: "existing", organization: org },
        actor,
        targetDeploymentId: "dep_dp_source",
        targetOrigin,
        authSecret: targetSecret,
        replaceConfiguration: true,
        replaceScepCa: true,
        now,
      }),
    );

    expect(target.store.scep_ca.find((row) => row.organizationId === org.id)?.certPem).toBe(
      source.ca.certPem,
    );
    expect(
      target.store.scep_ca_trust.some(
        (row) => row.organizationId === org.id && row.certPem === replacingCa.certPem,
      ),
    ).toBe(true);
  });
});

describe("cutover preflight", () => {
  it("marks a hostname change as a blocker and counts affected links", async () => {
    const { db, org } = await buildSource();

    db.store.vpp_token.push({
      organizationId: org.id,
      appleOrgId: "vpp",
      token: "VPP",
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      createdAt: at,
      updatedAt: at,
    });

    const report = await runEffect(
      preflightTenantOriginSwitch(db, org, {
        currentOrigin: sourceOrigin,
        targetOrigin,
        deploymentId: "dep_dp_source",
      }),
    );

    expect(report.hostnameChanged).toBe(true);
    expect(report.items.find((item) => item.id === "origin")?.severity).toBe("blocker");
    expect(report.items.find((item) => item.id === "scep_profile_urls")?.affected).toBe(1);
    expect(report.items.find((item) => item.id === "integrations")?.affected).toBeGreaterThan(0);
    expect(report.steps.map((step) => step.id)).toEqual([
      "preflight",
      "freeze",
      "export",
      "switch",
      "import",
      "verify",
      "unfreeze",
    ]);
  });

  it("is green when the hostname does not change", async () => {
    const { db, org } = await buildSource();

    const report = await runEffect(
      preflightTenantOriginSwitch(db, org, {
        currentOrigin: sourceOrigin,
        targetOrigin: "https://mdm.example.com/",
        deploymentId: "dep_dp_source",
      }),
    );

    expect(report.hostnameChanged).toBe(false);
    expect(report.items.find((item) => item.id === "origin")?.severity).toBe("ok");
    expect(report.items.find((item) => item.id === "scep_profile_urls")?.severity).toBe("info");
  });
});
