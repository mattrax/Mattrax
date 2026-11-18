import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import type { R2Bucket } from "@mattrax/enterprise-core";
import type { BackupActionError } from "../src/Tenant/backup.ts";
import {
  parseTenantRestoreBundle,
  restoreTenantFromBackup,
  type TenantRestoreError,
} from "../src/Tenant/tenantRestore.ts";
import { buildTenantExport } from "../src/Tenant/tenantExport.ts";
import { makeDb, runEffect } from "./helpers.js";

const failureReason = (failure: BackupActionError | TenantRestoreError | null) => failure?.reason;

const startedAt = new Date("2026-10-01T00:00:00Z");

const bundle = {
  version: 1,
  exportedAt: startedAt.toISOString(),
  tenant: {
    name: "Acme Restored",
    slug: "acme",
    displayName: "Acme",
    brandColor: "#112233",
  },
  members: [],
  groups: [
    {
      key: "group-1",
      name: "All devices",
      policyKeys: ["policy-1"],
      devices: [{ key: "device-1", name: "Laptop", serial: "SERIAL-1" }],
    },
  ],
  policies: [{ key: "policy-1", name: "Baseline", configurations: {} }],
  applications: [],
  preRegistrations: [],
  scepCertificates: [],
  auditLog: [],
};

const makeStorage = (entries: Record<string, string> = {}) => {
  const objects = new Map(Object.entries(entries));

  const storage: R2Bucket = {
    put: async (key, value) => {
      objects.set(key, String(value));

      return { key, version: "1", size: 1, etag: "e", httpEtag: "e", uploaded: startedAt };
    },
    head: async () => null,
    get: async (key) => {
      const body = objects.get(key);

      if (body === undefined) return null;

      return {
        key,
        version: "1",
        size: body.length,
        etag: "e",
        httpEtag: "e",
        uploaded: startedAt,
        body: new ReadableStream(),
        bodyUsed: false,
        text: async () => body,
        arrayBuffer: async () => new TextEncoder().encode(body).buffer,
        json: async () => JSON.parse(body),
        blob: async () => new Blob([body]),
      };
    },
    delete: async (keys) => {
      for (const key of Schema.is(Schema.String)(keys) ? [keys] : keys) objects.delete(key);
    },
    list: async () => ({ objects: [], truncated: false, delimitedPrefixes: [] }),
  };

  return { storage, objects };
};

