import { Effect, Exit, Schema } from "effect";
import { and, eq, gt, inArray, lt, ne } from "drizzle-orm";
import { isDirectorySyncDue, nextDirectorySyncAt, syncDirectory } from "@mattrax/directory-sync";
import type { AzureGraphService } from "@mattrax/azure-graph";
import { schema } from "@mattrax/enterprise-core";
import type { EnterpriseDb } from "@mattrax/enterprise-core";
import { entraDirectoryUserDirectory } from "./provider.js";

const now = () => new Date();

const normalizedDomain = (domain: string) => domain.trim().toLowerCase().replace(/\.$/, "");

/**
 * How long a `running` sync may sit before another request may take over.
 * Long enough for a large tenant's pages, short enough that a crashed Worker
 * does not wedge directory sync until someone edits the database.
 */
export const ENTRA_SYNC_STALE_MS = 15 * 60_000;

export type EntraSyncLockState = {
  /** True when this caller now owns the sync slot. */
  readonly acquired: boolean;
  /** True when the previous owner's lock was stale and was taken over. */
  readonly stale: boolean;
  readonly previousStatus: "idle" | "running" | "error" | null;
  readonly enabled: boolean;
};

/**
 * Tenant-scoped sync lock stored on `entra_directory_sync`.
 *
 * The read + conditional write run in one transaction so two concurrent
 * requests cannot both observe `idle` and both start. A `running` row older
 * than {@link ENTRA_SYNC_STALE_MS} is treated as abandoned; the new owner takes
 * it over instead of leaving the tenant stuck until manual cleanup.
 */
export const acquireEntraSyncLock = (options: {
  readonly db: EnterpriseDb;
  readonly organizationId: string;
  readonly now?: Date;
  readonly staleAfterMs?: number;
}): Effect.Effect<EntraSyncLockState, unknown> => {
  const { db, organizationId } = options;
  const timestamp = options.now ?? now();
  const staleAfterMs = options.staleAfterMs ?? ENTRA_SYNC_STALE_MS;

  return db.transaction((tx) =>
    Effect.gen(function* () {
      const state = yield* tx.query.entraDirectorySync.findFirst({
        where: { organizationId },
      });

      if (!state) {
        yield* tx.insert(schema.entraDirectorySync).values({
          organizationId,
          enabled: true,
          status: "running",
          lastAttemptedAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
        });

        return { acquired: true, stale: false, previousStatus: null, enabled: true };
      }

      const previousStatus = Schema.decodeUnknownSync(
        Schema.Literals(["idle", "running", "error"]),
      )(state.status);

      if (previousStatus === "running") {
        const updatedAt =
          state.updatedAt instanceof Date
            ? state.updatedAt.getTime()
            : Date.parse(String(state.updatedAt));

        const age = Number.isFinite(updatedAt) ? timestamp.getTime() - updatedAt : Number.NaN;
        const stale = !Number.isFinite(age) || age > staleAfterMs;

        if (!stale)
          return {
            acquired: false,
            stale: false,
            previousStatus,
            enabled: state.enabled,
          };

        // Conditional write: only one concurrent caller can take over a stale
        // lock, even if both read the same snapshot.
        const takeover = yield* tx
          .update(schema.entraDirectorySync)
          .set({ status: "running", lastAttemptedAt: timestamp, updatedAt: timestamp })
          .where(
            and(
              eq(schema.entraDirectorySync.organizationId, organizationId),
              eq(schema.entraDirectorySync.status, "running"),
              lt(schema.entraDirectorySync.updatedAt, new Date(timestamp.getTime() - staleAfterMs)),
            ),
          );

        if (takeover.affectedRows === 0)
          return { acquired: false, stale: false, previousStatus, enabled: state.enabled };

        return { acquired: true, stale: true, previousStatus, enabled: state.enabled };
      }

      const claimed = yield* tx
        .update(schema.entraDirectorySync)
        .set({
          status: "running",
          lastAttemptedAt: timestamp,
          lastError: null,
          updatedAt: timestamp,
        })
        .where(
          and(
            eq(schema.entraDirectorySync.organizationId, organizationId),
            ne(schema.entraDirectorySync.status, "running"),
          ),
        );

      if (claimed.affectedRows === 0)
        return { acquired: false, stale: false, previousStatus, enabled: state.enabled };

      return { acquired: true, stale: false, previousStatus, enabled: state.enabled };
    }),
  );
};

export type EntraSyncProgress = {
  readonly users: number;
  readonly groups: number;
  readonly domains: number;
  readonly usersDelta?: string;
  readonly groupsDelta?: string;
};

