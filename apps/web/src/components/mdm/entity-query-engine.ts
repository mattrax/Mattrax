import { Match, Schema } from "effect";

/**
 * The pure filter engine behind {@link parseEntityQuery} and the entity tables.
 *
 * Conditions are encoded in the URL as `field operator value` joined with
 * `and`. This module owns that grammar, the evaluator and the canonical value
 * formatting; the component file adds the Solid filter UI on top.
 *
 * It is a separate module so the grammar can be unit-tested in the Node test
 * project without loading Solid components.
 */

type FieldKind = "text" | "number" | "select";

export type EntityField<T> = {
  id: string;
  label: string;
  kind: FieldKind;
  options?: ReadonlyArray<{ value: string; label: string }>;
  get: (row: T) => string | number | boolean | null | undefined;
};

export type EntityCondition = { field: string; op: string; value: string };

const textOps = [
  { value: "contains", label: "contains" },
  { value: "is", label: "is" },
  { value: "is not", label: "is not" },
  { value: "in", label: "is any of" },
  { value: "starts with", label: "starts with" },
];

const numberOps = [
  { value: "at least", label: "at least" },
  { value: "more than", label: "more than" },
  { value: "at most", label: "at most" },
  { value: "less than", label: "less than" },
  { value: "exactly", label: "exactly" },
  { value: "in", label: "is any of" },
];

const selectOps = [
  { value: "is", label: "is" },
  { value: "is not", label: "is not" },
  { value: "in", label: "is any of" },
];

const opsFor = <T>(field: EntityField<T> | undefined) =>
  Match.value(field?.kind).pipe(
    Match.when("number", () => numberOps),
    Match.when("select", () => selectOps),
    Match.orElse(() => textOps),
  );

const isNumber = Schema.is(Schema.Number);

const defaultFor = <T>(field: EntityField<T>): EntityCondition => ({
  field: field.id,
  op: Match.value(field.kind).pipe(
    Match.when("number", () => "at least"),
    Match.when("select", () => "is"),
    Match.orElse(() => "contains"),
  ),
  value: Match.value(field.kind).pipe(
    Match.when("select", () => field.options?.[0]?.value ?? ""),
    Match.when("number", () => "1"),
    Match.orElse(() => ""),
  ),
});

const quote = (value: string) =>
  /[\s",]/u.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;

const unquote = (value: string) =>
  value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1).replaceAll('\\"', '"') : value;

/**
 * Split a multi-value (`in`) operand into its values.
 *
 * Commas separate values; a double-quoted value may contain commas and is
 * unescaped the same way as the surrounding query text. Whitespace around a
 * value is ignored, and empty entries are dropped so `field in ,` can never
 * turn into an accidental "match every row" predicate.
 */
export const splitEntityValues = (text: string): string[] => {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < text.length; index++) {
    const character = text[index]!;

    if (character === '"' && text[index - 1] !== "\\") quoted = !quoted;

    if (!quoted && character === ",") {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += character;
  }

  values.push(current.trim());

  const result: string[] = [];

  for (const value of values) {
    const unquoted = unquote(value);

    if (unquoted !== "") result.push(unquoted);
  }

  return result;
};

/** Format values as the canonical comma-separated `in` operand. */
export const joinEntityValues = (values: ReadonlyArray<string>): string => {
  const parts: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();

    if (trimmed !== "") parts.push(quote(trimmed));
  }

  return parts.join(", ");
};

/**
 * Format one operand. An empty `in` list has a canonical representation
 * (`""`) so it survives the URL round-trip as a predicate that matches
 * nothing, rather than silently disappearing into an unfiltered table.
 */
const formatConditionValue = (condition: EntityCondition): string => {
  if (condition.op !== "in") return quote(condition.value);

  const values = joinEntityValues(splitEntityValues(condition.value));

  return values === "" ? '""' : values;
};

/**
 * Format conditions as the shareable text form.
 *
 * `in` operands are canonicalised (quoted commas, trimmed entries) so a parsed
 * query always formats back to the same text.
 */
