import { Effect, Exit, Option, Predicate, Schema } from "effect";
import { and, eq, gt, inArray, lt, ne } from "drizzle-orm";
import type {
  AzureGraphError,
  AzureGraphService,
  GraphGroup,
  GraphUser,
} from "@mattrax/azure-graph";
import { schema, type EnterpriseDb } from "@mattrax/enterprise-core";
import { isBuiltInOwnerMember, settlePendingInvitations } from "@mattrax/enterprise-identity";

const newId = () => crypto.randomUUID();

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

type EntraSyncDatabase = Pick<EnterpriseDb, "query" | "select" | "insert" | "update" | "delete">;

const ownerCount = (database: EntraSyncDatabase, organizationId: string) =>
  Effect.gen(function* () {
    const rows = yield* database
      .select({ role: schema.member.role, customRoleId: schema.member.customRoleId })
      .from(schema.member)
      .where(eq(schema.member.organizationId, organizationId));

    return rows.filter((row: { role: string; customRoleId?: string | null }) =>
      isBuiltInOwnerMember(row),
    ).length;
  });

const findIdentity = (database: EntraSyncDatabase, organizationId: string, objectId: string) =>
  database.query.ssoIdentity.findFirst({
    where: { organizationId, objectId },
  });

type UserPageContext = {
  readonly organizationId: string;
  readonly autoProvision: boolean;
  readonly seenObjectIds: Set<string>;
  readonly changedUserIds: Set<string>;
  readonly onUser: () => void;
};

/**
 * Apply one `/users/delta` page. Callers run this inside a transaction so a
 * failure half-way through a page cannot leave a user provisioned without its
 * membership/identity link.
 */
const syncUsersPage = (
  database: EntraSyncDatabase,
  users: ReadonlyArray<GraphUser>,
  context: UserPageContext,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const { organizationId, autoProvision, seenObjectIds } = context;

    for (const user of users) {
      const email = (user.mail ?? user.userPrincipalName)?.trim().toLowerCase();
      const identity = user.id ? yield* findIdentity(database, organizationId, user.id) : undefined;

      let existing = identity
        ? yield* database.query.user.findFirst({ where: { id: identity.userId } })
        : undefined;

      if (!existing && email) {
        const byEmail = yield* database.query.user.findFirst({ where: { email } });

        if (byEmail) {
          // Mirror the SSO guard: link an existing account by email only when
          // this is its sole tenant. Never pull another tenant's user into this
          // directory.
          const memberships = yield* database.query.member.findMany({
            where: { userId: byEmail.id },
          });

          if (
            (memberships.length === 1 && memberships[0]?.organizationId === organizationId) ||
            (memberships.length === 0 && autoProvision)
          )
            existing = byEmail;
          else continue;
        }
      }

      if (user.removed || user.accountEnabled === false) {
        if (existing) {
          const membership = yield* database.query.member.findFirst({
            where: { organizationId, userId: existing.id },
          });

          if (
            membership &&
            isBuiltInOwnerMember(membership) &&
            (yield* ownerCount(database, organizationId)) <= 1
          )
            continue;
          yield* database
            .delete(schema.member)
            .where(
              and(
                eq(schema.member.organizationId, organizationId),
                eq(schema.member.userId, existing.id),
              ),
            );

          const orgGroups = yield* database
            .select({ id: schema.userGroup.id })
            .from(schema.userGroup)
            .where(eq(schema.userGroup.organizationId, organizationId));

          // Kept inline rather than using clearTenantUserDirectoryState: a
          // directory sync must delete only the graph object it no longer sees
          // and reuses the tenant's group list selected here, whereas the
          // shared helper is user-scoped and reloads groups per call.
          if (orgGroups.length)
            yield* database.delete(schema.userGroupMember).where(
              and(
                eq(schema.userGroupMember.userId, existing.id),
                inArray(
                  schema.userGroupMember.groupId,
                  orgGroups.map((group: { id: string }) => group.id),
                ),
              ),
            );

          const remaining = yield* database
            .select()
            .from(schema.member)
            .where(eq(schema.member.userId, existing.id));

          if (remaining.length === 0)
            yield* database
              .update(schema.user)
              .set({ disabled: true, updatedAt: now() })
              .where(eq(schema.user.id, existing.id));
          context.changedUserIds.add(existing.id);
        }

        if (user.id)
          yield* database
            .delete(schema.ssoIdentity)
            .where(
              and(
                eq(schema.ssoIdentity.organizationId, organizationId),
                eq(schema.ssoIdentity.objectId, user.id),
              ),
            );
        continue;
      }

      if (!email || !user.id) continue;
      let userId = existing?.id;

      if (!userId) {
        if (!autoProvision) continue;
        userId = newId();
        yield* database.insert(schema.user).values({
          id: userId,
          name: user.displayName?.trim() || email,
          email,
          emailVerified: true,
          disabled: false,
          source: "graph",
          authRevision: newId(),
          createdAt: now(),
          updatedAt: now(),
        });
      }

      const membership = yield* database.query.member.findFirst({
        where: { organizationId, userId },
      });

      if (!membership)
        yield* database.insert(schema.member).values({
          id: newId(),
          organizationId,
          userId,
          role: "member",
          createdAt: now(),
          updatedAt: now(),
        });

      // A directory-provisioned membership closes any matching invitation.
      yield* settlePendingInvitations(database, organizationId, email, now());

      if (existing?.disabled) {
        yield* database
          .update(schema.user)
          .set({ disabled: false, updatedAt: now() })
          .where(eq(schema.user.id, userId));
        context.changedUserIds.add(userId);
      }

      if (!identity)
        yield* database.insert(schema.ssoIdentity).values({
          organizationId,
          objectId: user.id,
          userId,
          createdAt: now(),
        });
      seenObjectIds.add(user.id);
      context.onUser();
    }
  });

