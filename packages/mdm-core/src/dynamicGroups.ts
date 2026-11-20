import { Effect } from "effect";
import { and, eq, inArray } from "drizzle-orm";
import { schema as s, type EnterpriseDb } from "@mattrax/enterprise-core";
import {
  deriveDeviceHealth,
  dynamicGroupRulesProblem,
  evaluateDynamicGroupRules,
  hasDynamicGroupConditions,
  type DeviceQueryUser,
} from "@mattrax/enterprise-domain";
import { syncGroupInheritance } from "./groupInheritance.ts";

export type DynamicGroupSyncOptions = {
  /** Injectable clock. Defaults to `new Date()`. */
  readonly now?: Date;
  /** Stale threshold used when deriving health for `health` conditions. */
  readonly staleAfterDays?: number;
};

export type DynamicGroupSyncResult = {
  readonly groupId: string;
  readonly matched: number;
  readonly added: number;
  readonly removed: number;
  readonly evaluatedAt: Date;
};

type DeviceRow = typeof s.device.$inferSelect;

type DeclarationRow = typeof s.deviceDeclaration.$inferSelect;

type ApplicationRow = typeof s.deviceApplication.$inferSelect;

type HealthInput = Parameters<typeof deriveDeviceHealth>[0];

const healthForDevice = (
  device: DeviceRow,
  declarations: ReadonlyArray<DeclarationRow>,
  now: Date,
  staleAfterDays: number | undefined,
): ReturnType<typeof deriveDeviceHealth> => {
  const input: HealthInput = {
    status: device.status,
    lastSeenAt: device.lastSeenAt,
    declarations,
    diskTotal: device.diskTotal,
    diskUsed: device.diskUsed,
    proto: device.proto,
    model: device.model,
    osEdition: device.osEdition,
    fileVaultEnabled: device.fileVaultEnabled,
    batteryHealth: device.batteryHealth,
    // Keep dynamic-group health aligned with the device table: omitting the
    // Windows security report made a BitLocker-off device "healthy" here but
    // "attention" in search and dashboards.
    bitLockerEnabled: device.bitLockerEnabled,
    bitLockerStatus: device.bitLockerStatus,
    tpmVersion: device.tpmVersion,
    secureBootState: device.secureBootState,
    domainName: device.domainName,
    entraDeviceId: device.entraDeviceId,
    windowsSecurityReported: device.securityUpdatedAt != null,
    now,
  };

  return deriveDeviceHealth(staleAfterDays === undefined ? input : { ...input, staleAfterDays });
};

const deviceSnapshot = (
  device: DeviceRow,
  health: ReturnType<typeof deriveDeviceHealth>,
  applications: ReadonlyArray<{ bundleId: string; name: string | null }> = [],
  users: ReadonlyArray<DeviceQueryUser> = [],
) => ({
  name: device.name,
  proto: device.proto,
  model: device.model,
  osVersion: device.osVersion,
  osEdition: device.osEdition,
  serial: device.serial,
  assetTag: device.assetTag,
  status: device.status,
  batteryHealth: device.batteryHealth,
  lastSeenAt: device.lastSeenAt,
  enrolledAt: device.enrolledAt,
  fileVaultEnabled: device.fileVaultEnabled,
  windowsActivationStatus: device.windowsActivationStatus,
  applications,
  // An empty array is a real answer ("no linked users") and makes positive user
  // conditions fail while `ne` ones hold. Passing `undefined` would mean the
  // data was never loaded.
  users,
  health: { level: health.level, stale: health.stale },
});

const declarationsByDevice = (rows: ReadonlyArray<DeclarationRow>) => {
  const map = new Map<string, DeclarationRow[]>();

  for (const row of rows) {
    const list = map.get(row.deviceId) ?? [];
    list.push(row);
    map.set(row.deviceId, list);
  }

  return map;
};

/**
 * Load the declarations needed for health derivation. Dynamic groups evaluate
 * health in application code, so this is intentionally a tenant-scoped bulk
 * read rather than a query per device.
 */
const loadDeclarations = (db: EnterpriseDb, deviceIds: ReadonlyArray<string>) =>
  deviceIds.length === 0
    ? Effect.succeed([])
    : db
        .select()
        .from(s.deviceDeclaration)
        .where(inArray(s.deviceDeclaration.deviceId, [...deviceIds]));

const loadTenantDevices = (db: EnterpriseDb, organizationId: string) =>
  db.select().from(s.device).where(eq(s.device.organizationId, organizationId));

