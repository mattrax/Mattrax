import type { JSX } from "@solidjs/web";
import type { Component } from "solid-js";
import { createMemo, createSignal, For, Show } from "solid-js";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@ui-sdk/solid/popover";
import { cn } from "./lib/cn";
import { Check, ChevronDown, Filter as FilterIcon, Plus, Search, X } from "./icons";

/**
 * Filter primitives.
 *
 * The shape is the Linear one: a quiet row of pills, each reading
 * `Field  operator  value`, joined by "and", with one button to add more. A
 * pill opens a small panel that edits the field, the operator and the values in
 * place; an empty editor offers the list of fields search-first.
 *
 * Everything here is presentation plus condition bookkeeping. What a condition
 * means — a URL param, a SQL predicate, a device query — stays with the page.
 */

export type FilterOption = {
  value: string;
  label: string;
  icon?: Component<{ class?: string }>;
};

export type FilterOperator = { value: string; label: string };

export type FilterFieldKind = "text" | "number" | "select" | "date";

export type FilterField = {
  id: string;
  label: string;
  /** Optional group heading in the field picker, e.g. "Device". */
  group?: string;
  icon?: Component<{ class?: string }>;
  kind: FilterFieldKind;
  options?: ReadonlyArray<FilterOption>;
  operators?: ReadonlyArray<FilterOperator>;
  defaultOperator?: string;
  defaultValue?: string;
  placeholder?: string;
  /** Allow more than one value for a select field. */
  multiple?: boolean;
};

export type FilterCondition = {
  field: string;
  operator: string;
  values: string[];
};

const KIND_OPERATORS: Record<FilterFieldKind, ReadonlyArray<FilterOperator>> = {
  text: [
    { value: "contains", label: "contains" },
    { value: "is", label: "is" },
    { value: "is not", label: "is not" },
    { value: "starts with", label: "starts with" },
  ],
  number: [
    { value: "at least", label: "at least" },
    { value: "more than", label: "more than" },
    { value: "at most", label: "at most" },
    { value: "less than", label: "less than" },
    { value: "exactly", label: "exactly" },
  ],
  select: [
    { value: "is", label: "is" },
    { value: "is not", label: "is not" },
  ],
  date: [
    { value: "is", label: "is" },
    { value: "on or after", label: "on or after" },
    { value: "on or before", label: "on or before" },
  ],
};

const KIND_DEFAULT_OPERATOR: Record<FilterFieldKind, string> = {
  text: "contains",
  number: "at least",
  select: "is",
  date: "is",
};

export const filterOperators = (field: FilterField): ReadonlyArray<FilterOperator> =>
  field.operators ?? KIND_OPERATORS[field.kind];

export const filterOperatorLabel = (field: FilterField, operator: string): string =>
  filterOperators(field).find((option) => option.value === operator)?.label ?? operator;

export const defaultFilter = (field: FilterField): FilterCondition => {
  let values: string[] = [];

  if (field.defaultValue !== undefined) values = [field.defaultValue];
  else if (field.kind === "select") {
    const first = field.options?.[0];

    if (first) values = [first.value];
  }

  return {
    field: field.id,
    operator: field.defaultOperator ?? KIND_DEFAULT_OPERATOR[field.kind],
    values,
  };
};

export const filterValueLabel = (field: FilterField, condition: FilterCondition): string => {
  const labels = condition.values
    .filter((value) => value !== "")
    .map((value) => field.options?.find((option) => option.value === value)?.label ?? value);

  return labels.length > 0 ? labels.join(", ") : "Any";
};

const isMultiValue = (field: FilterField) => field.multiple === true;

const surface =
  "w-[264px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[10px] border border-border bg-popover p-1 text-popover-foreground shadow-popover outline-none data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0 data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0 transition-[opacity,transform] duration-[var(--duration-popover)] ease-swift";

const optionClass =
  "flex h-7 w-full cursor-default select-none items-center gap-2 rounded-[6px] px-2 text-left text-[12.5px] font-[450] text-foreground outline-none transition-colors duration-[var(--duration-press)] hover:bg-hover focus-visible:bg-hover [&_svg]:shrink-0";

