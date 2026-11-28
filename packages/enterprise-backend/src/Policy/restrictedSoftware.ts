import { DeviceId, RestrictedSoftwareId, RuleId } from "@mattrax/crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import {
  RESTRICTED_SOFTWARE_LIMITS,
  normaliseRestrictedSoftwareMatch,
  normaliseRestrictedSoftwareMatchValue,
  restrictedSoftwareProblem,
  restrictedSoftwareScopeApplies,
  updatedAtSatisfiesPrecondition,
} from "@mattrax/enterprise-domain";
import type {
  CreateRestrictedSoftwareRequest,
  PatchRestrictedSoftwareAssignmentsRequest,
  PatchRestrictedSoftwareRequest,
  RestrictedSoftwareAssignmentInfo,
  RestrictedSoftwareDetail,
  RestrictedSoftwareListResponse,
  RestrictedSoftwareRuleInfo,
  RestrictedSoftwareViolationInfo,
  RestrictedSoftwareViolationsResponse,
  UpdatedAtPrecondition,
} from "@mattrax/enterprise-domain";
import type { EnterpriseDb } from "../schema.ts";
import { schema as s } from "../schema.ts";
import { resolveRestrictedSoftwareForDevice } from "@mattrax/enterprise-core";

/**
 * Tenant-scoped persistence for restricted software.
 *
 * Every query filters by `organization_id` because the HTTP layer's tenant
 * check is the only boundary; a rule id from another tenant must behave like a
 * missing row. Audit and webhook delivery stay in the handler.
 */

type RuleRow = typeof s.restrictedSoftware.$inferSelect;
type ViolationRow = typeof s.restrictedSoftwareViolation.$inferSelect;

const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null);

const emails = (value: RuleRow["notificationEmails"]): string[] =>
  Array.isArray(value) ? value.filter((email) => typeof email === "string") : [];

