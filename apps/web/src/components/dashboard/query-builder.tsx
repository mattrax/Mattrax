import { createEffect, createSignal, For, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  formatDeviceQueryText,
  parseDeviceQueryText,
  type DeviceCondition,
  type DeviceQuery,
} from "~/lib/enterprise";
import { cn } from "~/lib/utils";

type FieldKind = "text" | "number" | "select";

type FieldOption = { value: string; label: string };

type FieldDefinition = {
  id: string;
  label: string;
  kind: FieldKind;
  defaultOp: string;
  defaultValue: string;
  options?: ReadonlyArray<FieldOption>;
  ops: ReadonlyArray<FieldOption>;
};

const textOps = [
  { value: "contains", label: "contains" },
  { value: "eq", label: "is" },
  { value: "ne", label: "is not" },
  { value: "prefix", label: "starts with" },
];

const numberOps = [
  { value: "gte", label: "at least" },
  { value: "gt", label: "more than" },
  { value: "lte", label: "at most" },
  { value: "lt", label: "less than" },
  { value: "eq", label: "exactly" },
];

const versionOps = [
  { value: "eq", label: "is" },
  { value: "gte", label: "at least" },
  { value: "gt", label: "newer than" },
  { value: "lte", label: "at most" },
  { value: "lt", label: "older than" },
];

export const QUERY_FIELDS: ReadonlyArray<FieldDefinition> = [
  {
    id: "platform",
    label: "Platform",
    kind: "select",
    defaultOp: "eq",
    defaultValue: "apple",
    options: [
      { value: "apple", label: "Apple" },
      { value: "win", label: "Windows" },
      { value: "android", label: "Android" },
    ],
    ops: [
      { value: "eq", label: "is" },
      { value: "ne", label: "is not" },
    ],
  },
  {
    id: "osVersion",
    label: "OS version",
    kind: "text",
    defaultOp: "gte",
    defaultValue: "",
    ops: versionOps,
  },
  {
    id: "name",
    label: "Name",
    kind: "text",
    defaultOp: "contains",
    defaultValue: "",
    ops: textOps,
  },
  {
    id: "model",
    label: "Model",
    kind: "text",
    defaultOp: "contains",
    defaultValue: "",
    ops: textOps,
  },
  {
    id: "serial",
    label: "Serial",
    kind: "text",
    defaultOp: "prefix",
    defaultValue: "",
    ops: textOps,
  },
  {
    id: "assetTag",
    label: "Asset tag",
    kind: "text",
    defaultOp: "prefix",
    defaultValue: "",
    ops: textOps,
  },
  {
    id: "status",
    label: "Status",
    kind: "select",
    defaultOp: "eq",
    defaultValue: "enrolled",
    options: [
      { value: "enrolled", label: "Enrolled" },
      { value: "enrolling", label: "Enrolling" },
      { value: "unenrolling", label: "Unenrolling" },
      { value: "unenrolled", label: "Unenrolled" },
    ],
    ops: [
      { value: "eq", label: "is" },
      { value: "ne", label: "is not" },
    ],
  },
  {
    id: "health",
    label: "Health",
    kind: "select",
    defaultOp: "eq",
    defaultValue: "attention",
    options: [
      { value: "healthy", label: "Healthy" },
      { value: "attention", label: "Attention" },
      { value: "critical", label: "Critical" },
      { value: "unknown", label: "Unknown" },
      { value: "stale", label: "Stale" },
    ],
    ops: [
      { value: "eq", label: "is" },
      { value: "ne", label: "is not" },
    ],
  },
  {
    id: "fileVault",
    label: "FileVault",
    kind: "select",
    defaultOp: "eq",
    defaultValue: "enabled",
    options: [
      { value: "enabled", label: "Enabled" },
      { value: "disabled", label: "Disabled" },
      { value: "unknown", label: "Unknown" },
    ],
    ops: [{ value: "eq", label: "is" }],
  },
  {
    id: "staleDays",
    label: "Days since check-in",
    kind: "number",
    defaultOp: "gte",
    defaultValue: "14",
    ops: numberOps,
  },
  {
    id: "enrolledDays",
    label: "Days since enrollment",
    kind: "number",
    defaultOp: "gte",
    defaultValue: "30",
    ops: numberOps,
  },
  {
    id: "osEdition",
    label: "OS edition",
    kind: "text",
    defaultOp: "contains",
    defaultValue: "",
    ops: textOps,
  },
  {
    id: "batteryHealth",
    label: "Battery health",
    kind: "text",
    defaultOp: "contains",
    defaultValue: "",
    ops: textOps,
  },
  {
    id: "application",
    label: "Application",
    kind: "text",
    defaultOp: "has",
    defaultValue: "",
    ops: [
      { value: "has", label: "has installed" },
      { value: "lacks", label: "doesn't have" },
    ],
  },
];

const fieldById = (id: string) => QUERY_FIELDS.find((field) => field.id === id) ?? QUERY_FIELDS[0]!;

type Draft = { field: string; op: string; value: string };

const toDraft = (condition: DeviceCondition): Draft => ({
  field: condition.field,
  op: condition.op ?? fieldById(condition.field).defaultOp,
  value: String(condition.value),
});

const defaultDraft = (fieldId: string): Draft => {
  const field = fieldById(fieldId);
  return { field: field.id, op: field.defaultOp, value: field.defaultValue };
};

/** Build a typed condition from the generic editor values. */
export const draftToCondition = (draft: Draft): DeviceCondition => {
  const field = fieldById(draft.field);
  const value =
    field.kind === "number"
      ? Number(draft.value || 0)
      : field.kind === "select"
        ? draft.value
        : draft.value;
  return {
    field: field.id,
    op: draft.op || field.defaultOp,
    value,
  } as unknown as DeviceCondition;
};

