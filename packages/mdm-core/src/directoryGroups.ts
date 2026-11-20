import { Effect } from "effect";
import { and, eq, inArray } from "drizzle-orm";
import { schema as s, type EnterpriseDb } from "@mattrax/enterprise-core";
import { syncGroupInheritance } from "./groupInheritance.ts";

export type DirectoryGroupSyncOptions = {
  /** Injectable clock. Defaults to `new Date()`. */
  readonly now?: Date;
};

/**
 * The builders this module uses. A drizzle transaction exposes the same query
 * surface, so a restore can derive membership inside its own atomic write.
 */
export type DirectoryGroupDb = Pick<EnterpriseDb, "select" | "insert" | "delete" | "update"> & {
  readonly transaction: EnterpriseDb["transaction"];
};

export type DirectoryGroupSyncResult = {
  readonly groupId: string;
  readonly directoryGroupId: string | null;
  /** Devices the linked directory group resolves to right now. */
  readonly matched: number;
  readonly added: number;
  readonly removed: number;
  readonly evaluatedAt: Date;
};

const emptyResult = (
  groupId: string,
  directoryGroupId: string | null,
  removed: number,
  evaluatedAt: Date,
): DirectoryGroupSyncResult => ({
  groupId,
  directoryGroupId,
  matched: 0,
  added: 0,
  removed,
  evaluatedAt,
});

/**
 * Recompute one directory-linked device group.
 *
 * A linked group's membership is entirely derived: every active directory user
 * in the group contributes each device linked to them through `device_user`.
 * Rows are materialised with `source = 'directory'` so the policy and
 * application resolvers keep reading `group_device` exactly like a manual or
 * dynamic group. Non-directory rows are removed whenever the group is linked,
 * which enforces the read-only contract even for rows written before the link.
 *
 * Unlinking (or turning the group dynamic) deletes the derived rows, leaving
 * the group empty until an administrator adds members again.
 *
 * The read-modify-write runs in a transaction that locks the device group row
 * `FOR UPDATE`. Callers are concurrent (SCIM requests, scheduled sync, group
 * patch, device-user edits), and without the lock two interleavings could both
 * observe the same membership and resurrect a row the other just removed.
 */
export const syncDirectoryGroup = (
  db: DirectoryGroupDb,
  organizationId: string,
  groupId: string,
  options: DirectoryGroupSyncOptions = {},
) => db.transaction((tx) => syncDirectoryGroupLocked(tx, organizationId, groupId, options));

