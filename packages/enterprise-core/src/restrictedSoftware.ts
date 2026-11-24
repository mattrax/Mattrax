/**
 * Restricted-software evaluation against the installed-application inventory.
 *
 * This module owns the durable side of detection: it resolves scope, matches
 * inventory, opens/reopens/resolves violations and writes the device audit row.
 * The pure matching rules live in `@mattrax/enterprise-domain` so the same
 * decision can be tested without a database and reused by delivery code.
 *
 * It deliberately does not send webhooks or email. Those are delivered by the
 * notification sweep in `@mattrax/enterprise-backend` where the signing secret
 * and mail transport live.
 */

import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import {
  findRestrictedSoftwareMatch,
  restrictedSoftwareCapability,
  restrictedSoftwareScopeApplies,
} from "@mattrax/enterprise-domain";
import type { InventoryApplication, RestrictedSoftwarePlatform } from "@mattrax/enterprise-domain";
import type { EnterpriseDb } from "./db.ts";
import {
  restrictedSoftware,
  restrictedSoftwareAssignment,
  restrictedSoftwareViolation,
} from "./schema.ts";
import { auditLog } from "./schema.ts";
import { device, deviceApplication, groupDevice } from "./schema.ts";

type RuleRow = typeof restrictedSoftware.$inferSelect;
type AssignmentRow = typeof restrictedSoftwareAssignment.$inferSelect;

export type ResolvedRestrictedSoftwareRule = {
  readonly rule: RuleRow;
  readonly capability: ReturnType<typeof restrictedSoftwareCapability>;
};

/**
 * Only macOS runs mattraxd. iOS/iPadOS share the `apple` platform value but
 * have no agent, so treating them as agent-enforceable would be a false claim.
 */
const appleDeviceIsMac = (row: { readonly osEdition?: string | null }): boolean =>
  row.osEdition?.toLowerCase().includes("macos") ?? false;

const auditId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 24);

const violationId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 24);

const writeDeviceAudit = (
  db: EnterpriseDb,
  input: {
    readonly organizationId: string;
    readonly deviceId: string;
    readonly platform: RestrictedSoftwarePlatform;
    readonly action: string;
    readonly violationId: string;
    readonly metadata: Record<string, string | number | boolean | null>;
    readonly at: Date;
  },
) =>
  db.insert(auditLog).values({
    id: auditId(),
    organizationId: input.organizationId,
    actorAccountId: null,
    actorEmail: "system",
    actorType: "system",
    category: "mdm",
    action: input.action,
    targetType: "restricted_software_violation",
    targetId: input.violationId,
    metadata: input.metadata,
    deviceId: input.deviceId,
    protocol: input.platform,
    createdAt: input.at,
  });

/**
 * Rules that currently apply to one device.
 *
 * Returns only enabled rules whose platform matches the device. Scope is
 * resolved per rule from its assignments, so a group exclude can veto one rule
 * without affecting another.
 */
export const resolveRestrictedSoftwareForDevice = (
  db: EnterpriseDb,
  input: { readonly organizationId: string; readonly deviceId: string },
): Effect.Effect<
  {
    readonly device: typeof device.$inferSelect | null;
    readonly rules: ReadonlyArray<ResolvedRestrictedSoftwareRule>;
  },
  unknown