export const queryConditions = (
  query: DeviceQuery | null | undefined,
): ReadonlyArray<DeviceCondition> => query?.all ?? [];

export function DeviceQueryBuilder(props: {
  query: DeviceQuery | null | undefined;
  onChange: (query: DeviceQuery | null) => void;
  disabled?: boolean;
  compact?: boolean;
  /** Explain that a software widget filters the devices that reported apps. */
  dataset?: "devices" | "software";
}) {
  const drafts = () => queryConditions(props.query).map(toDraft);
  const update = (next: Draft[]) =>
    props.onChange(
      next.length
        ? {
            version: 1,
            all: next.map(draftToCondition),
            ...(props.query?.any ? { any: props.query.any } : {}),
            ...(props.query?.none ? { none: props.query.none } : {}),
          }
        : null,
    );

  const [text, setText] = createSignal(formatDeviceQueryText(props.query));
  createEffect(
    () => props.query,
    (query) => {
      setText(formatDeviceQueryText(query));
    },
  );
  const applyText = () => {
    const parsed = parseDeviceQueryText(text());
    props.onChange(parsed);
    setText(formatDeviceQueryText(parsed));
  };

  return (
    <div class={cn("space-y-3", props.compact && "space-y-2")}>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <p class="text-[12.5px] font-medium text-foreground">Match devices</p>
          <span class="rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[10.5px] text-muted-foreground">
            all conditions
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={props.disabled}
          onClick={() => update([...drafts(), defaultDraft("platform")])}
        >
          Add condition
        </Button>
      </div>

      <Show
        when={drafts().length > 0}
        fallback={
          <p class="rounded-lg border border-dashed border-white/[0.09] p-3 text-[12px] text-muted-foreground">
            {props.dataset === "software"
              ? "No device filter. Every installed application reported by the fleet is included."
              : "No conditions yet. This matches every device."}
          </p>
        }
      >
        <div class={cn("space-y-2", props.compact && "space-y-1.5")}>
          <For each={drafts()}>
            {(draft, index) => {
              const field = () => fieldById(draft.field);
              return (
                <div class="flex flex-wrap items-center gap-1.5 rounded-lg border border-white/[0.07] bg-white/[0.02] p-1.5">
                  <select
                    aria-label="Condition field"
                    class="h-8 min-w-0 rounded-md border border-input bg-background px-2 text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50"
                    disabled={props.disabled}
                    value={draft.field}
                    onChange={(event) => {
                      const next = [...drafts()];
                      next[index()] = defaultDraft(event.currentTarget.value);
                      update(next);
                    }}
                  >
                    <For each={QUERY_FIELDS}>
                      {(option) => <option value={option.id}>{option.label}</option>}
                    </For>
                  </select>
                  <select
                    aria-label="Condition operator"
                    class="h-8 min-w-0 rounded-md border border-input bg-background px-2 text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50"
                    disabled={props.disabled}
                    value={draft.op}
                    onChange={(event) => {
                      const next = [...drafts()];
                      next[index()] = { ...draft, op: event.currentTarget.value };
                      update(next);
                    }}
                  >
                    <For each={field().ops}>
                      {(option) => <option value={option.value}>{option.label}</option>}
                    </For>
                  </select>
                  <Show
                    when={field().kind === "select"}
                    fallback={
                      <Input
                        aria-label="Condition value"
                        class="h-8 w-44 min-w-0 flex-1"
                        type={field().kind === "number" ? "number" : "text"}
                        min={field().kind === "number" ? 0 : undefined}
                        placeholder={
                          field().id === "osVersion"
                            ? "14.4"
                            : field().id === "application"
                              ? "com.apple.Safari"
                              : "Value"
                        }
                        disabled={props.disabled}
                        value={draft.value}
                        onInput={(event) => {
                          const next = [...drafts()];
                          next[index()] = { ...draft, value: event.currentTarget.value };
                          update(next);
                        }}
                      />
                    }
                  >
                    <select
                      aria-label="Condition value"
                      class="h-8 min-w-0 rounded-md border border-input bg-background px-2 text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50"
                      disabled={props.disabled}
                      value={draft.value}
                      onChange={(event) => {
                        const next = [...drafts()];
                        next[index()] = { ...draft, value: event.currentTarget.value };
                        update(next);
                      }}
                    >
                      <For each={field().options ?? []}>
                        {(option) => <option value={option.value}>{option.label}</option>}
                      </For>
                    </select>
                  </Show>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    class="ml-auto text-muted-foreground"
                    aria-label={`Remove ${field().label} condition`}
                    disabled={props.disabled}
                    onClick={() => update(drafts().filter((_, position) => position !== index()))}
                  >
                    Remove
                  </Button>
                </div>
              );
            }}
          </For>
        </div>
      </Show>

      <div class="space-y-1">
        <label class="text-[11px] font-medium text-muted-foreground" for="device-query-text">
          Query text
        </label>
        <Input
          id="device-query-text"
          class="h-8 font-mono text-[11.5px]"
          disabled={props.disabled}
          value={text()}
          placeholder="platform is apple and staleDays at least 14"
          onInput={(event) => setText(event.currentTarget.value)}
          onBlur={applyText}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              applyText();
            }
          }}
        />
        <p class="text-[11px] text-muted-foreground/80">
          Shareable syntax: <code class="font-mono">field operator value</code>, joined with{" "}
          <code class="font-mono">and</code>.
        </p>
      </div>
    </div>
  );
}