const syncDirectoryGroupLocked = (
  db: DirectoryGroupDb,
  organizationId: string,
  groupId: string,
  options: DirectoryGroupSyncOptions = {},
) =>
  Effect.gen(function* () {
    const now = options.now ?? new Date();

    const [group] = yield* db
      .select()
      .from(s.enterpriseGroup)
      .where(
        and(
          eq(s.enterpriseGroup.id, groupId),
          eq(s.enterpriseGroup.organizationId, organizationId),
        ),
      )
      .limit(1)
      .for("update");

    if (!group) return emptyResult(groupId, null, 0, now);

    const directoryGroupId = group.directoryGroupId ?? null;

    if (!directoryGroupId || group.kind !== "manual") {
      const removed = yield* db
        .delete(s.groupDevice)
        .where(
          and(eq(s.groupDevice.groupId, groupId), eq(s.groupDevice.source, "directory")),
        );

      // Unlinking can drop members that enclosing groups were inheriting.
      yield* syncGroupInheritance(db, organizationId, groupId);

      return emptyResult(
        groupId,
        directoryGroupId,
        Array.isArray(removed) ? removed.length : 0,
        now,
      );
    }

    const members = yield* db
      .select({ userId: s.userGroupMember.userId })
      .from(s.userGroupMember)
      .where(eq(s.userGroupMember.groupId, directoryGroupId));

    const memberIds = [...new Set(members.map((row) => row.userId))];

    // A disabled directory person keeps their `user` row (directory sync marks
    // leavers disabled) but must stop contributing devices, matching the policy
    // resolver. The tenant filter keeps a stale cross-tenant membership inert.
    const activeUsers = memberIds.length
      ? yield* db
          .select({ id: s.user.id })
          .from(s.user)
          .where(
            and(
              eq(s.user.organizationId, organizationId),
              eq(s.user.disabled, false),
              inArray(s.user.id, memberIds),
            ),
          )
      : [];

    // A user exclusion stops this group deriving devices from that person. A
    // device shared with a non-excluded user stays, which is the documented
    // difference between a person exclusion and a device exclusion.
    const exclusions = yield* db
      .select({ target: s.groupExclusion.target, targetId: s.groupExclusion.targetId })
      .from(s.groupExclusion)
      .where(eq(s.groupExclusion.groupId, groupId));

    const excludedUsers = new Set(
      exclusions.filter((row) => row.target === "user").map((row) => row.targetId),
    );
    const excludedDevices = new Set(
      exclusions.filter((row) => row.target === "device").map((row) => row.targetId),
    );

    const activeIds = activeUsers
      .map((row) => row.id)
      .filter((userId) => !excludedUsers.has(userId));

    const deviceLinks = activeIds.length
      ? yield* db
          .select({ deviceId: s.deviceUser.deviceId })
          .from(s.deviceUser)
          .where(
            and(
              eq(s.deviceUser.organizationId, organizationId),
              inArray(s.deviceUser.userId, activeIds),
            ),
          )
      : [];

    const candidateDeviceIds = [...new Set(deviceLinks.map((row) => row.deviceId))];

    // `device_user` carries an organisation, but the device row is
    // authoritative: never materialise a membership pointing at another
    // tenant's device.
    const tenantDevices = candidateDeviceIds.length
      ? yield* db
          .select({ id: s.device.id })
          .from(s.device)
          .where(
            and(
              eq(s.device.organizationId, organizationId),
              inArray(s.device.id, candidateDeviceIds),
            ),
          )
      : [];

    const deviceIds = new Set(tenantDevices.map((row) => row.id));
    const desired = candidateDeviceIds.filter(
      (deviceId) => deviceIds.has(deviceId) && !excludedDevices.has(deviceId),
    );

    const links = yield* db.select().from(s.groupDevice).where(eq(s.groupDevice.groupId, groupId));

    const existingDirectory = new Set(
      links.filter((link) => link.source === "directory").map((link) => link.deviceId),
    );

    // Inherited rows belong to the parent's child list, not to this link, so a
    // directory recompute must not delete them.
    const staleSources = links.filter(
      (link) => link.source !== "directory" && link.source !== "nested",
    );

    const toAdd = desired.filter((deviceId) => !existingDirectory.has(deviceId));
    const toRemove = [...existingDirectory].filter((deviceId) => !desired.includes(deviceId));

    if (staleSources.length > 0)
      yield* db
        .delete(s.groupDevice)
        .where(
          and(
            eq(s.groupDevice.groupId, groupId),
            inArray(
              s.groupDevice.deviceId,
              staleSources.map((link) => link.deviceId),
            ),
          ),
        );

    if (toRemove.length > 0)
      yield* db
        .delete(s.groupDevice)
        .where(
          and(
            eq(s.groupDevice.groupId, groupId),
            eq(s.groupDevice.source, "directory"),
            inArray(s.groupDevice.deviceId, toRemove),
          ),
        );

    if (toAdd.length > 0)
      yield* db
        .insert(s.groupDevice)
        .ignore()
        .values(toAdd.map((deviceId) => ({ groupId, deviceId, source: "directory" as const })));

    yield* db
      .update(s.enterpriseGroup)
      .set({ lastEvaluatedAt: now })
      .where(
        and(
          eq(s.enterpriseGroup.id, groupId),
          eq(s.enterpriseGroup.organizationId, organizationId),
        ),
      );

    // Enclosing groups include this group's membership.
    yield* syncGroupInheritance(db, organizationId, groupId);

    return {
      groupId,
      directoryGroupId,
      matched: desired.length,
      added: toAdd.length,
      removed: toRemove.length + staleSources.length,
      evaluatedAt: now,
    };
  });

/**
 * Recompute every directory-linked group of one tenant.
 *
 * Directory membership changes are reported per user, but a leaver's membership
 * row is already gone by then, so the tenant's linked groups are recomputed as a
 * set instead of trying to infer which group lost the user. The number of
 * linked groups is small; each recompute is bounded by its directory group's
 * membership, not the fleet.
 *
 * Groups whose link was removed by a cascade are swept too: their derived rows
 * must not outlive the link.
 */
export const syncDirectoryGroupsForTenant = (
  db: DirectoryGroupDb,
  organizationId: string,
  options: DirectoryGroupSyncOptions = {},
) =>
  Effect.gen(function* () {
    const groups = yield* db
      .select({
        id: s.enterpriseGroup.id,
        directoryGroupId: s.enterpriseGroup.directoryGroupId,
      })
      .from(s.enterpriseGroup)
      .where(eq(s.enterpriseGroup.organizationId, organizationId));

    if (groups.length === 0) return [];

    const ids = groups.map((group) => group.id);

    const directoryRows = yield* db
      .select({ groupId: s.groupDevice.groupId })
      .from(s.groupDevice)
      .where(
        and(
          eq(s.groupDevice.source, "directory"),
          inArray(s.groupDevice.groupId, ids),
        ),
      );

    const orphaned = new Set(directoryRows.map((row) => row.groupId));

    const results: DirectoryGroupSyncResult[] = [];

    for (const group of groups) {
      if (!group.directoryGroupId && !orphaned.has(group.id)) continue;

      results.push(yield* syncDirectoryGroup(db, organizationId, group.id, options));
    }

    return results;
  });
