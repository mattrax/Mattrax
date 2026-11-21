import { Effect, Exit, Schema } from "effect";
import { and, eq, gt, lt, ne } from "drizzle-orm";
import { openSecret } from "@mattrax/crypto";
import { isDirectorySyncDue, nextDirectorySyncAt, syncDirectory } from "@mattrax/directory-sync";
import type { DirectorySyncScheduleState } from "@mattrax/directory-sync";
import { schema } from "@mattrax/enterprise-core";
import type { EnterpriseDb } from "@mattrax/enterprise-core";
import {
  decodeServiceAccountJson,
  GoogleWorkspaceConfigError,
  isEmailAddress,
  normaliseAdminEmail,
  normaliseCustomer,
  redactGoogleCredentials,
} from "./config.js";
import type { GoogleWorkspaceCredentials } from "./config.js";
import { googleWorkspaceDirectoryUserDirectory, GOOGLE_ADMIN_USERS_URL } from "./provider.js";
import { GoogleWorkspaceError } from "./service.js";
import type { GoogleWorkspaceService } from "./service.js";
import { makeGoogleWorkspaceService } from "./service.js";

const now = () => new Date();

/**
 * How long a `running` sync may sit before another request may take over.
 * Matches the Entra lock window: long enough for a large tenant, short enough
 * that a crashed Worker does not wedge sync until someone edits the database.
 */
export const GOOGLE_SYNC_STALE_MS = 15 * 60_000;

/** How many tenants a scheduled Workspace sweep may sync at once. */
export const GOOGLE_SYNC_CONCURRENCY = 2;

export const GOOGLE_WORKSPACE_NOT_CONFIGURED =
  "Google Workspace is not configured for this tenant or deployment. Add a service-account JSON key and the admin to impersonate.";

export type GoogleSyncTrigger = "manual" | "scheduled";

export type GoogleDirectorySyncRow = typeof schema.googleDirectorySync.$inferSelect;

export type GoogleSyncLockState = {
  readonly acquired: boolean;
  readonly stale: boolean;
  readonly previousStatus: "idle" | "running" | "error" | null;
  readonly enabled: boolean;
};

/**
 * Tenant-scoped Google sync lock, stored on `google_directory_sync`.
 *
 * The read and conditional write run in one transaction, and a stale
 * `running` row can only be taken over by one caller because the update
 * matches the stale heartbeat.
 */