> =>
  Effect.gen(function* () {
    const [row] = yield* db
      .select()
      .from(device)
      .where(and(eq(device.id, input.deviceId), eq(device.organizationId, input.organizationId)))
      .limit(1);

    if (!row) return { device: null, rules: [] };

    const rules = yield* db
      .select()
      .from(restrictedSoftware)
      .where(
        and(
          eq(restrictedSoftware.organizationId, input.organizationId),
          eq(restrictedSoftware.platform, row.proto),
          eq(restrictedSoftware.enabled, true),
        ),
      );

    if (rules.length === 0) return { device: row, rules: [] };

    const assignments = yield* db
      .select()
      .from(restrictedSoftwareAssignment)
      .where(
        and(
          eq(restrictedSoftwareAssignment.organizationId, input.organizationId),
          inArray(
            restrictedSoftwareAssignment.restrictedSoftwareId,
            rules.map((rule) => rule.id),
          ),
        ),
      );

    const memberships = yield* db
      .select({ groupId: groupDevice.groupId })
      .from(groupDevice)
      .where(eq(groupDevice.deviceId, input.deviceId));
    const groupIds = new Set(memberships.map((membership) => membership.groupId));

    const byRule = new Map<string, AssignmentRow[]>();

    for (const assignment of assignments) {
      const list = byRule.get(assignment.restrictedSoftwareId) ?? [];

      list.push(assignment);
      byRule.set(assignment.restrictedSoftwareId, list);
    }

    return {
      device: row,
      rules: rules
        .filter((rule) =>
          restrictedSoftwareScopeApplies(byRule.get(rule.id) ?? [], {
            deviceId: input.deviceId,
            groupIds,
          }),
        )
        .map((rule) => {
          const capability = restrictedSoftwareCapability(rule.platform, rule.action);

          return {
            rule,
            // Only macOS runs mattraxd. iOS shares the apple platform value and
            // must not be presented as agent-enforceable.
            capability:
              capability.mode === "agent" && !appleDeviceIsMac(row)
                ? {
                    mode: "detection-only" as const,
                    label: "Detection only",
                    detail:
                      "mattraxd runs on macOS only, so Mattrax records this match on this Apple device without enforcing it.",
                  }
                : capability,
          };
        }),
    };
  });

const enforcementFor = (
  platform: RestrictedSoftwarePlatform,
  action: RuleRow["action"],
  deviceRow: { readonly osEdition?: string | null },
) => {
  const capability = restrictedSoftwareCapability(platform, action);

  if (capability.mode === "policy")
    return {
      state: "pending" as const,
      detail: "Waiting for a successful Managed Google Play policy delivery (installType BLOCKED).",
    };

  if (capability.mode === "agent" && appleDeviceIsMac(deviceRow))
    return {
      state: "pending" as const,
      detail: "Queued for mattraxd on its next enforcement pass.",
    };

  return { state: "detection-only" as const, detail: capability.detail };
};

/**
 * Match every applicable rule against a device's latest inventory.
 *
 * The unique `(rule, device)` row is the de-duplication boundary: a repeated
 * report refreshes `lastDetectedAt` and the occurrence count without producing
 * another violation event. A rule that stops matching resolves the open row.
 * Callers reporting a fresh inventory can supply it to avoid reading the stored
 * rows again. Rule and assignment changes omit it and use the saved inventory.
 */
export const reconcileRestrictedSoftwareForDevice = (
  db: EnterpriseDb,
  input: {
    readonly organizationId: string;
    readonly deviceId: string;
    readonly at: Date;
    readonly applications?: ReadonlyArray<InventoryApplication>;
  },
): Effect.Effect<
  {
    readonly detected: number;
    readonly reopened: number;
    readonly refreshed: number;
    readonly resolved: number;
  },
  unknown
