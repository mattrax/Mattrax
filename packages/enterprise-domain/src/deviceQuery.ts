import { Schema } from "effect";
import { WindowsActivationStatus } from "./deviceInventory.js";

/**
 * The shared device query language.
 *
 * Device tables, dynamic groups and dashboard widgets all describe the same
 * thing: a set of devices. Keeping the condition schema and evaluator in one
 * place means a rule written in a group builder behaves exactly like the same
 * rule shown in a dashboard or encoded into a device-table URL.
 */

const DevicePlatform = Schema.Literals(["apple", "win", "android"]);

const DeviceStatusValue = Schema.Literals(["enrolling", "enrolled", "unenrolling", "unenrolled"]);

const DeviceHealthLevel = Schema.Literals(["healthy", "attention", "critical", "unknown"]);

export type DeviceQueryHealth = typeof DeviceHealthLevel.Type | "stale";

const DeviceFileVault = Schema.Literals(["enabled", "disabled", "unknown"]);

const TextField = Schema.Literals([
  "name",
  "model",
  "serial",
  "assetTag",
  "osEdition",
  "batteryHealth",
]);

const TextCondition = Schema.Struct({
  field: TextField,
  op: Schema.optional(Schema.Literals(["eq", "ne", "contains", "prefix"])),
  value: Schema.String,
});

const PlatformCondition = Schema.Struct({
  field: Schema.Literals(["platform", "proto"]),
  op: Schema.optional(Schema.Literals(["eq", "ne"])),
  value: DevicePlatform,
});

const OsVersionCondition = Schema.Struct({
  field: Schema.Literal("osVersion"),
  op: Schema.optional(Schema.Literals(["eq", "lt", "lte", "gt", "gte"])),
  /** Dotted version string, for example `14.4.1`. */
  value: Schema.String,
});

const StatusCondition = Schema.Struct({
  field: Schema.Literal("status"),
  op: Schema.optional(Schema.Literals(["eq", "ne"])),
  value: DeviceStatusValue,
});

const HealthCondition = Schema.Struct({
  field: Schema.Literal("health"),
  op: Schema.optional(Schema.Literals(["eq", "ne"])),
  value: Schema.Union([DeviceHealthLevel, Schema.Literal("stale")]),
});

const DaysCondition = Schema.Struct({
  field: Schema.Literals(["staleDays", "enrolledDays"]),
  op: Schema.optional(Schema.Literals(["lt", "lte", "gt", "gte", "eq"])),
  value: Schema.Number,
});

const FileVaultCondition = Schema.Struct({
  field: Schema.Literal("fileVault"),
  op: Schema.optional(Schema.Literal("eq")),
  value: DeviceFileVault,
});

/**
 * Windows activation state. Only Windows devices can match: every other
 * platform has no activation state and must not be treated as unactivated.
 */
const ActivationCondition = Schema.Struct({
  field: Schema.Literal("activation"),
  op: Schema.optional(Schema.Literals(["eq", "ne"])),
  value: WindowsActivationStatus,
});

const ApplicationCondition = Schema.Struct({
  field: Schema.Literal("application"),
  /** `has` matches a bundle id or application name; `lacks` is its inverse. */
  op: Schema.optional(Schema.Literals(["has", "lacks"])),
  value: Schema.String,
});

export const DeviceCondition = Schema.Union([
  TextCondition,
  PlatformCondition,
  OsVersionCondition,
  StatusCondition,
  HealthCondition,
  DaysCondition,
  FileVaultCondition,
  ActivationCondition,
  ApplicationCondition,
]);

export type DeviceCondition = typeof DeviceCondition.Type;

/**
 * All lists are optional. `all` is AND, `any` is OR, `none` is NOT. A query
 * with no conditions matches every device.
 */
export const DeviceQuery = Schema.Struct({
  version: Schema.optional(Schema.Literal(1)),
  all: Schema.optional(Schema.Array(DeviceCondition)),
  any: Schema.optional(Schema.Array(DeviceCondition)),
  none: Schema.optional(Schema.Array(DeviceCondition)),
});

export type DeviceQuery = typeof DeviceQuery.Type;

export const emptyDeviceQuery = (): DeviceQuery => ({ all: [] });

