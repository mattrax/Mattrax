import { Effect } from "effect";
import { and, eq, inArray } from "drizzle-orm";
import { schema as s, type EnterpriseDb } from "@mattrax/enterprise-core";

/**
 * Nested group membership.
 *
 * A group includes the transitive membership of its child groups. Rather than
 * making every read walk the tree (and risking a cross-tenant read or an
 * unbounded traversal on corrupt data), the inherited devices are materialised
 * into `group_device` with `source = 'nested'`. Policy, script, application and
 * scope resolution keep reading one membership table, so a parent's policy is
 * resolved once per device exactly like a flat group's.
 *
 * Traversal in this module is always breadth-limited by
 * {@link GROUP_NESTING_MAX_DEPTH} and guarded by a visited set, so a cycle that
 * somehow reached the database (the write path rejects one) cannot loop.
 */

/**
 * Maximum number of groups in one nesting chain (a root plus its descendants).
 * Eight covers realistic org structures while keeping every recompute and
 * ancestor walk bounded.
 */
export const GROUP_NESTING_MAX_DEPTH = 8;

export type GroupHierarchyEdge = { readonly parentId: string; readonly childId: string };

export type GroupInheritanceDb = Pick<EnterpriseDb, "select" | "insert" | "delete">;

export type GroupInheritanceResult = {
  readonly groupId: string;
  /** Devices inherited from child groups after the refresh. */
  readonly inherited: number;
  readonly added: number;
  readonly removed: number;
  /** Groups refreshed, nearest first (the group itself, then its ancestors). */
  readonly refreshed: ReadonlyArray<string>;
};

const childrenMap = (edges: ReadonlyArray<GroupHierarchyEdge>) => {
  const map = new Map<string, Array<string>>();

  for (const edge of edges) {
    const list = map.get(edge.parentId) ?? [];

    list.push(edge.childId);
    map.set(edge.parentId, list);
  }

  return map;
};

const parentsMap = (edges: ReadonlyArray<GroupHierarchyEdge>) => {
  const map = new Map<string, Array<string>>();

  for (const edge of edges) {
    const list = map.get(edge.childId) ?? [];

    list.push(edge.parentId);
    map.set(edge.childId, list);
  }

  return map;
};

/**
 * The group followed by each enclosing group, nearest first.
 *
 * A visited set makes a corrupt cycle terminate; the depth cap bounds a
 * maliciously deep (or looped) chain. The returned list always starts with the
 * requested group, even when that group no longer exists.
 */
export const ancestorGroupIds = (
  edges: ReadonlyArray<GroupHierarchyEdge>,
  groupId: string,
  limit: number = GROUP_NESTING_MAX_DEPTH,
): ReadonlyArray<string> => {
  const parents = parentsMap(edges);
  const chain: Array<string> = [];
  const visited = new Set<string>();
  let current: string | undefined = groupId;

  while (current !== undefined && chain.length < limit && !visited.has(current)) {
    chain.push(current);
    visited.add(current);
    current = (parents.get(current) ?? []).find((parent) => !visited.has(parent));
  }

  return chain;
};

/** Longest number of edges from `groupId` towards a root. */
const depthAbove = (
  parents: ReadonlyMap<string, ReadonlyArray<string>>,
  groupId: string,
): number => {
  let deepest = 0;

  // Depth is bounded rather than visited-guarded: a shared ancestor can be
  // reached at different depths, and the longest path is the one that matters.
  const walk = (current: string, depth: number): void => {
    if (depth > GROUP_NESTING_MAX_DEPTH) return;
    deepest = Math.max(deepest, depth);

    for (const parent of parents.get(current) ?? []) walk(parent, depth + 1);
  };

  walk(groupId, 0);

  return deepest;
};

/** Longest number of edges from `groupId` towards a leaf. */
const heightBelow = (
  children: ReadonlyMap<string, ReadonlyArray<string>>,
  groupId: string,
): number => {
  let deepest = 0;

  const walk = (current: string, depth: number): void => {
    if (depth > GROUP_NESTING_MAX_DEPTH) return;
    deepest = Math.max(deepest, depth);

    for (const child of children.get(current) ?? []) walk(child, depth + 1);
  };

  walk(groupId, 0);

  return deepest;
};

/**
 * Whether one group can be nested inside another, or the reason it cannot.
 *
 * Rejects self-inclusion, every cycle (including a longer path that already
 * reaches the parent from the child) and a chain deeper than
 * {@link GROUP_NESTING_MAX_DEPTH}. The existing edge is allowed as a no-op so a
 * repeated save is idempotent.
 */
export const groupHierarchyProblem = (
  edges: ReadonlyArray<GroupHierarchyEdge>,
  parentId: string,
  childId: string,
): string | null => {
  if (parentId === childId) return "A group cannot be nested inside itself.";

  if (edges.some((edge) => edge.parentId === parentId && edge.childId === childId)) return null;

  const children = childrenMap(edges);

  // If the parent is already reachable from the child, the new edge would
  // close a loop.
  const reaches = (from: string, target: string): boolean => {
    const seen = new Set<string>();
    const stack = [from];

    while (stack.length > 0) {
      const current = stack.pop()!;

      if (current === target) return true;

      if (seen.has(current) || seen.size > GROUP_NESTING_MAX_DEPTH * GROUP_NESTING_MAX_DEPTH)
        continue;
      seen.add(current);
      stack.push(...(children.get(current) ?? []));
    }

    return false;
  };

  if (reaches(childId, parentId))
    return "That child group already contains this group, so nesting it would create a loop.";

  const parents = parentsMap(edges);
  const chainLength = depthAbove(parents, parentId) + 1 + 1 + heightBelow(children, childId);

  if (chainLength > GROUP_NESTING_MAX_DEPTH)
    return `Groups can be nested at most ${GROUP_NESTING_MAX_DEPTH} levels deep.`;

  return null;
};