> =>
  Effect.gen(function* () {
    const resolved = yield* resolveRestrictedSoftwareForDevice(db, input);
    const deviceRow = resolved.device;

    if (!deviceRow || resolved.rules.length === 0)
      return { detected: 0, reopened: 0, refreshed: 0, resolved: 0 };

    const applications =
      input.applications ??
      (yield* db
        .select()
        .from(deviceApplication)
        .where(
          and(
            eq(deviceApplication.deviceId, input.deviceId),
            eq(deviceApplication.organizationId, input.organizationId),
          ),
        ));

    const existing = yield* db
      .select()
      .from(restrictedSoftwareViolation)
      .where(
        and(
          eq(restrictedSoftwareViolation.deviceId, input.deviceId),
          eq(restrictedSoftwareViolation.organizationId, input.organizationId),
        ),
      );

    const byRule = new Map(existing.map((row) => [row.restrictedSoftwareId, row]));
    const matchedRuleIds = new Set<string>();
    let detected = 0;
    let reopened = 0;
    let refreshed = 0;
    let resolvedCount = 0;

    for (const { rule } of resolved.rules) {
      const application = findRestrictedSoftwareMatch(rule, applications);

      if (!application) continue;

      matchedRuleIds.add(rule.id);
      const prior = byRule.get(rule.id);
      const enforcement = enforcementFor(rule.platform, rule.action, deviceRow);

      if (!prior) {
        const id = violationId();

        yield* db.insert(restrictedSoftwareViolation).values({
          id,
          organizationId: input.organizationId,
          restrictedSoftwareId: rule.id,
          deviceId: input.deviceId,
          platform: rule.platform,
          action: rule.action,
          matchType: rule.matchType,
          matchKey: rule.matchKey,
          matchedBundleId: application.bundleId,
          applicationName: application.name ?? null,
          applicationVersion: application.version ?? null,
          status: "open",
          enforcementState: enforcement.state,
          enforcementDetail: enforcement.detail,
          occurrenceCount: 1,
          firstDetectedAt: input.at,
          lastDetectedAt: input.at,
          createdAt: input.at,
          updatedAt: input.at,
        });

        yield* writeDeviceAudit(db, {
          organizationId: input.organizationId,
          deviceId: input.deviceId,
          platform: rule.platform,
          action: "restricted_software.violation_detected",
          violationId: id,
          at: input.at,
          metadata: {
            ruleId: rule.id,
            ruleName: rule.name,
            matchType: rule.matchType,
            matchValue: rule.matchValue,
            bundleId: application.bundleId,
            applicationName: application.name ?? null,
            enforcement: enforcement.state,
          },
        });

        detected += 1;
        continue;
      }

      if (prior.status === "resolved") {
        yield* db
          .update(restrictedSoftwareViolation)
          .set({
            status: "open",
            action: rule.action,
            matchedBundleId: application.bundleId,
            applicationName: application.name ?? null,
            applicationVersion: application.version ?? null,
            enforcementState: enforcement.state,
            enforcementDetail: enforcement.detail,
            // A different action starts a new enforcement episode; a stale
            // timestamp from the previous action would be misleading.
            lastEnforcedAt: prior.action === rule.action ? prior.lastEnforcedAt : null,
            occurrenceCount: prior.occurrenceCount + 1,
            lastDetectedAt: input.at,
            resolvedAt: null,
            notifiedAt: null,
            updatedAt: input.at,
          })
          .where(eq(restrictedSoftwareViolation.id, prior.id));

        yield* writeDeviceAudit(db, {
          organizationId: input.organizationId,
          deviceId: input.deviceId,
          platform: rule.platform,
          action: "restricted_software.violation_detected",
          violationId: prior.id,
          at: input.at,
          metadata: {
            ruleId: rule.id,
            ruleName: rule.name,
            bundleId: application.bundleId,
            reopened: true,
          },
        });

        reopened += 1;
        continue;
      }

      // Still present: refresh the evidence. No new audit/webhook row, which
      // is what keeps a daily inventory from producing a daily notification.
      yield* db
        .update(restrictedSoftwareViolation)
        .set({
          action: rule.action,
          matchedBundleId: application.bundleId,
          applicationName: application.name ?? null,
          applicationVersion: application.version ?? null,
          enforcementState: enforcement.state,
          enforcementDetail: enforcement.detail,
          lastEnforcedAt: prior.action === rule.action ? prior.lastEnforcedAt : null,
          occurrenceCount: prior.occurrenceCount + 1,
          lastDetectedAt: input.at,
          updatedAt: input.at,
        })
        .where(eq(restrictedSoftwareViolation.id, prior.id));

      refreshed += 1;
    }

    for (const prior of existing) {
      if (prior.status !== "open" || matchedRuleIds.has(prior.restrictedSoftwareId)) continue;

      yield* db
        .update(restrictedSoftwareViolation)
        .set({
          status: "resolved",
          resolvedAt: input.at,
          updatedAt: input.at,
          enforcementDetail:
            prior.enforcementState === "failed"
              ? prior.enforcementDetail
              : "The application is no longer present in the device inventory.",
        })
        .where(eq(restrictedSoftwareViolation.id, prior.id));

      yield* writeDeviceAudit(db, {
        organizationId: input.organizationId,
        deviceId: input.deviceId,
        platform: prior.platform,
        action: "restricted_software.violation_resolved",
        violationId: prior.id,
        at: input.at,
        metadata: { ruleId: prior.restrictedSoftwareId, bundleId: prior.matchedBundleId },
      });

      resolvedCount += 1;
    }

    return { detected, reopened, refreshed, resolved: resolvedCount };
  });