const loadApplications = (
  db: EnterpriseDb,
  organizationId: string,
  deviceIds: ReadonlyArray<string>,
) =>
  deviceIds.length === 0
    ? Effect.succeed([])
    : db
        .select({
          deviceId: s.deviceApplication.deviceId,
          bundleId: s.deviceApplication.bundleId,
          name: s.deviceApplication.name,
        })
        .from(s.deviceApplication)
        .where(
          and(
            eq(s.deviceApplication.organizationId, organizationId),
            inArray(s.deviceApplication.deviceId, [...deviceIds]),
          ),
        );

const applicationsByDevice = (
  rows: ReadonlyArray<Pick<ApplicationRow, "deviceId" | "bundleId" | "name">>,
) => {
  const map = new Map<string, Array<{ bundleId: string; name: string | null }>>();

  for (const row of rows) {
    const list = map.get(row.deviceId) ?? [];
    list.push({ bundleId: row.bundleId, name: row.name });
    map.set(row.deviceId, list);
  }

  return map;
};

/**
 * Directory users linked to devices, for `user*` conditions.
 *
 * Disabled users are omitted: a leaver keeps their row (directory sync marks
 * them disabled), but no longer represents the person using the device, and the
 * policy resolver already ignores them. Tenant filters on both sides keep a
 * stale cross-tenant link inert.
 */
const loadDeviceUsers = (
  db: EnterpriseDb,
  organizationId: string,
  deviceIds: ReadonlyArray<string>,
) =>
  deviceIds.length === 0
    ? Effect.succeed([])
    : db
        .select({
          deviceId: s.deviceUser.deviceId,
          userId: s.user.id,
          email: s.user.email,
          name: s.user.name,
          externalId: s.user.externalId,
          source: s.user.source,
        })
        .from(s.deviceUser)
        .innerJoin(s.user, eq(s.user.id, s.deviceUser.userId))
        .where(
          and(
            eq(s.deviceUser.organizationId, organizationId),
            eq(s.user.organizationId, organizationId),
            eq(s.user.disabled, false),
            inArray(s.deviceUser.deviceId, [...deviceIds]),
          ),
        );

const usersByDevice = (
  rows: ReadonlyArray<{
    deviceId: string;
    userId: string;
    email: string;
    name: string;
    externalId: string | null;
    source: string;
  }>,
) => {
  const map = new Map<string, Array<DeviceQueryUser>>();

  for (const row of rows) {
    const list = map.get(row.deviceId) ?? [];
    list.push({
      id: row.userId,
      email: row.email,
      name: row.name,
      externalId: row.externalId,
      source: row.source,
    });
    map.set(row.deviceId, list);
  }

  return map;
};

/** Devices an operator explicitly excluded from a group. */
const loadDeviceExclusions = (db: EnterpriseDb, groupId: string) =>
  Effect.gen(function* () {
    const rows = yield* db
      .select({ targetId: s.groupExclusion.targetId })
      .from(s.groupExclusion)
      .where(and(eq(s.groupExclusion.groupId, groupId), eq(s.groupExclusion.target, "device")));

    return new Set(rows.map((row) => row.targetId));
  });

/**
 * People an operator explicitly excluded from a group. Their `device_user`
 * links are ignored when this group's rules are evaluated, so a device is not
 * pulled in by a person the group excludes. If another, non-excluded person
 * links the same device, the device can still match.
 */
const loadUserExclusions = (db: EnterpriseDb, groupId: string) =>
  Effect.gen(function* () {
    const rows = yield* db
      .select({ targetId: s.groupExclusion.targetId })
      .from(s.groupExclusion)
      .where(and(eq(s.groupExclusion.groupId, groupId), eq(s.groupExclusion.target, "user")));

    return new Set(rows.map((row) => row.targetId));
  });

/** Drop people whose link this group ignores. */
const withoutExcludedUsers = (
  users: ReadonlyArray<DeviceQueryUser>,
  excluded: ReadonlySet<string>,
): Array<DeviceQueryUser> =>
  excluded.size === 0 ? [...users] : users.filter((user) => !user.id || !excluded.has(user.id));

/**
 * Recompute a single dynamic group.
 *
 * Only rows with `group_device.source = 'dynamic'` are replaced. A manually
 * added device stays in the group even when the rules no longer match it, which
 * gives administrators explicit exceptions without a separate table.
 *
 * Callers must pass the tenant id; the group lookup and every write is scoped by
 * it so a crafted group id cannot cross tenants.
 */
