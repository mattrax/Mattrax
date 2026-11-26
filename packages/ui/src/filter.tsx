import type { JSX } from "@solidjs/web";
import type { Accessor, Component } from "solid-js";
import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  onSettled,
  Show,
} from "solid-js";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@ui-sdk/solid/popover";
import { cn } from "./lib/cn";
import { Check, ChevronDown, Filter as FilterIcon, Plus, Search, X } from "./icons";
import {
  formatFilterValues,
  isMultiFilterValue,
  normaliseFilterOperatorValues,
  normaliseFilterValues,
  normaliseNumericFilterValues,
  splitFilterValues,
} from "./filter-values";
import {
  FILTER_GROUP_HEIGHT,
  FILTER_OPTION_HEIGHT,
  positionFilterRows,
  visibleFilterRows,
} from "./filter-windowing";
import type { FilterPickerRow } from "./filter-windowing";

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

  if (labels.length > 0) return labels.join(", ");

  // An empty `in` list is a real predicate that matches nothing, unlike an
  // empty single-value condition, which leaves the field unconstrained.
  return condition.operator === "in" ? "None" : "Any";
};

const surface =
  "w-66 max-w-full overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-popover outline-none data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 transition duration-150 ease-out";

const optionClass =
  "flex h-7 w-full cursor-default select-none items-center gap-2 rounded-md px-2 text-left text-xs font-normal text-foreground outline-none transition-colors duration-100 hover:bg-hover focus-visible:bg-hover [&_svg]:shrink-0";

function FieldOptionRow(props: {
  id?: string;
  option: FilterOption;
  selected?: boolean;
  position: number;
  setSize: number;
  onFocus?: () => void;
  onPointerEnter?: () => void;
  onClick: () => void;
}) {
  return (
    <button
      id={props.id}
      type="button"
      role="option"
      aria-selected={props.selected ? "true" : "false"}
      aria-posinset={props.position}
      aria-setsize={props.setSize}
      tabindex={-1}
      class={optionClass}
      onFocus={props.onFocus}
      onPointerEnter={props.onPointerEnter}
      // Pointer selection updates the active descendant without moving DOM
      // focus onto a tabindex=-1 option. Keyboard focus stays on the listbox.
      onPointerDown={(event) => event.preventDefault()}
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
        <Check class="size-3 text-foreground" stroke-width={3} />
      </Show>
    </button>
  );
}

type VirtualPickerListProps = {
  id: string;
  label: string;
  maxHeight: number;
  multiselectable?: boolean;
  rows: Accessor<ReadonlyArray<FilterPickerRow>>;
  optionCount: Accessor<number>;
  renderRow: (row: FilterPickerRow, trackOption: (optionIndex: number) => void) => JSX.Element;
  onActivate: (optionIndex: number) => void;
};

/**
 * One focusable listbox with a roving active descendant. Only the viewport and
 * a small overscan are mounted, but arrow keys can still reach every option
 * because moving the active descendant scrolls its row into view.
 */