/**
 * Re-evaluate one tenant, optionally limited to certain devices.
 *
 * Used after a rule or assignment change so existing inventory is judged
 * immediately rather than waiting for the next daily report.
 */
export const reconcileRestrictedSoftwareForOrganization = (
  db: EnterpriseDb,
  input: {
    readonly organizationId: string;
    readonly at: Date;
    readonly deviceIds?: ReadonlyArray<string>;
  },
): Effect.Effect<{ readonly devices: number }, unknown> =>
  Effect.gen(function* () {
    const deviceIds = input.deviceIds ? [...new Set(input.deviceIds)] : undefined;

    if (deviceIds && deviceIds.length === 0) return { devices: 0 };

    const devices = yield* db
      .select({ id: device.id })
      .from(device)
      .where(
        deviceIds
          ? and(eq(device.organizationId, input.organizationId), inArray(device.id, deviceIds))
          : eq(device.organizationId, input.organizationId),
      );

    yield* Effect.forEach(
      devices,
      (row) =>
        reconcileRestrictedSoftwareForDevice(db, {
          organizationId: input.organizationId,
          deviceId: row.id,
          at: input.at,
        }),
      { concurrency: 5, discard: true },
    );

    return { devices: devices.length };
  });

/** Device ids a rule resolves to; used to push Android policy/Apple profiles. */
export const restrictedSoftwareDeviceIds = (
  db: EnterpriseDb,
  organizationId: string,
  ruleId: string,
): Effect.Effect<ReadonlyArray<{ readonly id: string; readonly proto: string }>, unknown> =>
  Effect.gen(function* () {
    const [rule] = yield* db
      .select()
      .from(restrictedSoftware)
      .where(
        and(
          eq(restrictedSoftware.id, ruleId),
          eq(restrictedSoftware.organizationId, organizationId),
        ),
      )
      .limit(1);

    if (!rule) return [];

    const assignments = yield* db
      .select()
      .from(restrictedSoftwareAssignment)
      .where(
        and(
          eq(restrictedSoftwareAssignment.restrictedSoftwareId, ruleId),
          eq(restrictedSoftwareAssignment.organizationId, organizationId),
        ),
      );

    const direct = assignments
      .filter((assignment) => assignment.targetType === "device")
      .map((assignment) => assignment.targetId);
    const groups = assignments
      .filter((assignment) => assignment.targetType === "group")
      .map((assignment) => assignment.targetId);
    const grouped =
      groups.length === 0
        ? []
        : (yield* db
            .select({ deviceId: groupDevice.deviceId })
            .from(groupDevice)
            .where(inArray(groupDevice.groupId, groups))).map((row) => row.deviceId);

    const candidateIds = [...new Set([...direct, ...grouped])];

    if (candidateIds.length === 0) return [];

    const rows = yield* db
      .select({ id: device.id, proto: device.proto })
      .from(device)
      .where(
        and(
          eq(device.organizationId, organizationId),
          eq(device.status, "enrolled"),
          inArray(device.id, candidateIds),
        ),
      );

    return rows;
  });

/**
 * Mark policy-mode Android violations enforced after a successful policy push.
 *
 * Detection deliberately starts them pending: a rule can exist while the
 * tenant's Android enterprise is inactive or Google rejects the policy, and
 * calling it "enforced" before the BLOCKED entry reaches the device would be
 * false. Only an updated policy from `syncAndroidPoliciesForTenant` calls this.
 */
