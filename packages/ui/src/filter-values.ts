/**
 * Pure value-list helpers shared by the filter bar and the entity query engine.
 *
 * A filter operand is either one value or, for `in`, a comma-separated list.
 * Values may be quoted so commas, whitespace and backslashes survive the
 * round-trip through the URL. The scanner mirrors the quoter: a backslash
 * escapes the next character, so `\\` is a literal backslash and `\"` is a
 * literal quote.
 */

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

/** Keep just the first value, for switching back to a single-value operator. */
export const firstFilterValue = (values: ReadonlyArray<string>): string[] => {
  for (const value of values) {
    if (value.trim() !== "") return [value];
  }

  return [];
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

/** The subset of a filter field the value/operator rules need. */
export type FilterValueField = {
  kind: "text" | "number" | "select" | "date";
  multiple?: boolean;
};

/** Whether this operator takes a list (or the field is inherently multi-select). */
export const isMultiFilterValue = (field: FilterValueField, operator: string): boolean =>
  operator === "in" || (field.kind === "select" && field.multiple === true);

/** Drop numeric junk when the operator is a list. */
export const normaliseFilterValues = (
  field: FilterValueField,
  operator: string,
  values: string[],
): string[] => {
  if (field.kind === "number" && isMultiFilterValue(field, operator))
    return normaliseNumericFilterValues(values);

  return values;
};

/** Switching away from a list operator keeps only the first value. */
export const normaliseFilterOperatorValues = (
  field: FilterValueField,
  nextOperator: string,
  values: ReadonlyArray<string>,
): string[] => {
  const next = isMultiFilterValue(field, nextOperator) ? [...values] : firstFilterValue(values);

  return normaliseFilterValues(field, nextOperator, next);
};
