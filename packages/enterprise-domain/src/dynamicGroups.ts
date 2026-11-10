import { Schema } from "effect";

/** Mirrors `DeviceProtocol` without importing the API module (avoids a cycle). */
const DynamicGroupPlatform = Schema.Literals(["apple", "win", "android"]);
/** Mirrors `DeviceHealthLevel` without importing the API module. */
const DynamicGroupHealthLevel = Schema.Literals(["healthy", "attention", "critical", "unknown"]);

export type DynamicGroupHealthLevel = typeof DynamicGroupHealthLevel.Type;

/**
 * Versioned rule format for dynamic group membership.
 *
 * Rules are stored as JSON on `enterprise_group.rules` and evaluated in the
 * application (not in SQL) so comparison semantics stay identical across the
 * API and the device check-in path. Every condition list is optional:
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

const PlatformCondition = Schema.Struct({
  field: Schema.Literal("platform"),
  op: Schema.optional(Schema.Literal("eq")),
  value: DynamicGroupPlatform,
});

const ProtoCondition = Schema.Struct({
  field: Schema.Literal("proto"),
  op: Schema.optional(Schema.Literal("eq")),
  value: DynamicGroupPlatform,
});

const OsVersionCondition = Schema.Struct({
  field: Schema.Literal("osVersion"),
  op: Schema.optional(Schema.Literals(["lt", "lte", "gt", "gte", "eq"])),
  /** Dotted version string, for example `14.4.1`. Compared numerically per segment. */
  value: Schema.String,
});

const ModelCondition = Schema.Struct({
  field: Schema.Literal("model"),
  op: Schema.optional(Schema.Literals(["contains", "eq"])),
  value: Schema.String,
});

const SerialCondition = Schema.Struct({
  field: Schema.Literal("serial"),
  op: Schema.optional(Schema.Literals(["prefix", "eq"])),
  value: Schema.String,
});

const AssetTagCondition = Schema.Struct({
  field: Schema.Literal("assetTag"),
  op: Schema.optional(Schema.Literals(["prefix", "eq"])),
  value: Schema.String,
});

const StaleDaysCondition = Schema.Struct({
  field: Schema.Literal("staleDays"),
  /** Defaults to `gte`. `staleDays >= 14` means "not seen for at least 14 days". */
  op: Schema.optional(Schema.Literals(["lt", "lte", "gt", "gte", "eq"])),
  value: Schema.Number,
});

const HealthCondition = Schema.Struct({
  field: Schema.Literal("health"),
  op: Schema.optional(Schema.Literal("eq")),
  value: DynamicGroupHealthLevel,
});

export const DynamicGroupCondition = Schema.Union([
  PlatformCondition,
  ProtoCondition,
  OsVersionCondition,
  ModelCondition,
  SerialCondition,
  AssetTagCondition,
  StaleDaysCondition,
  HealthCondition,
]);
export type DynamicGroupCondition = typeof DynamicGroupCondition.Type;

export const DynamicGroupRules = Schema.Struct({
  version: Schema.Literal(DYNAMIC_GROUP_RULES_VERSION),
  all: Schema.optional(Schema.Array(DynamicGroupCondition)),
  any: Schema.optional(Schema.Array(DynamicGroupCondition)),
  none: Schema.optional(Schema.Array(DynamicGroupCondition)),
});
export type DynamicGroupRules = typeof DynamicGroupRules.Type;

export const DynamicGroupKind = Schema.Literals(["manual", "dynamic"]);
export type DynamicGroupKind = typeof DynamicGroupKind.Type;

/** Version currently supported by this build; anything else is rejected. */
export const isSupportedDynamicGroupRulesVersion = (value: unknown): boolean =>
  value === DYNAMIC_GROUP_RULES_VERSION;

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
      if (typeof condition.value === "string" && condition.value.trim() === "")
        return `The ${condition.field} condition needs a value`;
      if (condition.field === "staleDays" && condition.value < 0)
        return "staleDays must not be negative";
    }
  return null;
};