function FieldOptionRow(props: { option: FilterOption; selected?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={props.selected ? "true" : undefined}
      class={optionClass}
      onClick={props.onClick}
    >
      <Show when={props.option.icon}>
        {(icon) => {
          const Icon = icon();

          return <Icon class="size-3.5 text-muted-foreground" />;
        }}
      </Show>
      <span class="min-w-0 flex-1 truncate">{props.option.label}</span>
      <Show when={props.selected}>
        <Check class="size-3.5 text-foreground" />
      </Show>
    </button>
  );
}

function FieldPicker(props: {
  fields: ReadonlyArray<FilterField>;
  onPick: (field: FilterField) => void;
}) {
  const [search, setSearch] = createSignal("");

  const matches = createMemo(() => {
    const term = search().trim().toLowerCase();

    return props.fields.filter(
      (field) => !term || field.label.toLowerCase().includes(term) || field.id.includes(term),
    );
  });

  const groups = createMemo(() => {
    const map = new Map<string, FilterField[]>();

    for (const field of matches()) {
      const key = field.group ?? "";
      map.set(key, [...(map.get(key) ?? []), field]);
    }

    return [...map.entries()];
  });

  return (
    <div>
      <div class="flex items-center gap-2 border-b border-border px-2 pb-1.5 pt-1">
        <Search class="size-3.5 text-subtle-foreground" />
        <input
          type="text"
          value={search()}
          onInput={(event) => setSearch(event.currentTarget.value)}
          placeholder="Filter by…"
          aria-label="Search filters"
          class="h-7 min-w-0 flex-1 bg-transparent text-[12.5px] text-foreground outline-none placeholder:text-subtle-foreground"
        />
        <Show when={search()}>
          <button
            type="button"
            class="text-subtle-foreground hover:text-foreground"
            aria-label="Clear filter search"
            onClick={() => setSearch("")}
          >
            <X class="size-3" />
          </button>
        </Show>
      </div>

      <Show when={matches().length > 0}>
        <div
          role="listbox"
          aria-label="Filter by"
          class="max-h-[292px] overflow-y-auto overscroll-contain py-1"
        >
          <For each={groups()}>
            {([group, groupFields], groupIndex) => (
              <div
                role={group ? "group" : undefined}
                aria-labelledby={group ? `filter-group-${groupIndex()}` : undefined}
              >
                <Show when={group}>
                  <p
                    id={`filter-group-${groupIndex()}`}
                    class="label-caps flex h-6 items-center px-2"
                  >
                    {group}
                  </p>
                </Show>
                <For each={groupFields}>
                  {(field) => (
                    <FieldOptionRow
                      option={{
                        value: field.id,
                        label: field.label,
                        icon: field.icon,
                      }}
                      onClick={() => props.onPick(field)}
                    />
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={matches().length === 0}>
        <p class="px-2 py-6 text-center text-[12px] text-muted-foreground">No fields match.</p>
      </Show>
    </div>
  );
}

function ValueEditor(props: {
  field: FilterField;
  condition: FilterCondition;
  onChange: (values: string[]) => void;
  onDone: (values: string[]) => void;
}) {
  const [search, setSearch] = createSignal("");

  const options = createMemo(() => {
    const term = search().trim().toLowerCase();

    return (props.field.options ?? []).filter(
      (option) => !term || option.label.toLowerCase().includes(term),
    );
  });

  const toggle = (value: string) => {
    if (isMultiValue(props.field)) {
      const next = props.condition.values.includes(value)
        ? props.condition.values.filter((item) => item !== value)
        : [...props.condition.values.filter((item) => item !== ""), value];

      props.onChange(next);

      return;
    }

    props.onChange([value]);
    props.onDone([value]);
  };

  return (
    <div>
      <Show when={(props.field.options?.length ?? 0) > 6}>
        <div class="flex items-center gap-2 border-b border-border px-2 pb-1.5 pt-1">
          <Search class="size-3.5 text-subtle-foreground" />
          <input
            type="text"
            value={search()}
            onInput={(event) => setSearch(event.currentTarget.value)}
            placeholder={`Search ${props.field.label.toLowerCase()}…`}
            aria-label={`Search ${props.field.label} values`}
            class="h-7 min-w-0 flex-1 bg-transparent text-[12.5px] text-foreground outline-none placeholder:text-subtle-foreground"
          />
        </div>
      </Show>

      <Show when={options().length > 0}>
        <div
          role="listbox"
          aria-label={`${props.field.label} value`}
          aria-multiselectable={isMultiValue(props.field) ? "true" : undefined}
          class="max-h-[260px] overflow-y-auto overscroll-contain py-1"
        >
          <For each={options()}>
            {(option) => (
              <FieldOptionRow
                option={option}
                selected={props.condition.values.includes(option.value)}
                onClick={() => toggle(option.value)}
              />
            )}
          </For>
        </div>
      </Show>
      <Show when={options().length === 0}>
        <p class="px-2 py-6 text-center text-[12px] text-muted-foreground">No values.</p>
      </Show>
    </div>
  );
}

const inputType = (kind: FilterFieldKind): "text" | "number" | "date" => {
  switch (kind) {
    case "number":
      return "number";
    case "date":
      return "date";
    default:
      return "text";
  }
};

function TextValueEditor(props: {
  field: FilterField;
  condition: FilterCondition;
  onChange: (values: string[]) => void;
}) {
  return (
    <div class="p-1">
      <input
        type={inputType(props.field.kind)}
        value={props.condition.values[0] ?? ""}
        min={props.field.kind === "number" ? 0 : undefined}
        placeholder={props.field.placeholder ?? "Value"}
        aria-label={`${props.field.label} value`}
        onInput={(event) => props.onChange([event.currentTarget.value])}
        class="h-8 w-full rounded-[6px] border border-input bg-background px-2 text-[12.5px] text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-subtle-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20"
      />
    </div>
  );
}

function EditorHeader(props: {
  field: FilterField;
  condition: FilterCondition;
  onField: () => void;
  onOperator: (operator: string) => void;
}) {
  return (
    <div class="flex items-center gap-1 border-b border-border px-1 pb-1.5 pt-1">
      <button
        type="button"
        class="flex h-7 min-w-0 items-center gap-1.5 rounded-[6px] px-1.5 text-[12.5px] font-[520] text-foreground outline-none hover:bg-hover focus-visible:bg-hover"
        aria-label={`Change filter field: ${props.field.label}`}
        onClick={props.onField}
      >
        <Show when={props.field.icon}>
          {(icon) => {
            const Icon = icon();

            return <Icon class="size-3.5 text-muted-foreground" />;
          }}
        </Show>
        <span class="truncate">{props.field.label}</span>
        <ChevronDown class="size-3 text-subtle-foreground" />
      </button>

      <label class="relative min-w-0">
        <span class="sr-only">{props.field.label} operator</span>
        <select
          aria-label={`${props.field.label} operator`}
          value={props.condition.operator}
          onChange={(event) => props.onOperator(event.currentTarget.value)}
          class="h-7 max-w-[8.5rem] appearance-none rounded-[6px] bg-transparent py-0 pl-1.5 pr-5 text-[12px] text-muted-foreground outline-none hover:bg-hover focus-visible:bg-hover"
        >
          <For each={filterOperators(props.field)}>
            {(operator) => <option value={operator.value}>{operator.label}</option>}
          </For>
        </select>
        <ChevronDown class="pointer-events-none absolute right-1.5 top-1/2 size-3 -translate-y-1/2 text-subtle-foreground" />
      </label>
    </div>
  );
}

function ConditionPanel(props: {
  field: FilterField;
  condition: FilterCondition;
  onChange: (condition: FilterCondition) => void;
  onDone: (condition: FilterCondition) => void;
  onRemove?: () => void;
  onField: () => void;
}) {
  const operator = (value: string) => props.onChange({ ...props.condition, operator: value });

  return (
    <div>
      <EditorHeader
        field={props.field}
        condition={props.condition}
        onField={props.onField}
        onOperator={operator}
      />

      <Show
        when={props.field.kind === "select"}
        fallback={
          <TextValueEditor
            field={props.field}
            condition={props.condition}
            onChange={(values) => props.onChange({ ...props.condition, values })}
          />
        }
      >
        <ValueEditor
          field={props.field}
          condition={props.condition}
          onChange={(values) => props.onChange({ ...props.condition, values })}
          onDone={(values) => props.onDone({ ...props.condition, values })}
        />
      </Show>

      <div class="mt-0.5 flex items-center justify-between gap-1 border-t border-border px-1 pb-0.5 pt-1">
        <Show
          when={props.onRemove}
          fallback={
            <span class="px-1 text-[10.5px] text-subtle-foreground">Changes apply as you pick</span>
          }
        >
          <button
            type="button"
            class="flex h-6 items-center gap-1 rounded-[6px] px-1.5 text-[11.5px] text-muted-foreground outline-none hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10"
            onClick={props.onRemove}
          >
            <X class="size-3" />
            Remove filter
          </button>
        </Show>
        <Show when={props.field.kind !== "select"}>
          <button
            type="button"
            disabled={(props.condition.values[0] ?? "") === ""}
            class="h-6 rounded-[6px] bg-primary px-2 text-[11.5px] font-medium text-primary-foreground outline-none hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-40"
            onClick={() => props.onDone(props.condition)}
          >
            Apply
          </button>
        </Show>
      </div>
    </div>
  );
}

function FilterChip(props: {
  fields: ReadonlyArray<FilterField>;
  field: FilterField;
  condition: FilterCondition;
  onChange: (condition: FilterCondition) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [view, setView] = createSignal<"condition" | "fields">("condition");

  const field = () => props.field;
  const close = () => setOpen(false);

  const changeField = (next: FilterField) => {
    props.onChange(defaultFilter(next));
    setView("condition");
  };

  return (
    <div class="group inline-flex h-7 max-w-full items-center rounded-full border border-border bg-card pl-1.5 pr-0.5 transition-colors duration-[var(--duration-hover)] ease-swift hover:border-border-strong">
      <Popover
        open={open()}
        onOpenChange={(next) => {
          setOpen(next);

          if (!next) setView("condition");
        }}
        modal={false}
      >
        <PopoverTrigger
          class="flex h-full min-w-0 items-center gap-1 rounded-full pr-1 text-[12px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25"
          aria-label={`${field().label} ${filterOperatorLabel(field(), props.condition.operator)} ${filterValueLabel(field(), props.condition)}`}
        >
          <Show when={field().icon}>
            {(icon) => {
              const Icon = icon();

              return <Icon class="size-3.5 shrink-0 text-subtle-foreground" />;
            }}
          </Show>
          <span class="truncate text-muted-foreground">{field().label}</span>{" "}
          <span class="shrink-0 text-subtle-foreground">
            {filterOperatorLabel(field(), props.condition.operator)}
          </span>{" "}
          <span class="min-w-0 truncate font-[520] text-foreground">
            {filterValueLabel(field(), props.condition)}
          </span>
        </PopoverTrigger>

        <PopoverContent side="bottom" align="start" sideOffset={6} class={surface}>
          <PopoverTitle class="sr-only">Edit {field().label} filter</PopoverTitle>
          <PopoverDescription class="sr-only">
            Change the field, operator or value for this filter.
          </PopoverDescription>
          <Show
            when={view() === "fields"}
            fallback={
              <ConditionPanel
                field={field()}
                condition={props.condition}
                onChange={props.onChange}
                onDone={() => close()}
                onRemove={() => {
                  props.onRemove();
                  close();
                }}
                onField={() => setView("fields")}
              />
            }
          >
            <FieldPicker fields={props.fields} onPick={changeField} />
          </Show>
        </PopoverContent>
      </Popover>

      <button
        type="button"
        class="flex size-5 shrink-0 items-center justify-center rounded-full text-subtle-foreground outline-none transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
        aria-label={`Remove ${field().label} filter`}
        title={`Remove ${field().label} filter`}
        onClick={props.onRemove}
      >
        <X class="size-3" />
      </button>
    </div>
  );
}

function AddFilter(props: {
  fields: ReadonlyArray<FilterField>;
  addLabel: string;
  onCreate: (condition: FilterCondition) => void;
  compact: boolean;
}) {
  const [open, setOpen] = createSignal(false);

  const [draft, setDraft] = createSignal<{ field: FilterField; condition: FilterCondition } | null>(
    null,
  );

  const reset = () => {
    setDraft(null);
    setOpen(false);
  };

  return (
    <Popover
      open={open()}
      onOpenChange={(next) => {
        setOpen(next);

        if (!next) setDraft(null);
      }}
      modal={false}
    >
      <PopoverTrigger
        class={cn(
          "flex h-7 items-center gap-1.5 rounded-full border bg-card text-[12px] text-muted-foreground outline-none transition-[border-color,background-color,color] duration-[var(--duration-hover)] ease-swift hover:bg-hover hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/25",
          props.compact ? "w-6 justify-center p-0" : "px-2.5",
          "border-border",
        )}
        aria-label={props.addLabel}
        title={props.addLabel}
      >
        <Show when={props.compact} fallback={<FilterIcon class="size-3.5" />}>
          <Plus class="size-3.5" />
        </Show>
        <Show when={!props.compact}>
          <span>{props.addLabel}</span>
        </Show>
      </PopoverTrigger>

      <PopoverContent side="bottom" align="start" sideOffset={6} class={surface}>
        <PopoverTitle class="sr-only">{props.addLabel}</PopoverTitle>
        <PopoverDescription class="sr-only">
          Choose a field, then its value, to narrow the table.
        </PopoverDescription>
        <Show
          when={draft()}
          fallback={
            <FieldPicker
              fields={props.fields}
              onPick={(field) => setDraft({ field, condition: defaultFilter(field) })}
            />
          }
        >
          {(current) => (
            <div>
              <button
                type="button"
                class="flex h-7 items-center gap-1 rounded-[6px] px-1.5 text-[11.5px] text-muted-foreground outline-none hover:bg-hover hover:text-foreground"
                onClick={() => setDraft(null)}
              >
                <ChevronDown class="size-3 rotate-90" />
                All fields
              </button>
              <ConditionPanel
                field={current().field}
                condition={current().condition}
                onChange={(condition) => setDraft({ ...current(), condition })}
                onDone={(condition) => {
                  props.onCreate(condition);
                  reset();
                }}
                onField={() => setDraft(null)}
              />
            </div>
          )}
        </Show>
      </PopoverContent>
    </Popover>
  );
}

export type FilterBarProps = {
  fields: ReadonlyArray<FilterField>;
  conditions: ReadonlyArray<FilterCondition>;
  onChange: (conditions: FilterCondition[]) => void;
  disabled?: boolean;
  class?: string;
  /** Label on the empty "Filter" button. */
  label?: string;
  /** Word shown between conditions. */
  conjunction?: string;
  /** Hide the clear-all button. */
  hideClear?: boolean;
  /** Extra controls rendered after the filters. */
  children?: JSX.Element;
};

function clearButtonClass() {
  return "flex h-7 items-center gap-1 rounded-full px-2 text-[11.5px] text-muted-foreground outline-none transition-colors duration-[var(--duration-hover)] hover:bg-hover hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/25";
}

export function FilterBar(props: FilterBarProps) {
  const fields = () => props.fields;
  const fieldById = (id: string) => fields().find((field) => field.id === id);

  const update = (index: number, condition: FilterCondition) => {
    props.onChange(
      props.conditions.map((current, currentIndex) =>
        currentIndex === index ? condition : current,
      ),
    );
  };

  const remove = (index: number) => {
    props.onChange(props.conditions.filter((_, currentIndex) => currentIndex !== index));
  };

  return (
    <div class={cn("flex min-w-0 flex-wrap items-center gap-1.5", props.class)}>
      <For each={props.conditions}>
        {(condition, index) => (
          <div class="flex min-w-0 items-center gap-1.5">
            <Show when={index() > 0}>
              <span class="shrink-0 text-[11px] text-subtle-foreground">
                {props.conjunction ?? "and"}
              </span>
            </Show>
            <Show when={fieldById(condition.field)}>
              {(field) => (
                <FilterChip
                  fields={fields()}
                  field={field()}
                  condition={condition}
                  onChange={(next) => update(index(), next)}
                  onRemove={() => remove(index())}
                />
              )}
            </Show>
          </div>
        )}
      </For>

      <AddFilter
        fields={fields()}
        addLabel={props.conditions.length > 0 ? "Add filter" : (props.label ?? "Filter")}
        compact={props.conditions.length > 0}
        onCreate={(condition) => props.onChange([...props.conditions, condition])}
      />

      <Show when={props.conditions.length > 0 && !props.hideClear}>
        <button
          type="button"
          class={clearButtonClass()}
          aria-label="Clear filters"
          onClick={() => props.onChange([])}
        >
          <X class="size-3" />
          Clear
        </button>
      </Show>

      {props.children}
    </div>
  );
}
