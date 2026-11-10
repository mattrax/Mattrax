import { For, Show } from "solid-js";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import type { DynamicGroupCondition, DynamicGroupRules } from "~/lib/enterprise";

const FIELD_OPTIONS = [
  ["platform", "Platform"],
  ["osVersion", "OS version"],
  ["model", "Model"],
  ["serial", "Serial"],
  ["assetTag", "Asset tag"],
  ["staleDays", "Days since check-in"],
  ["health", "Health"],
] as const;

type RuleField = (typeof FIELD_OPTIONS)[number][0];

const OPS: Record<RuleField, Array<[string, string]>> = {
  platform: [["eq", "is"]],
  osVersion: [
    ["eq", "is"],
    ["lt", "older than"],
    ["lte", "at most"],
    ["gt", "newer than"],
    ["gte", "at least"],
  ],
  model: [
    ["contains", "contains"],
    ["eq", "is"],
  ],
  serial: [
    ["prefix", "starts with"],
    ["eq", "is"],
  ],
  assetTag: [
    ["prefix", "starts with"],
    ["eq", "is"],
  ],
  staleDays: [
    ["gte", "at least"],
    ["gt", "more than"],
    ["eq", "exactly"],
    ["lte", "at most"],
    ["lt", "less than"],
  ],
  health: [["eq", "is"]],
};

export type RuleDraft = { field: RuleField; op: string; value: string };

const defaultDraft = (field: RuleField): RuleDraft => {
  switch (field) {
    case "platform":
      return { field, op: "eq", value: "apple" };
    case "osVersion":
      return { field, op: "gte", value: "" };
    case "model":
      return { field, op: "contains", value: "" };
    case "serial":
      return { field, op: "prefix", value: "" };
    case "assetTag":
      return { field, op: "prefix", value: "" };
    case "staleDays":
      return { field, op: "gte", value: "14" };
    case "health":
      return { field, op: "eq", value: "attention" };
  }
};

/**
 * The dashboard edits the `all` list (AND). `any`/`none` lists written through
 * the API are preserved verbatim so opening the builder cannot silently change
 * a rule set created elsewhere.
 */
export const rulesToDrafts = (rules: DynamicGroupRules | null | undefined): RuleDraft[] =>
  (rules?.all ?? []).map((condition) => ({
    field: condition.field as RuleField,
    op:
      condition.op ??
      (condition.field === "staleDays"
        ? "gte"
        : condition.field === "model"
          ? "contains"
          : condition.field === "serial" || condition.field === "assetTag"
            ? "prefix"
            : "eq"),
    value: String(condition.value),
  }));

const toCondition = (draft: RuleDraft): DynamicGroupCondition => {
  if (draft.field === "staleDays")
    return {
      field: "staleDays",
      op: draft.op as "lt" | "lte" | "gt" | "gte" | "eq",
      value: Number(draft.value),
    } as DynamicGroupCondition;
  switch (draft.field) {
    case "platform":
      return {
        field: "platform",
        op: "eq",
        value: draft.value as "apple" | "win" | "android",
      } as DynamicGroupCondition;
    case "osVersion":
      return {
        field: "osVersion",
        op: draft.op as "lt" | "lte" | "gt" | "gte" | "eq",
        value: draft.value,
      } as DynamicGroupCondition;
    case "model":
      return {
        field: "model",
        op: draft.op as "contains" | "eq",
        value: draft.value,
      } as DynamicGroupCondition;
    case "serial":
      return {
        field: "serial",
        op: draft.op as "prefix" | "eq",
        value: draft.value,
      } as DynamicGroupCondition;
    case "assetTag":
      return {
        field: "assetTag",
        op: draft.op as "prefix" | "eq",
        value: draft.value,
      } as DynamicGroupCondition;
    case "health":
      return {
        field: "health",
        op: "eq",
        value: draft.value as "healthy" | "attention" | "critical" | "unknown",
      } as DynamicGroupCondition;
  }
};