const makeContext = () => {
  const db = makeDb();
  const timestamp = new Date();

  const organization = {
    id: "org-1",
    name: "Acme",
    slug: "acme",
    logo: null,
    displayName: null,
    supportEmail: null,
    brandColor: null,
    metadata: null,
    stripeCustomerId: null,
    onboardingFollowUpSentAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  db.store.organization.push(organization);
  db.store.device.push({
    id: "device-1",
    organizationId: "org-1",
    proto: "apple",
    status: "enrolled",
    name: "Laptop",
    model: null,
    modelIdentifier: null,
    serial: "SERIAL-1",
    enrolledAt: timestamp,
    lastSeenAt: timestamp,
    notes: null,
    assetTag: null,
    physicalName: null,
    vendor: null,
    osEdition: null,
    osVersion: null,
    osBuild: null,
    diskTotal: null,
    diskUsed: null,
    fileVaultEnabled: null,
  });
  db.store.policy.push({
    id: "old-policy",
    organizationId: "org-1",
    name: "Old policy",
    notes: null,
    priority: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  db.store.enterprise_group.push({
    id: "old-group",
    organizationId: "org-1",
    name: "Old group",
    notes: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  db.store.backup_run.push({
    id: "run-1",
    organizationId: "org-1",
    status: "succeeded",
    r2Key: "backups/org-1/run-1.json",
    sizeBytes: 100,
    startedAt,
    completedAt: startedAt,
    error: null,
    trigger: "manual",
    retention: "default",
  });

  const { storage, objects } = makeStorage({
    "backups/org-1/run-1.json": JSON.stringify(bundle),
  });

  return { db, storage, objects, organization };
};

describe("in-place tenant restore", () => {
  it("replaces configuration, keeps devices, and takes a pinned pre-restore snapshot", async () => {
    const { db, storage, objects, organization } = makeContext();

    const result = await runEffect(
      restoreTenantFromBackup(db, storage, organization, {
        backupId: "run-1",
        actor: { accountId: "user-1", email: "owner@example.com" },
        confirm: "acme",
        now: new Date("2026-11-01T00:00:00Z"),
      }),
    );

    expect(result).toMatchObject({
      backupId: "run-1",
      counts: { groups: 1, policies: 1, devices: 1 },
      skipped: { devices: 0 },
    });

    // The snapshot is pinned so retention cannot remove the rollback point.
    const snapshot = db.store.backup_run.find(
      (run: { id: string }) => run.id === result.preRestoreBackupId,
    );

    expect(snapshot).toMatchObject({
      status: "succeeded",
      retention: "pinned",
    });
    expect([...objects.keys()].some((key) => key.startsWith("backups/org-1/"))).toBe(true);

    expect(db.store.policy.map((row: { name: string }) => row.name)).toEqual(["Baseline"]);
    expect(db.store.enterprise_group.map((row: { name: string }) => row.name)).toEqual([
      "All devices",
    ]);
    expect(db.store.group_policy).toHaveLength(1);
    expect(db.store.group_device).toMatchObject([{ deviceId: "device-1" }]);
    expect(db.store.organization[0]).toMatchObject({
      name: "Acme Restored",
      displayName: "Acme",
      brandColor: "#112233",
      // Restoring never renames the tenant URL.
      slug: "acme",
    });
    expect(db.store.audit_log.at(-1)).toMatchObject({
      action: "tenant.restored",
      targetType: "tenant",
    });
    expect(db.store.device).toHaveLength(1);
  });

  it("round-trips direct device policy and application assignments", async () => {
    const { db, storage, objects, organization } = makeContext();

    db.store.application.push({
      id: "app-1",
      organizationId: "org-1",
      name: "Slack",
      platform: "apple",
      bundleId: null,
      version: null,
      source: "store",
      manifestUrl: null,
      storeId: "803453959",
      fileName: null,
      contentType: null,
      size: null,
      sha256: null,
      r2Key: null,
      notes: null,
      createdAt: startedAt,
      updatedAt: startedAt,
    });

    // A direct exclusion and a direct app assignment. Neither is derived from
    // group membership, which is exactly what the restore used to drop.
    db.store.device_policy.push({ deviceId: "device-1", policyId: "old-policy", mode: "exclude" });
    db.store.application_device.push({ deviceId: "device-1", applicationId: "app-1" });

    const exported = await runEffect(
      buildTenantExport(db, organization, { now: new Date("2026-10-02T00:00:00Z") }),
    );

    expect(exported.bundle.deviceAssignments).toMatchObject([
      {
        deviceKey: "device-1",
        deviceSerial: "SERIAL-1",
        policyKeys: [],
        excludedPolicyKeys: ["old-policy"],
        applicationKeys: ["app-1"],
      },
    ]);

    objects.set("backups/org-1/run-2.json", exported.body);
    db.store.backup_run.push({
      id: "run-2",
      organizationId: "org-1",
      status: "succeeded",
      r2Key: "backups/org-1/run-2.json",
      sizeBytes: exported.body.length,
      startedAt,
      completedAt: startedAt,
      error: null,
      trigger: "manual",
      retention: "default",
    });

    const result = await runEffect(
      restoreTenantFromBackup(db, storage, organization, {
        backupId: "run-2",
        actor: { accountId: "user-1", email: "owner@example.com" },
        confirm: "acme",
        now: new Date("2026-11-02T00:00:00Z"),
      }),
    );

    expect(result.counts.deviceAssignments).toBe(2);
    expect(result.skipped.deviceAssignments).toBe(0);

    const policy = db.store.policy.find(
      (row: { organizationId: string }) => row.organizationId === "org-1",
    )!;

    const application = db.store.application.find(
      (row: { organizationId: string }) => row.organizationId === "org-1",
    )!;

    expect(db.store.device_policy).toEqual([
      { deviceId: "device-1", policyId: policy.id, mode: "exclude" },
    ]);
    expect(db.store.application_device).toEqual([
      { deviceId: "device-1", applicationId: application.id },
    ]);
    expect(db.store.audit_log.at(-1)).toMatchObject({
      action: "tenant.restored",
      metadata: { counts: { deviceAssignments: 2 } },
    });
  });

  it("skips a device assignment whose device no longer exists", async () => {
    const { db, storage, objects, organization } = makeContext();

    objects.set(
      "backups/org-1/run-1.json",
      JSON.stringify({
        ...bundle,
        deviceAssignments: [
          {
            deviceKey: "deleted-device",
            deviceSerial: "GONE-1",
            policyKeys: ["policy-1"],
            excludedPolicyKeys: [],
            applicationKeys: [],
          },
        ],
      }),
    );

    const result = await runEffect(
      restoreTenantFromBackup(db, storage, organization, {
        backupId: "run-1",
        actor: { accountId: "user-1", email: "owner@example.com" },
        confirm: "acme",
        now: new Date("2026-11-01T00:00:00Z"),
      }),
    );

    expect(result.counts.deviceAssignments).toBe(0);
    expect(result.skipped).toMatchObject({ deviceAssignments: 1 });
    expect(db.store.device_policy).toEqual([]);
    // The rest of the restore still applies.
    expect(db.store.policy.map((row: { name: string }) => row.name)).toEqual(["Baseline"]);
  });

  it("restores directory users and their policy assignments", async () => {
    const { db, storage, objects, organization } = makeContext();
    const withDirectoryUsers = {
      ...bundle,
      directoryUsers: [
        {
          email: "person@example.com",
          name: "Directory Person",
          externalId: "scim-person",
          source: "scim",
          disabled: false,
        },
      ],
      userAssignments: [
        {
          email: "person@example.com",
          policyKeys: ["policy-1"],
          excludedPolicyKeys: [],
        },
      ],
    };

    db.store.backup_run.push({
      id: "run-2",
      organizationId: "org-1",
      status: "succeeded",
      r2Key: "backups/org-1/run-2.json",
      sizeBytes: 100,
      startedAt,
      completedAt: startedAt,
      error: null,
      trigger: "manual",
      retention: "default",
    });
    objects.set("backups/org-1/run-2.json", JSON.stringify(withDirectoryUsers));

    await runEffect(
      restoreTenantFromBackup(db, storage, organization, {
        backupId: "run-2",
        actor: { accountId: "user-1", email: "owner@example.com" },
        confirm: "acme",
        now: new Date("2026-11-01T00:00:00Z"),
      }),
    );

    const restoredUser = db.store.user.find(
      (user: { email: string }) => user.email === "person@example.com",
    );

    expect(restoredUser).toMatchObject({
      organizationId: "org-1",
      name: "Directory Person",
      externalId: "scim-person",
      source: "scim",
      disabled: false,
    });
    expect(db.store.user_policy).toMatchObject([
      { userId: restoredUser!.id, policyId: db.store.policy[0]!.id, mode: "include" },
    ]);
  });

  it("refuses a restore the operator did not confirm", async () => {
    const { db, storage, organization } = makeContext();

    const failure = await runEffect(
      Effect.match(
        restoreTenantFromBackup(db, storage, organization, {
          backupId: "run-1",
          actor: { accountId: "user-1", email: "owner@example.com" },
          confirm: "wrong",
        }),
        { onFailure: (error) => error, onSuccess: () => null },
      ),
    );

    expect(failureReason(failure)).toBe("invalid_bundle");
    expect(db.store.backup_run).toHaveLength(1);
  });

  it("leaves the tenant untouched when the bundle is invalid", async () => {
    const { db, storage, organization } = makeContext();

    const invalidStorage: R2Bucket = {
      ...storage,
      get: async (key) => {
        const body = "{}";

        return {
          key,
          version: "1",
          size: body.length,
          etag: "e",
          httpEtag: "e",
          uploaded: startedAt,
          body: new ReadableStream(),
          bodyUsed: false,
          text: async () => body,
          arrayBuffer: async () => new TextEncoder().encode(body).buffer,
          json: async () => JSON.parse(body),
          blob: async () => new Blob([body]),
        };
      },
    };

    const failure = await runEffect(
      Effect.match(
        restoreTenantFromBackup(db, invalidStorage, organization, {
          backupId: "run-1",
          actor: { accountId: "user-1", email: "owner@example.com" },
          confirm: "acme",
        }),
        { onFailure: (error) => error, onSuccess: () => null },
      ),
    );

    expect(failureReason(failure)).toBe("invalid_bundle");
    // Validation happens before the snapshot and before any write.
    expect(db.store.backup_run).toHaveLength(1);
    expect(db.store.policy.map((row: { name: string }) => row.name)).toEqual(["Old policy"]);
  });
});

describe("restore bundle validation", () => {
  it("rejects a group that references a missing policy", async () => {
    const failure = await runEffect(
      Effect.match(
        parseTenantRestoreBundle(
          JSON.stringify({
            ...bundle,
            groups: [{ key: "g", name: "G", policyKeys: ["missing"], devices: [] }],
          }),
        ),
        { onFailure: (error) => error, onSuccess: () => null },
      ),
    );

    expect(failureReason(failure)).toBe("invalid_bundle");
    expect(failure?.message).toContain("missing");
  });

  it("rejects an unsupported bundle version", async () => {
    const failure = await runEffect(
      Effect.match(parseTenantRestoreBundle(JSON.stringify({ ...bundle, version: 99 })), {
        onFailure: (error) => error,
        onSuccess: () => null,
      }),
    );

    expect(failure?.message).toContain("Unsupported backup version");
  });
});
