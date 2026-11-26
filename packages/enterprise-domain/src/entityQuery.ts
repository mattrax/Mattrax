import { Match, Schema } from "effect";

/**
 * The shared filter language for entity tables (groups, policies and
 * applications).
 *
 * Conditions are encoded in a shareable URL parameter as `field operator value`
 * clauses joined with `and`. The parser, formatter and evaluator live in the
 * domain package so the dashboard's filter bar and the API's server-side
 * pagination agree on exactly one grammar.
 *
 * The value grammar is duplicated in `@mattrax/ui/filter-values` (which the UI
 * filter bar uses for its own chips); keeping this module dependency-free lets
 * the API import it without pulling in Solid or the component library.
 */

export type EntityFieldKind = "text" | "number" | "select";

export type EntityFieldOption = { value: string; label: string };

/** The subset of a field the parser and operator picker need. */
export type EntityQueryField = {
  id: string;
  kind: EntityFieldKind;
  options?: ReadonlyArray<EntityFieldOption>;
};

export type EntityField<T> = EntityQueryField & {
  label: string;
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

export const opsFor = (field: EntityQueryField | undefined) =>
  Match.value(field?.kind).pipe(
    Match.when("number", () => numberOps),
    Match.when("select", () => selectOps),
    Match.orElse(() => textOps),
  );

const isNumber = Schema.is(Schema.Number);

export const defaultFor = (field: EntityQueryField): EntityCondition => ({
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

const needsQuotes = /[\s",\\]/u;

/** Quote one value for the text form, escaping backslashes and quotes. */
export const quoteFilterValue = (value: string): string => {
  const trimmed = value.trim();

  if (!needsQuotes.test(trimmed)) return trimmed;

  return `"${trimmed.replaceAll("\\", String.raw`\\`).replaceAll('"', String.raw`\"`)}"`;
};

/** Remove the outer quotes of a quoted value and resolve `\\` / `\"`. */
export const unquoteFilterValue = (value: string): string => {
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) return value;

  const inner = value.slice(1, -1);
  let result = "";

  for (let index = 0; index < inner.length; index++) {
    const character = inner[index];

    if (character === "\\" && (inner[index + 1] === "\\" || inner[index + 1] === '"')) {
      result += inner[index + 1];
      index += 1;
      continue;
    }

    result += character;
  }

  return result;
};

/**
 * Split a comma-separated operand, respecting quoted values and escapes.
 * Empty entries are dropped so a stray separator cannot widen a filter.
 */
export const splitFilterValues = (text: string): string[] => {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  let escaped = false;

  for (const character of text) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }

    if (character === "\\") {
      current += character;
      escaped = true;
      continue;
    }

    if (character === '"') {
      quoted = !quoted;
      current += character;
      continue;
    }

    if (character === "," && !quoted) {
      parts.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  parts.push(current);

  const values: string[] = [];

  for (const part of parts) {
    const value = unquoteFilterValue(part.trim());

    if (value !== "") values.push(value);
  }

  return values;
};

/** Format values as the canonical comma-separated operand. */
export const formatFilterValues = (values: ReadonlyArray<string>): string => {
  const parts: string[] = [];

  for (const value of values) {
    if (value.trim() !== "") parts.push(quoteFilterValue(value));
  }

  return parts.join(", ");
};

/**
 * Drop entries that are not finite numbers and canonicalise the rest, so the
 * chip and the predicate describe the same values. Order is preserved.
 */
export const normaliseNumericFilterValues = (values: ReadonlyArray<string>): string[] => {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const trimmed = value.trim();

    if (trimmed === "") continue;
    const parsed = Number(trimmed);

    if (!Number.isFinite(parsed)) continue;
    const canonical = String(parsed);

    if (seen.has(canonical)) continue;
    seen.add(canonical);
    result.push(canonical);
  }

  return result;
};

export const splitEntityValues = (text: string): string[] => splitFilterValues(text);

/** Format values as the canonical comma-separated `in` operand. */
export const joinEntityValues = (values: ReadonlyArray<string>): string =>
  formatFilterValues(values);

/**
 * Format one operand. An empty `in` list has a canonical representation
 * (`""`) so it survives the URL round-trip as a predicate that matches
 * nothing, rather than silently disappearing into an unfiltered table.
 */
const formatConditionValue = (condition: EntityCondition): string => {
  if (condition.op !== "in") return quoteFilterValue(condition.value);

  const values = joinEntityValues(splitEntityValues(condition.value));

  return values === "" ? '""' : values;
};

/** Format conditions as the shareable text form. */
export const formatEntityQuery = (conditions: ReadonlyArray<EntityCondition>): string =>
  conditions
    .map((condition) => `${condition.field} ${condition.op} ${formatConditionValue(condition)}`)
    .join(" and ");

const splitAnd = (text: string): string[] => {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  let escaped = false;

  for (let index = 0; index < text.length; index++) {
    const character = text[index];

    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }

    if (character === "\\") {
      current += character;
      escaped = true;
      continue;
    }

    if (character === '"') {
      quoted = !quoted;
      current += character;
      continue;
    }

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
 * Parse the text form against a set of known fields. Clauses naming an unknown
 * field or an operator the field does not offer are dropped rather than failing
 * the page, matching the previous client-side behaviour.
 */
export const parseEntityQuery = (
  text: string | null | undefined,
  fields: ReadonlyArray<EntityQueryField>,
): EntityCondition[] => {
  const trimmed = text?.trim();

  if (!trimmed) return [];
  const conditions: EntityCondition[] = [];

  for (const clause of splitAnd(trimmed)) {
    const match = clause.match(
      /^([A-Za-z][A-Za-z0-9]*)\s+(is not|is|contains|starts with|at least|more than|at most|less than|exactly|in)\s+(.+)$/i,
    );

    if (!match) continue;
    const field = fields.find((item) => item.id === match[1].toLowerCase());

    if (!field) continue;
    const op = match[2].toLowerCase();

    if (!opsFor(field).some((option) => option.value === op)) continue;

    if (op === "in") {
      // Keep an empty list as a real, matches-nothing predicate so a shared
      // `field in ""` link cannot degrade into an unfiltered table. Numeric
      // lists drop junk here so the chip and the predicate always agree.
      const values = splitEntityValues(match[3].trim());
      const normalised = field.kind === "number" ? normaliseNumericFilterValues(values) : values;

      conditions.push({ field: field.id, op, value: joinEntityValues(normalised) });
      continue;
    }

    conditions.push({ field: field.id, op, value: unquoteFilterValue(match[3].trim()) });
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