/**
 * Pull verified domains and (optionally) users/groups from Microsoft Graph.
 * The sync is delta-based: the stored deltaLink is passed on the next run and
 * replaced with the fresh one. Removed/disabled people are marked disabled in
 * the tenant directory and lose their directory group memberships; Graph
 * sources are upserted by Entra object id.
 *
 * Discovery and page application are shared with the other directory
 * providers (`@mattrax/directory-sync`); this function adds the Entra-only
 * verified-domain import and maps its delta cursors onto the tenant's
 * `entra_directory_sync` row.
 */
export const syncEntraDirectory = (options: {
  readonly db: EnterpriseDb;
  readonly graph: AzureGraphService;
  readonly organizationId: string;
  readonly azureTenantId: string;
  /**
   * Retained for the tenant's SSO configuration, where it controls account
   * provisioning at sign-in. Directory sync imports directory users
   * regardless of this setting.
   */
  readonly autoProvision?: boolean;
  readonly usersDeltaLink?: string | null;
  readonly groupsDeltaLink?: string | null;
  readonly syncUsersAndGroups?: boolean;
  readonly onProgress?: (progress: EntraSyncProgress) => Effect.Effect<void, unknown>;
}) =>
  Effect.gen(function* () {
    const { db, graph, organizationId, azureTenantId } = options;
    const counts = { users: 0, groups: 0, domains: 0 };

    const graphDomains = yield* graph.domains(azureTenantId);

    const verified = graphDomains
      .map((domain) => ({ ...domain, id: normalizedDomain(domain.id) }))
      .filter(
        (domain) =>
          domain.isVerified &&
          !domain.isInitial &&
          domain.id.length > 0 &&
          !domain.id.endsWith(".onmicrosoft.com"),
      );

    for (const domain of verified) {
      const existing = yield* db.query.ssoDomain.findFirst({
        where: { domain: domain.id },
      });

      if (existing && existing.organizationId !== organizationId) {
        // Never reassign a verified domain between tenants. The first owner
        // keeps it; a conflicting sync is skipped.
        continue;
      }

      if (existing) {
        yield* db
          .update(schema.ssoDomain)
          .set({
            organizationId,
            source: "entra",
            isVerified: true,
            verifiedAt: existing.verifiedAt ?? now(),
            updatedAt: now(),
          })
          .where(eq(schema.ssoDomain.domain, domain.id));
      } else {
        yield* db.insert(schema.ssoDomain).values({
          domain: domain.id,
          organizationId,
          source: "entra",
          isVerified: true,
          verifiedAt: now(),
          createdAt: now(),
          updatedAt: now(),
        });
      }

      counts.domains++;
    }

    const knownDomains = new Set(verified.map((domain) => domain.id));

    const staleDomains = yield* db
      .select()
      .from(schema.ssoDomain)
      .where(
        and(
          eq(schema.ssoDomain.organizationId, organizationId),
          eq(schema.ssoDomain.source, "entra"),
        ),
      );

    const stale = staleDomains
      .map((row: { domain: string }) => row.domain)
      .filter((domain: string) => !knownDomains.has(domain));

    if (stale.length)
      yield* db.delete(schema.ssoDomain).where(inArray(schema.ssoDomain.domain, stale));

    if (!options.syncUsersAndGroups) {
      const changedUserIds: string[] = [];

      return { ...counts, usersDelta: undefined, groupsDelta: undefined, changedUserIds };
    }

    let usersDelta: string | undefined;

    const result = yield* syncDirectory({
      db,
      organizationId,
      directory: entraDirectoryUserDirectory({ graph, azureTenantId }),
      usersCursor: options.usersDeltaLink,
      groupsCursor: options.groupsDeltaLink,
      // Persist each resource class's cursor as soon as it is complete, so a
      // later failure does not replay the whole tenant.
      onUsersComplete: (progress) => {
        counts.users = progress.users;
        usersDelta = progress.cursor;

        return options.onProgress
          ? options.onProgress({
              users: progress.users,
              groups: 0,
              domains: counts.domains,
              usersDelta: progress.cursor,
            })
          : Effect.void;
      },
      onGroupsComplete: (progress) =>
        options.onProgress
          ? options.onProgress({
              users: counts.users,
              groups: progress.groups,
              domains: counts.domains,
              usersDelta,
              groupsDelta: progress.cursor,
            })
          : Effect.void,
    });

    return {
      users: result.users,
      groups: result.groups,
      domains: counts.domains,
      usersDelta: result.usersDelta,
      groupsDelta: result.groupsDelta,
      changedUserIds: result.changedUserIds,
    };
  });