export const acquireGoogleSyncLock = (options: {
  readonly db: EnterpriseDb;
  readonly organizationId: string;
  readonly now?: Date;
  readonly staleAfterMs?: number;
}): Effect.Effect<GoogleSyncLockState, unknown> => {
  const { db, organizationId } = options;
  const timestamp = options.now ?? now();
  const staleAfterMs = options.staleAfterMs ?? GOOGLE_SYNC_STALE_MS;

  return db.transaction((tx) =>
    Effect.gen(function* () {
      const state = yield* tx.query.googleDirectorySync.findFirst({
        where: { organizationId },
      });

      if (!state) {
        yield* tx.insert(schema.googleDirectorySync).values({
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
          return { acquired: false, stale: false, previousStatus, enabled: state.enabled };

        const takeover = yield* tx
          .update(schema.googleDirectorySync)
          .set({ status: "running", lastAttemptedAt: timestamp, updatedAt: timestamp })
          .where(
            and(
              eq(schema.googleDirectorySync.organizationId, organizationId),
              eq(schema.googleDirectorySync.status, "running"),
              lt(
                schema.googleDirectorySync.updatedAt,
                new Date(timestamp.getTime() - staleAfterMs),
              ),
            ),
          );

        if (takeover.affectedRows === 0)
          return { acquired: false, stale: false, previousStatus, enabled: state.enabled };

        return { acquired: true, stale: true, previousStatus, enabled: state.enabled };
      }

      const claimed = yield* tx
        .update(schema.googleDirectorySync)
        .set({
          status: "running",
          lastAttemptedAt: timestamp,
          lastError: null,
          updatedAt: timestamp,
        })
        .where(
          and(
            eq(schema.googleDirectorySync.organizationId, organizationId),
            ne(schema.googleDirectorySync.status, "running"),
          ),
        );

      if (claimed.affectedRows === 0)
        return { acquired: false, stale: false, previousStatus, enabled: state.enabled };

      return { acquired: true, stale: false, previousStatus, enabled: state.enabled };
    }),
  );
};

export type LoadedGoogleCredentials = {
  readonly credentials: GoogleWorkspaceCredentials;
  readonly source: "tenant" | "deployment";
};

/**
 * Resolve the credentials for one tenant.
 *
 * Tenant-sealed credentials take precedence; a deployment-wide service account
 * is the fallback so a self-hosted operator can configure Workspace once. The
 * returned object contains the private key and must never be serialised into a
 * response or log.
 */
export const loadGoogleDirectoryConfig = (options: {
  readonly db: EnterpriseDb;
  readonly organizationId: string;
  readonly authSecret?: string;
  readonly deployment?: GoogleWorkspaceCredentials;
}): Effect.Effect<LoadedGoogleCredentials | null, GoogleWorkspaceConfigError | unknown> =>
  Effect.gen(function* () {
    const { db, organizationId, authSecret, deployment } = options;
    const row = yield* db.query.googleDirectorySync.findFirst({ where: { organizationId } });

    if (row?.sealedServiceAccount) {
      if (!authSecret)
        return yield* Effect.fail(
          new GoogleWorkspaceConfigError({
            message:
              "This tenant's Google credentials are encrypted but the deployment has no AUTH_SECRET, so they cannot be read.",
          }),
        );

      const json = yield* Effect.tryPromise({
        try: () => openSecret(authSecret, row.sealedServiceAccount!),
        catch: () =>
          new GoogleWorkspaceConfigError({
            message: "The stored Google service-account credentials could not be decrypted.",
          }),
      });

      const serviceAccount = yield* decodeServiceAccountJson(json);
      const adminEmail = normaliseAdminEmail(row.adminEmail ?? "");

      if (!isEmailAddress(adminEmail))
        return yield* Effect.fail(
          new GoogleWorkspaceConfigError({
            message:
              "The tenant's Google admin email is missing or invalid. Save the credentials again.",
          }),
        );

      return {
        source: "tenant" as const,
        credentials: {
          serviceAccount,
          adminEmail,
          customer: normaliseCustomer(row.customer),
        },
      };
    }

    if (deployment) return { source: "deployment" as const, credentials: deployment };

    return null;
  });

export type GoogleDirectorySyncStatusView = {
  readonly configured: boolean;
  readonly enabled: boolean;
  readonly status: "idle" | "running" | "error";
  readonly credentialsSource: "tenant" | "deployment" | null;
  readonly adminEmail: string | null;
  readonly customer: string | null;
  readonly serviceAccountEmail: string | null;
  readonly lastSyncedAt: Date | null;
  readonly lastAttemptedAt: Date | null;
  readonly lastHeartbeatAt: Date | null;
  readonly lastRunTrigger: "manual" | "scheduled" | null;
  readonly lastError: string | null;
  readonly lastCounts: unknown;
  readonly syncIntervalMinutes: number;
  readonly nextSyncAt: Date | null;
  readonly adminDirectoryUrl: string;
};

/**
 * The dashboard-facing status. Built from explicit, safe fields only, so the
 * sealed service-account JSON and private key cannot reach a response even if
 * the row gains more columns later.
 */
export const googleDirectorySyncStatus = (
  row: GoogleDirectorySyncRow | undefined,
  options: { readonly deployment?: GoogleWorkspaceCredentials } = {},
): GoogleDirectorySyncStatusView => {
  const tenantCredentials = Boolean(row?.sealedServiceAccount);
  const deployment = options.deployment;
  const source = tenantCredentials ? "tenant" : deployment ? "deployment" : null;

  return {
    configured: source !== null,
    enabled: row?.enabled ?? false,
    status: Schema.decodeUnknownSync(Schema.Literals(["idle", "running", "error"]))(
      row?.status ?? "idle",
    ),
    credentialsSource: source,
    adminEmail: tenantCredentials ? (row?.adminEmail ?? null) : (deployment?.adminEmail ?? null),
    customer: tenantCredentials ? normaliseCustomer(row?.customer) : (deployment?.customer ?? null),
    serviceAccountEmail: tenantCredentials
      ? (row?.serviceAccountEmail ?? null)
      : (deployment?.serviceAccount.clientEmail ?? null),
    lastSyncedAt: row?.lastSyncedAt ?? null,
    lastAttemptedAt: row?.lastAttemptedAt ?? null,
    lastHeartbeatAt: row?.updatedAt ?? null,
    lastRunTrigger: row?.lastRunTrigger ?? null,
    lastError: row?.lastError ?? null,
    lastCounts: row?.lastCounts ?? null,
    syncIntervalMinutes: row?.syncIntervalMinutes ?? 0,
    nextSyncAt: row?.nextSyncAt ?? null,
    adminDirectoryUrl: GOOGLE_ADMIN_USERS_URL,
  };
};

export const isGoogleSyncDue = (
  state: DirectorySyncScheduleState,
  at: Date = new Date(),
): boolean => isDirectorySyncDue(state, at);

export type GoogleMembershipChangeHandler<R = never> = (
  organizationId: string,
  userIds: ReadonlyArray<string>,
) => Effect.Effect<void, unknown, R>;

export type GoogleDirectorySyncOutcome =
  | { readonly status: "ok"; readonly users: number; readonly groups: number }
  | { readonly status: "locked" }
  | { readonly status: "not_configured"; readonly message: string }
  | { readonly status: "error"; readonly message: string };

/**
 * Run one tenant's Workspace sync.
 *
 * Credentials are resolved by the caller (and can come from the tenant row or
 * deployment config). A run never fails the caller: scheduled sweeps get a
 * summary and isolate one broken tenant.
 */
export const runGoogleDirectorySyncForTenant = <R = never>(options: {
  readonly db: EnterpriseDb;
  readonly organizationId: string;
  readonly credentials?: GoogleWorkspaceCredentials | null;
  readonly trigger?: GoogleSyncTrigger;
  readonly now?: Date;
  /** Test seam; production builds a service from the credentials. */
  readonly service?: GoogleWorkspaceService;
  readonly onMembershipsChanged?: GoogleMembershipChangeHandler<R>;
}): Effect.Effect<GoogleDirectorySyncOutcome, never, R> =>
  Effect.gen(function* () {
    const { db, organizationId, credentials } = options;
    const timestamp = options.now ?? now();
    const trigger = options.trigger ?? "manual";

    if (!credentials)
      return { status: "not_configured", message: GOOGLE_WORKSPACE_NOT_CONFIGURED } as const;

    const state = yield* db.query.googleDirectorySync.findFirst({ where: { organizationId } });
    const interval = state?.syncIntervalMinutes ?? 0;
    const nextSyncAt = nextDirectorySyncAt(interval, timestamp);

    const lock = yield* acquireGoogleSyncLock({ db, organizationId, now: timestamp });

    if (!lock.acquired) return { status: "locked" } as const;

    const service = options.service ?? makeGoogleWorkspaceService({ credentials });

    const exit = yield* Effect.exit(
      syncDirectory({
        db,
        organizationId,
        directory: googleWorkspaceDirectoryUserDirectory({ service }),
        // Google has no persisted cursor: every run is a complete listing, and
        // the pipeline reconciles people/groups that disappeared.
        onUsersComplete: (progress) =>
          db
            .update(schema.googleDirectorySync)
            .set({
              lastCounts: { users: progress.users, groups: 0 },
              // Real heartbeat: a long healthy run must not look stale.
              updatedAt: new Date(),
            })
            .where(eq(schema.googleDirectorySync.organizationId, organizationId)),
        onGroupsComplete: (progress) =>
          db
            .update(schema.googleDirectorySync)
            .set({
              lastCounts: { users: progress.users, groups: progress.groups },
              updatedAt: new Date(),
            })
            .where(eq(schema.googleDirectorySync.organizationId, organizationId)),
      }),
    );

    if (Exit.isFailure(exit)) {
      const message = redactGoogleCredentials(String(exit.cause), credentials).slice(0, 2000);

      yield* db
        .update(schema.googleDirectorySync)
        .set({
          status: "error",
          lastError: message,
          lastRunTrigger: trigger,
          nextSyncAt,
          updatedAt: timestamp,
        })
        .where(eq(schema.googleDirectorySync.organizationId, organizationId));

      return { status: "error", message } as const;
    }

    const result = exit.value;

    if (result.changedUserIds.length > 0 && options.onMembershipsChanged)
      yield* options.onMembershipsChanged(organizationId, result.changedUserIds).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            console.error("Google directory membership refresh failed", organizationId, error);
          }),
        ),
      );

    yield* db
      .update(schema.googleDirectorySync)
      .set({
        status: "idle",
        lastError: null,
        lastSyncedAt: timestamp,
        lastCounts: { users: result.users, groups: result.groups },
        lastRunTrigger: trigger,
        nextSyncAt,
        updatedAt: timestamp,
      })
      .where(eq(schema.googleDirectorySync.organizationId, organizationId));

    return { status: "ok", users: result.users, groups: result.groups } as const;
  }).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        console.error("Google directory sync failed", options.organizationId, error);

        return {
          status: "error",
          message: redactGoogleCredentials(String(error), options.credentials ?? undefined).slice(
            0,
            2000,
          ),
        } as const;
      }),
    ),
  );

