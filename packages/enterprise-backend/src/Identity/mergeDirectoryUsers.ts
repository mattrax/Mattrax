import { and, eq, inArray } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import {
  type DirectoryUserMergeCandidate,
  type DirectoryUserMergePreview,
  type DirectoryUserMergeResult,
  type DirectoryUserRef,
  type UserMergeCounts,
  EnterpriseBadRequest,
  EnterpriseDbError,
  EnterpriseNotFound,
  USER_MERGE_SOURCE_LIMIT,
  directoryEmailKey,
  userMergeCandidateReasons,
  userMergeRequiresExternalIdConfirmation,
} from "@mattrax/enterprise-domain";
import { type EnterpriseDb, schema } from "@mattrax/enterprise-core";

type MergeError = EnterpriseBadRequest | EnterpriseNotFound | EnterpriseDbError;

type UserRow = typeof schema.user.$inferSelect;

/** The audit action a completed merge records; also its alias history. */
export const DIRECTORY_USER_MERGE_ACTION = "directory.users_merged";

type Executor = Pick<EnterpriseDb, "select" | "insert" | "update" | "delete" | "query">;

/** The schema type is readonly; the plan accumulates into a mutable copy. */
type MutableCounts = { -readonly [K in keyof UserMergeCounts]: UserMergeCounts[K] };

const emptyCounts = (): MutableCounts => ({
  deviceLinks: 0,
  groupMemberships: 0,
  directPolicies: 0,
  groupExclusions: 0,
  appleUserChannels: 0,
});

const addCounts = (target: MutableCounts, source: UserMergeCounts): void => {
  target.deviceLinks += source.deviceLinks;
  target.groupMemberships += source.groupMemberships;
  target.directPolicies += source.directPolicies;
  target.groupExclusions += source.groupExclusions;
  target.appleUserChannels += source.appleUserChannels;
};

const toRef = (row: UserRow, linkedExternalIds: ReadonlySet<string>): DirectoryUserRef => ({
  id: row.id,
  name: row.name,
  email: row.email,
  externalId: row.externalId,
  source: row.source,
  disabled: row.disabled,
  linked: row.externalId != null && linkedExternalIds.has(row.externalId),
});

const normaliseSourceIds = (sourceIds: ReadonlyArray<string>): ReadonlyArray<string> => [
  ...new Set(
    sourceIds.flatMap((id) => {
      const trimmed = id.trim();

      return trimmed ? [trimmed] : [];
    }),
  ),
];

/**
 * The source ids an earlier merge into this target recorded in the audit log.
 *
 * The audit entry is the only alias record: a separate table would let the
 * merge and the alias diverge, and sync would still be free to recreate a
 * provider object. Audit retention therefore bounds how long a retry or a
 * duplicate suggestion can recognise an absorbed source.
 */
const mergedSourceHistory = (db: Executor, organizationId: string, targetId: string) =>
  Effect.gen(function* () {
    const rows = yield* db
      .select({ metadata: schema.auditLog.metadata })
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.organizationId, organizationId),
          eq(schema.auditLog.action, DIRECTORY_USER_MERGE_ACTION),
          eq(schema.auditLog.targetType, "directoryUser"),
          eq(schema.auditLog.targetId, targetId),
        ),
      );

    const ids = new Set<string>();
    const emails = new Set<string>();
    const externalIds = new Set<string>();

    const metadataSchema = Schema.Struct({
      sources: Schema.Array(
        Schema.Struct({
          id: Schema.String,
          email: Schema.String,
          externalId: Schema.optional(Schema.NullOr(Schema.String)),
        }),
      ),
    });

    for (const row of rows) {
      const decoded = Schema.decodeUnknownOption(metadataSchema)(row.metadata);

      if (Option.isNone(decoded)) continue;

      for (const source of decoded.value.sources) {
        ids.add(source.id);
        emails.add(directoryEmailKey(source.email));

        if (source.externalId) externalIds.add(source.externalId);
      }
    }

    return { ids, emails, externalIds };
  });

