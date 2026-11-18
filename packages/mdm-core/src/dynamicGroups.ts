import { Effect } from "effect";
import { and, eq, inArray } from "drizzle-orm";
import { schema as s, type EnterpriseDb } from "@mattrax/enterprise-core";
import {
  deriveDeviceHealth,
  dynamicGroupRulesProblem,
  evaluateDynamicGroupRules,
  hasDynamicGroupConditions,
} from "@mattrax/enterprise-domain";

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

    const applications = applicationsByDevice(
      yield* loadApplications(
        db,
        organizationId,
        devices.map((device) => device.id),
      ),
    );

    const matching = new Set<string>();

    for (const device of devices) {
      const health = healthForDevice(
        device,
        declarationsFor.get(device.id) ?? [],
        now,
        options.staleAfterDays,
      );

      if (
        evaluateDynamicGroupRules(
          rules,
          deviceSnapshot(device, health, applications.get(device.id) ?? []),
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

    const applications = applicationsByDevice(
      yield* loadApplications(db, organizationId, [device.id]),
    );

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
        evaluateDynamicGroupRules(
          rules,
          deviceSnapshot(device, health, applications.get(device.id) ?? []),
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

    return results;
  });

export type DynamicGroupPreview = {
  readonly groupId: string;
  readonly kind: "manual" | "dynamic";
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

    if (group.kind !== "dynamic") {
      const links = yield* db
        .select()
        .from(s.groupDevice)
        .where(eq(s.groupDevice.groupId, groupId));

      const memberIds = new Set(links.map((link) => link.deviceId));

      const members = devices
        .filter((device) => memberIds.has(device.id))
        .map((device) => ({ id: device.id, name: device.name }))
        .sort((left, right) => left.name.localeCompare(right.name));

      return { groupId, kind: "manual", count: members.length, devices: members, evaluatedAt: now };
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

    const applications = applicationsByDevice(
      yield* loadApplications(
        db,
        organizationId,
        devices.map((device) => device.id),
      ),
    );

    const matched: Array<{ id: string; name: string }> = [];

    for (const device of devices) {
      const health = healthForDevice(
        device,
        declarationsFor.get(device.id) ?? [],
        now,
        options.staleAfterDays,
      );

      if (
        evaluateDynamicGroupRules(
          rules,
          deviceSnapshot(device, health, applications.get(device.id) ?? []),
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
