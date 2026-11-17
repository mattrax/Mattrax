import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import type { R2Bucket } from "@mattrax/enterprise-core";
import {
  deleteBackupRun,
  readTenantBackup,
  setBackupRetention,
  type BackupActionError,
} from "../src/Tenant/backup.ts";
import { makeDb, runEffect } from "./helpers.js";

const failureReason = (failure: BackupActionError | null) => failure?.reason;

const startedAt = new Date("2026-11-01T00:00:00Z");

const makeStorage = (entries: Record<string, string> = {}) => {
  const objects = new Map(Object.entries(entries));
  const deleted: string[] = [];
  let failDelete = false;

  const storage: R2Bucket & {
    readonly objects: Map<string, string>;
    readonly deleted: string[];
    failNextDelete(): void;
  } = {
    objects,
    deleted,
    failNextDelete() {
      failDelete = true;
    },
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
      if (failDelete) {
        failDelete = false;
        throw new Error("R2 unavailable");
      }

      for (const key of Schema.is(Schema.String)(keys) ? [keys] : keys) {
        deleted.push(key);
        objects.delete(key);
      }
    },
    list: async () => ({ objects: [], truncated: false, delimitedPrefixes: [] }),
  };

  return storage;
};

const findRun = (db: ReturnType<typeof makeDbWithRuns>, id: string) =>
  db.store.backup_run.find((run: { id: string }) => run.id === id);

const makeDbWithRuns = () => {
  const db = makeDb();
  const timestamp = new Date();
  db.store.organization.push({
    id: "org-1",
    name: "Acme",
    slug: "acme",
    logo: null,
    displayName: null,
    supportEmail: null,
    brandColor: null,
    metadata: null,
    stripeCustomerId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  for (const [index, status] of (
    ["succeeded", "succeeded", "failed", "running", "succeeded"] as const
  ).entries())
    db.store.backup_run.push({
      id: `run-${index}`,
      organizationId: index === 4 ? "org-2" : "org-1",
      status,
      r2Key: status === "succeeded" ? `backups/org-1/run-${index}.json` : null,
      sizeBytes: 12,
      startedAt: new Date(startedAt.getTime() + index * 1_000),
      completedAt: status === "running" ? null : new Date(),
      error: null,
      trigger: "manual",
      retention: "default",
    });

  return db;
};

describe("backup retention actions", () => {
  it("pins and unpins a run with an audit entry", async () => {
    const db = makeDbWithRuns();

    const pinned = await runEffect(
      setBackupRetention(db, "org-1", "run-1", "pinned", {
        userId: "user-1",
        email: "owner@example.com",
      }),
    );

    expect(pinned.retention).toBe("pinned");
    expect(findRun(db, "run-1")).toMatchObject({
      retention: "pinned",
    });
    expect(db.store.audit_log.at(-1)).toMatchObject({
      organizationId: "org-1",
      action: "backup.pinned",
      targetType: "organization",
    });

    const unpinned = await runEffect(setBackupRetention(db, "org-1", "run-1", "default"));
    expect(unpinned.retention).toBe("default");
    expect(db.store.audit_log.at(-1)).toMatchObject({ action: "backup.unpinned" });
  });

  it("does not expose another tenant's run", async () => {
    const db = makeDbWithRuns();

    const failure = await runEffect(
      Effect.match(setBackupRetention(db, "org-1", "run-4", "pinned"), {
        onFailure: (error) => error,
        onSuccess: () => null,
      }),
    );

    expect(failureReason(failure)).toBe("not_found");
    expect(findRun(db, "run-4")).toMatchObject({
      retention: "default",
    });
  });

  it("refuses to change a run that is still writing", async () => {
    const db = makeDbWithRuns();

    const failure = await runEffect(
      Effect.match(setBackupRetention(db, "org-1", "run-3", "pinned"), {
        onFailure: (error) => error,
        onSuccess: () => null,
      }),
    );

    expect(failureReason(failure)).toBe("running");
  });

  it("deletes the stored object before the row", async () => {
    const db = makeDbWithRuns();
    const storage = makeStorage({ "backups/org-1/run-0.json": "{}" });

    const result = await runEffect(deleteBackupRun(db, storage, "org-1", "run-0"));

    expect(result.deleted).toBe(true);
    expect(storage.deleted).toEqual(["backups/org-1/run-0.json"]);
    expect(findRun(db, "run-0")).toBeUndefined();
    expect(db.store.audit_log.at(-1)).toMatchObject({ action: "backup.deleted" });
  });

  it("keeps the row when the object cannot be deleted", async () => {
    const db = makeDbWithRuns();
    const storage = makeStorage({ "backups/org-1/run-0.json": "{}" });
    storage.failNextDelete();

    const failure = await runEffect(
      Effect.match(deleteBackupRun(db, storage, "org-1", "run-0"), {
        onFailure: (error) => error,
        onSuccess: () => null,
      }),
    );

    expect(failureReason(failure)).toBe("storage");
    expect(findRun(db, "run-0")).toBeDefined();
  });

  it("is idempotent when the run is already gone", async () => {
    const db = makeDbWithRuns();

    expect(await runEffect(deleteBackupRun(db, makeStorage(), "org-1", "missing"))).toEqual({
      deleted: false,
    });
  });

  it("refuses to delete a run while it is writing", async () => {
    const db = makeDbWithRuns();

    const failure = await runEffect(
      Effect.match(deleteBackupRun(db, makeStorage(), "org-1", "run-3"), {
        onFailure: (error) => error,
        onSuccess: () => null,
      }),
    );

    expect(failureReason(failure)).toBe("running");
  });

  it("only reads a successful run's bundle", async () => {
    const db = makeDbWithRuns();
    const storage = makeStorage({ "backups/org-1/run-0.json": '{"version":1}' });

    const loaded = await runEffect(readTenantBackup(db, storage, "org-1", "run-0"));
    expect(loaded.text).toBe('{"version":1}');

    const failure = await runEffect(
      Effect.match(readTenantBackup(db, storage, "org-1", "run-2"), {
        onFailure: (error) => error,
        onSuccess: () => null,
      }),
    );

    expect(failureReason(failure)).toBe("not_restorable");
  });
});