export const deviceQueryConditionCount = (query: DeviceQuery | null | undefined): number =>
  (query?.all?.length ?? 0) + (query?.any?.length ?? 0) + (query?.none?.length ?? 0);

/** Human-readable reason a query cannot be evaluated, or `null`. */
export const deviceQueryProblem = (query: DeviceQuery | null | undefined): string | null => {
  if (!query) return null;

  for (const list of [query.all ?? [], query.any ?? [], query.none ?? []])
    for (const condition of list) {
      if (Schema.is(Schema.String)(condition.value) && condition.value.trim() === "")
        return `The ${condition.field} condition needs a value`;

      if (
        (condition.field === "staleDays" || condition.field === "enrolledDays") &&
        condition.value < 0
      )
        return `${condition.field} must not be negative`;

      if (condition.field === "osVersion" && condition.value.trim() === "")
        return "The osVersion condition needs a value";
    }

  return null;
};

/** Device fields the evaluator reads. Dates may be `Date` or ISO strings. */
export type DeviceQueryDevice = {
  readonly proto?: string | null;
  readonly name?: string | null;
  readonly model?: string | null;
  readonly osVersion?: string | null;
  readonly osEdition?: string | null;
  readonly serial?: string | null;
  readonly assetTag?: string | null;
  readonly status?: string | null;
  readonly batteryHealth?: string | null;
  readonly lastSeenAt?: Date | string | null;
  readonly enrolledAt?: Date | string | null;
  readonly fileVaultStatus?: string | null;
  readonly fileVaultEnabled?: boolean | null;
  /** Windows activation state reported by the agent; null on other platforms. */
  readonly windowsActivationStatus?: string | null;
  readonly health?: {
    readonly level: typeof DeviceHealthLevel.Type;
    readonly stale: boolean;
  } | null;
  readonly applications?: ReadonlyArray<{
    readonly bundleId: string;
    readonly name?: string | null;
  }>;
};

export type DeviceQueryEvaluationOptions = {
  /** Injectable clock so day comparisons are deterministic in tests. */
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
    case "ne":
      return actual !== expected;
    default:
      return false;
  }
};

const textMatches = (
  actual: string | null | undefined,
  condition: { op?: string; value: string },
) => {
  const value = normalized(actual);
  const expected = normalized(condition.value);

  if (value === null || expected === null) return false;

  switch (condition.op ?? "contains") {
    case "eq":
      return value === expected;
    case "ne":
      return value !== expected;
    case "prefix":
      return value.startsWith(expected);
    case "contains":
    default:
      return value.includes(expected);
  }
};

const dayAge = (value: Date | string | null | undefined, now: Date): number | null => {
  const date = parseDate(value);

  return date ? (now.getTime() - date.getTime()) / DAY_MS : null;
};

const fileVaultState = (device: DeviceQueryDevice): "enabled" | "disabled" | "unknown" => {
  const status = normalized(device.fileVaultStatus);

  if (status === "enabled" || status === "disabled") return status;

  if (device.fileVaultEnabled === true) return "enabled";

  if (device.fileVaultEnabled === false) return "disabled";

  return "unknown";
};

/**
 * Windows activation state a condition can match.
 *
 * Non-Windows devices return `null`, not `unknown`: a Mac or Android device
 * cannot report activation, so `activation is unknown` must not sweep it into
 * the same bucket as a Windows device whose agent has not reported yet.
 */
const activationState = (device: DeviceQueryDevice): WindowsActivationStatus | null => {
  if (normalized(device.proto) !== "win") return null;

  const status = normalized(device.windowsActivationStatus);

  if (status === "activated" || status === "not-activated" || status === "unknown") return status;

  return "unknown";
};

const matchesApplication = (
  device: DeviceQueryDevice,
  condition: Extract<DeviceCondition, { field: "application" }>,
) => {
  const expected = normalized(condition.value);

  if (!expected) return false;

  const found = (device.applications ?? []).some((application) => {
    const id = normalized(application.bundleId);
    const name = normalized(application.name);

    return id === expected || name === expected || (name?.includes(expected) ?? false);
  });

  return condition.op === "lacks" ? !found : found;
};