const toInfo = (
  row: RuleRow,
  counts: {
    readonly deviceCount: number;
    readonly groupCount: number;
    readonly assignedDeviceCount: number;
    readonly openViolationCount: number;
  },
): RestrictedSoftwareRuleInfo => ({
  id: row.id,
  name: row.name,
  platform: row.platform,
  matchType: row.matchType,
  matchValue: row.matchValue,
  action: row.action,
  message: row.message,
  notificationEmails: emails(row.notificationEmails),
  enabled: row.enabled,
  deviceCount: counts.deviceCount,
  groupCount: counts.groupCount,
  assignedDeviceCount: counts.assignedDeviceCount,
  openViolationCount: counts.openViolationCount,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const summaries = (
  db: EnterpriseDb,
  organizationId: string,
  rows: ReadonlyArray<RuleRow>,
): Effect.Effect<ReadonlyArray<RestrictedSoftwareRuleInfo>, unknown> =>
  Effect.gen(function* () {
    if (rows.length === 0) return [];

    const ids = rows.map((row) => row.id);
    const assignments = yield* db
      .select()
      .from(s.restrictedSoftwareAssignment)
      .where(
        and(
          eq(s.restrictedSoftwareAssignment.organizationId, organizationId),
          inArray(s.restrictedSoftwareAssignment.restrictedSoftwareId, ids),
        ),
      );

    const devices = yield* db
      .select({ id: s.device.id })
      .from(s.device)
      .where(eq(s.device.organizationId, organizationId));
    const tenantDeviceIds = devices.map((row) => row.id);

    const groupIds = [
      ...new Set(
        assignments
          .filter((assignment) => assignment.targetType === "group")
          .map((assignment) => assignment.targetId),
      ),
    ];

    const members =
      groupIds.length === 0
        ? []
        : yield* db
            .select({ groupId: s.groupDevice.groupId, deviceId: s.groupDevice.deviceId })
            .from(s.groupDevice)
            .where(inArray(s.groupDevice.groupId, groupIds));
    const groupsByDevice = new Map<string, Set<string>>();

    for (const member of members) {
      const set = groupsByDevice.get(member.deviceId) ?? new Set<string>();

      set.add(member.groupId);
      groupsByDevice.set(member.deviceId, set);
    }

    const violations = yield* db
      .select({
        ruleId: s.restrictedSoftwareViolation.restrictedSoftwareId,
        status: s.restrictedSoftwareViolation.status,
      })
      .from(s.restrictedSoftwareViolation)
      .where(
        and(
          eq(s.restrictedSoftwareViolation.organizationId, organizationId),
          inArray(s.restrictedSoftwareViolation.restrictedSoftwareId, ids),
        ),
      );

    const openByRule = new Map<string, number>();

    for (const violation of violations)
      if (violation.status === "open")
        openByRule.set(violation.ruleId, (openByRule.get(violation.ruleId) ?? 0) + 1);

    return rows.map((row) => {
      const own = assignments.filter((assignment) => assignment.restrictedSoftwareId === row.id);

      // Include/exclude semantics, not a raw union: an exclude-only rule has
      // zero devices, and an include plus exclude must subtract the exclusion.
      const assignedDeviceCount = tenantDeviceIds.filter((deviceId) =>
        restrictedSoftwareScopeApplies(own, {
          deviceId,
          groupIds: groupsByDevice.get(deviceId) ?? new Set(),
        }),
      ).length;

      return toInfo(row, {
        deviceCount: own.filter(
          (assignment) => assignment.targetType === "device" && assignment.mode === "include",
        ).length,
        groupCount: own.filter(
          (assignment) => assignment.targetType === "group" && assignment.mode === "include",
        ).length,
        assignedDeviceCount,
        openViolationCount: openByRule.get(row.id) ?? 0,
      });
    });
  });

export const listRestrictedSoftware = (
  db: EnterpriseDb,
  organizationId: string,
): Effect.Effect<RestrictedSoftwareListResponse, unknown> =>
  Effect.gen(function* () {
    const rows = yield* db
      .select()
      .from(s.restrictedSoftware)
      .where(eq(s.restrictedSoftware.organizationId, organizationId))
      .orderBy(asc(s.restrictedSoftware.name))
      .limit(RESTRICTED_SOFTWARE_LIMITS.maxRulesPerTenant);

    return {
      rules: [...(yield* summaries(db, organizationId, rows))],
      limits: { maxRules: RESTRICTED_SOFTWARE_LIMITS.maxRulesPerTenant },
    };
  });

const loadRule = (
  db: EnterpriseDb,
  organizationId: string,
  ruleId: string,
): Effect.Effect<RuleRow | undefined, unknown> =>
  Effect.map(
    db
      .select()
      .from(s.restrictedSoftware)
      .where(
        and(
          eq(s.restrictedSoftware.id, ruleId),
          eq(s.restrictedSoftware.organizationId, organizationId),
        ),
      )
      .limit(1),
    (rows) => rows[0],
  );

export const getRestrictedSoftwareDetail = (
  db: EnterpriseDb,
  organizationId: string,
  ruleId: string,
): Effect.Effect<RestrictedSoftwareDetail | null, unknown> =>
  Effect.gen(function* () {
    const row = yield* loadRule(db, organizationId, ruleId);

    if (!row) return null;

    const [info] = yield* summaries(db, organizationId, [row]);
    const assignments = yield* db
      .select()
      .from(s.restrictedSoftwareAssignment)
      .where(
        and(
          eq(s.restrictedSoftwareAssignment.organizationId, organizationId),
          eq(s.restrictedSoftwareAssignment.restrictedSoftwareId, ruleId),
        ),
      );

    const deviceIds = assignments
      .filter((assignment) => assignment.targetType === "device")
      .map((assignment) => assignment.targetId);
    const groupIds = assignments
      .filter((assignment) => assignment.targetType === "group")
      .map((assignment) => assignment.targetId);

    const devices =
      deviceIds.length === 0
        ? []
        : yield* db
            .select({ id: s.device.id, name: s.device.name })
            .from(s.device)
            .where(
              and(eq(s.device.organizationId, organizationId), inArray(s.device.id, deviceIds)),
            );
    const groups =
      groupIds.length === 0
        ? []
        : yield* db
            .select({ id: s.enterpriseGroup.id, name: s.enterpriseGroup.name })
            .from(s.enterpriseGroup)
            .where(
              and(
                eq(s.enterpriseGroup.organizationId, organizationId),
                inArray(s.enterpriseGroup.id, groupIds),
              ),
            );

    const deviceNames = new Map(devices.map((device) => [device.id, device.name]));
    const groupNames = new Map(groups.map((group) => [group.id, group.name]));

    const resolved: RestrictedSoftwareAssignmentInfo[] = assignments
      .map((assignment) =>
        assignment.targetType === "device"
          ? {
              targetType: "device" as const,
              targetId: assignment.targetId,
              mode: assignment.mode,
              name: deviceNames.get(assignment.targetId) ?? "Deleted device",
            }
          : {
              targetType: "group" as const,
              targetId: assignment.targetId,
              mode: assignment.mode,
              name: groupNames.get(assignment.targetId) ?? "Deleted group",
            },
      )
      .sort((left, right) => left.name.localeCompare(right.name));

    return { rule: info, assignments: resolved };
  });

type DraftInput = {
  readonly name: string;
  readonly platform: string;
  readonly matchType: string;
  readonly matchValue: string;
  readonly action: string;
  readonly message?: string | null;
  readonly notificationEmails?: ReadonlyArray<string>;
  readonly enabled: boolean;
};

type RuleValues = {
  readonly name: string;
  readonly platform: RuleRow["platform"];
  readonly matchType: RuleRow["matchType"];
  readonly matchValue: string;
  readonly matchKey: string;
  readonly action: RuleRow["action"];
  readonly message: string | null;
  readonly notificationEmails: string[];
  readonly enabled: boolean;
};

type DraftValues =
  | { readonly _tag: "problem"; readonly problem: string }
  | { readonly _tag: "ok"; readonly values: RuleValues };

const draftValues = (draft: DraftInput): DraftValues => {
  const problem = restrictedSoftwareProblem(draft);

  if (problem) return { _tag: "problem", problem };

  return {
    _tag: "ok",
    values: {
      name: draft.name.trim(),
      platform: draft.platform as RuleRow["platform"],
      matchType: draft.matchType as RuleRow["matchType"],
      matchValue: normaliseRestrictedSoftwareMatchValue(draft.matchType, draft.matchValue),
      matchKey: normaliseRestrictedSoftwareMatch(draft.matchValue, draft.matchType),
      action: draft.action as RuleRow["action"],
      message: draft.message?.trim() || null,
      notificationEmails: (draft.notificationEmails ?? [])
        .map((email) => email.trim())
        .filter(Boolean),
      enabled: draft.enabled,
    },
  };
};

export const createRestrictedSoftware = (
  db: EnterpriseDb,
  organizationId: string,
  accountId: string,
  input: CreateRestrictedSoftwareRequest,
  now: Date,
): Effect.Effect<{ readonly id: string } | { readonly problem: string }, unknown> =>
  Effect.gen(function* () {
    const built = draftValues({
      name: input.name,
      platform: input.platform,
      matchType: input.matchType,
      matchValue: input.matchValue,
      action: input.action,
      message: input.message,
      notificationEmails: input.notificationEmails,
      enabled: input.enabled ?? true,
    });

    if (built._tag === "problem") return built;

    const existing = yield* db
      .select({ id: s.restrictedSoftware.id })
      .from(s.restrictedSoftware)
      .where(eq(s.restrictedSoftware.organizationId, organizationId))
      .limit(RESTRICTED_SOFTWARE_LIMITS.maxRulesPerTenant + 1);

    if (existing.length >= RESTRICTED_SOFTWARE_LIMITS.maxRulesPerTenant)
      return {
        problem: `This tenant already has the maximum of ${RESTRICTED_SOFTWARE_LIMITS.maxRulesPerTenant} restricted software rules.`,
      };

    const duplicate = yield* db
      .select({ id: s.restrictedSoftware.id })
      .from(s.restrictedSoftware)
      .where(
        and(
          eq(s.restrictedSoftware.organizationId, organizationId),
          eq(s.restrictedSoftware.platform, built.values.platform),
          eq(s.restrictedSoftware.matchKey, built.values.matchKey),
        ),
      )
      .limit(1);

    if (duplicate.length > 0)
      return { problem: "A rule for this identifier already exists on this platform." };

    const id = RestrictedSoftwareId.make();

    yield* db.insert(s.restrictedSoftware).values({
      id,
      organizationId,
      ...built.values,
      createdByAccountId: accountId,
      createdAt: now,
      updatedAt: now,
    });

    return { id };
  });

export const updateRestrictedSoftware = (
  db: EnterpriseDb,
  organizationId: string,
  ruleId: string,
  input: PatchRestrictedSoftwareRequest,
  now: Date,
  precondition: UpdatedAtPrecondition = { _tag: "Missing" },
): Effect.Effect<
  | { readonly notFound: true }
  | { readonly problem: string }
  | { readonly stale: true; readonly current: RuleRow }
  | { readonly status: "ok" },
  unknown
> =>
  Effect.gen(function* () {
    const existing = yield* loadRule(db, organizationId, ruleId);

    if (!existing) return { notFound: true as const };

    const built = draftValues({
      name: input.name ?? existing.name,
      platform: input.platform ?? existing.platform,
      matchType: input.matchType ?? existing.matchType,
      matchValue: input.matchValue ?? existing.matchValue,
      action: input.action ?? existing.action,
      message: input.message === undefined ? existing.message : input.message,
      notificationEmails:
        input.notificationEmails === undefined
          ? emails(existing.notificationEmails)
          : input.notificationEmails,
      enabled: input.enabled ?? existing.enabled,
    });

    if (built._tag === "problem") return built;

    const duplicate = yield* db
      .select({ id: s.restrictedSoftware.id })
      .from(s.restrictedSoftware)
      .where(
        and(
          eq(s.restrictedSoftware.organizationId, organizationId),
          eq(s.restrictedSoftware.platform, built.values.platform),
          eq(s.restrictedSoftware.matchKey, built.values.matchKey),
        ),
      )
      .limit(2);

    if (duplicate.some((row) => row.id !== ruleId))
      return { problem: "A rule for this identifier already exists on this platform." };

    return yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const [current] = yield* tx
          .select()
          .from(s.restrictedSoftware)
          .where(
            and(
              eq(s.restrictedSoftware.id, ruleId),
              eq(s.restrictedSoftware.organizationId, organizationId),
            ),
          )
          .limit(1)
          .for("update");

        if (!current) return { notFound: true as const };

        if (!updatedAtSatisfiesPrecondition(current.updatedAt, precondition))
          return { stale: true as const, current };

        yield* tx
          .update(s.restrictedSoftware)
          .set({ ...built.values, updatedAt: now })
          .where(
            and(
              eq(s.restrictedSoftware.id, ruleId),
              eq(s.restrictedSoftware.organizationId, organizationId),
            ),
          );

        return { status: "ok" as const };
      }),
    );
  });