function VirtualPickerList(props: VirtualPickerListProps) {
  const positioned = createMemo(() => positionFilterRows(props.rows()));
  const [scrollTop, setScrollTop] = createSignal(0);
  const [viewportHeight, setViewportHeight] = createSignal(props.maxHeight);
  const [activeIndex, setActiveIndex] = createSignal(0);
  let listRef: HTMLDivElement | undefined;

  const renderedRows = createMemo(() => {
    const visible = visibleFilterRows(positioned(), scrollTop(), viewportHeight());
    const active = positioned().byOption.get(activeIndex());

    if (!active || visible.some((entry) => entry.row.key === active.row.key)) return visible;

    return [...visible, active].sort((left, right) => left.top - right.top);
  });

  createEffect(
    () => props.rows(),
    () => {
      setActiveIndex(0);
      setScrollTop(0);
      if (listRef) listRef.scrollTop = 0;
    },
  );

  createEffect(
    () => [positioned().byOption.get(activeIndex()), viewportHeight()] as const,
    ([active]) => {
      if (!active || !listRef) return;

      const top = listRef.scrollTop;
      const bottom = top + viewportHeight();

      if (active.top < top) listRef.scrollTop = active.top;
      else if (active.top + active.row.height > bottom)
        listRef.scrollTop = active.top + active.row.height - viewportHeight();
    },
  );

  onSettled(() => {
    if (!listRef) return;

    const measure = () => setViewportHeight(listRef?.clientHeight || props.maxHeight);
    measure();

    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(measure);
    observer.observe(listRef);

    return () => observer.disconnect();
  });

  const moveActive = (delta: number) => {
    const count = props.optionCount();

    if (count === 0) return;
    setActiveIndex((current) => (current + delta + count) % count);
  };

  const activate = () => {
    if (positioned().byOption.has(activeIndex())) props.onActivate(activeIndex());
  };

  return (
    <div
      id={props.id}
      ref={(element) => {
        listRef = element;
      }}
      role="listbox"
      aria-label={props.label}
      aria-multiselectable={props.multiselectable ? "true" : undefined}
      aria-activedescendant={
        positioned().byOption.has(activeIndex()) ? `${props.id}-option-${activeIndex()}` : undefined
      }
      tabindex={0}
      class="max-h-(--list-max-height) overflow-y-auto overscroll-contain py-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/25"
      style={{ "--list-max-height": `${props.maxHeight}px` }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          moveActive(1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          moveActive(-1);
        } else if (event.key === "Home") {
          event.preventDefault();
          setActiveIndex(0);
        } else if (event.key === "End") {
          event.preventDefault();
          setActiveIndex(Math.max(0, props.optionCount() - 1));
        } else if (event.key === "Enter" && event.target === event.currentTarget) {
          event.preventDefault();
          activate();
        } else if (event.key === " " && event.target === event.currentTarget) {
          event.preventDefault();
        }
      }}
      onKeyUp={(event) => {
        if (event.key === " " && event.target === event.currentTarget) {
          event.preventDefault();
          activate();
        }
      }}
    >
      <div class="relative h-(--list-height)" style={{ "--list-height": `${positioned().height}px` }}>
        <For each={renderedRows()}>
          {(entry) => (
            <div
              class="absolute inset-x-0 top-(--row-top) h-(--row-height)"
              style={{ "--row-top": `${entry.top}px`, "--row-height": `${entry.row.height}px` }}
            >
              {props.renderRow(entry.row, (optionIndex) => setActiveIndex(optionIndex))}
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

function FieldPicker(props: {
  fields: ReadonlyArray<FilterField>;
  onPick: (field: FilterField) => void;
}) {
  const [search, setSearch] = createSignal("");
  const listId = createUniqueId();

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
      const group = map.get(key);

      // Append in place: copying the accumulated array for every field made
      // grouping quadratic on tenants with many custom attributes.
      if (group) group.push(field);
      else map.set(key, [field]);
    }

    return [...map.entries()];
  });

  const fieldById = createMemo(() => new Map(props.fields.map((field) => [field.id, field])));
  const model = createMemo(() => {
    const rows: FilterPickerRow[] = [];
    const options: FilterPickerRow[] = [];
    let optionIndex = 0;
    let groupIndex = 0;

    for (const [group, groupFields] of groups()) {
      if (group) {
        rows.push({
          key: `${listId}-group-${groupIndex}`,
          height: FILTER_GROUP_HEIGHT,
          group,
        });
      }

      for (const field of groupFields) {
        const row: FilterPickerRow = {
          key: `${listId}-field-${field.id}`,
          height: FILTER_OPTION_HEIGHT,
          optionIndex: optionIndex++,
          fieldId: field.id,
          label: field.label,
          group,
        };
        rows.push(row);
        options.push(row);
      }

      groupIndex++;
    }

    return { rows, options };
  });

  const focusList = () => document.getElementById(listId)?.focus();

  return (
    <div>
      <div class="flex items-center gap-2 border-b border-border px-2 pb-1.5 pt-1">
        <Search class="size-3.5 text-subtle-foreground" />
        <input
          type="text"
          value={search()}
          onInput={(event) => setSearch(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              focusList();
            }
          }}
          placeholder="Filter by…"
          aria-label="Search filters"
          aria-controls={listId}
          class="h-7 min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-subtle-foreground"
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

      <Show when={model().options.length > 0}>
        <VirtualPickerList
          id={listId}
          label="Filter by"
          maxHeight={292}
          rows={() => model().rows}
          optionCount={() => model().options.length}
          onActivate={(index) => {
            const field = fieldById().get(model().options[index]!.fieldId!);

            if (field) props.onPick(field);
          }}
          renderRow={(row, trackOption) => {
            if (row.fieldId === undefined)
              return (
                <p role="presentation" class="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex h-6 items-center px-2">
                  {row.group}
                </p>
              );

            const field = fieldById().get(row.fieldId);

            if (!field) return null;

            return (
              <FieldOptionRow
                id={`${listId}-option-${row.optionIndex}`}
                option={{ value: field.id, label: field.label, icon: field.icon }}
                position={row.optionIndex! + 1}
                setSize={model().options.length}
                onFocus={() => trackOption(row.optionIndex!)}
                onPointerEnter={() => trackOption(row.optionIndex!)}
                onClick={() => props.onPick(field)}
              />
            );
          }}
        />
      </Show>
      <Show when={model().options.length === 0}>
        <p class="px-2 py-6 text-center text-xs text-muted-foreground">No fields match.</p>
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
  const listId = createUniqueId();

  const options = createMemo(() => {
    const term = search().trim().toLowerCase();

    return (props.field.options ?? []).filter(
      (option) => !term || option.label.toLowerCase().includes(term),
    );
  });
  const optionById = createMemo(() => new Map(options().map((option) => [option.value, option])));
  const rows = createMemo<ReadonlyArray<FilterPickerRow>>(() =>
    options().map((option, optionIndex) => ({
      key: `${listId}-value-${optionIndex}`,
      height: FILTER_OPTION_HEIGHT,
      optionIndex,
      fieldId: option.value,
      label: option.label,
    })),
  );

  const toggle = (value: string) => {
    if (isMultiFilterValue(props.field, props.condition.operator)) {
      const next = props.condition.values.includes(value)
        ? props.condition.values.filter((item) => item !== value)
        : [...props.condition.values.filter((item) => item !== ""), value];

      props.onChange(next);

      return;
    }

    props.onChange([value]);
    props.onDone([value]);
  };

  const focusList = () => document.getElementById(listId)?.focus();

  return (
    <div>
      <Show when={(props.field.options?.length ?? 0) > 6}>
        <div class="flex items-center gap-2 border-b border-border px-2 pb-1.5 pt-1">
          <Search class="size-3.5 text-subtle-foreground" />
          <input
            type="text"
            value={search()}
            onInput={(event) => setSearch(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                focusList();
              }
            }}
            placeholder={`Search ${props.field.label.toLowerCase()}…`}
            aria-label={`Search ${props.field.label} values`}
            aria-controls={listId}
            class="h-7 min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-subtle-foreground"
          />
        </div>
      </Show>

      <Show when={options().length > 0}>
        <VirtualPickerList
          id={listId}
          label={`${props.field.label} value`}
          maxHeight={260}
          multiselectable={isMultiFilterValue(props.field, props.condition.operator)}
          rows={rows}
          optionCount={() => options().length}
          onActivate={(index) => {
            const option = options()[index];

            if (option) toggle(option.value);
          }}
          renderRow={(row, trackOption) => {
            const option = optionById().get(row.fieldId!);

            if (!option) return null;

            return (
              <FieldOptionRow
                id={`${listId}-option-${row.optionIndex}`}
                option={option}
                selected={props.condition.values.includes(option.value)}
                position={row.optionIndex! + 1}
                setSize={options().length}
                onFocus={() => trackOption(row.optionIndex!)}
                onPointerEnter={() => trackOption(row.optionIndex!)}
                onClick={() => toggle(option.value)}
              />
            );
          }}
        />
      </Show>
      <Show when={options().length === 0}>
        <p class="px-2 py-6 text-center text-xs text-muted-foreground">No values.</p>
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
    <Show
      when={props.condition.operator === "in"}
      fallback={
        <div class="p-1">
          <input
            type={inputType(props.field.kind)}
            value={props.condition.values[0] ?? ""}
            min={props.field.kind === "number" ? 0 : undefined}
            placeholder={props.field.placeholder ?? "Value"}
            aria-label={`${props.field.label} value`}
            onInput={(event) => props.onChange([event.currentTarget.value])}
            class="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none transition placeholder:text-subtle-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20"
          />
        </div>
      }
    >
      <MultiTextValueEditor {...props} />
    </Show>
  );
}