const linkedObjectIds = (db: Executor, organizationId: string, users: ReadonlyArray<UserRow>) =>
  Effect.gen(function* () {
    const objectIds = [
      ...new Set(users.flatMap((user) => (user.externalId == null ? [] : [user.externalId]))),
    ];

    if (objectIds.length === 0) return new Set<string>();

    const rows = yield* db
      .select({ objectId: schema.ssoIdentity.objectId })
      .from(schema.ssoIdentity)
      .where(
        and(
          eq(schema.ssoIdentity.organizationId, organizationId),
          inArray(schema.ssoIdentity.objectId, objectIds),
        ),
      );

    return new Set(rows.map((row) => row.objectId));
  });

type Participants = {
  readonly target: UserRow;
  readonly sources: ReadonlyArray<UserRow>;
  /** Requested ids that are not rows in this tenant (or at all). */
  readonly missingSourceIds: ReadonlyArray<string>;
  readonly linkedExternalIds: ReadonlySet<string>;
};

/**
 * Load the merge participants, locked when the caller is about to write.
 *
 * Every lookup is tenant-scoped. A source from another tenant is therefore
 * indistinguishable from a deleted one here; the caller decides whether a
 * prior audit entry proves it was absorbed by this target.
 */
const loadParticipants = (
  db: Executor,
  input: {
    readonly organizationId: string;
    readonly targetId: string;
    readonly sourceIds: ReadonlyArray<string>;
    readonly lock: boolean;
  },
) =>
  Effect.gen(function* () {
    const ids = [input.targetId, ...input.sourceIds];

    const query = db
      .select()
      .from(schema.user)
      .where(
        and(eq(schema.user.organizationId, input.organizationId), inArray(schema.user.id, ids)),
      );

    // MySQL's locking read makes two concurrent merges of the same rows
    // serialise instead of racing the unique keys.
    const rows = yield* input.lock ? query.for("update") : query;
    const byId = new Map(rows.map((row) => [row.id, row]));
    const target = byId.get(input.targetId);

    if (!target) return yield* Effect.fail(new EnterpriseNotFound({ message: "User not found" }));

    const sources = input.sourceIds.flatMap((id) => {
      const row = byId.get(id);

      return row ? [row] : [];
    });

    return {
      target,
      sources,
      missingSourceIds: input.sourceIds.filter((id) => !byId.has(id)),
      linkedExternalIds: yield* linkedObjectIds(db, input.organizationId, [target, ...sources]),
    } satisfies Participants;
  });

type DeviceLinkRow = {
  readonly organizationId: string;
  readonly deviceId: string;
  readonly userId: string;
  readonly source: "manual" | "directory";
  readonly createdAt: Date;
};

type GroupMemberRow = { readonly groupId: string; readonly userId: string };

type PolicyRow = {
  readonly organizationId: string;
  readonly policyId: string;
  readonly userId: string;
  readonly mode: "include" | "exclude";
  readonly createdAt: Date;
};

type ExclusionRow = {
  readonly groupId: string;
  readonly targetId: string;
  readonly createdAt: Date;
};

type SourceTally = { counts: MutableCounts; deduplicated: MutableCounts };

type MergePlan = {
  readonly counts: ReadonlyMap<string, SourceTally>;
  readonly deviceLinks: ReadonlyArray<DeviceLinkRow>;
  readonly groupMemberships: ReadonlyArray<GroupMemberRow>;
  readonly directPolicies: ReadonlyArray<PolicyRow>;
  readonly groupExclusions: ReadonlyArray<ExclusionRow>;
  readonly appleChannels: ReadonlyArray<{
    readonly deviceId: string;
    readonly directoryUserId: string;
  }>;
};

/**
 * Everything a merge will move, with the edges that stay on the target
 * counted separately.
 *
 * The plan is built from reads so the preview and the write agree on what is
 * about to happen. When two sources claim the same edge the first source in
 * the request wins; an edge the target already has always stays the target's.
 */