export const deleteRestrictedSoftware = (
  db: EnterpriseDb,
  organizationId: string,
  ruleId: string,
): Effect.Effect<{ readonly deleted: boolean }, unknown> =>
  Effect.gen(function* () {
    const existing = yield* loadRule(db, organizationId, ruleId);

    if (!existing) return { deleted: false };

    yield* db
      .delete(s.restrictedSoftware)
      .where(
        and(
          eq(s.restrictedSoftware.id, ruleId),
          eq(s.restrictedSoftware.organizationId, organizationId),
        ),
      );

    return { deleted: true };
  });

const targetExists = (
  db: EnterpriseDb,
  organizationId: string,
  target: { readonly targetType: "device" | "group"; readonly targetId: string },
): Effect.Effect<boolean, unknown> =>
  Effect.gen(function* () {
    if (target.targetType === "device") {
      const [row] = yield* db
        .select({ id: s.device.id })
        .from(s.device)
        .where(and(eq(s.device.organizationId, organizationId), eq(s.device.id, target.targetId)))
        .limit(1);

      return Boolean(row);
    }

    const [row] = yield* db
      .select({ id: s.enterpriseGroup.id })
      .from(s.enterpriseGroup)
      .where(
        and(
          eq(s.enterpriseGroup.organizationId, organizationId),
          eq(s.enterpriseGroup.id, target.targetId),
        ),
      )
      .limit(1);

    return Boolean(row);
  });