type GroupPageContext = {
  readonly organizationId: string;
  readonly seenGroupIds: Set<string>;
  readonly changedUserIds: Set<string>;
  readonly onGroup: () => void;
};

/** Apply one `/groups/delta` page inside a transaction. */
const syncGroupsPage = (
  database: EntraSyncDatabase,
  groups: ReadonlyArray<GraphGroup>,
  context: GroupPageContext,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const { organizationId, seenGroupIds } = context;

    for (const group of groups) {
      const existing = yield* database.query.userGroup.findFirst({
        where: { organizationId, externalId: group.id },
      });

      if (group.removed) {
        if (existing) {
          // Deleting the group cascades its memberships; those users must be
          // refreshed so their devices drop the group's policies.
          const members = yield* database
            .select({ userId: schema.userGroupMember.userId })
            .from(schema.userGroupMember)
            .where(eq(schema.userGroupMember.groupId, existing.id));

          for (const member of members) context.changedUserIds.add(member.userId);
          yield* database.delete(schema.userGroup).where(eq(schema.userGroup.id, existing.id));
        }

        continue;
      }

      let groupId = existing?.id;

      if (!groupId) {
        groupId = newId();
        yield* database.insert(schema.userGroup).values({
          id: groupId,
          organizationId,
          name: group.displayName || group.id,
          externalId: group.id,
          description: group.description ?? null,
          source: "graph",
          createdAt: now(),
          updatedAt: now(),
        });
      } else {
        yield* database
          .update(schema.userGroup)
          .set({
            name: group.displayName || existing!.name,
            description: group.description ?? existing!.description,
            source: "graph",
            updatedAt: now(),
          })
          .where(eq(schema.userGroup.id, groupId));
      }

      for (const member of group.members ?? []) {
        if (member.type && member.type !== "user") continue;
        const identity = yield* findIdentity(database, organizationId, member.id);

        if (!identity) continue;

        if (member.removed) {
          yield* database
            .delete(schema.userGroupMember)
            .where(
              and(
                eq(schema.userGroupMember.groupId, groupId),
                eq(schema.userGroupMember.userId, identity.userId),
              ),
            );
          context.changedUserIds.add(identity.userId);
        } else {
          const membership = yield* database.query.member.findFirst({
            where: { organizationId, userId: identity.userId },
          });

          if (!membership) continue;

          const alreadyLinked = yield* database
            .select({ userId: schema.userGroupMember.userId })
            .from(schema.userGroupMember)
            .where(
              and(
                eq(schema.userGroupMember.groupId, groupId),
                eq(schema.userGroupMember.userId, identity.userId),
              ),
            )
            .limit(1);

          if (alreadyLinked.length === 0) {
            yield* database
              .insert(schema.userGroupMember)
              .ignore()
              .values({ groupId, userId: identity.userId });
            context.changedUserIds.add(identity.userId);
          }
        }
      }

      seenGroupIds.add(group.id);
      context.onGroup();
    }
  });

/**
 * Pull verified domains and (optionally) users/groups from Microsoft Graph.
 * The sync is delta-based: the stored deltaLink is passed on the next run and
 * replaced with the fresh one. Removed/disabled users lose their tenant
 * membership; Graph-sourced groups are upserted by Entra object id.
 *
 * Each Graph page is applied in its own transaction, and `onProgress` fires as
 * soon as a resource class completes so the caller can persist that cursor even
 * if a later page fails.
 */