const planMerge = (
  db: Executor,
  input: {
    readonly organizationId: string;
    readonly targetId: string;
    readonly sourceIds: ReadonlyArray<string>;
  },
): Effect.Effect<MergePlan, unknown> =>
  Effect.gen(function* () {
    const { organizationId, targetId, sourceIds } = input;

    const counts = new Map<string, SourceTally>(
      sourceIds.map((id) => [id, { counts: emptyCounts(), deduplicated: emptyCounts() }]),
    );

    const bucket = (sourceId: string) => {
      const entry = counts.get(sourceId);

      if (!entry) throw new Error(`Merge plan lost source ${sourceId}`);

      return entry;
    };

    // --- Device links: unique on (device, user) -----------------------------
    const sourceLinks = yield* db
      .select({
        organizationId: schema.deviceUser.organizationId,
        deviceId: schema.deviceUser.deviceId,
        userId: schema.deviceUser.userId,
        source: schema.deviceUser.source,
        createdAt: schema.deviceUser.createdAt,
      })
      .from(schema.deviceUser)
      .where(
        and(
          eq(schema.deviceUser.organizationId, organizationId),
          inArray(schema.deviceUser.userId, [...sourceIds]),
        ),
      );

    const targetLinks = yield* db
      .select({ deviceId: schema.deviceUser.deviceId })
      .from(schema.deviceUser)
      .where(
        and(
          eq(schema.deviceUser.organizationId, organizationId),
          eq(schema.deviceUser.userId, targetId),
        ),
      );

    const claimedDevices = new Set(targetLinks.map((row) => row.deviceId));
    const deviceLinks: DeviceLinkRow[] = [];

    for (const sourceId of sourceIds)
      for (const row of sourceLinks.filter((link) => link.userId === sourceId)) {
        if (claimedDevices.has(row.deviceId)) {
          bucket(sourceId).deduplicated.deviceLinks++;

          continue;
        }

        claimedDevices.add(row.deviceId);
        bucket(sourceId).counts.deviceLinks++;
        deviceLinks.push({ ...row, userId: targetId });
      }

    // --- Directory-group memberships: unique on (group, user) --------------
    //
    // These link tables carry no organization column. Every id here has already
    // been resolved to a user in this tenant, and a user belongs to exactly one
    // organization, so filtering by the (globally unique) user id is the
    // tenant scope; a join back to the group would only add work.
    const sourceMemberships = yield* db
      .select({ groupId: schema.userGroupMember.groupId, userId: schema.userGroupMember.userId })
      .from(schema.userGroupMember)
      .where(inArray(schema.userGroupMember.userId, [...sourceIds]));

    const targetMemberships = yield* db
      .select({ groupId: schema.userGroupMember.groupId })
      .from(schema.userGroupMember)
      .where(eq(schema.userGroupMember.userId, targetId));

    const claimedGroups = new Set(targetMemberships.map((row) => row.groupId));
    const groupMemberships: GroupMemberRow[] = [];

    for (const sourceId of sourceIds)
      for (const row of sourceMemberships.filter((member) => member.userId === sourceId)) {
        if (claimedGroups.has(row.groupId)) {
          bucket(sourceId).deduplicated.groupMemberships++;

          continue;
        }

        claimedGroups.add(row.groupId);
        bucket(sourceId).counts.groupMemberships++;
        groupMemberships.push({ groupId: row.groupId, userId: targetId });
      }

    // --- Direct policies: unique on (user, policy) -------------------------
    const sourcePolicies = yield* db
      .select({
        organizationId: schema.userPolicy.organizationId,
        policyId: schema.userPolicy.policyId,
        userId: schema.userPolicy.userId,
        mode: schema.userPolicy.mode,
        createdAt: schema.userPolicy.createdAt,
      })
      .from(schema.userPolicy)
      .where(
        and(
          eq(schema.userPolicy.organizationId, organizationId),
          inArray(schema.userPolicy.userId, [...sourceIds]),
        ),
      );

    const targetPolicies = yield* db
      .select({ policyId: schema.userPolicy.policyId })
      .from(schema.userPolicy)
      .where(
        and(
          eq(schema.userPolicy.organizationId, organizationId),
          eq(schema.userPolicy.userId, targetId),
        ),
      );

    const claimedPolicies = new Set(targetPolicies.map((row) => row.policyId));
    const directPolicies: PolicyRow[] = [];

    for (const sourceId of sourceIds)
      for (const row of sourcePolicies.filter((policy) => policy.userId === sourceId)) {
        if (claimedPolicies.has(row.policyId)) {
          bucket(sourceId).deduplicated.directPolicies++;

          continue;
        }

        claimedPolicies.add(row.policyId);
        bucket(sourceId).counts.directPolicies++;
        directPolicies.push({ ...row, userId: targetId });
      }

    // --- Group exclusions: unique on (group, "user", user) -----------------
    const sourceExclusions = yield* db
      .select({
        groupId: schema.groupExclusion.groupId,
        targetId: schema.groupExclusion.targetId,
        createdAt: schema.groupExclusion.createdAt,
      })
      .from(schema.groupExclusion)
      .where(
        and(
          eq(schema.groupExclusion.target, "user"),
          inArray(schema.groupExclusion.targetId, [...sourceIds]),
        ),
      );

    const targetExclusions = yield* db
      .select({ groupId: schema.groupExclusion.groupId })
      .from(schema.groupExclusion)
      .where(
        and(eq(schema.groupExclusion.target, "user"), eq(schema.groupExclusion.targetId, targetId)),
      );

    const claimedExclusions = new Set(targetExclusions.map((row) => row.groupId));
    const groupExclusions: ExclusionRow[] = [];

    for (const sourceId of sourceIds)
      for (const row of sourceExclusions.filter((exclusion) => exclusion.targetId === sourceId)) {
        if (claimedExclusions.has(row.groupId)) {
          bucket(sourceId).deduplicated.groupExclusions++;

          continue;
        }

        claimedExclusions.add(row.groupId);
        bucket(sourceId).counts.groupExclusions++;
        groupExclusions.push({ groupId: row.groupId, targetId, createdAt: row.createdAt });
      }

    // --- Apple user channels: no uniqueness, every binding moves -----------
    const appleChannels = yield* db
      .select({
        deviceId: schema.deviceAppleUser.deviceId,
        directoryUserId: schema.deviceAppleUser.directoryUserId,
      })
      .from(schema.deviceAppleUser)
      .where(inArray(schema.deviceAppleUser.directoryUserId, [...sourceIds]));

    for (const channel of appleChannels)
      if (channel.directoryUserId) bucket(channel.directoryUserId).counts.appleUserChannels++;

    return {
      counts,
      deviceLinks,
      groupMemberships,
      directPolicies,
      groupExclusions,
      appleChannels: appleChannels.flatMap((channel) =>
        channel.directoryUserId
          ? [{ deviceId: channel.deviceId, directoryUserId: channel.directoryUserId }]
          : [],
      ),
    } satisfies MergePlan;
  });