export const draftsToRules = (
  drafts: ReadonlyArray<RuleDraft>,
  previous?: DynamicGroupRules | null,
): DynamicGroupRules => ({
  version: 1,
  ...(previous?.any ? { any: previous.any } : {}),
  ...(previous?.none ? { none: previous.none } : {}),
  all: drafts.map(toCondition),
});

export function GroupRuleBuilder(props: {
  rules: DynamicGroupRules | null | undefined;
  onChange: (rules: DynamicGroupRules) => void;
  disabled?: boolean;
}) {
  const drafts = () => rulesToDrafts(props.rules);
  const update = (next: RuleDraft[]) => props.onChange(draftsToRules(next, props.rules));

  return (
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <p class="text-sm font-medium">Match devices</p>
          <Badge variant="secondary">all conditions</Badge>
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
          <p class="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            Add at least one condition. A dynamic group with no conditions matches no devices.
          </p>
        }
      >
        <div class="space-y-2">
          <For each={drafts()}>
            {(draft, index) => (
              <div class="flex flex-wrap items-center gap-2 rounded-lg border p-2">
                <select
                  class="rounded border bg-white px-2 py-1 text-sm disabled:opacity-50"
                  disabled={props.disabled}
                  value={draft.field}
                  onChange={(event) => {
                    const field = event.currentTarget.value as RuleField;
                    const next = [...drafts()];
                    next[index()] = defaultDraft(field);
                    update(next);
                  }}
                >
                  <For each={FIELD_OPTIONS}>
                    {([value, label]) => <option value={value}>{label}</option>}
                  </For>
                </select>
                <select
                  class="rounded border bg-white px-2 py-1 text-sm disabled:opacity-50"
                  disabled={props.disabled}
                  value={draft.op}
                  onChange={(event) => {
                    const next = [...drafts()];
                    next[index()] = { ...draft, op: event.currentTarget.value };
                    update(next);
                  }}
                >
                  <For each={OPS[draft.field]}>
                    {([value, label]) => <option value={value}>{label}</option>}
                  </For>
                </select>
                <Show
                  when={draft.field === "platform"}
                  fallback={
                    <Show
                      when={draft.field === "health"}
                      fallback={
                        <Input
                          class="h-8 w-40"
                          type={draft.field === "staleDays" ? "number" : "text"}
                          min={draft.field === "staleDays" ? 0 : undefined}
                          disabled={props.disabled}
                          placeholder={
                            draft.field === "osVersion"
                              ? "14.4"
                              : draft.field === "staleDays"
                                ? "14"
                                : "Value"
                          }
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
                        class="rounded border bg-white px-2 py-1 text-sm disabled:opacity-50"
                        disabled={props.disabled}
                        value={draft.value}
                        onChange={(event) => {
                          const next = [...drafts()];
                          next[index()] = { ...draft, value: event.currentTarget.value };
                          update(next);
                        }}
                      >
                        <option value="healthy">healthy</option>
                        <option value="attention">attention</option>
                        <option value="critical">critical</option>
                        <option value="unknown">unknown</option>
                      </select>
                    </Show>
                  }
                >
                  <select
                    class="rounded border bg-white px-2 py-1 text-sm disabled:opacity-50"
                    disabled={props.disabled}
                    value={draft.value}
                    onChange={(event) => {
                      const next = [...drafts()];
                      next[index()] = { ...draft, value: event.currentTarget.value };
                      update(next);
                    }}
                  >
                    <option value="apple">Apple</option>
                    <option value="win">Windows</option>
                    <option value="android">Android</option>
                  </select>
                </Show>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  class="ml-auto"
                  disabled={props.disabled}
                  onClick={() => update(drafts().filter((_, position) => position !== index()))}
                >
                  Remove
                </Button>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.rules?.any?.length || props.rules?.none?.length}>
        <p class="text-xs text-muted-foreground">
          This group also has OR/NOT conditions created through the API. They are preserved when you
          save but can only be edited through the API.
        </p>
      </Show>
    </div>
  );
}