/**
 * Tenant-scoped edges. Loading them all is bounded by the number of groups in
 * the tenant and keeps the depth/cycle checks free of recursive SQL.
 */
export const loadGroupHierarchyEdges = (
  db: GroupInheritanceDb,
  organizationId: string,
) =>
  Effect.gen(function* () {
    const rows = yield* db
      .select({
        parentId: s.groupGroup.parentGroupId,
        childId: s.groupGroup.childGroupId,
      })
      .from(s.groupGroup)
      .innerJoin(s.enterpriseGroup, eq(s.enterpriseGroup.id, s.groupGroup.parentGroupId))
      .where(eq(s.enterpriseGroup.organizationId, organizationId));

    return rows as ReadonlyArray<GroupHierarchyEdge>;
  });

/** The group plus every enclosing group, bounded and cycle-safe. */
export const groupIdsWithAncestors = (
  db: GroupInheritanceDb,
  organizationId: string,
  groupId: string,
) =>
  Effect.gen(function* () {
    const edges = yield* loadGroupHierarchyEdges(db, organizationId);

    return [...ancestorGroupIds(edges, groupId)];
  });

/**
 * Recompute the inherited rows of one group and of every group that contains
 * it (transitively, nearest first).
 *
 * Call this after anything that can change a group's own membership: a manual
 * add/remove, a dynamic recompute, a directory recompute, an exclusion, or a
 * child-group edge change. A parent's row set is a union of its children's
 * already-materialised rows, so refreshing in child → parent order is what makes
 * the transitive union correct in one pass.
 *
 * Only `source = 'nested'` rows are touched. Manual, dynamic and directory rows
 * are the child group's own facts and are never overwritten by inheritance: the
 * primary key decides precedence (a device already manually assigned stays
 * manual, and the nested insert is ignored).
 */
export const syncGroupInheritance = (
  db: GroupInheritanceDb,
  organizationId: string,
  groupId: string,
): Effect.Effect<GroupInheritanceResult, unknown> =>
  Effect.gen(function* () {
    const edges = yield* loadGroupHierarchyEdges(db, organizationId);
    const chain = ancestorGroupIds(edges, groupId);
    const children = childrenMap(edges);

    let inherited = 0;
    let added = 0;
    let removed = 0;

    for (const current of chain) {
      const childIds = children.get(current) ?? [];

      if (childIds.length === 0) {
        const result = yield* db
          .delete(s.groupDevice)
          .where(
            and(
              eq(s.groupDevice.groupId, current),
              eq(s.groupDevice.source, "nested"),
            ),
          );

        removed += Array.isArray(result) ? result.length : 0;
        continue;
      }

      // A child's rows already include its own inherited members, so reading
      // one level is enough for a transitive union.
      const childRows = yield* db
        .select({ deviceId: s.groupDevice.deviceId })
        .from(s.groupDevice)
        .where(inArray(s.groupDevice.groupId, [...childIds]));

      const exclusionRows = yield* db
        .select({ targetId: s.groupExclusion.targetId })
        .from(s.groupExclusion)
        .where(
          and(eq(s.groupExclusion.groupId, current), eq(s.groupExclusion.target, "device")),
        );

      const existingRows = yield* db
        .select({ deviceId: s.groupDevice.deviceId, source: s.groupDevice.source })
        .from(s.groupDevice)
        .where(eq(s.groupDevice.groupId, current));

      const excluded = new Set(exclusionRows.map((row) => row.targetId));

      // A device excluded from this group is not inherited either. Exclusions
      // win over every membership source.
      const desired = new Set(
        childRows.map((row) => row.deviceId).filter((deviceId) => !excluded.has(deviceId)),
      );

      const existingAll = new Set(
        existingRows
          .filter((row) => !excluded.has(row.deviceId))
          .map((row) => row.deviceId),
      );

      const existingNested = new Set(
        existingRows
          .filter((row) => row.source === "nested" && !excluded.has(row.deviceId))
          .map((row) => row.deviceId),
      );

      // Skip every device that already has a row of any source: manual,
      // dynamic and directory rows outrank inheritance, and not attempting the
      // insert is also what a database with the membership primary key does.
      const toAdd = [...desired].filter((deviceId) => !existingAll.has(deviceId));
      const toRemove = [...existingNested].filter((deviceId) => !desired.has(deviceId));

      if (toRemove.length > 0) {
        const result = yield* db
          .delete(s.groupDevice)
          .where(
            and(
              eq(s.groupDevice.groupId, current),
              eq(s.groupDevice.source, "nested"),
              inArray(s.groupDevice.deviceId, toRemove),
            ),
          );

        removed += Array.isArray(result) ? result.length : 0;
      }

      if (toAdd.length > 0) {
        // `ignore` is what lets a manual/dynamic/directory row survive: the
        // primary key wins and the device simply is not marked as inherited.
        yield* db
          .insert(s.groupDevice)
          .ignore()
          .values(toAdd.map((deviceId) => ({ groupId: current, deviceId, source: "nested" as const })));
        added += toAdd.length;
      }

      if (current === groupId) inherited = desired.size;
    }

    return { groupId, inherited, added, removed, refreshed: chain };
  });

/** Direct child group ids, tenant-scoped through the edge loader. */
export const childGroupIds = (
  db: GroupInheritanceDb,
  organizationId: string,
  groupId: string,
) =>
  Effect.gen(function* () {
    const edges = yield* loadGroupHierarchyEdges(db, organizationId);

    return childrenMap(edges).get(groupId) ?? [];
  });
