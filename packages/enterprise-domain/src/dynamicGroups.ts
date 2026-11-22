import { Schema } from "effect";
import {
  compareVersionStrings,
  DeviceCondition,
  deviceConditionGroupIds,
  deviceQueryGroupIds,
  evaluateDeviceQuery,
} from "./deviceQuery.ts";
import type { DeviceQueryDevice, DeviceQueryEvaluationOptions } from "./deviceQuery.ts";

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
 *
 * Version 1 is extended additively: the `group` condition was added without
 * changing the version because every previously valid rule set still decodes
 * to exactly the same meaning. There is no migration that reinterprets saved
 * rules; a build that predates the field simply rejects the new rule when it
 * decodes it. Bumping the version instead would have invalidated every saved
 * rule, which is why this is deliberately not a version bump.
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

/**
 * Every tenant-scoped group id a rule set references, in condition-list order.
 * Duplicates are dropped so a graph walk sees each edge once.
 */
export const dynamicGroupRuleGroupIds = (
  rules: DynamicGroupRules | null | undefined,
): ReadonlyArray<string> =>
  rules && rules.version === DYNAMIC_GROUP_RULES_VERSION ? deviceQueryGroupIds(rules) : [];

export type DynamicGroupReferenceNode = {
  readonly id: string;
  /** Null for manual groups: they are valid reference targets but have no refs. */
  readonly rules?: DynamicGroupRules | null;
};

/** Why a dynamic group cannot be evaluated. */
export type DynamicGroupSkipReason = "cycle" | "missing" | "invalid";

export type DynamicGroupSkip = {
  readonly groupId: string;
  readonly reason: DynamicGroupSkipReason;
  /** Reference path that explains the skip, starting at `groupId`. */
  readonly path: ReadonlyArray<string>;
  readonly message: string;
};

export type DynamicGroupDependencyPlan = {
  /**
   * Dynamic group ids in dependency order: every referenced group appears
   * before the group that uses it. Groups that must not be evaluated (a
   * circular or missing reference) are absent.
   */
  readonly order: ReadonlyArray<string>;
  /** Groups that must be skipped, keyed by id. */
  readonly problems: ReadonlyMap<string, DynamicGroupSkip>;
  /** Direct reverse references, including references to manual groups. */
  readonly dependents: ReadonlyMap<string, ReadonlyArray<string>>;
};

const referencePathText = (path: ReadonlyArray<string>): string => path.join(" → ");

/**
 * Order dynamic groups by their references and detect circular ones.
 *
 * The walk is a DFS with a visiting stack, so a direct self-reference and any
 * longer cycle are reported with the path that closes them. A group that
 * depends on a skipped group is skipped too: evaluating it against a stale or
 * empty referenced membership would silently change its members.
 *
 * Manual groups may be referenced (their materialised membership is used) but
 * never contribute edges of their own.
 */
