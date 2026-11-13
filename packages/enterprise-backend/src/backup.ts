import { Effect } from "effect";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { schema, type R2Bucket } from "@mattrax/enterprise-core";
import { buildTenantExport } from "./tenantExport.ts";
import type { EnterpriseDb } from "./schema.ts";

/** Default age after which a non-pinned run and its R2 object are deleted. */
export const BACKUP_RUN_RETENTION_DAYS = 30;

/** Tenants backed up in parallel by the scheduled handler. */
export const BACKUP_CONCURRENCY = 4;

/** Caps how much of a failure can reach the database/UI. */
export const BACKUP_ERROR_MAX_LENGTH = 500;

const day = 24 * 60 * 60 * 1000;
const id = () => crypto.randomUUID().replaceAll("-", "").slice(0, 24);

const chunk = <T>(values: ReadonlyArray<T>, size: number): T[][] => {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size)
    chunks.push(values.slice(index, index + size) as T[]);

  return chunks;
};

export type BackupTrigger = "scheduled" | "manual";

export type BackupRetention = "default" | "pinned";

export type BackupStatus = "running" | "succeeded" | "failed";

export type BackupActor = {
  readonly userId: string;
  readonly email: string;
};

export type TenantBackupResult = {
  readonly id: string;
  readonly organizationId: string;
  readonly status: "succeeded" | "failed";
  readonly trigger: BackupTrigger;
  readonly retention: BackupRetention;
  readonly r2Key: string | null;
  readonly sizeBytes: number | null;
  readonly startedAt: Date;
  readonly completedAt: Date;
  readonly error: string | null;
};

export type RunTenantBackupOptions = {
  /** Injectable clock for tests and deterministic keys. */
  readonly now?: Date;
  /** `pinned` runs opt out of age-based pruning. Defaults to `default`. */
  readonly retention?: BackupRetention;
  /** Owner who triggered a manual run, recorded in the audit log. */
  readonly actor?: BackupActor;
};

/**
 * Deterministic, tenant-scoped object key. ISO timestamps contain `:` and `.`,
 * which are valid in R2 keys but awkward in tooling, so they are normalised.
 */
export const backupObjectKey = (organizationId: string, startedAt: Date, runId?: string): string =>
  `backups/${organizationId}/${startedAt.toISOString().replace(/[:.]/g, "-")}${
    runId ? `-${runId}` : ""
  }.json`;

/**
 * Redact the obvious secrets before a failure is persisted. The same rules as
 * request logging: no emails and no long opaque tokens. Errors are truncated
 * so a provider response cannot bloat the table or the settings page.
 */
export const describeBackupError = (cause: unknown): string => {
  const error = cause instanceof Error ? cause : undefined;
  const text = error ? `${error.name}: ${error.message}` : String(cause);

  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\b[A-Za-z0-9+/=_-]{32,}\b/g, "[redacted]")
    .slice(0, BACKUP_ERROR_MAX_LENGTH);
};

const recordAudit = (
  db: EnterpriseDb,
  organizationId: string,
  action: string,
  metadata: Record<string, unknown>,
  actor?: BackupActor,
): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    yield* db.insert(schema.auditLog).values({
      id: id(),
      organizationId,
      actorUserId: actor?.userId ?? null,
      actorEmail: actor?.email ?? null,
      action,
      targetType: "organization",
      targetId: organizationId,
      metadata,
      createdAt: new Date(),
    });
  }).pipe(
    // Audit is secondary to the backup: a transient write failure must not
    // turn a successful upload into a failed run.
    Effect.catch((cause) =>
      Effect.sync(() => console.error("Backup audit write failed", organizationId, cause)),
    ),
  ) as Effect.Effect<void, never>;

/**
 * Back up one tenant by reusing the versioned export bundle builder and writing
 * it to R2. A failed bundle/upload is recorded as a failed run instead of
 * failing the caller, so a scheduled sweep can skip one broken tenant and
 * continue. Only an inability to record the run itself can fail the effect.
 */
