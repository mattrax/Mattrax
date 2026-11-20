import { DeviceCondition, DeviceQuery } from "@mattrax/enterprise-domain/client";
import {
  FilterBar,
  type FilterCondition,
  type FilterField,
  type FilterOperator,
} from "@mattrax/ui";
import { Match, Option, Schema } from "effect";
import { createEffect, createSignal, Show } from "solid-js";
import { Activity, Laptop, RefreshCw, ShieldCheck, SlidersHorizontal } from "~/components/ui/icons";
import { Input } from "~/components/ui/input";
import { formatDeviceQueryText, parseDeviceQueryText } from "~/lib/enterprise";

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
      { value: "missing", label: "MIA (missing)" },
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
    id: "activation",
    label: "Windows activation",
    kind: "select",
    defaultOp: "eq",
    defaultValue: "not-activated",
    options: [
      { value: "activated", label: "Activated" },
      { value: "not-activated", label: "Not activated" },
      { value: "unknown", label: "Unknown" },
    ],
    ops: [
      { value: "eq", label: "is" },
      { value: "ne", label: "is not" },
    ],
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

/**
 * Conditions on the directory people linked to a device.
 *
 * They are only offered by the dynamic-group rule builder: a device table has
 * no linked-user data, and the evaluator deliberately fails these conditions
 * when `users` is undefined rather than sweeping every device into a `ne` rule.
 *
 * A device matches a positive condition when **any** linked user matches; `is
 * not` means **no** linked user matches. A device with no linked users matches
 * no positive condition and satisfies `is not`.
 */
export const USER_QUERY_FIELDS: ReadonlyArray<FieldDefinition> = [
  {
    id: "userEmail",
    label: "User email",
    kind: "text",
    defaultOp: "contains",
    defaultValue: "",
    ops: textOps,
  },
  {
    id: "userDomain",
    label: "User email domain",
    kind: "text",
    defaultOp: "eq",
    defaultValue: "",
    ops: textOps,
  },
  {
    id: "userName",
    label: "User display name",
    kind: "text",
    defaultOp: "contains",
    defaultValue: "",
    ops: textOps,
  },
  {
    id: "userExternalId",
    label: "User external id",
    kind: "text",
    defaultOp: "eq",
    defaultValue: "",
    ops: textOps,
  },
  {
    id: "userSource",
    label: "Identity provider",
    kind: "select",
    defaultOp: "eq",
    defaultValue: "entra",
    options: [
      { value: "entra", label: "Microsoft Entra ID" },
      { value: "google", label: "Google Workspace" },
      { value: "scim", label: "SCIM directory" },
      { value: "manual", label: "Local / manual" },
    ],
    ops: [
      { value: "eq", label: "is" },
      { value: "ne", label: "is not" },
    ],
  },
];

const fieldById = (id: string, fields: ReadonlyArray<FieldDefinition> = QUERY_FIELDS) =>
  fields.find((field) => field.id === id) ?? fields[0]!;

type Draft = { field: string; op: string; value: string };

/** Build a typed condition from the generic editor values. */
export const draftToCondition = (
  draft: Draft,
  fields: ReadonlyArray<FieldDefinition> = QUERY_FIELDS,
): DeviceCondition => {
  const field = fieldById(draft.field, fields);
  const value = field.kind === "number" ? Number(draft.value || 0) : draft.value;

  const condition = Option.getOrUndefined(
    Schema.decodeUnknownOption(DeviceCondition)({
      field: field.id,
      op: draft.op || field.defaultOp,
      value,
    }),
  );

  if (condition === undefined)
    throw new Error(`The query builder produced an invalid ${field.id} condition`);

  return condition;
};

export const queryConditions = (
  query: DeviceQuery | null | undefined,
): ReadonlyArray<DeviceCondition> => query?.all ?? [];

const fieldIcons = {
  platform: Laptop,
  status: Activity,
  health: ShieldCheck,
  activation: ShieldCheck,
  staleDays: RefreshCw,
  enrolledDays: RefreshCw,
  application: SlidersHorizontal,
  osEdition: SlidersHorizontal,
} satisfies Partial<Record<string, typeof Activity>>;