export const planDynamicGroupDependencies = (
  nodes: ReadonlyArray<DynamicGroupReferenceNode>,
): DynamicGroupDependencyPlan => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const references = new Map<string, ReadonlyArray<string>>(
    nodes.map((node) => [node.id, dynamicGroupRuleGroupIds(node.rules)]),
  );

  const dependents = new Map<string, Array<string>>();

  for (const node of nodes) {
    for (const reference of references.get(node.id) ?? []) {
      const list = dependents.get(reference) ?? [];

      list.push(node.id);
      dependents.set(reference, list);
    }
  }

  const problems = new Map<string, DynamicGroupSkip>();

  const skip = (
    groupId: string,
    reason: DynamicGroupSkipReason,
    path: ReadonlyArray<string>,
    message: string,
  ) => {
    if (!problems.has(groupId)) problems.set(groupId, { groupId, reason, path, message });
  };

  // A reference to a group outside this tenant (deleted, or a forged id) is a
  // skip, never an empty membership: `notIn` would otherwise match everything.
  for (const node of nodes) {
    for (const reference of references.get(node.id) ?? []) {
      if (byId.has(reference)) continue;

      skip(
        node.id,
        "missing",
        [node.id, reference],
        `This group references a group that does not exist in the tenant (${reference}).`,
      );
    }
  }

  const state = new Map<string, "visiting" | "done">();
  const stack: Array<string> = [];
  const order: Array<string> = [];
  const cycles: Array<Array<string>> = [];

  const visit = (groupId: string) => {
    const current = state.get(groupId);

    if (current === "done") return;

    if (current === "visiting") {
      const start = stack.indexOf(groupId);

      cycles.push([...stack.slice(start), groupId]);

      return;
    }

    state.set(groupId, "visiting");
    stack.push(groupId);

    for (const reference of references.get(groupId) ?? []) {
      if (!byId.has(reference)) continue;

      if (state.get(reference) === "visiting") {
        const start = stack.indexOf(reference);

        cycles.push([...stack.slice(start), reference]);
      } else visit(reference);
    }

    stack.pop();
    state.set(groupId, "done");
    order.push(groupId);
  };

  for (const node of nodes) visit(node.id);

  for (const cycle of cycles) {
    const members = cycle.slice(0, -1);
    const message = `Circular group reference: ${referencePathText(cycle)}.`;

    for (const groupId of members) skip(groupId, "cycle", cycle, message);
  }

  // Skip every group whose referenced membership cannot be trusted.
  const queue = [...problems.keys()];

  while (queue.length > 0) {
    const skipped = queue.pop()!;

    for (const dependent of dependents.get(skipped) ?? []) {
      if (problems.has(dependent) || byId.get(dependent)?.rules == null) continue;

      skip(
        dependent,
        problems.get(skipped)!.reason,
        [dependent, ...problems.get(skipped)!.path],
        `This group depends on a group that cannot be evaluated (${referencePathText(
          problems.get(skipped)!.path,
        )}).`,
      );
      queue.push(dependent);
    }
  }

  return {
    order: order.filter((groupId) => !problems.has(groupId) && byId.get(groupId)?.rules != null),
    problems,
    dependents,
  };
};

/** Every group that directly or transitively references `groupId`. */
export const dynamicGroupDependentsOf = (
  plan: DynamicGroupDependencyPlan,
  groupId: string,
): ReadonlySet<string> => {
  const found = new Set<string>();
  const stack = [groupId];

  while (stack.length > 0) {
    const current = stack.pop()!;

    for (const dependent of plan.dependents.get(current) ?? []) {
      if (found.has(dependent)) continue;

      found.add(dependent);
      stack.push(dependent);
    }
  }

  return found;
};

/**
 * Why a rule set cannot reference the given groups, or `null`.
 *
 * Used on the write path so a circular or cross-tenant reference is rejected
 * before it is saved. `groups` is the tenant's group list; when `groupId` is
 * null (a create) only the referenced ids and self-reference are checked.
 */
export const dynamicGroupReferenceProblem = (
  groupId: string | null,
  rules: DynamicGroupRules | null | undefined,
  groups: ReadonlyArray<DynamicGroupReferenceNode>,
): string | null => {
  const ids = dynamicGroupRuleGroupIds(rules);

  if (ids.length === 0) return null;

  if (groupId !== null && ids.includes(groupId))
    return "A group cannot use itself as a rule criterion.";

  const known = new Set(groups.map((group) => group.id));
  const missing = ids.filter((id) => !known.has(id));

  if (missing.length > 0) return "A group rule can only reference groups in the same tenant.";

  if (groupId === null) return null;

  // Replace the stored rules with the candidate so a rule that closes a loop
  // through this group is detected against the graph as it would be saved.
  const nodes = groups.map((group) => (group.id === groupId ? { ...group, rules } : group));
  const problem = planDynamicGroupDependencies(nodes).problems.get(groupId);

  if (!problem) return null;

  return problem.reason === "cycle"
    ? `That rule creates a circular group reference (${referencePathText(problem.path)}).`
    : problem.message;
};

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
        condition.field === "group" &&
        deviceConditionGroupIds(condition).filter((id) => id.trim() !== "").length === 0
      )
        return "A group condition needs at least one group";

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