export const markAndroidRestrictedSoftwarePolicyDelivered = (
  db: EnterpriseDb,
  input: {
    readonly organizationId: string;
    readonly deviceId: string;
    readonly at: Date;
  },
): Effect.Effect<number, unknown> =>
  Effect.gen(function* () {
    const violations = yield* db
      .select()
      .from(restrictedSoftwareViolation)
      .where(
        and(
          eq(restrictedSoftwareViolation.organizationId, input.organizationId),
          eq(restrictedSoftwareViolation.deviceId, input.deviceId),
          eq(restrictedSoftwareViolation.platform, "android"),
          eq(restrictedSoftwareViolation.status, "open"),
        ),
      );

    if (violations.length === 0) return 0;

    const ruleIds = [...new Set(violations.map((row) => row.restrictedSoftwareId))];
    const rules = yield* db
      .select()
      .from(restrictedSoftware)
      .where(
        and(
          eq(restrictedSoftware.organizationId, input.organizationId),
          inArray(restrictedSoftware.id, ruleIds),
        ),
      );
    const ruleById = new Map(rules.map((rule) => [rule.id, rule]));
    let marked = 0;

    for (const violation of violations) {
      const rule = ruleById.get(violation.restrictedSoftwareId);

      if (!rule || rule.action !== "block-install" || rule.platform !== "android") continue;

      if (violation.enforcementState === "enforced") continue;

      yield* db
        .update(restrictedSoftwareViolation)
        .set({
          enforcementState: "enforced",
          enforcementDetail: "Managed Google Play policy delivered with installType BLOCKED.",
          lastEnforcedAt: input.at,
          updatedAt: input.at,
        })
        .where(eq(restrictedSoftwareViolation.id, violation.id));

      yield* writeDeviceAudit(db, {
        organizationId: input.organizationId,
        deviceId: input.deviceId,
        platform: "android",
        action: "restricted_software.enforced",
        violationId: violation.id,
        at: input.at,
        metadata: {
          ruleId: rule.id,
          ruleName: rule.name,
          action: rule.action,
          mode: "policy",
        },
      });

      marked += 1;
    }

    return marked;
  });

/**
 * Record the outcome of an agent enforcement pass and audit it.
 *
 * The agent cannot invent a rule or a device: the caller has already verified
 * the bearer token and that the rule resolves to the device. A result for a
 * violation that does not exist still audits the attempt, because "the agent
 * tried and there was no open violation" is useful operational evidence.
 */
export const recordRestrictedSoftwareEnforcement = (
  db: EnterpriseDb,
  input: {
    readonly organizationId: string;
    readonly deviceId: string;
    readonly platform: RestrictedSoftwarePlatform;
    readonly ruleId: string;
    readonly action: RuleRow["action"];
    readonly status: "succeeded" | "failed" | "skipped";
    readonly detail: string | null;
    readonly at: Date;
  },
): Effect.Effect<{ readonly violationId: string | null }, unknown> =>
  Effect.gen(function* () {
    const [violation] = yield* db
      .select()
      .from(restrictedSoftwareViolation)
      .where(
        and(
          eq(restrictedSoftwareViolation.organizationId, input.organizationId),
          eq(restrictedSoftwareViolation.deviceId, input.deviceId),
          eq(restrictedSoftwareViolation.restrictedSoftwareId, input.ruleId),
        ),
      )
      .limit(1);

    if (violation)
      yield* db
        .update(restrictedSoftwareViolation)
        .set({
          action: input.action,
          enforcementState:
            input.status === "failed"
              ? "failed"
              : input.status === "skipped"
                ? violation.enforcementState
                : "enforced",
          enforcementDetail: input.detail,
          lastEnforcedAt: input.at,
          updatedAt: input.at,
        })
        .where(eq(restrictedSoftwareViolation.id, violation.id));

    yield* db.insert(auditLog).values({
      id: auditId(),
      organizationId: input.organizationId,
      actorAccountId: null,
      actorEmail: "system",
      actorType: "system",
      category: "mdm",
      action:
        input.status === "failed"
          ? "restricted_software.enforcement_failed"
          : input.status === "skipped"
            ? "restricted_software.enforcement_skipped"
            : "restricted_software.enforced",
      targetType: "restricted_software",
      targetId: input.ruleId,
      metadata: {
        ruleId: input.ruleId,
        action: input.action,
        status: input.status,
        detail: input.detail,
      },
      deviceId: input.deviceId,
      protocol: input.platform,
      createdAt: input.at,
    });

    return { violationId: violation?.id ?? null };
  });