/**
 * Comma-separated editor for the `in` operator.
 *
 * The draft text is local so a trailing comma or space is not swallowed while
 * the operator is typed. Values are still emitted on every keystroke, and the
 * draft only resets when the parsed values and the parent's values diverge.
 */
function MultiTextValueEditor(props: {
  field: FilterField;
  condition: FilterCondition;
  onChange: (values: string[]) => void;
}) {
  const [draft, setDraft] = createSignal(formatFilterValues(props.condition.values));
  const [rejected, setRejected] = createSignal(false);
  const numeric = () => props.field.kind === "number";

  createEffect(
    () => props.condition.values,
    (values) => {
      if (splitFilterValues(draft()).join("\u0000") !== values.join("\u0000"))
        setDraft(formatFilterValues(values));
    },
  );

  const update = (text: string) => {
    setDraft(text);
    setRejected(false);
    props.onChange(splitFilterValues(text));
  };

  /** Commit turns a loose draft into the predicate the chip displays. */
  const commit = () => {
    const values = splitFilterValues(draft());
    const next = numeric() ? normaliseNumericFilterValues(values) : values;

    setRejected(numeric() && next.length !== values.length);
    setDraft(formatFilterValues(next));
    props.onChange(next);
  };

  return (
    <div class="p-1">
      <input
        type="text"
        inputmode={numeric() ? "decimal" : undefined}
        value={draft()}
        placeholder={props.field.placeholder ? `${props.field.placeholder}, …` : "Value, value"}
        aria-label={`${props.field.label} values`}
        aria-invalid={rejected() ? "true" : undefined}
        onInput={(event) => update(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.isComposing) {
            event.preventDefault();
            commit();
          }
        }}
        class="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none transition placeholder:text-subtle-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20"
      />
      <p class="px-1 pt-1 text-xs text-muted-foreground">
        {rejected() ? "Only numbers are kept in this filter." : "Separate values with commas."}
      </p>
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
        class="flex h-7 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-xs font-medium text-foreground outline-none hover:bg-hover focus-visible:bg-hover"
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
          class="h-7 max-w-34 appearance-none rounded-md bg-transparent py-0 pl-1.5 pr-5 text-xs text-muted-foreground outline-none hover:bg-hover focus-visible:bg-hover"
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
  const operator = (value: string) =>
    props.onChange({
      ...props.condition,
      operator: value,
      values: normaliseFilterOperatorValues(props.field, value, props.condition.values),
    });

  const done = () =>
    props.onDone({
      ...props.condition,
      values: normaliseFilterValues(props.field, props.condition.operator, props.condition.values),
    });

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
            <span class="px-1 text-xs text-subtle-foreground">Changes apply as you pick</span>
          }
        >
          <button
            type="button"
            class="flex h-6 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground outline-none hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10"
            onClick={props.onRemove}
          >
            <X class="size-3" />
            Remove filter
          </button>
        </Show>
        <Show when={props.field.kind !== "select"}>
          <button
            type="button"
            disabled={!props.condition.values.some((value) => value.trim() !== "")}
            class="h-6 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground outline-none hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-40"
            onClick={done}
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
  /**
   * A getter, not a snapshot: the condition editor must survive parent
   * updates. The bar keys chips by position so Solid never re-creates this
   * component while a value is being typed or a second enum option is ticked.
   */
  condition: () => FilterCondition;
  onChange: (condition: FilterCondition) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [view, setView] = createSignal<"condition" | "fields">("condition");

  const field = () => props.field;
  const condition = () => props.condition();
  const close = () => setOpen(false);

  const changeField = (next: FilterField) => {
    props.onChange(defaultFilter(next));
    setView("condition");
  };

  return (
    <div class="group inline-flex h-7 max-w-full items-center rounded-full border border-border bg-card pl-1.5 pr-0.5 transition-colors duration-150 ease-out hover:border-border-strong">
      <Popover
        open={open()}
        onOpenChange={(next) => {
          setOpen(next);

          if (!next) setView("condition");
        }}
        modal={false}
      >
        <PopoverTrigger
          class="flex h-full min-w-0 items-center gap-1 rounded-full pr-1 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/25"
          aria-label={`${field().label} ${filterOperatorLabel(field(), condition().operator)} ${filterValueLabel(field(), condition())}`}
        >
          <Show when={field().icon}>
            {(icon) => {
              const Icon = icon();

              return <Icon class="size-3.5 shrink-0 text-subtle-foreground" />;
            }}
          </Show>
          <span class="truncate text-muted-foreground">{field().label}</span>{" "}
          <span class="shrink-0 text-subtle-foreground">
            {filterOperatorLabel(field(), condition().operator)}
          </span>{" "}
          <span class="min-w-0 truncate font-medium text-foreground">
            {filterValueLabel(field(), condition())}
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
                condition={condition()}
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
  variant: "default" | "compact";
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
          "flex h-7 items-center gap-1.5 rounded-full border bg-card text-xs text-muted-foreground outline-none transition duration-150 ease-out hover:bg-hover hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/25",
          props.variant === "compact" ? "w-6 justify-center p-0" : "px-2.5",
          "border-border",
        )}
        aria-label={props.addLabel}
        title={props.addLabel}
      >
        <Show when={props.variant === "compact"} fallback={<FilterIcon class="size-3.5" />}>
          <Plus class="size-3.5" />
        </Show>
        <Show when={props.variant !== "compact"}>
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
                class="flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground outline-none hover:bg-hover hover:text-foreground"
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
  /**
   * Render the trigger, applied chips and children as one horizontally
   * scrollable strip for a table header. This keeps the header on one row
   * however many filters are active.
   */
  inline?: boolean;
  /**
   * A filter-adjacent control rendered with the chips, such as the device
   * table's advanced-query trigger.
   */
  filterExtra?: JSX.Element;
  /** Extra controls rendered after the filters (in the inline strip). */
  children?: JSX.Element;
};