const sumCounts = (plan: MergePlan, key: "counts" | "deduplicated"): UserMergeCounts => {
  const total = emptyCounts();

  for (const entry of plan.counts.values()) addCounts(total, entry[key]);

  return total;
};

const ssoIdentitiesForSources = (
  db: Executor,
  organizationId: string,
  sources: ReadonlyArray<UserRow>,
) =>
  Effect.gen(function* () {
    const objectIds = [
      ...new Set(sources.flatMap((user) => (user.externalId == null ? [] : [user.externalId]))),
    ];

    if (objectIds.length === 0) return 0;

    const rows = yield* db
      .select({ objectId: schema.ssoIdentity.objectId })
      .from(schema.ssoIdentity)
      .where(
        and(
          eq(schema.ssoIdentity.organizationId, organizationId),
          inArray(schema.ssoIdentity.objectId, objectIds),
        ),
      );

    return rows.length;
  });

const previewWarnings = (input: {
  readonly target: UserRow;
  readonly sources: ReadonlyArray<UserRow>;
  readonly ssoIdentitiesRetained: number;
  readonly requiresExternalIdConfirmation: boolean;
}): ReadonlyArray<string> => {
  const warnings: string[] = [];

  if (input.target.disabled)
    warnings.push(
      "The target is disabled. Merged resources move to a disabled user, so no user-scoped policy is delivered until it is re-enabled.",
    );

  const disabled = input.sources.filter((source) => source.disabled);

  if (disabled.length > 0)
    warnings.push(
      `${disabled.map((source) => source.name).join(", ")} ${disabled.length === 1 ? "is" : "are"} disabled. Their directory data moves to the target and the duplicate record is removed.`,
    );

  if (input.requiresExternalIdConfirmation)
    warnings.push(
      "One or more records report a different directory object id than the target. Confirm that the provider really created these records for the same person.",
    );

  if (input.ssoIdentitiesRetained > 0)
    warnings.push(
      "Single sign-on links belong to Mattrax accounts, not directory rows. They are kept as they are; this merge does not move or merge accounts.",
    );

  return warnings;
};

