import { Schema } from "effect";
import {
  compareVersionStrings,
  DeviceCondition,
  evaluateDeviceQuery,
  type DeviceQueryDevice,
  type DeviceQueryEvaluationOptions,
} from "./deviceQuery.ts";

export { compareVersionStrings };

export type { DeviceQueryEvaluationOptions };

/** Kept as a named export for callers that describe group health levels. */
export const DynamicGroupHealthLevel = Schema.Literals([
  "healthy",
  "attention",
  "missing",
  "critical",
  "unknown",
]);

export type DynamicGroupHealthLevel = typeof DynamicGroupHealthLevel.Type;

/**
 * Versioned rule format for dynamic group membership.
 *
 * Rules are stored as JSON on `enterprise_group.rules` and evaluated in the
 * application (not in SQL) so comparison semantics stay identical across the
 * API, the device check-in path and dashboard queries. Every condition list is
 * optional:
 *
 * - `all`  — every condition must match (AND). An empty list is a no-op.
 * - `any`  — at least one condition must match (OR). An empty list is a no-op.
 * - `none` — no condition may match (NOT). An empty list is a no-op.
 *
 * A rule set with no conditions at all matches **no devices**. That is
 * deliberately the safe default: creating a dynamic group never silently
 * assigns every device in the tenant.
 */
export const DYNAMIC_GROUP_RULES_VERSION = 1;

/** Groups and dashboards share the same condition schema and evaluator. */
export const DynamicGroupCondition = DeviceCondition;

export type DynamicGroupCondition = DeviceCondition;

export const DynamicGroupRules = Schema.Struct({
  version: Schema.Literal(DYNAMIC_GROUP_RULES_VERSION),
  all: Schema.optional(Schema.Array(DeviceCondition)),
  any: Schema.optional(Schema.Array(DeviceCondition)),
  none: Schema.optional(Schema.Array(DeviceCondition)),
});

export type DynamicGroupRules = typeof DynamicGroupRules.Type;

export const DynamicGroupKind = Schema.Literals(["manual", "dynamic"]);

export type DynamicGroupKind = typeof DynamicGroupKind.Type;

/** Version currently supported by this build; anything else is rejected. */
export const isSupportedDynamicGroupRulesVersion = (
  value: unknown,
): value is typeof DYNAMIC_GROUP_RULES_VERSION => value === DYNAMIC_GROUP_RULES_VERSION;

const conditionCount = (rules: DynamicGroupRules): number =>
  (rules.all?.length ?? 0) + (rules.any?.length ?? 0) + (rules.none?.length ?? 0);

/** A dynamic group must carry at least one condition. */
export const hasDynamicGroupConditions = (rules: DynamicGroupRules | null | undefined): boolean =>
  rules != null && conditionCount(rules) > 0;

/**
 * Human-readable reason a rule set cannot be used for a dynamic group, or
 * `null` when it is valid. Kept pure so the HTTP handler and tests share it.
 */
export const dynamicGroupRulesProblem = (
  rules: DynamicGroupRules | null | undefined,
): string | null => {
  if (rules == null) return "Dynamic groups require a rule set";

  if (rules.version !== DYNAMIC_GROUP_RULES_VERSION)
    return `Unsupported rule version: ${String(rules.version)}`;

  if (!hasDynamicGroupConditions(rules))
    return "Add at least one condition before saving a dynamic group";

  for (const list of [rules.all ?? [], rules.any ?? [], rules.none ?? []])
    for (const condition of list) {
      if (Schema.is(Schema.String)(condition.value) && condition.value.trim() === "")
        return `The ${condition.field} condition needs a value`;

      if (
        (condition.field === "staleDays" || condition.field === "enrolledDays") &&
        condition.value < 0
      )
        return `${condition.field} must not be negative`;
    }

  return null;
};

/** Device fields the evaluator reads. Dates may be `Date` or ISO strings. */
export type DynamicGroupDevice = DeviceQueryDevice;

export type DynamicGroupEvaluationOptions = DeviceQueryEvaluationOptions;

/**
 * Evaluate a rule set against one device. Pure: callers pass the device
 * snapshot, its derived health rollup and an optional clock.
 */
export const evaluateDynamicGroupRules = (
  rules: DynamicGroupRules,
  device: DynamicGroupDevice,
  options: DynamicGroupEvaluationOptions = {},
): boolean => {
  // No conditions means "match nothing", never "match everything".
  if (!hasDynamicGroupConditions(rules)) return false;

  return evaluateDeviceQuery(rules, device, options);
};