export const patchRestrictedSoftwareAssignments = (
  db: EnterpriseDb,
  organizationId: string,
  ruleId: string,
  input: PatchRestrictedSoftwareAssignmentsRequest,
  now: Date,
): Effect.Effect<
  { readonly notFound: true } | { readonly problem: string } | { readonly status: "ok" },
  unknown
> =>
  Effect.gen(function* () {
    const rule = yield* loadRule(db, organizationId, ruleId);

    if (!rule) return { notFound: true as const };

    const assign = input.assign ?? [];
    const unassign = input.unassign ?? [];

    for (const target of [...assign, ...unassign])
      if (!(yield* targetExists(db, organizationId, target)))
        return {
          problem: `${target.targetType === "device" ? "Device" : "Group"} ${target.targetId} was not found in this tenant.`,
        };

    const current = yield* db
      .select()
      .from(s.restrictedSoftwareAssignment)
      .where(
        and(
          eq(s.restrictedSoftwareAssignment.organizationId, organizationId),
          eq(s.restrictedSoftwareAssignment.restrictedSoftwareId, ruleId),
        ),
      );

    const desired = new Map(
      current.map((assignment) => [`${assignment.targetType}:${assignment.targetId}`, assignment]),
    );

    for (const target of unassign) desired.delete(`${target.targetType}:${target.targetId}`);

    for (const target of assign)
      desired.set(`${target.targetType}:${target.targetId}`, {
        restrictedSoftwareId: ruleId,
        organizationId,
        targetType: target.targetType,
        targetId: target.targetId,
        mode: target.mode ?? "include",
        createdAt: now,
      });

    if (desired.size > RESTRICTED_SOFTWARE_LIMITS.maxAssignmentsPerRule)
      return {
        problem: `A rule can be scoped to at most ${RESTRICTED_SOFTWARE_LIMITS.maxAssignmentsPerRule} device or group targets.`,
      };

    yield* db.transaction((tx) =>
      Effect.gen(function* () {
        yield* tx
          .delete(s.restrictedSoftwareAssignment)
          .where(
            and(
              eq(s.restrictedSoftwareAssignment.organizationId, organizationId),
              eq(s.restrictedSoftwareAssignment.restrictedSoftwareId, ruleId),
            ),
          );

        if (desired.size > 0)
          yield* tx.insert(s.restrictedSoftwareAssignment).values([...desired.values()]);
      }),
    );

    return { status: "ok" as const };
  });