export const formatEntityQuery = (conditions: ReadonlyArray<EntityCondition>): string =>
  conditions
    .map((condition) => `${condition.field} ${condition.op} ${formatConditionValue(condition)}`)
    .join(" and ");

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

export const parseEntityQuery = <T>(
  text: string | null | undefined,
  fields: ReadonlyArray<EntityField<T>>,
): EntityCondition[] => {
  const trimmed = text?.trim();

  if (!trimmed) return [];
  const conditions: EntityCondition[] = [];

  for (const clause of splitAnd(trimmed)) {
    const match = clause.match(
      /^([A-Za-z][A-Za-z0-9]*)\s+(is not|is|contains|starts with|at least|more than|at most|less than|exactly|in)\s+(.+)$/i,
    );

    if (!match) continue;
    const field = fields.find((item) => item.id === match[1]!.toLowerCase());

    if (!field) continue;
    const op = match[2]!.toLowerCase();

    if (!opsFor(field).some((option) => option.value === op)) continue;

    if (op === "in") {
      // Keep an empty list as a real, matches-nothing predicate so a shared
      // `field in ""` link cannot degrade into an unfiltered table.
      const values = splitEntityValues(match[3]!.trim());

      conditions.push({ field: field.id, op, value: joinEntityValues(values) });
      continue;
    }

    conditions.push({ field: field.id, op, value: unquote(match[3]!.trim()) });
  }

  return conditions;
};

const compareNumber = (actual: number, expected: number, op: string) => {
  switch (op) {
    case "at least":
      return actual >= expected;
    case "more than":
      return actual > expected;
    case "at most":
      return actual <= expected;
    case "less than":
      return actual < expected;
    case "exactly":
      return actual === expected;
    default:
      return false;
  }
};

const numberValue = (raw: string | number | boolean | null | undefined) =>
  isNumber(raw) ? raw : Number(raw ?? 0);

/**
 * Evaluate conditions against one row.
 *
 * String operators, including `in`, are case-insensitive: `in` compares each
 * value the same way `is` does, so `Platform is any of apple` matches "Apple".
 * On numeric fields `in` means "exactly one of", matching the `exactly`
 * operator. A numeric value that is not a finite number never matches.
 */
export const matchesEntityQuery = <T>(
  conditions: ReadonlyArray<EntityCondition>,
  row: T,
  fields: ReadonlyArray<EntityField<T>>,
): boolean => {
  for (const condition of conditions) {
    const field = fields.find((item) => item.id === condition.field);

    if (!field) continue;
    const raw = field.get(row);

    if (condition.op === "in") {
      const values = splitEntityValues(condition.value);

      // Empty operands match nothing. This is the guard against an
      // accidentally empty filter returning the whole fleet.
      if (values.length === 0) return false;

      if (field.kind === "number") {
        const actual = numberValue(raw);

        if (!Number.isFinite(actual)) return false;
        let matched = false;

        for (const value of values) {
          const expected = Number(value);

          if (Number.isFinite(expected) && actual === expected) {
            matched = true;
            break;
          }
        }

        if (!matched) return false;
        continue;
      }

      const actual = String(raw ?? "").toLowerCase();
      let matched = false;

      for (const value of values) {
        if (value.toLowerCase() === actual) {
          matched = true;
          break;
        }
      }

      if (!matched) return false;
      continue;
    }

    if (field.kind === "number") {
      const actual = numberValue(raw);
      const expected = Number(condition.value);

      if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;

      if (!compareNumber(actual, expected, condition.op)) return false;
      continue;
    }

    const actual = String(raw ?? "").toLowerCase();
    const expected = condition.value.toLowerCase();

    if (condition.op === "is" && actual !== expected) return false;

    if (condition.op === "is not" && actual === expected) return false;

    if (condition.op === "contains" && !actual.includes(expected)) return false;

    if (condition.op === "starts with" && !actual.startsWith(expected)) return false;
  }

  return true;
};

export { defaultFor, opsFor };