function clearButtonClass() {
  return "flex h-7 items-center gap-1 rounded-full px-2 text-[11.5px] text-muted-foreground outline-none transition-colors duration-150 hover:bg-hover hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/25";
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

  const chips = () => (
    <For each={props.conditions} keyed={false}>
      {(condition, index) => (
        <div class="flex min-w-0 items-center gap-1.5">
          <Show when={index > 0}>
            <span class="shrink-0 text-xs text-subtle-foreground">
              {props.conjunction ?? "and"}
            </span>
          </Show>
          <Show when={fieldById(condition().field)}>
            {(field) => (
              <FilterChip
                fields={fields()}
                field={field()}
                condition={condition}
                onChange={(next) => update(index, next)}
                onRemove={() => remove(index)}
              />
            )}
          </Show>
        </div>
      )}
    </For>
  );

  const addFilter = (variant: "default" | "compact") => (
    <AddFilter
      fields={fields()}
      addLabel={props.conditions.length > 0 ? "Add filter" : (props.label ?? "Filter")}
      variant={variant}
      onCreate={(condition) => props.onChange([...props.conditions, condition])}
    />
  );

  const clear = () => (
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
  );

  if (props.inline) {
    return (
      <div
        role={props.conditions.length > 0 ? "group" : undefined}
        aria-label={props.conditions.length > 0 ? "Active filters" : undefined}
        class={cn(
          "flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-x-auto",
          props.class,
        )}
      >
        {chips()}
        {addFilter(props.conditions.length > 0 ? "compact" : "default")}
        {props.filterExtra}
        {clear()}
        {props.children}
      </div>
    );
  }

  return (
    <div class={cn("flex min-w-0 flex-wrap items-center gap-1.5", props.class)}>
      {chips()}
      {addFilter(props.conditions.length > 0 ? "compact" : "default")}
      {props.filterExtra}
      {clear()}
      {props.children}
    </div>
  );
}