export const runTenantBackup = (
  db: EnterpriseDb,
  storage: R2Bucket,
  organizationId: string,
  trigger: BackupTrigger,
  options: RunTenantBackupOptions = {},
): Effect.Effect<TenantBackupResult, unknown, never> =>
  Effect.gen(function* () {
    const startedAt = options.now ?? new Date();
    const retention = options.retention ?? "default";
    const runId = id();

    yield* db.insert(schema.backupRun).values({
      id: runId,
      organizationId,
      status: "running",
      r2Key: null,
      sizeBytes: null,
      startedAt,
      completedAt: null,
      error: null,
      trigger,
      retention,
    });

    const finish = (patch: {
      readonly status: "succeeded" | "failed";
      readonly r2Key: string | null;
      readonly sizeBytes: number | null;
      readonly completedAt: Date;
      readonly error: string | null;
    }) =>
      Effect.gen(function* () {
        yield* db.update(schema.backupRun).set(patch).where(eq(schema.backupRun.id, runId));

        return {
          id: runId,
          organizationId,
          status: patch.status,
          trigger,
          retention,
          r2Key: patch.r2Key,
          sizeBytes: patch.sizeBytes,
          startedAt,
          completedAt: patch.completedAt,
          error: patch.error,
        } satisfies TenantBackupResult;
      });

    const organization = yield* db.query.organization.findFirst({
      where: { id: organizationId },
    });

    if (!organization) {
      const completedAt = options.now ?? new Date();
      const error = "Tenant not found";

      const result = yield* finish({
        status: "failed",
        r2Key: null,
        sizeBytes: null,
        completedAt,
        error,
      });

      yield* recordAudit(db, organizationId, "backup.failed", { trigger, error }, options.actor);

      return result;
    }

    const built = yield* buildTenantExport(db, organization, { now: startedAt }).pipe(
      Effect.map((bundle) => ({ ok: true as const, bundle })),
      Effect.catch((cause) =>
        Effect.succeed({ ok: false as const, error: describeBackupError(cause) }),
      ),
    );

    if (!built.ok) {
      const completedAt = options.now ?? new Date();

      const result = yield* finish({
        status: "failed",
        r2Key: null,
        sizeBytes: null,
        completedAt,
        error: built.error,
      });

      yield* recordAudit(
        db,
        organizationId,
        "backup.failed",
        { trigger, error: built.error },
        options.actor,
      );

      return result;
    }

    const key = backupObjectKey(organizationId, startedAt, runId);
    const body = built.bundle.body;
    const sizeBytes = new TextEncoder().encode(body).byteLength;

    const upload = yield* Effect.tryPromise({
      try: () =>
        storage.put(key, body, {
          httpMetadata: { contentType: "application/json; charset=utf-8" },
          customMetadata: {
            tenantId: organizationId,
            version: String(built.bundle.version),
            trigger,
          },
        }),
      catch: (cause) => cause,
    }).pipe(
      Effect.map(() => ({ ok: true as const })),
      Effect.catch((cause) =>
        Effect.succeed({ ok: false as const, error: describeBackupError(cause) }),
      ),
    );

    if (!upload.ok) {
      const completedAt = options.now ?? new Date();

      const result = yield* finish({
        status: "failed",
        r2Key: null,
        sizeBytes: null,
        completedAt,
        error: upload.error,
      });

      yield* recordAudit(
        db,
        organizationId,
        "backup.failed",
        { trigger, error: upload.error },
        options.actor,
      );

      return result;
    }

    const completedAt = options.now ?? new Date();

    const result = yield* finish({
      status: "succeeded",
      r2Key: key,
      sizeBytes,
      completedAt,
      error: null,
    });

    yield* recordAudit(
      db,
      organizationId,
      "backup.succeeded",
      { trigger, sizeBytes, key },
      options.actor,
    );

    return result;
  }) as Effect.Effect<TenantBackupResult, unknown, never>;

export type PruneBackupsResult = {
  /** Backup rows deleted by age. */
  readonly runsDeleted: number;
  /** R2 objects deleted alongside those rows. */
  readonly objectsDeleted: number;
};

/**
 * Delete non-pinned runs older than `retentionDays`, removing the R2 object
 * before the row so a failed object delete does not orphan the only pointer to
 * it. A retention of `0` disables pruning.
 */
export const pruneBackups = (
  db: EnterpriseDb,
  storage: R2Bucket,
  options: { readonly now?: Date; readonly retentionDays?: number } = {},
): Effect.Effect<PruneBackupsResult, unknown, never> =>
  Effect.gen(function* () {
    const retentionDays = options.retentionDays ?? BACKUP_RUN_RETENTION_DAYS;

    if (retentionDays <= 0) return { runsDeleted: 0, objectsDeleted: 0 };

    const cutoff = new Date((options.now ?? new Date()).getTime() - retentionDays * day);

    const stale = (yield* db
      .select()
      .from(schema.backupRun)
      .where(
        and(lt(schema.backupRun.startedAt, cutoff), eq(schema.backupRun.retention, "default")),
      )) as Array<{ id: string; r2Key: string | null }>;

    if (stale.length === 0) return { runsDeleted: 0, objectsDeleted: 0 };

    let objectsDeleted = 0;
    let objectDeleteFailed = false;
    const keys = stale.flatMap((run) => (run.r2Key ? [run.r2Key] : []));

    for (const batch of chunk(keys, 50)) {
      const removed = yield* Effect.tryPromise({
        try: async () => {
          await storage.delete(batch);

          return batch.length;
        },
        catch: (cause) => cause,
      }).pipe(
        // Keep the rows when the object cannot be removed so a later sweep can
        // retry instead of silently losing track of the bytes.
        Effect.catch((cause) =>
          Effect.sync(() => {
            console.error("Backup object retention failed", cause);
            objectDeleteFailed = true;

            return 0;
          }),
        ),
      );

      objectsDeleted += removed;
    }

    // A partial object deletion leaves rows in place; the next daily sweep
    // retries the whole batch rather than orphaning bytes.
    if (objectDeleteFailed) return { runsDeleted: 0, objectsDeleted };

    const deletable = stale.map((run) => run.id);

    if (deletable.length > 0)
      yield* db.delete(schema.backupRun).where(inArray(schema.backupRun.id, deletable));

    return { runsDeleted: deletable.length, objectsDeleted };
  }) as Effect.Effect<PruneBackupsResult, unknown, never>;