const filterFieldsFor = (fields: ReadonlyArray<FieldDefinition>): FilterField[] =>
  fields.map((field) => ({
    id: field.id,
    label: field.label,
    group: field.id.startsWith("user") ? "Directory user" : "Device",
    // SAFETY: every id comes from either QUERY_FIELDS or USER_QUERY_FIELDS, the
    // only two sources of fields passed to this mapper; the icon map is partial
    // and an unmapped id yields `undefined`, which FilterField permits.
    icon: fieldIcons[field.id as keyof typeof fieldIcons],
    kind: field.kind,
    options: field.options,
    operators: field.ops.map<FilterOperator>((op) => ({ value: op.value, label: op.label })),
    defaultOperator: field.defaultOp,
    defaultValue: field.defaultValue || undefined,
    placeholder: Match.value(field.id).pipe(
      Match.when("osVersion", () => "14.4"),
      Match.when("application", () => "com.apple.Safari"),
      Match.when("userEmail", () => "person@example.com"),
      Match.when("userDomain", () => "example.com"),
      Match.when("userName", () => "Alex Doe"),
      Match.orElse(() => "Value"),
    ),
  }));

const deviceFilterFields = filterFieldsFor(QUERY_FIELDS);

const toFilterConditions = (
  query: DeviceQuery | null | undefined,
  fields: ReadonlyArray<FieldDefinition> = QUERY_FIELDS,
): FilterCondition[] =>
  (query?.all ?? []).map((condition) => ({
    field: condition.field,
    operator: condition.op ?? fieldById(condition.field, fields).defaultOp,
    values:
      condition.value === undefined || condition.value === "" ? [] : [String(condition.value)],
  }));

const toDeviceCondition = (
  condition: FilterCondition,
  fields: ReadonlyArray<FieldDefinition>,
): DeviceCondition =>
  draftToCondition(
    {
      field: condition.field,
      op: condition.operator,
      value: condition.values[0] ?? "",
    },
    fields,
  );

/** The condition editor shared by device tables, dynamic groups and widgets. */
export function DeviceQueryBuilder(props: {
  query: DeviceQuery | null | undefined;
  onChange: (query: DeviceQuery | null) => void;
  disabled?: boolean;
  compact?: boolean;
  /** Explain that a software widget filters the devices that reported apps. */
  dataset?: "devices" | "software" | "users";
  /**
   * Offer conditions on the device's linked directory people. Only the
   * dynamic-group builder sets this; device tables have no user data.
   */
  includeUserConditions?: boolean;
}) {
  const fields = () =>
    props.includeUserConditions ? [...QUERY_FIELDS, ...USER_QUERY_FIELDS] : QUERY_FIELDS;

  const update = (conditions: FilterCondition[]) => {
    const all = conditions.map((condition) => toDeviceCondition(condition, fields()));
    const any = props.query?.any ?? [];
    const none = props.query?.none ?? [];

    if (all.length === 0 && any.length === 0 && none.length === 0) {
      props.onChange(null);

      return;
    }

    props.onChange({ version: 1, all, any, none });
  };

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
    <div class={props.compact ? "space-y-2" : "space-y-3"}>
      <Show when={!props.compact}>
        <div class="flex flex-wrap items-center gap-2">
          <p class="text-[12.5px] font-medium text-foreground">Match devices</p>
          <span class="rounded-full border border-border bg-surface px-2 py-0.5 text-[10.5px] text-muted-foreground">
            all conditions
          </span>
        </div>
      </Show>

      <Show
        when={
          props.dataset === "software" && toFilterConditions(props.query, fields()).length === 0
        }
      >
        <p class="text-[11.5px] leading-relaxed text-muted-foreground">
          Every installed application reported by the fleet is included until you filter devices.
        </p>
      </Show>

      <FilterBar
        fields={props.includeUserConditions ? filterFieldsFor(fields()) : deviceFilterFields}
        conditions={toFilterConditions(props.query, fields())}
        onChange={update}
        label="Filter devices"
        disabled={props.disabled}
      />

      <details class="group">
        <summary class="flex w-fit cursor-pointer list-none items-center gap-1 rounded-md px-1 py-0.5 text-[11px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30">
          <span class="transition-transform duration-[var(--duration-hover)] group-open:rotate-90">
            ›
          </span>
          Edit as text
        </summary>
        <div class="mt-1.5 space-y-1">
          <Input
            id="device-query-text"
            class="h-8 font-mono text-[11.5px]"
            disabled={props.disabled}
            value={text()}
            placeholder="platform is apple and staleDays at least 14"
            onInput={(event) => setText(event.currentTarget.value)}
            onBlur={applyText}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.isComposing) {
                event.preventDefault();
                applyText();
              }
            }}
          />
          <p class="text-[10.5px] text-muted-foreground">
            Shareable syntax: <code class="font-mono">field operator value</code>, joined with{" "}
            <code class="font-mono">and</code>.
          </p>
        </div>
      </details>
    </div>
  );
}