const matchesCondition = (
  condition: DeviceCondition,
  device: DeviceQueryDevice,
  now: Date,
): boolean => {
  switch (condition.field) {
    case "name":
    case "model":
    case "serial":
    case "assetTag":
    case "osEdition":
    case "batteryHealth":
      return textMatches(device[condition.field], condition);
    case "platform":
    case "proto": {
      const actual = normalized(device.proto);
      const expected = normalized(condition.value);

      if (actual === null || expected === null) return false;

      return condition.op === "ne" ? actual !== expected : actual === expected;
    }

    case "osVersion": {
      if (!device.osVersion) return false;
      const op = condition.op ?? "eq";

      if (op === "eq")
        return (
          normalized(device.osVersion) === normalized(condition.value) ||
          compareVersionStrings(device.osVersion, condition.value) === 0
        );
      const comparison = compareVersionStrings(device.osVersion, condition.value);

      if (comparison === null) return false;

      return compareNumber(comparison, 0, op);
    }

    case "status": {
      const actual = normalized(device.status);
      const expected = normalized(condition.value);

      if (actual === null || expected === null) return false;

      return condition.op === "ne" ? actual !== expected : actual === expected;
    }

    case "health": {
      if (condition.value === "stale") {
        const stale = Boolean(device.health?.stale);

        return condition.op === "ne" ? !stale : stale;
      }

      const matches = device.health?.level === condition.value;

      return condition.op === "ne" ? !matches : matches;
    }

    case "staleDays":
    case "enrolledDays": {
      const age = dayAge(
        condition.field === "staleDays" ? device.lastSeenAt : device.enrolledAt,
        now,
      );

      if (age === null) return false;

      return compareNumber(age, condition.value, condition.op ?? "gte");
    }

    case "fileVault":
      return fileVaultState(device) === condition.value;
    case "activation": {
      const actual = activationState(device);

      if (actual === null) return false;

      const matches = actual === condition.value;

      return condition.op === "ne" ? !matches : matches;
    }

    case "application":
      return matchesApplication(device, condition);
    default:
      return false;
  }
};

/**
 * Evaluate a query against one device snapshot. Pure: callers pass the device,
 * its derived health rollup, its installed applications and an optional clock.
 */
export const evaluateDeviceQuery = (
  query: DeviceQuery | null | undefined,
  device: DeviceQueryDevice,
  options: DeviceQueryEvaluationOptions = {},
): boolean => {
  if (!query) return true;
  const now = options.now ?? new Date();
  const every = query.all ?? [];

  if (!every.every((condition) => matchesCondition(condition, device, now))) return false;
  const some = query.any ?? [];

  if (some.length > 0 && !some.some((condition) => matchesCondition(condition, device, now)))
    return false;
  const none = query.none ?? [];

  if (none.some((condition) => matchesCondition(condition, device, now))) return false;

  return true;
};

/** The URL/search representation used by the device table. */
const quoteValue = (value: string) =>
  /[\s"]/u.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;

const unquoteValue = (value: string) =>
  value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1).replaceAll('\\"', '"') : value;

const operatorText = (condition: DeviceCondition): string => {
  const op = condition.op;

  switch (condition.field) {
    case "platform":
    case "proto":
    case "status":
      return op === "ne" ? "is not" : "is";
    case "health":
      return op === "ne" ? "is not" : "is";
    case "application":
      return op === "lacks" ? "lacks" : "has";
    case "fileVault":
      return "is";
    case "activation":
      return op === "ne" ? "is not" : "is";
    case "staleDays":
    case "enrolledDays":
    case "osVersion": {
      switch (op ?? (condition.field === "staleDays" ? "gte" : "eq")) {
        case "lt":
          return "older than";
        case "lte":
          return "at most";
        case "gt":
          return "newer than";
        case "gte":
          return "at least";
        default:
          return "is";
      }
    }

    default:
      switch (op ?? "contains") {
        case "eq":
          return "is";
        case "ne":
          return "is not";
        case "prefix":
          return "starts with";
        default:
          return "contains";
      }
  }
};

const formatCondition = (condition: DeviceCondition): string => {
  const value =
    condition.field === "staleDays" || condition.field === "enrolledDays"
      ? String(condition.value)
      : condition.value;

  return `${condition.field} ${operatorText(condition)} ${quoteValue(String(value))}`;
};