/** How many tenants a scheduled sweep may sync at once. Graph is rate limited. */
export const ENTRA_SYNC_CONCURRENCY = 2;

export const ENTRA_GRAPH_NOT_CONFIGURED =
  "Microsoft Graph is not configured. Set AZURE_CLIENT_ID and AZURE_CLIENT_SECRET and grant admin consent.";

export type EntraSyncTrigger = "manual" | "scheduled";

export type EntraDirectorySyncOutcome =
  | {
      readonly status: "ok";
      readonly users: number;
      readonly groups: number;
      readonly domains: number;
      readonly usersDelta?: string;
      readonly groupsDelta?: string;
    }
  | { readonly status: "locked" }
  | { readonly status: "not_configured"; readonly message: string }
  | { readonly status: "error"; readonly message: string };

export type EntraSyncScheduleState = {
  readonly enabled: boolean;
  readonly syncIntervalMinutes: number;
  readonly nextSyncAt?: Date | string | null;
  readonly lastAttemptedAt?: Date | string | null;
};

/**
 * Whether a tenant's automatic directory sync is due. The shared schedule
 * helper implements the `nextSyncAt` / `lastAttemptedAt` fallback once for
 * every provider.
 */
export const isEntraSyncDue = (state: EntraSyncScheduleState, at: Date = new Date()): boolean =>
  isDirectorySyncDue(state, at);

/**
 * Run one tenant's directory sync, reusing the tenant-scoped lock and
 * persisting cursors/status. Callers get a summary instead of a failure so a
 * scheduled sweep can isolate one broken tenant.
 *
 * Manual callers should check `status` to map `not_configured`/`locked`/`error`
 * onto their HTTP error contract.
 */
/** Resolve the devices linked to directory users, scoped to one tenant. */
export const linkedDeviceIdsForUsers = (
  db: EnterpriseDb,
  organizationId: string,
  userIds: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<string>, unknown> =>
  Effect.gen(function* () {
    const ids = [...new Set(userIds)];

    if (ids.length === 0) return [];

    const links = yield* db
      .select({ deviceId: schema.deviceUser.deviceId })
      .from(schema.deviceUser)
      .where(
        and(
          eq(schema.deviceUser.organizationId, organizationId),
          inArray(schema.deviceUser.userId, ids),
        ),
      );

    return [...new Set(links.map((link) => link.deviceId))];
  });

export type EntraMembershipChangeHandler<R = never> = (
  organizationId: string,
  userIds: ReadonlyArray<string>,
) => Effect.Effect<void, unknown, R>;

export const runEntraDirectorySyncForTenant = <R = never>(options: {
  readonly db: EnterpriseDb;
  readonly graph?: AzureGraphService;
  readonly organizationId: string;
  readonly trigger?: EntraSyncTrigger;
  readonly now?: Date;
  /** Called with users whose group membership or enabled state changed. */
  readonly onMembershipsChanged?: EntraMembershipChangeHandler<R>;
}): Effect.Effect<EntraDirectorySyncOutcome, never, R> =>
  Effect.gen(function* () {
    const { db, graph, organizationId } = options;
    const timestamp = options.now ?? now();
    const trigger = options.trigger ?? "manual";

    if (!graph) return { status: "not_configured", message: ENTRA_GRAPH_NOT_CONFIGURED } as const;

    const config = yield* db.query.ssoConfig.findFirst({
      where: { organizationId },
    });

    if (!config?.azureTenantId)
      return {
        status: "not_configured",
        message: "Enable Entra ID SSO with a tenant id first.",
      } as const;

    const state = yield* db.query.entraDirectorySync.findFirst({
      where: { organizationId },
    });

    const interval = state?.syncIntervalMinutes ?? 0;
    const nextSyncAt = nextDirectorySyncAt(interval, timestamp);

    const lock = yield* acquireEntraSyncLock({ db, organizationId, now: timestamp });

    if (!lock.acquired) return { status: "locked" } as const;

    const exit = yield* Effect.exit(
      syncEntraDirectory({
        db,
        graph,
        organizationId,
        azureTenantId: config.azureTenantId,
        autoProvision: config.autoProvision,
        usersDeltaLink: state?.usersDeltaLink,
        groupsDeltaLink: state?.groupsDeltaLink,
        syncUsersAndGroups: true,
        // Persist each resource class's delta cursor as soon as it is
        // complete, so a later failure does not replay the whole tenant.
        onProgress: (progress) =>
          db
            .update(schema.entraDirectorySync)
            .set({
              usersDeltaLink: progress.usersDelta,
              groupsDeltaLink: progress.groupsDelta,
              lastCounts: {
                users: progress.users,
                groups: progress.groups,
                domains: progress.domains,
              },
              // Real heartbeat: a long but healthy sync must not look stale.
              updatedAt: new Date(),
            })
            .where(eq(schema.entraDirectorySync.organizationId, organizationId)),
      }),
    );

    if (Exit.isFailure(exit)) {
      const message = String(exit.cause).slice(0, 2000);
      yield* db
        .update(schema.entraDirectorySync)
        .set({
          status: "error",
          lastError: message,
          lastRunTrigger: trigger,
          nextSyncAt,
          updatedAt: timestamp,
        })
        .where(eq(schema.entraDirectorySync.organizationId, organizationId));

      return { status: "error", message } as const;
    }

    const result = exit.value;

    if (result.changedUserIds.length > 0 && options.onMembershipsChanged)
      yield* options.onMembershipsChanged(organizationId, result.changedUserIds).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            console.error("Entra directory membership refresh failed", organizationId, error);
          }),
        ),
      );

    yield* db
      .update(schema.entraDirectorySync)
      .set({
        status: "idle",
        lastError: null,
        lastSyncedAt: timestamp,
        usersDeltaLink: result.usersDelta,
        groupsDeltaLink: result.groupsDelta,
        lastCounts: {
          users: result.users,
          groups: result.groups,
          domains: result.domains,
        },
        lastRunTrigger: trigger,
        nextSyncAt,
        updatedAt: timestamp,
      })
      .where(eq(schema.entraDirectorySync.organizationId, organizationId));

    return {
      status: "ok",
      users: result.users,
      groups: result.groups,
      domains: result.domains,
      usersDelta: result.usersDelta,
      groupsDelta: result.groupsDelta,
    } as const;
  }).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        console.error("Entra directory sync failed", options.organizationId, error);

        return {
          status: "error",
          message: String(error).slice(0, 2000),
        } as const;
      }),
    ),
  );

