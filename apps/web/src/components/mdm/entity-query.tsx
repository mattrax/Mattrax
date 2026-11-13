import { createEffect, createSignal, For, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";

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

const opsFor = (field: EntityField<unknown> | undefined) =>
  field?.kind === "number" ? numberOps : field?.kind === "select" ? selectOps : textOps;

const defaultFor = <T,>(field: EntityField<T>): EntityCondition => ({
  field: field.id,
  op: field.kind === "number" ? "at least" : field.kind === "select" ? "is" : "contains",
  value:
    field.kind === "select"
      ? (field.options?.[0]?.value ?? "")
      : field.kind === "number"
        ? "1"
        : "",
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
    if (!opsFor(field as EntityField<unknown>).some((option) => option.value === op)) continue;
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
      const actual = typeof raw === "number" ? raw : Number(raw ?? 0);
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

export function EntityQueryBar<T>(props: {
  fields: ReadonlyArray<EntityField<T>>;
  conditions: ReadonlyArray<EntityCondition>;
  onChange: (conditions: EntityCondition[]) => void;
}) {
  const [text, setText] = createSignal(formatEntityQuery(props.conditions));
  createEffect(
    () => props.conditions,
    (conditions) => {
      setText(formatEntityQuery(conditions));
    },
  );
  const fieldsById = (id: string) => props.fields.find((field) => field.id === id);
  const applyText = () => {
    const parsed = parseEntityQuery(text(), props.fields);
    props.onChange(parsed);
    setText(formatEntityQuery(parsed));
  };

  return (
    <Show
      when={props.conditions.length > 0}
      fallback={
        <div class="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => {
              const field = props.fields[0];
              if (field) props.onChange([defaultFor(field)]);
            }}
          >
            Filter
          </Button>
          <span class="text-[10.5px] text-muted-foreground/70">
            Add conditions to narrow this table. The query is stored in the URL.
          </span>
        </div>
      }
    >
      <div class="space-y-2 rounded-lg border border-white/[0.07] bg-white/[0.015] p-2.5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="text-[11.5px] font-medium text-muted-foreground">Match every condition</p>
          <div class="flex items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => {
                const field = props.fields[0];
                if (field) props.onChange([...props.conditions, defaultFor(field)]);
              }}
            >
              Add condition
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => {
                props.onChange([]);
                setText("");
              }}
            >
              Clear
            </Button>
          </div>
        </div>
        <div class="space-y-1.5">
          <For each={props.conditions}>
            {(condition, index) => {
              const field = () => fieldsById(condition.field) ?? props.fields[0];
              return (
                <div class="flex flex-wrap items-center gap-1.5">
                  <select
                    aria-label="Filter field"
                    class="h-8 rounded-md border border-input bg-background px-2 text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                    value={condition.field}
                    onChange={(event) => {
                      const next = [...props.conditions];
                      const selected = props.fields.find(
                        (item) => item.id === event.currentTarget.value,
                      );
                      if (selected) next[index()] = defaultFor(selected);
                      props.onChange(next);
                    }}
                  >
                    <For each={props.fields}>
                      {(item) => <option value={item.id}>{item.label}</option>}
                    </For>
                  </select>
                  <select
                    aria-label="Filter operator"
                    class="h-8 rounded-md border border-input bg-background px-2 text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                    value={condition.op}
                    onChange={(event) => {
                      const next = [...props.conditions];
                      next[index()] = { ...condition, op: event.currentTarget.value };
                      props.onChange(next);
                    }}
                  >
                    <For each={opsFor(field() as EntityField<unknown>)}>
                      {(item) => <option value={item.value}>{item.label}</option>}
                    </For>
                  </select>
                  <Show
                    when={field()?.kind === "select"}
                    fallback={
                      <Input
                        aria-label="Filter value"
                        class="h-8 w-40"
                        type={field()?.kind === "number" ? "number" : "text"}
                        value={condition.value}
                        onInput={(event) => {
                          const next = [...props.conditions];
                          next[index()] = {
                            ...condition,
                            value: event.currentTarget.value,
                          };
                          props.onChange(next);
                        }}
                      />
                    }
                  >
                    <select
                      aria-label="Filter value"
                      class="h-8 rounded-md border border-input bg-background px-2 text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                      value={condition.value}
                      onChange={(event) => {
                        const next = [...props.conditions];
                        next[index()] = { ...condition, value: event.currentTarget.value };
                        props.onChange(next);
                      }}
                    >
                      <For each={field()?.options ?? []}>
                        {(item) => <option value={item.value}>{item.label}</option>}
                      </For>
                    </select>
                  </Show>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    class="ml-auto text-muted-foreground"
                    onClick={() =>
                      props.onChange(props.conditions.filter((_, position) => position !== index()))
                    }
                  >
                    Remove
                  </Button>
                </div>
              );
            }}
          </For>
        </div>
        <div class="space-y-1">
          <label class="text-[11px] font-medium text-muted-foreground" for="entity-query-text">
            Query text
          </label>
          <Input
            id="entity-query-text"
            class="h-8 font-mono text-[11.5px]"
            value={text()}
            placeholder={`${props.fields[0]?.id ?? "name"} contains value`}
            onInput={(event) => setText(event.currentTarget.value)}
            onBlur={applyText}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyText();
              }
            }}
          />
        </div>
      </div>
    </Show>
  );
}