const assertNoSelfMerge = (targetId: string, sourceIds: ReadonlyArray<string>) =>
  sourceIds.includes(targetId)
    ? Effect.fail(
        new EnterpriseBadRequest({ message: "A directory user cannot be merged into itself." }),
      )
    : Effect.void;

const assertSourceCount = (sourceIds: ReadonlyArray<string>) => {
  if (sourceIds.length === 0)
    return Effect.fail(
      new EnterpriseBadRequest({ message: "Select at least one duplicate directory user." }),
    );

  if (sourceIds.length > USER_MERGE_SOURCE_LIMIT)
    return Effect.fail(
      new EnterpriseBadRequest({
        message: `Merge at most ${USER_MERGE_SOURCE_LIMIT} directory users at once.`,
      }),
    );

  return Effect.void;
};

export type MergeDirectoryUsersInput = {
  readonly organizationId: string;
  readonly targetId: string;
  readonly sourceIds: ReadonlyArray<string>;
  readonly confirmExternalIdMismatch?: boolean;
};

export type PreviewDirectoryUserMergeInput = {
  readonly organizationId: string;
  readonly targetId: string;
  readonly sourceIds: ReadonlyArray<string>;
};

/**
 * Preview a merge without writing anything.
 *
 * The caller's permission is checked by the HTTP handler; this function only
 * enforces tenant scope and the merge's own shape.
 */
export const previewDirectoryUserMerge = (
  db: EnterpriseDb,
  input: PreviewDirectoryUserMergeInput,
): Effect.Effect<DirectoryUserMergePreview, MergeError> =>
  Effect.gen(function* () {
    const sourceIds = normaliseSourceIds(input.sourceIds);

    yield* assertSourceCount(sourceIds);
    yield* assertNoSelfMerge(input.targetId, sourceIds);

    const { target, sources, linkedExternalIds } = yield* loadParticipants(db, {
      organizationId: input.organizationId,
      targetId: input.targetId,
      sourceIds,
      lock: false,
    });

    if (sources.length !== sourceIds.length)
      return yield* Effect.fail(
        new EnterpriseBadRequest({
          message: "One or more users are not in this tenant's directory.",
        }),
      );

    const plan = yield* planMerge(db, {
      organizationId: input.organizationId,
      targetId: input.targetId,
      sourceIds,
    });

    const requiresExternalIdConfirmation = userMergeRequiresExternalIdConfirmation({
      targetExternalId: target.externalId,
      sourceExternalIds: sources.map((source) => source.externalId),
    });

    const ssoIdentitiesRetained = yield* ssoIdentitiesForSources(db, input.organizationId, sources);

    return {
      target: toRef(target, linkedExternalIds),
      sources: sources.map((source) => {
        const entry = plan.counts.get(source.id);

        return {
          user: toRef(source, linkedExternalIds),
          counts: entry?.counts ?? emptyCounts(),
          deduplicated: entry?.deduplicated ?? emptyCounts(),
        };
      }),
      totals: sumCounts(plan, "counts"),
      deduplicated: sumCounts(plan, "deduplicated"),
      requiresExternalIdConfirmation,
      ssoIdentitiesRetained,
      warnings: previewWarnings({
        target,
        sources,
        ssoIdentitiesRetained,
        requiresExternalIdConfirmation,
      }),
    };
  }).pipe(
    Effect.catch((error) =>
      Effect.fail(
        error instanceof EnterpriseBadRequest ||
          error instanceof EnterpriseNotFound ||
          error instanceof EnterpriseDbError
          ? error
          : new EnterpriseDbError({ message: "The merge preview could not be built." }),
      ),
    ),
  );