export type ScheduledBackupsResult = {
  readonly tenants: number;
  readonly succeeded: number;
  readonly failed: number;
  /** Failed runs skipped so the rest of the fleet still backed up. */
  readonly skipped: number;
  readonly purgedRuns: number;
  readonly purgedObjects: number;
};

/**
 * Daily sweep: back up every tenant with bounded concurrency, never letting one
 * tenant abort the others, then apply age-based retention.
 */
export const runScheduledBackups = (
  db: EnterpriseDb,
  storage: R2Bucket,
  options: {
    readonly now?: Date;
    readonly concurrency?: number;
    readonly retentionDays?: number;
  } = {},
): Effect.Effect<ScheduledBackupsResult, unknown, never> =>
  Effect.gen(function* () {
    const now = options.now ?? new Date();
    // A killed isolate can leave a run stuck in `running` forever, which makes
    // the dashboard claim a backup is still in progress. Reconcile old rows.
    const runningCutoff = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    yield* db
      .update(schema.backupRun)
      .set({
        status: "failed",
        completedAt: now,
        error: "Backup was interrupted before it completed.",
      })
      .where(
        and(eq(schema.backupRun.status, "running"), lt(schema.backupRun.startedAt, runningCutoff)),
      );

    const organizations = (yield* db
      .select({ id: schema.organization.id })
      .from(schema.organization)) as Array<{ id: string }>;

    const results = yield* Effect.forEach(
      organizations,
      (organization) =>
        runTenantBackup(db, storage, organization.id, "scheduled", { now }).pipe(
          Effect.map((result) => ({ ok: result.status === "succeeded" })),
          Effect.catch((cause) =>
            Effect.sync(() => {
              console.error("Scheduled tenant backup failed", organization.id, cause);

              return { ok: false };
            }),
          ),
        ),
      { concurrency: options.concurrency ?? BACKUP_CONCURRENCY },
    );

    const succeeded = results.filter((result) => result.ok).length;
    const failed = results.length - succeeded;

    const pruned = yield* pruneBackups(db, storage, {
      now,
      retentionDays: options.retentionDays,
    });

    return {
      tenants: organizations.length,
      succeeded,
      failed,
      skipped: failed,
      purgedRuns: pruned.runsDeleted,
      purgedObjects: pruned.objectsDeleted,
    };
  }) as Effect.Effect<ScheduledBackupsResult, unknown, never>;

/**
 * Recent runs for one tenant, newest first. The API only needs a bounded list;
 * the settings card never pages through full backup history.
 */
export const listTenantBackups = (
  db: EnterpriseDb,
  organizationId: string,
  limit = 20,
): Effect.Effect<
  Array<{
    id: string;
    status: BackupStatus;
    trigger: BackupTrigger;
    retention: BackupRetention;
    r2Key: string | null;
    sizeBytes: number | null;
    startedAt: Date;
    completedAt: Date | null;
    error: string | null;
  }>,
  unknown,
  any
> =>
  Effect.gen(function* () {
    const rows = (yield* db
      .select()
      .from(schema.backupRun)
      .where(eq(schema.backupRun.organizationId, organizationId))
      .orderBy(desc(schema.backupRun.startedAt))
      .limit(Math.max(1, Math.min(limit, 100)))) as Array<{
      id: string;
      status: BackupStatus;
      trigger: BackupTrigger;
      retention: BackupRetention;
      r2Key: string | null;
      sizeBytes: number | null;
      startedAt: Date;
      completedAt: Date | null;
      error: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      trigger: row.trigger,
      retention: row.retention,
      r2Key: row.r2Key ?? null,
      sizeBytes: row.sizeBytes ?? null,
      startedAt: row.startedAt,
      completedAt: row.completedAt ?? null,
      error: row.error ?? null,
    }));
  });