export const syncDynamicGroup = (
  db: EnterpriseDb,
  organizationId: string,
  groupId: string,
  options: DynamicGroupSyncOptions = {},
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
      .limit(1);

    if (!group) return { groupId, matched: 0, added: 0, removed: 0, evaluatedAt: now };

    // Manual groups never own dynamic rows. Clearing them here also covers a
    // kind change from dynamic to manual.
    if (group.kind !== "dynamic") {
      const removed = yield* db
        .delete(s.groupDevice)
        .where(and(eq(s.groupDevice.groupId, groupId), eq(s.groupDevice.source, "dynamic")));

      return {
        groupId,
        matched: 0,
        added: 0,
        removed: Array.isArray(removed) ? removed.length : 0,
        evaluatedAt: now,
      };
    }

    const rules = group.rules;

    // Invalid rules should have been rejected on write. Leave the existing
    // membership untouched rather than silently removing baselines. A
    // version-valid rule set with no conditions is well defined: it matches
    // nothing, so recomputing clears dynamic rows.
    if (!rules || rules.version !== 1)
      return { groupId, matched: 0, added: 0, removed: 0, evaluatedAt: now };

    if (hasDynamicGroupConditions(rules) && dynamicGroupRulesProblem(rules) !== null)
      return { groupId, matched: 0, added: 0, removed: 0, evaluatedAt: now };

    const devices = yield* loadTenantDevices(db, organizationId);

    const declarations = yield* loadDeclarations(
      db,
      devices.map((device) => device.id),
    );

    const declarationsFor = declarationsByDevice(declarations);

    const applicationRows = yield* loadApplications(
      db,
      organizationId,
      devices.map((device) => device.id),
    );

    const userRows = yield* loadDeviceUsers(
      db,
      organizationId,
      devices.map((device) => device.id),
    );

    const excluded = yield* loadDeviceExclusions(db, groupId);
    const excludedUsers = yield* loadUserExclusions(db, groupId);

    const applications = applicationsByDevice(applicationRows);
    const users = usersByDevice(userRows);

    const matching = new Set<string>();

    for (const device of devices) {
      // An explicit exclusion wins over rule matches and manual membership.
      if (excluded.has(device.id)) continue;

      const health = healthForDevice(
        device,
        declarationsFor.get(device.id) ?? [],
        now,
        options.staleAfterDays,
      );

      if (
        evaluateDynamicGroupRules(
          rules,
          deviceSnapshot(
            device,
            health,
            applications.get(device.id) ?? [],
            withoutExcludedUsers(users.get(device.id) ?? [], excludedUsers),
          ),
          { now },
        )
      )
        matching.add(device.id);
    }

    const links = yield* db.select().from(s.groupDevice).where(eq(s.groupDevice.groupId, groupId));

    const manual = new Set(
      links.filter((link) => link.source !== "dynamic").map((link) => link.deviceId),
    );

    const existingDynamic = new Set(
      links.filter((link) => link.source === "dynamic").map((link) => link.deviceId),
    );

    // A manual row wins over a rule match; never insert a duplicate primary key.
    const desired = new Set([...matching].filter((deviceId) => !manual.has(deviceId)));
    const toAdd = [...desired].filter((deviceId) => !existingDynamic.has(deviceId));
    const toRemove = [...existingDynamic].filter((deviceId) => !desired.has(deviceId));

    if (toRemove.length > 0)
      yield* db
        .delete(s.groupDevice)
        .where(
          and(
            eq(s.groupDevice.groupId, groupId),
            eq(s.groupDevice.source, "dynamic"),
            inArray(s.groupDevice.deviceId, toRemove),
          ),
        );

    if (toAdd.length > 0)
      yield* db
        .insert(s.groupDevice)
        .ignore()
        .values(toAdd.map((deviceId) => ({ groupId, deviceId, source: "dynamic" as const })));

    yield* db
      .update(s.enterpriseGroup)
      .set({ lastEvaluatedAt: now })
      .where(
        and(
          eq(s.enterpriseGroup.id, groupId),
          eq(s.enterpriseGroup.organizationId, organizationId),
        ),
      );

    // A parent group includes this group's members, so a change here changes
    // every enclosing group too.
    yield* syncGroupInheritance(db, organizationId, groupId);

    return {
      groupId,
      matched: desired.size,
      added: toAdd.length,
      removed: toRemove.length,
      evaluatedAt: now,
    };
  });

/**
 * Recompute only the dynamic groups of one tenant. Used by group create/update
 * and daily maintenance.
 */