const writePlan = (
  db: Executor,
  plan: MergePlan,
  input: {
    readonly organizationId: string;
    readonly targetId: string;
    readonly sourceIds: ReadonlyArray<string>;
  },
) =>
  Effect.gen(function* () {
    // INSERT IGNORE keeps a concurrent write that added the same edge from
    // failing the merge; the target's row stays either way.
    if (plan.deviceLinks.length > 0)
      yield* db
        .insert(schema.deviceUser)
        .ignore()
        .values(plan.deviceLinks.map((row) => ({ ...row })));

    if (plan.groupMemberships.length > 0)
      yield* db
        .insert(schema.userGroupMember)
        .ignore()
        .values(plan.groupMemberships.map((row) => ({ ...row })));

    if (plan.directPolicies.length > 0)
      yield* db
        .insert(schema.userPolicy)
        .ignore()
        .values(plan.directPolicies.map((row) => ({ ...row })));

    if (plan.groupExclusions.length > 0)
      yield* db
        .insert(schema.groupExclusion)
        .ignore()
        .values(
          plan.groupExclusions.map((row) => ({
            groupId: row.groupId,
            target: "user" as const,
            targetId: row.targetId,
            createdAt: row.createdAt,
          })),
        );

    // A channel is keyed by Apple's own user id, so several bindings can point
    // at one person without colliding. Rebind all of them to the survivor.
    if (plan.appleChannels.length > 0)
      yield* db
        .update(schema.deviceAppleUser)
        .set({ directoryUserId: input.targetId })
        .where(inArray(schema.deviceAppleUser.directoryUserId, [...input.sourceIds]));

    // Clear the sources explicitly rather than relying on the user foreign
    // keys: exclusions are polymorphic and carry no foreign key, and making the
    // moved-edge counts deterministic keeps a retry's audit truthful.
    yield* db
      .delete(schema.deviceUser)
      .where(
        and(
          eq(schema.deviceUser.organizationId, input.organizationId),
          inArray(schema.deviceUser.userId, [...input.sourceIds]),
        ),
      );

    yield* db
      .delete(schema.userGroupMember)
      .where(inArray(schema.userGroupMember.userId, [...input.sourceIds]));

    yield* db
      .delete(schema.userPolicy)
      .where(
        and(
          eq(schema.userPolicy.organizationId, input.organizationId),
          inArray(schema.userPolicy.userId, [...input.sourceIds]),
        ),
      );

    yield* db
      .delete(schema.groupExclusion)
      .where(
        and(
          eq(schema.groupExclusion.target, "user"),
          inArray(schema.groupExclusion.targetId, [...input.sourceIds]),
        ),
      );
  });

