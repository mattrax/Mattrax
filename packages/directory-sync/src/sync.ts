import { GroupId, UserId } from "@mattrax/crypto";
import { Data, Effect } from "effect";
import { and, eq, inArray } from "drizzle-orm";
import { schema } from "@mattrax/enterprise-core";
import type { EnterpriseDb } from "@mattrax/enterprise-core";
import type {
  DirectoryGroupRecord,
  DirectoryProviderGroupSource,
  DirectoryProviderUserSource,
  DirectoryUserDirectory,
  DirectoryUserRecord,
} from "./provider.js";


/** Guards a runaway provider that never clears its next cursor. */
export const DIRECTORY_SYNC_MAX_PAGES = 1000;

export type DirectorySyncDatabase = Pick<
  EnterpriseDb,
  "query" | "select" | "insert" | "update" | "delete"
>;

export class DirectorySyncError extends Data.TaggedError("DirectorySyncError")<{
  readonly message: string;
  readonly phase: "users" | "groups";
}> {}

export class DirectorySyncTransactionError extends Data.TaggedError(
  "DirectorySyncTransactionError",
)<{
  readonly phase: "users" | "groups";
  readonly cause: unknown;
}> {}

const now = () => new Date();

const normalisedEmail = (email: string) => email.trim().toLowerCase();

export type DirectoryUserPageContext = {
  readonly organizationId: string;
  readonly source: DirectoryProviderUserSource;
  readonly seenExternalIds: Set<string>;
  readonly changedUserIds: Set<string>;
  readonly onUser?: () => void;
  readonly at?: Date;
};

/**
 * Apply one page of users inside a transaction.
 *
 * Directory sync owns `user` rows only. It never creates dashboard accounts,
 * memberships, invitations or `ssoIdentity` links: an account is a separate
 * identity that signs in, while a directory user is a person a policy or group
 * can target. Removing a person from the directory therefore disables them and
 * drops their directory memberships but leaves device links intact so the
 * dashboard can still explain what the device was.
 */