export type ScheduledGoogleSyncResult = {
  /** Tenants with an enabled, positive cadence that were due. */
  readonly due: number;
  readonly succeeded: number;
  readonly failed: number;
  /** Due tenants with no tenant or deployment credentials. */
  readonly skipped: number;
  readonly locked: number;
};

/**
 * Scheduled sweep: pick tenants with an enabled cadence that are due and sync
 * them with bounded concurrency. A failure or lock conflict for one tenant
 * never aborts the rest.
 */
export const runScheduledGoogleSync = <R = never>(options: {
  readonly db: EnterpriseDb;
  readonly resolveCredentials: (
    organizationId: string,
  ) => Effect.Effect<GoogleWorkspaceCredentials | null, unknown, R>;
  readonly now?: Date;
  readonly concurrency?: number;
  readonly onMembershipsChanged?: GoogleMembershipChangeHandler<R>;
  /** Test seam; production builds a service per tenant from its credentials. */
  readonly service?: GoogleWorkspaceService;
}): Effect.Effect<ScheduledGoogleSyncResult, unknown, R> => {
  const { db } = options;
  const timestamp = options.now ?? now();

  return Effect.gen(function* () {
    const rows = yield* db
      .select()
      .from(schema.googleDirectorySync)
      .where(
        and(
          eq(schema.googleDirectorySync.enabled, true),
          gt(schema.googleDirectorySync.syncIntervalMinutes, 0),
        ),
      );

    const due = rows.filter((row) => isGoogleSyncDue(row, timestamp));

    const outcomes = yield* Effect.forEach(
      due,
      (row) =>
        Effect.gen(function* () {
          const credentials = yield* options.resolveCredentials(row.organizationId);

          if (!credentials)
            return { status: "not_configured", message: GOOGLE_WORKSPACE_NOT_CONFIGURED } as const;

          return yield* runGoogleDirectorySyncForTenant({
            db,
            organizationId: row.organizationId,
            credentials,
            trigger: "scheduled",
            now: timestamp,
            service: options.service,
            onMembershipsChanged: options.onMembershipsChanged,
          });
        }).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              console.error("Scheduled Google directory sync failed", row.organizationId, error);

              return { status: "error", message: String(error) } as const;
            }),
          ),
        ),
      { concurrency: Math.max(1, options.concurrency ?? GOOGLE_SYNC_CONCURRENCY) },
    );

    return {
      due: due.length,
      succeeded: outcomes.filter((outcome) => outcome.status === "ok").length,
      failed: outcomes.filter((outcome) => outcome.status === "error").length,
      skipped: outcomes.filter((outcome) => outcome.status === "not_configured").length,
      locked: outcomes.filter((outcome) => outcome.status === "locked").length,
    };
  });
};

/** True for the Google error type, used by tests and callers formatting errors. */
export const isGoogleWorkspaceError = (error: unknown): error is GoogleWorkspaceError =>
  error instanceof GoogleWorkspaceError;