/**
 * Format the AND-list as a compact human-readable query for a URL. OR/NOT lists
 * are only expressible in the structured editor, so they are left out here.
 */
export const formatDeviceQueryText = (query: DeviceQuery | null | undefined): string =>
  (query?.all ?? []).map(formatCondition).join(" and ");

type ParsedCondition = DeviceCondition | null;

const parseOperator = (field: string, operator: string, value: string): ParsedCondition => {
  const op = operator.trim().toLowerCase();

  switch (field) {
    case "platform":
    case "proto": {
      if (!Schema.is(DevicePlatform)(value)) return null;

      if (op === "is not") return { field, op: "ne", value };

      if (op === "is") return { field, op: "eq", value };

      return null;
    }

    case "status": {
      if (!Schema.is(DeviceStatusValue)(value)) return null;

      if (op === "is not") return { field, op: "ne", value };

      if (op === "is") return { field, op: "eq", value };

      return null;
    }

    case "health": {
      if (!Schema.is(DeviceHealthLevel)(value) && value !== "stale") return null;

      if (op === "is not") return { field, op: "ne", value };

      if (op === "is") return { field, op: "eq", value };

      return null;
    }

    case "osVersion": {
      if (op === "older than") return { field, op: "lt", value };

      if (op === "at most") return { field, op: "lte", value };

      if (op === "newer than") return { field, op: "gt", value };

      if (op === "at least") return { field, op: "gte", value };

      if (op === "is") return { field, op: "eq", value };

      return null;
    }

    case "staleDays":
    case "enrolledDays": {
      const days = Number(value);

      if (!Number.isFinite(days)) return null;

      if (op === "older than" || op === "more than") return { field, op: "gt", value: days };

      if (op === "at most") return { field, op: "lte", value: days };

      if (op === "newer than" || op === "less than") return { field, op: "lt", value: days };

      if (op === "at least") return { field, op: "gte", value: days };

      if (op === "is") return { field, op: "eq", value: days };

      return null;
    }

    case "fileVault": {
      if (!Schema.is(DeviceFileVault)(value)) return null;

      return op === "is" ? { field, op: "eq", value } : null;
    }

    case "activation": {
      if (!Schema.is(WindowsActivationStatus)(value)) return null;

      if (op === "is not") return { field, op: "ne", value };

      if (op === "is") return { field, op: "eq", value };

      return null;
    }

    case "application":
      if (op === "has") return { field, op: "has", value };

      if (op === "lacks") return { field, op: "lacks", value };

      return null;

    case "name":
    case "model":
    case "serial":
    case "assetTag":
    case "osEdition":
    case "batteryHealth":
      if (op === "is") return { field, op: "eq", value };

      if (op === "is not") return { field, op: "ne", value };

      if (op === "starts with") return { field, op: "prefix", value };

      if (op === "contains") return { field, op: "contains", value };

      return null;

    default:
      return null;
  }
};

/** Split on ` and ` outside double quotes. */
const splitAnd = (text: string): string[] => {
  const parts: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < text.length; index++) {
    const character = text[index]!;

    if (character === '"' && text[index - 1] !== "\\") quoted = !quoted;

    if (!quoted && text.slice(index, index + 5).toLowerCase() === " and ") {
      parts.push(current.trim());
      current = "";
      index += 4;
      continue;
    }

    current += character;
  }

  if (current.trim()) parts.push(current.trim());

  return parts;
};

/**
 * Parse the URL representation. Returns `null` for an empty string and drops
 * clauses it cannot understand rather than failing the page.
 */
export const parseDeviceQueryText = (text: string | null | undefined): DeviceQuery | null => {
  const trimmed = text?.trim();

  if (!trimmed) return null;
  const conditions: DeviceCondition[] = [];

  for (const clause of splitAnd(trimmed)) {
    const match = clause.match(
      /^([A-Za-z][A-Za-z0-9]*)\s+(is not|is|contains|starts with|has|lacks|older than|newer than|at most|at least|more than|less than|>=|<=|>|<|=)\s+(.+)$/i,
    );

    if (!match) continue;
    const condition = parseOperator(match[1]!, match[2]!, unquoteValue(match[3]!.trim()));

    if (condition) conditions.push(condition);
  }

  return conditions.length ? { version: 1, all: conditions } : null;
};