export const syncEntraDirectory = (options: {
  readonly db: EnterpriseDb;
  readonly graph: AzureGraphService;
  readonly organizationId: string;
  readonly azureTenantId: string;
  readonly autoProvision: boolean;
  readonly usersDeltaLink?: string | null;
  readonly groupsDeltaLink?: string | null;
  readonly syncUsersAndGroups?: boolean;
  readonly onProgress?: (progress: EntraSyncProgress) => Effect.Effect<void, unknown>;
}) =>
  Effect.gen(function* () {
    const { db, graph, organizationId, azureTenantId, autoProvision } = options;
    const counts = { users: 0, groups: 0, domains: 0 };
    let usersDelta: string | undefined;
    let groupsDelta: string | undefined;

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

    const knownDomains = verified.map((domain) => domain.id);

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
      .filter((domain: string) => !knownDomains.includes(domain));

    if (stale.length)
      yield* db.delete(schema.ssoDomain).where(inArray(schema.ssoDomain.domain, stale));

    if (!options.syncUsersAndGroups)
      return { ...counts, usersDelta, groupsDelta, changedUserIds: [] };

    const isExpiredDelta = (error: AzureGraphError) =>
      Predicate.isTagged(error, "RequestFailed") &&
      (error.status === 410 || /syncStateNotFound|resyncRequired|resync/i.test(error.body ?? ""));

    // A full listing (first sync, or after Graph expires the delta cursor)
    // is authoritative: identities and groups that no longer appear must be
    // reconciled away. Delta pages only describe changes.
    let usersReset = false;
    let groupsReset = false;

    const usersDeltaPage = (link?: string) =>
      graph.usersDelta(azureTenantId, link).pipe(
        Effect.catchIf(isExpiredDelta, () => {
          usersReset = true;

          return graph.usersDelta(azureTenantId, undefined);
        }),
      );

    const groupsDeltaPage = (link?: string) =>
      graph.groupsDelta(azureTenantId, link).pipe(
        Effect.catchIf(isExpiredDelta, () => {
          groupsReset = true;

          return graph.groupsDelta(azureTenantId, undefined);
        }),
      );

    const seenObjectIds = new Set<string>();
    const changedUserIds = new Set<string>();

    const userContext: UserPageContext = {
      organizationId,
      autoProvision,
      seenObjectIds,
      changedUserIds,
      onUser: () => {
        counts.users++;
      },
    };

    let usersLink = options.usersDeltaLink ?? undefined;
    let usersComplete = false;

    for (let page = 0; page < 1000; page++) {
      const result = yield* usersDeltaPage(usersLink);
      // `tx` has the same query/builders as the outer db; the cast keeps the
      // page helpers usable from both.
      yield* db.transaction((tx) => syncUsersPage(tx, result.items, userContext));

      if (!result.nextLink) {
        usersDelta = result.deltaLink ?? undefined;
        usersComplete = true;
        break;
      }

      usersLink = result.nextLink;
    }

    if (!usersComplete)
      return yield* Effect.fail(new Error("Directory sync exceeded 1000 user pages"));

    if (options.onProgress)
      yield* options.onProgress({
        users: counts.users,
        groups: counts.groups,
        domains: counts.domains,
        usersDelta,
      });

    if (!options.usersDeltaLink || usersReset) {
      const identities = yield* db
        .select()
        .from(schema.ssoIdentity)
        .where(eq(schema.ssoIdentity.organizationId, organizationId));

      const orgGroups = yield* db
        .select({ id: schema.userGroup.id })
        .from(schema.userGroup)
        .where(eq(schema.userGroup.organizationId, organizationId));

      for (const identity of identities) {
        if (seenObjectIds.has(identity.objectId)) continue;

        const membership = yield* db.query.member.findFirst({
          where: { organizationId, userId: identity.userId },
        });

        if (membership) {
          // Never strand a tenant without an owner during reconciliation.
          if (isBuiltInOwnerMember(membership) && (yield* ownerCount(db, organizationId)) <= 1)
            continue;
          yield* db
            .delete(schema.member)
            .where(
              and(
                eq(schema.member.organizationId, organizationId),
                eq(schema.member.userId, identity.userId),
              ),
            );

          // Inline for the same reason as the page sync path above: only the
          // reconciled object's identity row may be removed, and the group list
          // is selected once for the whole tenant.
          if (orgGroups.length)
            yield* db.delete(schema.userGroupMember).where(
              and(
                eq(schema.userGroupMember.userId, identity.userId),
                inArray(
                  schema.userGroupMember.groupId,
                  orgGroups.map((group: { id: string }) => group.id),
                ),
              ),
            );

          const remaining = yield* db
            .select({ id: schema.member.id })
            .from(schema.member)
            .where(eq(schema.member.userId, identity.userId));

          if (remaining.length === 0)
            yield* db
              .update(schema.user)
              .set({ disabled: true, updatedAt: now() })
              .where(eq(schema.user.id, identity.userId));
          changedUserIds.add(identity.userId);
        }

        yield* db
          .delete(schema.ssoIdentity)
          .where(
            and(
              eq(schema.ssoIdentity.organizationId, organizationId),
              eq(schema.ssoIdentity.objectId, identity.objectId),
            ),
          );
      }
    }

    const seenGroupIds = new Set<string>();

    const groupContext: GroupPageContext = {
      organizationId,
      seenGroupIds,
      changedUserIds,
      onGroup: () => {
        counts.groups++;
      },
    };

    let groupsLink = options.groupsDeltaLink ?? undefined;
    let groupsComplete = false;

    for (let page = 0; page < 1000; page++) {
      const result = yield* groupsDeltaPage(groupsLink);
      yield* db.transaction((tx) => syncGroupsPage(tx, result.items, groupContext));

      if (!result.nextLink) {
        groupsDelta = result.deltaLink ?? undefined;
        groupsComplete = true;
        break;
      }

      groupsLink = result.nextLink;
    }

    if (!groupsComplete)
      return yield* Effect.fail(new Error("Directory sync exceeded 1000 group pages"));

    if (options.onProgress)
      yield* options.onProgress({
        users: counts.users,
        groups: counts.groups,
        domains: counts.domains,
        usersDelta,
        groupsDelta,
      });

    if (!options.groupsDeltaLink || groupsReset) {
      const graphGroups = yield* db
        .select()
        .from(schema.userGroup)
        .where(
          and(
            eq(schema.userGroup.organizationId, organizationId),
            eq(schema.userGroup.source, "graph"),
          ),
        );

      const staleGroups = graphGroups
        .filter((group) => group.externalId && !seenGroupIds.has(group.externalId))
        .map((group) => group.id);

      if (staleGroups.length)
        yield* db.delete(schema.userGroup).where(inArray(schema.userGroup.id, staleGroups));
    }

    return { ...counts, usersDelta, groupsDelta, changedUserIds: [...changedUserIds] };
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

const toTime = (value: Schema.Json | Date | null | undefined): number | null => {
  const date = Schema.is(Schema.Date)(value)
    ? value
    : Option.getOrUndefined(Schema.decodeUnknownOption(Schema.Date)(value));

  return date === undefined || !Number.isFinite(date.getTime()) ? null : date.getTime();
};

/**
 * Whether a tenant's automatic directory sync is due.
 *
 * `nextSyncAt` is authoritative when present (it is written after every run and
 * whenever the cadence changes). Rows created before the schedule existed fall
 * back to `lastAttemptedAt + interval`, and a tenant that has never run is due
 * immediately.
 */
export const isEntraSyncDue = (state: EntraSyncScheduleState, at: Date = new Date()): boolean => {
  if (!state.enabled) return false;
  const interval = state.syncIntervalMinutes;

  if (!Number.isFinite(interval) || interval <= 0) return false;
  const nowMs = at.getTime();
  const next = toTime(state.nextSyncAt);

  if (next !== null) return next <= nowMs;
  const last = toTime(state.lastAttemptedAt);

  if (last === null) return true;

  return last + interval * 60_000 <= nowMs;
};

const nextSyncAtFor = (intervalMinutes: number, at: Date): Date | null =>
  Number.isFinite(intervalMinutes) && intervalMinutes > 0
    ? new Date(at.getTime() + intervalMinutes * 60_000)
    : null;

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
    const nextSyncAt = nextSyncAtFor(interval, timestamp);

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
        Effect.catch((cause) =>
          Effect.sync(() => {
            console.error("Entra directory membership refresh failed", organizationId, cause);
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
    Effect.catch((cause) =>
      Effect.sync(() => {
        console.error("Entra directory sync failed", options.organizationId, cause);

        return {
          status: "error",
          message: String(cause).slice(0, 2000),
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
          Effect.catch((cause) =>
            Effect.sync(() => {
              console.error("Scheduled Entra directory sync failed", row.organizationId, cause);

              return { status: "error", message: String(cause) } as const;
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