const toViolation = (input: {
  readonly violation: ViolationRow;
  readonly rule: RuleRow | undefined;
  readonly deviceName: string;
}): RestrictedSoftwareViolationInfo => ({
  id: input.violation.id,
  ruleId: RuleId.fromParam(input.violation.restrictedSoftwareId),
  ruleName: input.rule?.name ?? "Deleted rule",
  action: input.violation.action as RestrictedSoftwareViolationInfo["action"],
  platform: input.violation.platform,
  matchType: input.violation.matchType as RestrictedSoftwareViolationInfo["matchType"],
  matchValue: input.rule?.matchValue ?? input.violation.matchKey,
  deviceId: DeviceId.fromParam(input.violation.deviceId),
  deviceName: input.deviceName,
  matchedBundleId: input.violation.matchedBundleId,
  applicationName: input.violation.applicationName,
  applicationVersion: input.violation.applicationVersion,
  status: input.violation.status,
  enforcementState: input.violation.enforcementState,
  enforcementDetail: input.violation.enforcementDetail,
  occurrenceCount: input.violation.occurrenceCount,
  firstDetectedAt: input.violation.firstDetectedAt.toISOString(),
  lastDetectedAt: input.violation.lastDetectedAt.toISOString(),
  lastEnforcedAt: iso(input.violation.lastEnforcedAt),
  resolvedAt: iso(input.violation.resolvedAt),
});

