import { FilterBar, type FilterCondition, type FilterField } from "@mattrax/ui";
import { Match, Schema } from "effect";

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
  { value: "starts with", label: "starts with" },
];

const numberOps = [
  { value: "at least", label: "at least" },
  { value: "more than", label: "more than" },
  { value: "at most", label: "at most" },
  { value: "less than", label: "less than" },
  { value: "exactly", label: "exactly" },
];

const selectOps = [
  { value: "is", label: "is" },
  { value: "is not", label: "is not" },
];

const opsFor = <T,>(field: EntityField<T> | undefined) =>
  Match.value(field?.kind).pipe(
    Match.when("number", () => numberOps),
    Match.when("select", () => selectOps),
    Match.orElse(() => textOps),
  );

const isNumber = Schema.is(Schema.Number);

const defaultFor = <T,>(field: EntityField<T>): EntityCondition => ({
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
  /[\s"]/u.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;

const unquote = (value: string) =>
  value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1).replaceAll('\\"', '"') : value;

export const formatEntityQuery = (conditions: ReadonlyArray<EntityCondition>): string =>
  conditions
    .map((condition) => `${condition.field} ${condition.op} ${quote(condition.value)}`)
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

export const parseEntityQuery = <T,>(
  text: string | null | undefined,
  fields: ReadonlyArray<EntityField<T>>,
): EntityCondition[] => {
  const trimmed = text?.trim();

  if (!trimmed) return [];
  const conditions: EntityCondition[] = [];

  for (const clause of splitAnd(trimmed)) {
    const match = clause.match(
      /^([A-Za-z][A-Za-z0-9]*)\s+(is not|is|contains|starts with|at least|more than|at most|less than|exactly)\s+(.+)$/i,
    );

    if (!match) continue;
    const field = fields.find((item) => item.id === match[1]!.toLowerCase());

    if (!field) continue;
    const op = match[2]!.toLowerCase();

    if (!opsFor(field).some((option) => option.value === op)) continue;
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

export const matchesEntityQuery = <T,>(
  conditions: ReadonlyArray<EntityCondition>,
  row: T,
  fields: ReadonlyArray<EntityField<T>>,
): boolean => {
  for (const condition of conditions) {
    const field = fields.find((item) => item.id === condition.field);

    if (!field) continue;
    const raw = field.get(row);

    if (field.kind === "number") {
      const actual = isNumber(raw) ? raw : Number(raw ?? 0);
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

const toFilterField = <T,>(field: EntityField<T>): FilterField => ({
  id: field.id,
  label: field.label,
  kind: field.kind,
  options: field.options,
  operators: opsFor(field),
  defaultOperator: defaultFor(field).op,
  defaultValue: defaultFor(field).value || undefined,
  placeholder: "Value",
});

const fieldsToFilterFields = <T,>(fields: ReadonlyArray<EntityField<T>>): FilterField[] =>
  fields.map((field) => toFilterField(field));

const toFilterConditions = (conditions: ReadonlyArray<EntityCondition>): FilterCondition[] =>
  conditions.map((condition) => ({
    field: condition.field,
    operator: condition.op,
    values: condition.value === "" ? [] : [condition.value],
  }));

const fromFilterConditions = (conditions: ReadonlyArray<FilterCondition>): EntityCondition[] =>
  conditions.map((condition) => ({
    field: condition.field,
    op: condition.operator,
    value: condition.values[0] ?? "",
  }));

/**
 * The condition editor for entity tables (groups, policies, applications).
 * Conditions are still encoded in the URL by the page; this only edits them.
 */
export function EntityQueryBar<T>(props: {
  fields: ReadonlyArray<EntityField<T>>;
  conditions: ReadonlyArray<EntityCondition>;
  onChange: (conditions: EntityCondition[]) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <FilterBar
      fields={fieldsToFilterFields(props.fields)}
      conditions={toFilterConditions(props.conditions)}
      onChange={(conditions) => props.onChange(fromFilterConditions(conditions))}
      label={props.label}
      disabled={props.disabled}
    />
  );
}