export type ScheduledEntraSyncResult = {
  /** False when Graph credentials are absent; nothing was selected or run. */
  readonly graphConfigured: boolean;
  /** Tenants with an enabled, positive cadence that were due. */
  readonly due: number;
  readonly succeeded: number;
  readonly failed: number;
  /** Due tenants skipped because Graph or their Entra tenant id is missing. */
  readonly skipped: number;
  /** Due tenants whose sync was already running elsewhere. */
  readonly locked: number;
};

/**
 * Scheduled sweep: pick tenants with an enabled, positive cadence that are due
 * and sync them with bounded concurrency. A failure or lock conflict for one
 * tenant never aborts the rest.
 */
export const runScheduledEntraSync = <R = never>(options: {
  readonly db: EnterpriseDb;
  readonly graph?: AzureGraphService;
  readonly now?: Date;
  readonly concurrency?: number;
  readonly onMembershipsChanged?: EntraMembershipChangeHandler<R>;
}): Effect.Effect<ScheduledEntraSyncResult, unknown, R> => {
  const { db, graph } = options;
  const timestamp = options.now ?? now();

  const empty = {
    graphConfigured: false,
    due: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    locked: 0,
  } as const;

  if (!graph) return Effect.succeed(empty);

  return Effect.gen(function* () {
    const rows = yield* db
      .select()
      .from(schema.entraDirectorySync)
      .where(
        and(
          eq(schema.entraDirectorySync.enabled, true),
          gt(schema.entraDirectorySync.syncIntervalMinutes, 0),
        ),
      );

    const due = rows.filter((row) => isEntraSyncDue(row, timestamp));

    const outcomes = yield* Effect.forEach(
      due,
      (row) =>
        runEntraDirectorySyncForTenant({
          db,
          graph,
          organizationId: row.organizationId,
          trigger: "scheduled",
          now: timestamp,
          onMembershipsChanged: options.onMembershipsChanged,
        }).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              console.error("Scheduled Entra directory sync failed", row.organizationId, error);

              return { status: "error", message: String(error) } as const;
            }),
          ),
        ),
      { concurrency: Math.max(1, options.concurrency ?? ENTRA_SYNC_CONCURRENCY) },
    );

    return {
      graphConfigured: true,
      due: due.length,
      succeeded: outcomes.filter((outcome) => outcome.status === "ok").length,
      failed: outcomes.filter((outcome) => outcome.status === "error").length,
      skipped: outcomes.filter((outcome) => outcome.status === "not_configured").length,
      locked: outcomes.filter((outcome) => outcome.status === "locked").length,
    };
  });
};