/** Device fields the evaluator reads. Dates may be `Date` or ISO strings. */
export type DynamicGroupDevice = {
  readonly proto?: string | null;
  readonly model?: string | null;
  readonly osVersion?: string | null;
  readonly serial?: string | null;
  readonly assetTag?: string | null;
  readonly lastSeenAt?: Date | string | null;
  readonly health?: {
    readonly level: DynamicGroupHealthLevel;
    readonly stale: boolean;
  } | null;
};

export type DynamicGroupEvaluationOptions = {
  /** Injectable clock so stale-day comparisons are deterministic in tests. */
  readonly now?: Date;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const parseDate = (value: Date | string | null | undefined): Date | null => {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() <= 0) return null;
  return date;
};

const normalized = (value: string | null | undefined): string | null => {
  const text = value?.trim();
  return text ? text.toLowerCase() : null;
};

const versionSegments = (value: string): number[] | null => {
  const parts = value
    .trim()
    .split(/[._-]/)
    .filter((part) => part.length > 0);
  if (parts.length === 0) return null;
  const numbers: number[] = [];
  for (const part of parts) {
    // Accept `14`, `14.4`, `14.4.1`, and trailing text such as `14.4 beta`.
    const match = part.match(/^(\d+)/);
    if (!match) return null;
    numbers.push(Number(match[1]));
  }
  return numbers;
};

/**
 * Compare two dotted versions numerically. Missing trailing segments count as
 * zero (`14.4` === `14.4.0`), so `gt`/`lt` behave the way administrators expect.
 * Returns `null` when either side is not version-like.
 */
export const compareVersionStrings = (left: string, right: string): number | null => {
  const a = versionSegments(left);
  const b = versionSegments(right);
  if (!a || !b) return null;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
};

const compareNumber = (actual: number, expected: number, op: string): boolean => {
  switch (op) {
    case "lt":
      return actual < expected;
    case "lte":
      return actual <= expected;
    case "gt":
      return actual > expected;
    case "gte":
      return actual >= expected;
    case "eq":
      return actual === expected;
    default:
      return false;
  }
};

const matchesCondition = (
  condition: DynamicGroupCondition,
  device: DynamicGroupDevice,
  now: Date,
): boolean => {
  switch (condition.field) {
    case "platform":
    case "proto": {
      const actual = normalized(device.proto);
      return actual !== null && actual === normalized(condition.value);
    }
    case "osVersion": {
      if (!device.osVersion) return false;
      const actual = condition.op ?? "eq";
      if (actual === "eq")
        return (
          normalized(device.osVersion) === normalized(condition.value) ||
          compareVersionStrings(device.osVersion, condition.value) === 0
        );
      const comparison = compareVersionStrings(device.osVersion, condition.value);
      if (comparison === null) return false;
      return compareNumber(comparison, 0, actual);
    }
    case "model": {
      const actual = normalized(device.model);
      const expected = normalized(condition.value);
      if (actual === null || expected === null) return false;
      return condition.op === "eq" ? actual === expected : actual.includes(expected);
    }
    case "serial": {
      const actual = normalized(device.serial);
      const expected = normalized(condition.value);
      if (actual === null || expected === null) return false;
      return condition.op === "eq" ? actual === expected : actual.startsWith(expected);
    }
    case "assetTag": {
      const actual = normalized(device.assetTag);
      const expected = normalized(condition.value);
      if (actual === null || expected === null) return false;
      return condition.op === "eq" ? actual === expected : actual.startsWith(expected);
    }
    case "staleDays": {
      const lastSeen = parseDate(device.lastSeenAt);
      if (!lastSeen) return false;
      const ageDays = (now.getTime() - lastSeen.getTime()) / DAY_MS;
      return compareNumber(ageDays, condition.value, condition.op ?? "gte");
    }
    case "health":
      return device.health?.level === condition.value;
    default:
      return false;
  }
};

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
  const now = options.now ?? new Date();

  const every = rules.all ?? [];
  if (!every.every((condition) => matchesCondition(condition, device, now))) return false;

  const some = rules.any ?? [];
  if (some.length > 0 && !some.some((condition) => matchesCondition(condition, device, now)))
    return false;

  const none = rules.none ?? [];
  if (none.some((condition) => matchesCondition(condition, device, now))) return false;

  return true;
};