export const mergeDirectoryUsers = (
  db: EnterpriseDb,
  input: MergeDirectoryUsersInput,
): Effect.Effect<DirectoryUserMergeResult, MergeError> =>
  Effect.gen(function* () {
    const requested = normaliseSourceIds(input.sourceIds);

    yield* assertSourceCount(requested);
    yield* assertNoSelfMerge(input.targetId, requested);

    const result = yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const { target, sources, missingSourceIds, linkedExternalIds } = yield* loadParticipants(
          tx,
          {
            organizationId: input.organizationId,
            targetId: input.targetId,
            sourceIds: requested,
            lock: true,
          },
        );

        // A source that is gone may be one this target already absorbed. Only
        // the audit entry can prove that; anything else is treated as a bad id
        // so a cross-tenant id can never look like a completed merge.
        const history = missingSourceIds.length
          ? yield* mergedSourceHistory(tx, input.organizationId, input.targetId)
          : { ids: new Set<string>(), emails: new Set<string>(), externalIds: new Set<string>() };

        const alreadyMerged = missingSourceIds.filter((id) => history.ids.has(id));
        const unknown = missingSourceIds.filter((id) => !history.ids.has(id));

        if (unknown.length > 0)
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "One or more users are not in this tenant's directory.",
            }),
          );

        if (sources.length === 0)
          return {
            status: "unchanged" as const,
            target: toRef(target, linkedExternalIds),
            sources: [],
            totals: emptyCounts(),
            deduplicated: emptyCounts(),
            ssoIdentitiesRetained: 0,
            alreadyMerged,
          };

        if (
          userMergeRequiresExternalIdConfirmation({
            targetExternalId: target.externalId,
            sourceExternalIds: sources.map((source) => source.externalId),
          }) &&
          input.confirmExternalIdMismatch !== true
        )
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message:
                "These records report different directory object ids. Confirm that they describe the same person before merging.",
            }),
          );

        const plan = yield* planMerge(tx, {
          organizationId: input.organizationId,
          targetId: input.targetId,
          sourceIds: sources.map((source) => source.id),
        });

        yield* writePlan(tx, plan, {
          organizationId: input.organizationId,
          targetId: input.targetId,
          sourceIds: sources.map((source) => source.id),
        });

        // Every source row goes: its edges now live on the target and its
        // remaining links cascade. A soft-deleted alias would need a column the
        // schema does not have, and the audit entry keeps the identity.
        yield* tx.delete(schema.user).where(
          and(
            eq(schema.user.organizationId, input.organizationId),
            inArray(
              schema.user.id,
              sources.map((source) => source.id),
            ),
          ),
        );

        return {
          status: "merged" as const,
          target: toRef(target, linkedExternalIds),
          sources: sources.map((source) => {
            const entry = plan.counts.get(source.id);

            return {
              user: toRef(source, linkedExternalIds),
              counts: entry?.counts ?? emptyCounts(),
              deduplicated: entry?.deduplicated ?? emptyCounts(),
            };
          }),
          totals: sumCounts(plan, "counts"),
          deduplicated: sumCounts(plan, "deduplicated"),
          ssoIdentitiesRetained: yield* ssoIdentitiesForSources(tx, input.organizationId, sources),
          alreadyMerged,
        };
      }),
    );

    return result;
  }).pipe(
    Effect.catch((error) =>
      Effect.fail(
        error instanceof EnterpriseBadRequest ||
          error instanceof EnterpriseNotFound ||
          error instanceof EnterpriseDbError
          ? error
          : new EnterpriseDbError({ message: "The directory users could not be merged." }),
      ),
    ),
  );

/**
 * Directory people that are likely the same human as the target.
 *
 * Evidence comes from the tenant's own rows: an address the target shares, or
 * an object id/address recorded when this target previously absorbed a
 * duplicate. A recreated Entra object therefore shows up again as a candidate
 * instead of the merge being silently undone.
 */
export const listDirectoryUserMergeCandidates = (
  db: EnterpriseDb,
  input: { readonly organizationId: string; readonly targetId: string },
): Effect.Effect<
  ReadonlyArray<DirectoryUserMergeCandidate>,
  EnterpriseNotFound | EnterpriseDbError
> =>
  Effect.gen(function* () {
    const target = yield* db.query.user.findFirst({
      where: { id: input.targetId, organizationId: input.organizationId },
    });

    if (!target) return yield* Effect.fail(new EnterpriseNotFound({ message: "User not found" }));

    const users = yield* db
      .select()
      .from(schema.user)
      .where(eq(schema.user.organizationId, input.organizationId));

    const history = yield* mergedSourceHistory(db, input.organizationId, input.targetId);
    const linked = yield* linkedObjectIds(db, input.organizationId, [target, ...users]);

    const candidates: DirectoryUserMergeCandidate[] = [];

    for (const user of users) {
      if (user.id === target.id) continue;

      const reasons = userMergeCandidateReasons({
        targetEmail: target.email,
        candidateEmail: user.email,
        candidateExternalId: user.externalId,
        mergedExternalIds: history.externalIds,
        mergedEmails: history.emails,
      });

      if (reasons.length === 0) continue;

      candidates.push({ user: toRef(user, linked), reasons: [...reasons] });
    }

    return candidates
      .sort(
        (left, right) =>
          right.reasons.length - left.reasons.length ||
          left.user.name.localeCompare(right.user.name) ||
          left.user.id.localeCompare(right.user.id),
      )
      .slice(0, 50);
  }).pipe(
    Effect.catch((error) =>
      Effect.fail(
        error instanceof EnterpriseNotFound || error instanceof EnterpriseDbError
          ? error
          : new EnterpriseDbError({ message: "The merge candidates could not be loaded." }),
      ),
    ),
  );