export const listRestrictedSoftwareViolations = (
  db: EnterpriseDb,
  organizationId: string,
  query: {
    readonly status?: "open" | "resolved";
    readonly platform?: "apple" | "win" | "android";
    readonly ruleId?: string;
    readonly limit?: number;
  } = {},
): Effect.Effect<RestrictedSoftwareViolationsResponse, unknown> =>
  Effect.gen(function* () {
    const where = and(
      eq(s.restrictedSoftwareViolation.organizationId, organizationId),
      query.status ? eq(s.restrictedSoftwareViolation.status, query.status) : undefined,
      query.platform ? eq(s.restrictedSoftwareViolation.platform, query.platform) : undefined,
      query.ruleId
        ? eq(s.restrictedSoftwareViolation.restrictedSoftwareId, query.ruleId)
        : undefined,
    );

    const rows = yield* db
      .select()
      .from(s.restrictedSoftwareViolation)
      .where(where)
      .orderBy(desc(s.restrictedSoftwareViolation.lastDetectedAt))
      .limit(
        Math.min(
          Math.max(query.limit ?? RESTRICTED_SOFTWARE_LIMITS.maxViolationList, 1),
          RESTRICTED_SOFTWARE_LIMITS.maxViolationList,
        ),
      );

    // The summary describes the whole filtered set, not the capped page. A
    // tenant with more than 500 violations would otherwise see a small number
    // that never matches the list below it.
    const summaryRows = yield* db
      .select({
        status: s.restrictedSoftwareViolation.status,
        enforcementState: s.restrictedSoftwareViolation.enforcementState,
      })
      .from(s.restrictedSoftwareViolation)
      .where(where);

    const ruleIds = [...new Set(rows.map((row) => row.restrictedSoftwareId))];
    const deviceIds = [...new Set(rows.map((row) => row.deviceId))];

    const rules =
      ruleIds.length === 0
        ? []
        : yield* db
            .select()
            .from(s.restrictedSoftware)
            .where(
              and(
                eq(s.restrictedSoftware.organizationId, organizationId),
                inArray(s.restrictedSoftware.id, ruleIds),
              ),
            );
    const devices =
      deviceIds.length === 0
        ? []
        : yield* db
            .select({ id: s.device.id, name: s.device.name })
            .from(s.device)
            .where(
              and(eq(s.device.organizationId, organizationId), inArray(s.device.id, deviceIds)),
            );

    const rulesById = new Map(rules.map((rule) => [rule.id, rule]));
    const deviceNames = new Map(devices.map((device) => [device.id, device.name]));

    const violations = rows.map((violation) =>
      toViolation({
        violation,
        rule: rulesById.get(violation.restrictedSoftwareId),
        deviceName: deviceNames.get(violation.deviceId) ?? "Deleted device",
      }),
    );

    return {
      violations,
      summary: {
        open: summaryRows.filter((violation) => violation.status === "open").length,
        resolved: summaryRows.filter((violation) => violation.status === "resolved").length,
        enforced: summaryRows.filter((violation) => violation.enforcementState === "enforced")
          .length,
        detectionOnly: summaryRows.filter(
          (violation) => violation.enforcementState === "detection-only",
        ).length,
        failed: summaryRows.filter((violation) => violation.enforcementState === "failed").length,
      },
    };
  });

export const deviceRestrictedSoftware = (
  db: EnterpriseDb,
  organizationId: string,
  deviceId: string,
) =>
  Effect.gen(function* () {
    const [device] = yield* db
      .select({ id: s.device.id, name: s.device.name })
      .from(s.device)
      .where(and(eq(s.device.organizationId, organizationId), eq(s.device.id, deviceId)))
      .limit(1);

    if (!device) return null;

    const rows = yield* db
      .select()
      .from(s.restrictedSoftwareViolation)
      .where(
        and(
          eq(s.restrictedSoftwareViolation.organizationId, organizationId),
          eq(s.restrictedSoftwareViolation.deviceId, deviceId),
        ),
      )
      .orderBy(desc(s.restrictedSoftwareViolation.lastDetectedAt))
      .limit(RESTRICTED_SOFTWARE_LIMITS.maxViolationList);

    const ruleIds = [...new Set(rows.map((row) => row.restrictedSoftwareId))];
    const rules =
      ruleIds.length === 0
        ? []
        : yield* db
            .select()
            .from(s.restrictedSoftware)
            .where(
              and(
                eq(s.restrictedSoftware.organizationId, organizationId),
                inArray(s.restrictedSoftware.id, ruleIds),
              ),
            );
    const rulesById = new Map(rules.map((rule) => [rule.id, rule]));

    const applicable = yield* resolveRestrictedSoftwareForDevice(db, {
      organizationId,
      deviceId,
    });

    return {
      violations: rows.map((violation) =>
        toViolation({
          violation,
          rule: rulesById.get(violation.restrictedSoftwareId),
          deviceName: device.name,
        }),
      ),
      rules: applicable.rules.map(({ rule, capability }) => ({
        id: rule.id,
        name: rule.name,
        action: rule.action,
        matchType: rule.matchType,
        matchValue: rule.matchValue,
        enforcement: {
          mode: capability.mode,
          label: capability.label,
          detail: capability.detail,
        },
      })),
    };
  });
