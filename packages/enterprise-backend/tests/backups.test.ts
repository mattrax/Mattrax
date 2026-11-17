import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import type { R2Bucket } from "@mattrax/enterprise-core";
import {
  EnterpriseNotFound,
  EnterprisePermissionDenied,
  EnterpriseUnauthorized,
} from "@mattrax/enterprise-domain";
import {
  runScheduledBackups,
  runTenantBackup,
  pruneBackups,
  listTenantBackups,
  backupObjectKey,
  describeBackupError,
} from "../src/backup.js";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { makeDb, makeStripeClient, request, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";

const headers = { cookie: "mattrax_session=test" };

const DAY = 24 * 60 * 60 * 1000;

const now = new Date("2026-11-11T03:17:00.000Z");

type R2PutValue = Parameters<R2Bucket["put"]>[1];

/**
 * The fake bucket, plus the controls and observation points tests need. The
 * mapped type drops `readonly` because one test swaps `put` to fail a tenant.
 */
type FakeStorage = { -readonly [Key in keyof R2Bucket]: R2Bucket[Key] } & {
  readonly objects: Map<string, string>;
  readonly deleted: string[];
  failNextPut(): void;
};

const makeStorage = (): FakeStorage => {
  const objects = new Map<string, string>();
  const deleted: string[] = [];
  let failPuts = false;

  const storage: FakeStorage = {
    objects,
    deleted,
    failNextPut() {
      failPuts = true;
    },
    put: async (key: string, value: R2PutValue) => {
      if (failPuts) {
        failPuts = false;
        throw new Error("R2 unavailable");
      }

      objects.set(key, String(value));

      return {
        key,
        version: "1",
        size: String(value).length,
        etag: "etag",
        httpEtag: "etag",
        uploaded: now,
      };
    },
    get: async (key: string) => {
      const body = objects.get(key);

      if (body === undefined) return null;

      return {
        key,
        version: "1",
        size: body.length,
        etag: "etag",
        httpEtag: "etag",
        uploaded: now,
        body: new ReadableStream(),
        bodyUsed: false,
        text: async () => body,
        arrayBuffer: async () => new TextEncoder().encode(body).buffer,
        json: async () => JSON.parse(body),
        blob: async () => new Blob([body]),
      };
    },
    head: async () => null,
    delete: async (keys: string | ReadonlyArray<string>) => {
      for (const key of Schema.is(Schema.String)(keys) ? [keys] : keys) {
        deleted.push(key);
        objects.delete(key);
      }
    },
    list: async () => ({ objects: [], truncated: false, delimitedPrefixes: [] }),
  };

  return storage;
};

const makeContext = (role = "owner") => {
  const db = makeDb();
  const timestamp = new Date();
  db.store.user.push({
    id: "user-1",
    name: "Owner",
    email: "owner@example.com",
    emailVerified: true,
    image: null,
    disabled: false,
    totpEnabled: false,
    authRevision: "rev-1",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  db.store.organization.push({
    id: "org-1",
    name: "Acme",
    slug: "acme",
    logo: null,
    displayName: "Acme Corp",
    supportEmail: null,
    brandColor: null,
    metadata: null,
    stripeCustomerId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  db.store.member.push({
    id: "member-1",
    organizationId: "org-1",
    userId: "user-1",
    role,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const storage = makeStorage();

  const auth = {
    requireUser: (input: any) => {
      const inputHeaders =
        input instanceof Request ? Object.fromEntries(input.headers) : input.headers;

      return inputHeaders.cookie
        ? Effect.succeed({ user: db.store.user[0] })
        : Effect.fail(new EnterpriseUnauthorized({ message: "Unauthenticated" }));
    },
    listApiTokens: () => Effect.succeed({ tokens: [] }),
    createApiToken: () => Effect.die("not used"),
    revokeApiToken: () => Effect.succeed({ status: "ok" }),
    requestEmailChange: () => Effect.succeed({ status: "ok" }),
    requireStepUp: () => Effect.void,
    verifyEmailChange: () => Effect.succeed({ status: "ok" }),
  };

  const service = createEnterpriseService({
    // SAFETY: the in-memory fake implements the query/insert/update surface the
    // service uses at runtime, but not the full `Db` service type.
    db,
    schema,
    origin,
    stripeClient: makeStripeClient(),
    // SAFETY: the fake exposes the R2 methods backups call; it is not a full
    // `R2Bucket` (no signing, no metadata).
    storage: storage,
    // SAFETY: the fake only implements the auth methods these tests exercise.
    auth: auth as any,
    authSecret: "backup-test-secret",
  });

  return { db, service, storage };
};

describe("tenant backup runs", () => {
  it("writes the export bundle to a deterministic tenant-scoped key and records success", async () => {
    const { db, storage } = makeContext();

    const result = await runEffect(
      runTenantBackup(db, storage, "org-1", "manual", {
        now,
        actor: { userId: "user-1", email: "owner@example.com" },
      }),
    );

    expect(result.status).toBe("succeeded");
    expect(result.r2Key).toBe(backupObjectKey("org-1", now, result.id));
    expect(result.r2Key).toContain("backups/org-1/2026-11-11T03-17-00-000Z-");
    expect(result.sizeBytes).toBeGreaterThan(0);

    const body = storage.objects.get(result.r2Key!)!;
    const bundle = JSON.parse(body);
    expect(bundle.version).toBe(1);
    expect(bundle.tenant.name).toBe("Acme");
    expect(bundle.members).toHaveLength(1);
    // The bundle must never carry auth material.
    expect(body).not.toContain("password");
    expect(body).not.toContain("tokenHash");

    expect(db.store.backup_run).toHaveLength(1);
    expect(db.store.backup_run[0]).toMatchObject({
      organizationId: "org-1",
      status: "succeeded",
      trigger: "manual",
      retention: "default",
      r2Key: result.r2Key,
    });
    expect(db.store.audit_log.map((row: any) => row.action)).toContain("backup.succeeded");
  });

  it("records a failed run instead of throwing when the upload fails", async () => {
    const { db, storage } = makeContext();
    storage.failNextPut();

    const result = await runEffect(runTenantBackup(db, storage, "org-1", "scheduled", { now }));

    expect(result.status).toBe("failed");
    expect(result.r2Key).toBeNull();
    expect(result.error).toContain("R2 unavailable");
    expect(db.store.backup_run[0]).toMatchObject({
      status: "failed",
      error: expect.stringContaining("R2 unavailable"),
    });
    expect(db.store.audit_log.map((row: any) => row.action)).toContain("backup.failed");
  });

  it("redacts emails and opaque tokens from recorded failures", () => {
    const described = describeBackupError(
      new Error(`upstream rejected owner@example.com token ${"a".repeat(48)}`),
    );

    expect(described).not.toContain("owner@example.com");
    expect(described).not.toContain("a".repeat(48));
    expect(described).toContain("[email]");
    expect(described.length).toBeLessThanOrEqual(500);
  });

  it("scopes run listings to one tenant", async () => {
    const { db, storage } = makeContext();
    db.store.organization.push({
      id: "org-2",
      name: "Other",
      slug: "other",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await runEffect(runTenantBackup(db, storage, "org-1", "manual", { now }));
    await runEffect(
      runTenantBackup(db, storage, "org-2", "manual", {
        now: new Date(now.getTime() + 1_000),
      }),
    );

    const first = await runEffect(listTenantBackups(db, "org-1"));
    const second = await runEffect(listTenantBackups(db, "org-2"));
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0].startedAt).not.toEqual(second[0].startedAt);
  });
});

describe("backup retention", () => {
  it("deletes R2 objects and rows older than the window but keeps pinned runs", async () => {
    const { db, storage } = makeContext();
    const old = new Date(now.getTime() - 31 * DAY);
    const recent = new Date(now.getTime() - 2 * DAY);
    const oldKey = backupObjectKey("org-1", old);
    const pinnedKey = backupObjectKey("org-1", new Date(now.getTime() - 60 * DAY));
    const recentKey = backupObjectKey("org-1", recent);
    storage.objects.set(oldKey, "old");
    storage.objects.set(pinnedKey, "pinned");
    storage.objects.set(recentKey, "recent");
    db.store.backup_run.push(
      {
        id: "old",
        organizationId: "org-1",
        status: "succeeded",
        r2Key: oldKey,
        sizeBytes: 3,
        startedAt: old,
        completedAt: old,
        error: null,
        trigger: "scheduled",
        retention: "default",
      },
      {
        id: "pinned",
        organizationId: "org-1",
        status: "succeeded",
        r2Key: pinnedKey,
        sizeBytes: 6,
        startedAt: new Date(now.getTime() - 60 * DAY),
        completedAt: old,
        error: null,
        trigger: "manual",
        retention: "pinned",
      },
      {
        id: "recent",
        organizationId: "org-1",
        status: "succeeded",
        r2Key: recentKey,
        sizeBytes: 6,
        startedAt: recent,
        completedAt: recent,
        error: null,
        trigger: "scheduled",
        retention: "default",
      },
    );

    const pruned = await runEffect(pruneBackups(db, storage, { now, retentionDays: 30 }));

    expect(pruned).toEqual({ runsDeleted: 1, objectsDeleted: 1 });
    expect(storage.objects.has(oldKey)).toBe(false);
    expect(storage.objects.has(pinnedKey)).toBe(true);
    expect(storage.objects.has(recentKey)).toBe(true);
    expect(db.store.backup_run.map((row: any) => row.id).sort()).toEqual(["pinned", "recent"]);
  });

  it("does nothing when retention is disabled", async () => {
    const { db, storage } = makeContext();
    db.store.backup_run.push({
      id: "old",
      organizationId: "org-1",
      status: "succeeded",
      r2Key: "backups/org-1/old.json",
      sizeBytes: 1,
      startedAt: new Date(now.getTime() - 365 * DAY),
      completedAt: now,
      error: null,
      trigger: "scheduled",
      retention: "default",
    });

    const pruned = await runEffect(pruneBackups(db, storage, { now, retentionDays: 0 }));

    expect(pruned).toEqual({ runsDeleted: 0, objectsDeleted: 0 });
    expect(db.store.backup_run).toHaveLength(1);
  });
});

describe("scheduled backup sweep", () => {
  it("backs up every tenant, isolates failures and applies retention", async () => {
    const { db, storage } = makeContext();
    db.store.organization.push({
      id: "org-2",
      name: "Other",
      slug: "other",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    // Make org-2 fail without affecting org-1.
    const originalPut = storage.put;
    storage.put = async (key: string, value: R2PutValue) => {
      if (key.startsWith("backups/org-2/")) throw new Error("tenant storage broken");

      return originalPut(key, value);
    };

    const result = await runEffect(
      runScheduledBackups(db, storage, { now, concurrency: 2, retentionDays: 30 }),
    );

    expect(result).toEqual({
      tenants: 2,
      succeeded: 1,
      failed: 1,
      skipped: 1,
      purgedRuns: 0,
      purgedObjects: 0,
    });
    expect(db.store.backup_run.map((row: any) => row.status).sort()).toEqual([
      "failed",
      "succeeded",
    ]);
    expect([...storage.objects.keys()]).toHaveLength(1);
    expect([...storage.objects.keys()][0]).toContain("backups/org-1/2026-11-11T03-17-00-000Z-");
  });
});

describe("backup API", () => {
  it("allows an owner to run and download a backup", async () => {
    const { service } = makeContext();
    const run = await runEffect(service.runTenantBackup(request(headers), "org-1"));
    expect(run.status).toBe("succeeded");

    const list = await runEffect(service.listTenantBackups(request(headers), "org-1"));
    expect(list.backups).toHaveLength(1);
    expect(list.backups[0].id).toBe(run.id);

    const download = await runEffect(
      service.downloadTenantBackup(request(headers), "org-1", run.id),
    );

    expect(download.filename).toMatch(/^tenant-acme-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(JSON.parse(download.content).tenant.slug).toBe("acme");
  });

  it("rejects manual backup and listing for non-owners", async () => {
    const { service } = makeContext("admin");
    await expect(
      runEffect(service.runTenantBackup(request(headers), "org-1")),
    ).rejects.toBeInstanceOf(EnterprisePermissionDenied);
    await expect(
      runEffect(service.listTenantBackups(request(headers), "org-1")),
    ).rejects.toBeInstanceOf(EnterprisePermissionDenied);
  });

  it("does not expose another tenant's backup by id", async () => {
    const { service, db } = makeContext();
    db.store.backup_run.push({
      id: "foreign",
      organizationId: "org-2",
      status: "succeeded",
      r2Key: "backups/org-2/x.json",
      sizeBytes: 1,
      startedAt: now,
      completedAt: now,
      error: null,
      trigger: "manual",
      retention: "default",
    });
    await expect(
      runEffect(service.downloadTenantBackup(request(headers), "org-1", "foreign")),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);
  });

  it("pins and deletes a run through the API", async () => {
    const { service, db } = makeContext();
    const run = await runEffect(service.runTenantBackup(request(headers), "org-1"));

    const pinned = await runEffect(service.pinTenantBackup(request(headers), "org-1", run.id));
    expect(pinned.retention).toBe("pinned");

    const unpinned = await runEffect(service.unpinTenantBackup(request(headers), "org-1", run.id));
    expect(unpinned.retention).toBe("default");

    await runEffect(service.deleteTenantBackup(request(headers), "org-1", run.id));
    expect(db.store.backup_run).toHaveLength(0);
  });

  it("reports what tenant deletion reclaimed", async () => {
    const { service, db } = makeContext();

    const result = await runEffect(service.deleteTenant(request(headers), "org-1"));

    expect(result).toMatchObject({
      status: "ok",
      reclaimed: { devices: 0, objects: 0, subscription: "none" },
    });
    expect(db.store.organization).toHaveLength(0);
    expect(db.store.tenant_deletion.at(0)).toMatchObject({
      organizationId: "org-1",
      status: "completed",
    });
  });
});