export const syncDynamicGroupsForTenant = (
  db: EnterpriseDb,
  organizationId: string,
  options: DynamicGroupSyncOptions = {},
) =>
  Effect.gen(function* () {
    const groups = yield* db
      .select()
      .from(s.enterpriseGroup)
      .where(
        and(
          eq(s.enterpriseGroup.organizationId, organizationId),
          eq(s.enterpriseGroup.kind, "dynamic"),
        ),
      );

    const results: DynamicGroupSyncResult[] = [];

    for (const group of groups)
      results.push(yield* syncDynamicGroup(db, organizationId, group.id, options));

    return results;
  });

/**
 * Cheap device-driven update: evaluate the tenant's dynamic rules for one
 * device instead of rescanning the fleet. This keeps an MDM check-in bounded by
 * the number of dynamic groups in the tenant, not by the number of devices.
 */
export const syncDynamicGroupsForDevice = (
  db: EnterpriseDb,
  organizationId: string,
  deviceId: string,
  options: DynamicGroupSyncOptions = {},
) =>
  Effect.gen(function* () {
    const now = options.now ?? new Date();

    const [device] = yield* db
      .select()
      .from(s.device)
      .where(and(eq(s.device.id, deviceId), eq(s.device.organizationId, organizationId)))
      .limit(1);

    if (!device) return [];

    const groups = yield* db
      .select()
      .from(s.enterpriseGroup)
      .where(
        and(
          eq(s.enterpriseGroup.organizationId, organizationId),
          eq(s.enterpriseGroup.kind, "dynamic"),
        ),
      );

    if (groups.length === 0) return [];

    const declarations = yield* loadDeclarations(db, [device.id]);

    const applicationRows = yield* loadApplications(db, organizationId, [device.id]);

    const userRows = yield* loadDeviceUsers(db, organizationId, [device.id]);

    const exclusionRows = yield* db
      .select({ groupId: s.groupExclusion.groupId })
      .from(s.groupExclusion)
      .innerJoin(s.enterpriseGroup, eq(s.enterpriseGroup.id, s.groupExclusion.groupId))
      .where(
        and(
          eq(s.enterpriseGroup.organizationId, organizationId),
          eq(s.groupExclusion.target, "device"),
          eq(s.groupExclusion.targetId, device.id),
        ),
      );

    const userExclusionRows = groups.length
      ? yield* db
          .select({
            groupId: s.groupExclusion.groupId,
            targetId: s.groupExclusion.targetId,
          })
          .from(s.groupExclusion)
          .where(
            and(
              eq(s.groupExclusion.target, "user"),
              inArray(
                s.groupExclusion.groupId,
                groups.map((group) => group.id),
              ),
            ),
          )
      : [];

    const exclusionsByGroup = new Map<string, Set<string>>();

    for (const row of userExclusionRows) {
      const set = exclusionsByGroup.get(row.groupId) ?? new Set<string>();

      set.add(row.targetId);
      exclusionsByGroup.set(row.groupId, set);
    }

    const applications = applicationsByDevice(applicationRows);
    const users = usersByDevice(userRows);
    const excludedGroups = new Set(exclusionRows.map((row) => row.groupId));

    const health = healthForDevice(device, declarations, now, options.staleAfterDays);

    const links = yield* db
      .select()
      .from(s.groupDevice)
      .where(eq(s.groupDevice.deviceId, deviceId));

    const manualGroups = new Set(
      links.filter((link) => link.source !== "dynamic").map((link) => link.groupId),
    );

    const dynamicGroups = new Set(
      links.filter((link) => link.source === "dynamic").map((link) => link.groupId),
    );

    const results: DynamicGroupSyncResult[] = [];
    const toAdd: string[] = [];
    const toRemove: string[] = [];
    const evaluated: string[] = [];

    for (const group of groups) {
      const rules = group.rules;

      if (!rules || rules.version !== 1) continue;

      if (hasDynamicGroupConditions(rules) && dynamicGroupRulesProblem(rules) !== null) continue;
      evaluated.push(group.id);

      const matches =
        !manualGroups.has(group.id) &&
        !excludedGroups.has(group.id) &&
        evaluateDynamicGroupRules(
          rules,
          deviceSnapshot(
            device,
            health,
            applications.get(device.id) ?? [],
            withoutExcludedUsers(
              users.get(device.id) ?? [],
              exclusionsByGroup.get(group.id) ?? new Set<string>(),
            ),
          ),
          { now },
        );

      const isDynamicMember = dynamicGroups.has(group.id);

      if (matches && !isDynamicMember) toAdd.push(group.id);

      if (!matches && isDynamicMember) toRemove.push(group.id);
      results.push({
        groupId: group.id,
        matched: matches ? 1 : 0,
        added: matches && !isDynamicMember ? 1 : 0,
        removed: !matches && isDynamicMember ? 1 : 0,
        evaluatedAt: now,
      });
    }

    if (toRemove.length > 0)
      yield* db
        .delete(s.groupDevice)
        .where(
          and(
            eq(s.groupDevice.deviceId, deviceId),
            eq(s.groupDevice.source, "dynamic"),
            inArray(s.groupDevice.groupId, toRemove),
          ),
        );

    if (toAdd.length > 0)
      yield* db
        .insert(s.groupDevice)
        .ignore()
        .values(toAdd.map((groupId) => ({ groupId, deviceId, source: "dynamic" as const })));

    if (evaluated.length > 0)
      yield* db
        .update(s.enterpriseGroup)
        .set({ lastEvaluatedAt: now })
        .where(
          and(
            eq(s.enterpriseGroup.organizationId, organizationId),
            inArray(s.enterpriseGroup.id, evaluated),
          ),
        );

    // Only the groups whose rows changed can move a parent's union. Refreshing
    // the ancestors of each keeps nested membership correct without a full
    // tenant recompute on every device check-in.
    for (const groupId of new Set([...toAdd, ...toRemove]))
      yield* syncGroupInheritance(db, organizationId, groupId);

    return results;
  });

