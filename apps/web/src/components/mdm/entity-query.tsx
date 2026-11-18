import { FilterBar, type FilterCondition, type FilterField } from "@mattrax/ui";
import {
  defaultFor,
  joinEntityValues,
  opsFor,
  splitEntityValues,
  type EntityCondition,
  type EntityField,
} from "./entity-query-engine";

export {
  formatEntityQuery,
  matchesEntityQuery,
  parseEntityQuery,
  splitEntityValues,
  type EntityCondition,
  type EntityField,
} from "./entity-query-engine";

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
    values:
      condition.op === "in"
        ? splitEntityValues(condition.value)
        : condition.value === ""
          ? []
          : [condition.value],
  }));

const fromFilterConditions = (conditions: ReadonlyArray<FilterCondition>): EntityCondition[] =>
  conditions.map((condition) => ({
    field: condition.field,
    op: condition.operator,
    value:
      condition.operator === "in"
        ? joinEntityValues(condition.values)
        : (condition.values[0] ?? ""),
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