export const applyUserPage = (
  database: DirectorySyncDatabase,
  page: ReadonlyArray<DirectoryUserRecord>,
  context: DirectoryUserPageContext,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const { organizationId, source, seenExternalIds } = context;
    const timestamp = context.at ?? now();

    for (const user of page) {
      const email = user.email ? normalisedEmail(user.email) : "";

      // Match the provider object first, then the tenant-local address. The
      // address lookup is scoped to this organization: another tenant's
      // directory and the global account table are never consulted.
      let existing = user.externalId
        ? yield* database.query.user.findFirst({
            where: { organizationId, externalId: user.externalId },
          })
        : undefined;

      // An address already owned by a different directory provider is not
      // ours to rewrite: two providers in one tenant may both know the person,
      // and flipping the row between them would churn policy and device
      // state. Manual/SCIM rows are safe to adopt (the original Entra rule).
      let ownedByOtherProvider = false;

      if (!existing && email) {
        const byEmail = yield* database.query.user.findFirst({
          where: { organizationId, email },
        });

        if (
          byEmail?.source === source ||
          byEmail?.source === "manual" ||
          byEmail?.source === "scim"
        )
          existing = byEmail;
        else if (byEmail) ownedByOtherProvider = true;
      }

      if (ownedByOtherProvider) continue;

      if (user.removed || user.disabled) {
        // Disabled/deleted records still belong to this authoritative listing.
        // Seeing them prevents the final reconciliation pass from treating
        // them as missing on every full sync.
        seenExternalIds.add(user.externalId);

        if (existing) {
          const alreadyDisabled = existing.disabled;

          if (!alreadyDisabled)
            yield* database
              .update(schema.user)
              .set({ disabled: true, updatedAt: timestamp })
              .where(eq(schema.user.id, existing.id));

          // The person's directory grants go with them. Accounts, memberships
          // and SSO identity links are not directory state and are untouched.
          const orgGroups = yield* database
            .select({ id: schema.userGroup.id })
            .from(schema.userGroup)
            .where(eq(schema.userGroup.organizationId, organizationId));

          const memberships = orgGroups.length
            ? yield* database
                .select({ userId: schema.userGroupMember.userId })
                .from(schema.userGroupMember)
                .where(
                  and(
                    eq(schema.userGroupMember.userId, existing.id),
                    inArray(
                      schema.userGroupMember.groupId,
                      orgGroups.map((group: { id: string }) => group.id),
                    ),
                  ),
                )
                .limit(1)
            : [];

          if (memberships.length)
            yield* database.delete(schema.userGroupMember).where(
              and(
                eq(schema.userGroupMember.userId, existing.id),
                inArray(
                  schema.userGroupMember.groupId,
                  orgGroups.map((group: { id: string }) => group.id),
                ),
              ),
            );

          // Wake devices only for an actual enabled-state or membership
          // transition, not because the same disabled record appeared again.
          if (!alreadyDisabled || memberships.length > 0) context.changedUserIds.add(existing.id);
        }

        continue;
      }

      // A directory person needs an object id and an address; without either
      // there is nothing stable to upsert.
      if (!email || !user.externalId) continue;

      seenExternalIds.add(user.externalId);

      const name = user.name?.trim() || email;

      if (!existing) {
        yield* database.insert(schema.user).values({
          id: UserId.make(),
          organizationId,
          name,
          email,
          externalId: user.externalId,
          source,
          disabled: false,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      } else {
        // Only write when something changed. Google has no delta cursor, so a
        // full sync runs every time; bumping `updatedAt` on every row would
        // churn the dashboard and destroy "changed since" signals.
        const changed =
          existing.name !== name ||
          existing.email !== email ||
          existing.externalId !== user.externalId ||
          existing.source !== source ||
          existing.disabled;

        if (changed)
          yield* database
            .update(schema.user)
            .set({
              name,
              email,
              externalId: user.externalId,
              source,
              disabled: false,
              updatedAt: timestamp,
            })
            .where(eq(schema.user.id, existing.id));

        // Re-enabling a person is a state change devices must observe; other
        // field updates are not.
        if (existing.disabled) context.changedUserIds.add(existing.id);
      }

      context.onUser?.();
    }
  });

export type DirectoryGroupPageContext = {
  readonly organizationId: string;
  readonly source: DirectoryProviderGroupSource;
  readonly seenExternalIds: Set<string>;
  readonly changedUserIds: Set<string>;
  readonly onGroup?: () => void;
  readonly at?: Date;
  /** Complete provider membership listing for each group on this page. */
  readonly authoritative?: boolean;
};

/** Apply one page of groups (and membership deltas) inside a transaction. */
export const applyGroupPage = (
  database: DirectorySyncDatabase,
  page: ReadonlyArray<DirectoryGroupRecord>,
  context: DirectoryGroupPageContext,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const { organizationId, source, seenExternalIds } = context;
    const timestamp = context.at ?? now();

    for (const group of page) {
      const existing = yield* database.query.userGroup.findFirst({
        where: { organizationId, externalId: group.externalId },
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
        groupId = GroupId.make();
        yield* database.insert(schema.userGroup).values({
          id: groupId,
          organizationId,
          name: group.name || group.externalId,
          externalId: group.externalId,
          description: group.description ?? null,
          source,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      } else if (
        existing &&
        (existing.name !== (group.name || existing.name) ||
          existing.description !== (group.description ?? existing.description) ||
          existing.source !== source)
      ) {
        yield* database
          .update(schema.userGroup)
          .set({
            name: group.name || existing.name,
            description: group.description ?? existing.description,
            source,
            updatedAt: timestamp,
          })
          .where(eq(schema.userGroup.id, groupId));
      }

      const desiredUserIds = new Set<string>();

      for (const member of group.members) {
        // Members are matched by provider object id inside this tenant's
        // directory. There is no account/member join: users are directory
        // people, not dashboard accounts.
        const directoryUser = yield* database.query.user.findFirst({
          where: { organizationId, externalId: member.externalId },
        });

        if (!directoryUser) continue;

        if (member.removed) {
          const linked = yield* database
            .select({ userId: schema.userGroupMember.userId })
            .from(schema.userGroupMember)
            .where(
              and(
                eq(schema.userGroupMember.groupId, groupId),
                eq(schema.userGroupMember.userId, directoryUser.id),
              ),
            )
            .limit(1);

          if (linked.length) {
            yield* database
              .delete(schema.userGroupMember)
              .where(
                and(
                  eq(schema.userGroupMember.groupId, groupId),
                  eq(schema.userGroupMember.userId, directoryUser.id),
                ),
              );
            context.changedUserIds.add(directoryUser.id);
          }
        } else {
          // A suspended/deleted person may still appear in an upstream group
          // listing. They must not regain directory grants after the user
          // phase disabled them.
          if (directoryUser.disabled) continue;

          desiredUserIds.add(directoryUser.id);

          const alreadyLinked = yield* database
            .select({ userId: schema.userGroupMember.userId })
            .from(schema.userGroupMember)
            .where(
              and(
                eq(schema.userGroupMember.groupId, groupId),
                eq(schema.userGroupMember.userId, directoryUser.id),
              ),
            )
            .limit(1);

          if (alreadyLinked.length === 0) {
            yield* database
              .insert(schema.userGroupMember)
              .ignore()
              .values({ groupId, userId: directoryUser.id });
            context.changedUserIds.add(directoryUser.id);
          }
        }
      }

      if (context.authoritative) {
        const existingMembers = yield* database
          .select({ userId: schema.userGroupMember.userId })
          .from(schema.userGroupMember)
          .where(eq(schema.userGroupMember.groupId, groupId));
        const removedMembers = existingMembers.filter(
          (member) => !desiredUserIds.has(member.userId),
        );

        if (removedMembers.length) {
          yield* database.delete(schema.userGroupMember).where(
            and(
              eq(schema.userGroupMember.groupId, groupId),
              inArray(
                schema.userGroupMember.userId,
                removedMembers.map((member) => member.userId),
              ),
            ),
          );

          for (const member of removedMembers) context.changedUserIds.add(member.userId);
        }
      }

      seenExternalIds.add(group.externalId);
      context.onGroup?.();
    }
  });

export type DirectorySyncProgress = {
  readonly users: number;
  readonly groups: number;
  /** Provider cursor persisted for the next users run, when incremental. */
  readonly usersDelta?: string;
  readonly groupsDelta?: string;
};

export type DirectorySyncOptions<E = unknown> = {
  readonly db: EnterpriseDb;
  readonly organizationId: string;
  readonly directory: DirectoryUserDirectory<E>;
  readonly usersCursor?: string | null;
  readonly groupsCursor?: string | null;
  readonly syncUsersAndGroups?: boolean;
  readonly at?: Date;
  /**
   * Runs in the same transaction as final authoritative reconciliation, so a
   * cursor can never be persisted past work that rolled back.
   */
  readonly onUsersComplete?: (
    progress: {
      readonly users: number;
      readonly groups: number;
      readonly cursor?: string;
    },
    database: DirectorySyncDatabase,
  ) => Effect.Effect<void, unknown>;
  readonly onGroupsComplete?: (
    progress: {
      readonly users: number;
      readonly groups: number;
      readonly cursor?: string;
    },
    database: DirectorySyncDatabase,
  ) => Effect.Effect<void, unknown>;
};

export type DirectorySyncResult = {
  readonly users: number;
  readonly groups: number;
  readonly usersDelta?: string;
  readonly groupsDelta?: string;
  /** People whose membership or enabled state changed during this run. */
  readonly changedUserIds: ReadonlyArray<string>;
};

const dropMembershipsOutsideDirectory = (
  database: DirectorySyncDatabase,
  organizationId: string,
  userId: string,
): Effect.Effect<boolean, unknown> =>
  Effect.gen(function* () {
    const orgGroups = yield* database
      .select({ id: schema.userGroup.id })
      .from(schema.userGroup)
      .where(eq(schema.userGroup.organizationId, organizationId));

    if (!orgGroups.length) return false;

    const memberships = yield* database
      .select({ userId: schema.userGroupMember.userId })
      .from(schema.userGroupMember)
      .where(
        and(
          eq(schema.userGroupMember.userId, userId),
          inArray(
            schema.userGroupMember.groupId,
            orgGroups.map((group: { id: string }) => group.id),
          ),
        ),
      )
      .limit(1);

    if (!memberships.length) return false;

    yield* database.delete(schema.userGroupMember).where(
      and(
        eq(schema.userGroupMember.userId, userId),
        inArray(
          schema.userGroupMember.groupId,
          orgGroups.map((group: { id: string }) => group.id),
        ),
      ),
    );

    return true;
  });

/**
 * Run a provider's discovery into the tenant directory.
 *
 * The same pipeline serves every provider: each page is applied in its own
 * transaction, final reconciliation and its cursor checkpoint commit together,
 * and an authoritative listing disables people the provider no longer returns
 * (without deleting them or their device links).
 */
export const syncDirectory = <E = unknown>(
  options: DirectorySyncOptions<E>,
): Effect.Effect<DirectorySyncResult, E | DirectorySyncError | DirectorySyncTransactionError> =>
  Effect.gen(function* () {
    const { db, organizationId, directory } = options;
    const { provider } = directory;
    const timestamp = options.at ?? now();
    const changedUserIds = new Set<string>();

    if (options.syncUsersAndGroups === false) return { users: 0, groups: 0, changedUserIds: [] };

    let users = 0;
    let usersDelta: string | undefined;

    if (provider.capabilities.users) {
      const seenExternalIds = new Set<string>();
      let cursor = options.usersCursor ?? undefined;
      let complete = false;
      let authoritative = false;

      for (let page = 0; page < DIRECTORY_SYNC_MAX_PAGES; page++) {
        const result = yield* directory.discoverUsers(cursor);

        yield* db
          .transaction((tx) =>
            applyUserPage(tx, result.users, {
              organizationId,
              source: provider.userSource,
              seenExternalIds,
              changedUserIds,
              at: timestamp,
              onUser: () => {
                users++;
              },
            }),
          )
          .pipe(
            Effect.mapError(
              (cause) => new DirectorySyncTransactionError({ phase: "users", cause }),
            ),
          );

        authoritative ||= result.authoritative;

        if (!result.nextCursor) {
          usersDelta = result.deltaCursor ?? undefined;
          complete = true;
          break;
        }

        cursor = result.nextCursor;
      }

      if (!complete)
        return yield* Effect.fail(
          new DirectorySyncError({
            phase: "users",
            message: `Directory sync exceeded ${DIRECTORY_SYNC_MAX_PAGES} user pages`,
          }),
        );

      if (authoritative || options.onUsersComplete)
        yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              if (authoritative) {
                // A full listing is authoritative: every tenant directory person
                // sourced from this provider that was not seen is disabled.
                // Accounts and device links are a separate identity and are never
                // reconciled here.
                const directoryUsers = yield* tx
                  .select()
                  .from(schema.user)
                  .where(
                    and(
                      eq(schema.user.organizationId, organizationId),
                      eq(schema.user.source, provider.userSource),
                    ),
                  );

                for (const user of directoryUsers) {
                  if (!user.externalId || seenExternalIds.has(user.externalId)) continue;

                  if (!user.disabled)
                    yield* tx
                      .update(schema.user)
                      .set({ disabled: true, updatedAt: timestamp })
                      .where(eq(schema.user.id, user.id));

                  const membershipsRemoved = yield* dropMembershipsOutsideDirectory(
                    tx,
                    organizationId,
                    user.id,
                  );

                  if (!user.disabled || membershipsRemoved) changedUserIds.add(user.id);
                }
              }

              if (options.onUsersComplete)
                yield* options.onUsersComplete({ users, groups: 0, cursor: usersDelta }, tx);
            }),
          )
          .pipe(
            Effect.mapError(
              (cause) => new DirectorySyncTransactionError({ phase: "users", cause }),
            ),
          );
    }

    let groups = 0;
    let groupsDelta: string | undefined;

    if (provider.capabilities.groups) {
      const seenExternalIds = new Set<string>();
      let cursor = options.groupsCursor ?? undefined;
      let complete = false;
      let authoritative = false;

      for (let page = 0; page < DIRECTORY_SYNC_MAX_PAGES; page++) {
        const result = yield* directory.discoverGroups(cursor);

        yield* db
          .transaction((tx) =>
            applyGroupPage(tx, result.groups, {
              organizationId,
              source: provider.groupSource,
              seenExternalIds,
              changedUserIds,
              at: timestamp,
              authoritative: result.authoritative,
              onGroup: () => {
                groups++;
              },
            }),
          )
          .pipe(
            Effect.mapError(
              (cause) => new DirectorySyncTransactionError({ phase: "groups", cause }),
            ),
          );

        authoritative ||= result.authoritative;

        if (!result.nextCursor) {
          groupsDelta = result.deltaCursor ?? undefined;
          complete = true;
          break;
        }

        cursor = result.nextCursor;
      }

      if (!complete)
        return yield* Effect.fail(
          new DirectorySyncError({
            phase: "groups",
            message: `Directory sync exceeded ${DIRECTORY_SYNC_MAX_PAGES} group pages`,
          }),
        );

      if (authoritative || options.onGroupsComplete)
        yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              if (authoritative) {
                const providerGroups = yield* tx
                  .select()
                  .from(schema.userGroup)
                  .where(
                    and(
                      eq(schema.userGroup.organizationId, organizationId),
                      eq(schema.userGroup.source, provider.groupSource),
                    ),
                  );

                const staleGroups = providerGroups
                  .filter((group) => group.externalId && !seenExternalIds.has(group.externalId))
                  .map((group) => group.id);

                if (staleGroups.length) {
                  // Removing a directory group cascades its memberships and
                  // unlinks any device group it drove. Those members are the
                  // people whose devices must be recomputed and woken.
                  const removedMembers = yield* tx
                    .select({ userId: schema.userGroupMember.userId })
                    .from(schema.userGroupMember)
                    .where(inArray(schema.userGroupMember.groupId, staleGroups));

                  for (const member of removedMembers) changedUserIds.add(member.userId);

                  yield* tx
                    .delete(schema.userGroup)
                    .where(inArray(schema.userGroup.id, staleGroups));
                }
              }

              if (options.onGroupsComplete)
                yield* options.onGroupsComplete({ users, groups, cursor: groupsDelta }, tx);
            }),
          )
          .pipe(
            Effect.mapError(
              (cause) => new DirectorySyncTransactionError({ phase: "groups", cause }),
            ),
          );
    }

    return {
      users,
      groups,
      usersDelta,
      groupsDelta,
      changedUserIds: [...changedUserIds],
    };
  });