export type DynamicGroupPreview = {
  readonly groupId: string;
  readonly kind: "manual" | "dynamic" | "directory";
  readonly count: number;
  readonly devices: ReadonlyArray<{ id: string; name: string }>;
  readonly evaluatedAt: Date;
};

/**
 * Read-only preview. Dynamic groups evaluate the current rule set live (so the
 * dashboard can show a count before saving); manual groups report the devices
 * currently linked to them.
 */
export const previewDynamicGroup = (
  db: EnterpriseDb,
  organizationId: string,
  groupId: string,
  options: DynamicGroupSyncOptions = {},
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
      .limit(1);

    if (!group) return null;

    const devices = yield* loadTenantDevices(db, organizationId);

    if (group.kind !== "dynamic" || group.directoryGroupId) {
      const links = yield* db
        .select()
        .from(s.groupDevice)
        .where(eq(s.groupDevice.groupId, groupId));

      const memberIds = new Set(links.map((link) => link.deviceId));

      const members = devices
        .filter((device) => memberIds.has(device.id))
        .map((device) => ({ id: device.id, name: device.name }))
        .sort((left, right) => left.name.localeCompare(right.name));

      // A linked group's members are materialised from directory membership;
      // the UI treats this as read-only rather than as an empty manual group.
      return {
        groupId,
        kind: group.directoryGroupId ? ("directory" as const) : ("manual" as const),
        count: members.length,
        devices: members,
        evaluatedAt: now,
      };
    }

    const rules = group.rules;

    if (!rules || rules.version !== 1)
      return { groupId, kind: "dynamic", count: 0, devices: [], evaluatedAt: now };

    if (hasDynamicGroupConditions(rules) && dynamicGroupRulesProblem(rules) !== null)
      return { groupId, kind: "dynamic", count: 0, devices: [], evaluatedAt: now };

    const declarations = yield* loadDeclarations(
      db,
      devices.map((device) => device.id),
    );

    const declarationsFor = declarationsByDevice(declarations);

    const applicationRows = yield* loadApplications(
      db,
      organizationId,
      devices.map((device) => device.id),
    );

    const userRows = yield* loadDeviceUsers(
      db,
      organizationId,
      devices.map((device) => device.id),
    );

    const excluded = yield* loadDeviceExclusions(db, groupId);
    const excludedUsers = yield* loadUserExclusions(db, groupId);

    const applications = applicationsByDevice(applicationRows);
    const users = usersByDevice(userRows);
    const matched: Array<{ id: string; name: string }> = [];

    for (const device of devices) {
      if (excluded.has(device.id)) continue;

      const health = healthForDevice(
        device,
        declarationsFor.get(device.id) ?? [],
        now,
        options.staleAfterDays,
      );

      if (
        evaluateDynamicGroupRules(
          rules,
          deviceSnapshot(
            device,
            health,
            applications.get(device.id) ?? [],
            withoutExcludedUsers(users.get(device.id) ?? [], excludedUsers),
          ),
          { now },
        )
      )
        matched.push({ id: device.id, name: device.name });
    }

    matched.sort((left, right) => left.name.localeCompare(right.name));

    return {
      groupId,
      kind: "dynamic",
      count: matched.length,
      devices: matched,
      evaluatedAt: now,
    };
  });
