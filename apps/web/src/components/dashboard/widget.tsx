import { useQueries, useQuery } from "@tanstack/solid-query";
import type {
  DashboardQueryRequest,
  DashboardQueryResponse,
  DashboardQueryRow,
} from "@mattrax/enterprise-domain/client";
import { dashboardQueryForWidget, DeviceQuery } from "@mattrax/enterprise-domain/client";
import { Match, Option, Schema } from "effect";
import { For, Show, createContext, createMemo, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import { isServer } from "@solidjs/web";
import { relativeTime } from "~/components/mdm/common";
import { Markdown } from "~/components/dashboard/markdown";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";
import type { DashboardWidget } from "~/lib/enterprise";
import { cn } from "~/lib/utils";
import { errorPresentation, raisedFailure } from "~/lib/errors";

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-2)",
  "var(--violet-9)",
  "var(--blue-11)",
  "var(--green-11)",
];

const QueryConfig = Schema.Struct({
  dataset: Schema.optional(Schema.Literals(["devices", "software", "users"])),
  query: Schema.optional(DeviceQuery),
  label: Schema.optional(Schema.String),
  dimension: Schema.optional(Schema.String),
  columns: Schema.optional(Schema.Array(Schema.String)),
  limit: Schema.optional(Schema.Number),
});

type QueryConfig = typeof QueryConfig.Type;

const MarkdownConfig = Schema.Struct({ markdown: Schema.optional(Schema.String) });

const decodeQueryConfig = Schema.decodeUnknownOption(QueryConfig);

const decodeMarkdownConfig = Schema.decodeUnknownOption(MarkdownConfig);

const isString = Schema.is(Schema.String);

const isNumber = Schema.is(Schema.Number);

const isBoolean = Schema.is(Schema.Boolean);

const configOf = (widget: DashboardWidget): QueryConfig =>
  Option.getOrUndefined(decodeQueryConfig(widget.config)) ?? {};

const markdownOf = (widget: DashboardWidget): string =>
  Option.getOrUndefined(decodeMarkdownConfig(widget.config))?.markdown ?? "";

const DEVICE_COLUMNS = new Map([
  ["name", "Name"],
  ["platform", "Platform"],
  ["osVersion", "OS"],
  ["status", "Status"],
  ["health", "Health"],
  ["lastSeenAt", "Last seen"],
  ["enrolledAt", "Enrolled"],
  ["model", "Model"],
  ["serial", "Serial"],
]);

const SOFTWARE_COLUMNS = new Map([
  ["name", "Application"],
  ["version", "Version"],
  ["managed", "Managed"],
  ["deviceCount", "Devices"],
  ["bundleId", "Bundle ID"],
]);

const USER_COLUMNS = new Map([
  ["name", "Name"],
  ["email", "Email"],
  ["status", "Status"],
  ["source", "Source"],
]);

const columnsFor = (dataset: string | undefined) => {
  if (dataset === "software") return SOFTWARE_COLUMNS;

  if (dataset === "users") return USER_COLUMNS;

  return DEVICE_COLUMNS;
};

const defaultColumns = (dataset: string | undefined) => {
  if (dataset === "software") return ["name", "version", "managed", "deviceCount"];

  if (dataset === "users") return ["name", "email", "status", "source"];

  return ["name", "platform", "osVersion", "status", "health", "lastSeenAt"];
};

const datasetNoun = (dataset: string | undefined) =>
  Match.value(dataset).pipe(
    Match.when("software", () => "applications"),
    Match.when("users", () => "users"),
    Match.orElse(() => "devices"),
  );

const datasetCaption = (dataset: string | undefined) =>
  Match.value(dataset).pipe(
    Match.when("software", () => "matching installed software"),
    Match.when("users", () => "matching the directory filter"),
    Match.orElse(() => "matching the current query"),
  );

const datasetRowsLabel = (dataset: string | undefined) =>
  Match.value(dataset).pipe(
    Match.when("software", () => "Applications"),
    Match.when("users", () => "Users"),
    Match.orElse(() => "Devices"),
  );

const healthClass = (value: string | null | undefined) =>
  Match.value(value).pipe(
    Match.when("healthy", () => "text-success"),
    Match.when("attention", () => "text-warning"),
    Match.when("missing", () => "text-info"),
    Match.when("critical", () => "text-destructive"),
    Match.orElse(() => "text-muted-foreground"),
  );

const platformLabel = (value: string | null | undefined) =>
  Match.value(value).pipe(
    Match.when("apple", () => "Apple"),
    Match.when("win", () => "Windows"),
    Match.when("android", () => "Android"),
    Match.orElse((platform) => platform ?? "—"),
  );

const cellValue = (row: DashboardQueryRow, column: string, dataset: string | undefined) => {
  if (column === "platform") return platformLabel(row.platform);

  if (column === "managed")
    return isBoolean(row.managed) ? (row.managed ? "Managed" : "Unmanaged") : "—";

  if (column === "lastSeenAt") return isString(row.lastSeenAt) ? relativeTime(row.lastSeenAt) : "—";

  if (column === "enrolledAt") return isString(row.enrolledAt) ? relativeTime(row.enrolledAt) : "—";

  if (column === "health")
    return (
      <span class={cn("capitalize", healthClass(row.health))}>
        {isString(row.health) ? row.health : "Unknown"}
      </span>
    );

  if (column === "status")
    return <span class="capitalize">{isString(row.status) ? row.status : "—"}</span>;

  if (column === "deviceCount") return isNumber(row.deviceCount) ? row.deviceCount : "—";

  if (column === "name" && dataset === "software")
    return (
      <span class="block min-w-0">
        <span class="block truncate font-medium text-foreground">{row.name}</span>
        <Show when={isString(row.bundleId)}>
          <span class="block max-w-[28ch] truncate font-mono text-[10.5px] text-muted-foreground">
            {row.bundleId}
          </span>
        </Show>
      </span>
    );

  const value = {
    name: row.name,
    osVersion: row.osVersion,
    model: row.model,
    serial: row.serial,
    version: row.version,
    bundleId: row.bundleId,
    email: row.email,
    source: row.source,
  }[column];

  if (value === null || value === undefined || value === "") return "—";

  return String(value);
};

/**
 * The exact request a widget sends; shared with the page-level batch, the
 * dashboard export and the scheduled report renderer.
 */
export const dashboardWidgetQueryRequest = (widget: DashboardWidget): DashboardQueryRequest =>
  dashboardQueryForWidget(widget);

type DashboardWidgetBatch = {
  readonly data: DashboardQueryResponse | undefined;
  readonly pending: boolean;
  readonly error: unknown;
  readonly retry: () => void;
};

type DashboardWidgetBatchLookup = (widget: DashboardWidget) => DashboardWidgetBatch | undefined;

/** The API caps one batch at 24 queries; extra widgets go in another request. */
const DASHBOARD_BATCH_LIMIT = 24;

const DashboardWidgetBatchContext = createContext<DashboardWidgetBatchLookup>();

/**
 * Fetch every widget on a dashboard with one request.
 *
 * The provider is rendered only once the dashboard itself has loaded, so its
 * query options read a resolved widget list. Reading a pending async value
 * from a query's options is not allowed (TanStack reads them untracked).
 */
export function DashboardWidgetBatchProvider(props: {
  widgets: ReadonlyArray<DashboardWidget>;
  tenantId: string;
  children?: JSX.Element;
}) {
  const queried = createMemo(() =>
    props.widgets.filter((widget) => widget.type !== "markdown").map(dashboardWidgetQueryRequest),
  );

  const chunks = createMemo(() => {
    const requests = queried();
    const groups: DashboardQueryRequest[][] = [];

    for (let index = 0; index < requests.length; index += DASHBOARD_BATCH_LIMIT)
      groups.push(requests.slice(index, index + DASHBOARD_BATCH_LIMIT));

    return groups;
  });

  const batches = useQueries(() => ({
    queries: chunks().map((queries) => ({
      queryKey: enterpriseKeys.dashboardQueryBatch(props.tenantId, queries),
      queryFn: () => enterprise.queryDashboardBatch(props.tenantId, queries),
      enabled: queries.length > 0,
    })),
  }));

  const batchIndex = createMemo(
    () =>
      new Map(
        props.widgets
          .filter((widget) => widget.type !== "markdown")
          .map((widget, index) => [widget.id, index] as const),
      ),
  );

  const batchFor: DashboardWidgetBatchLookup = (widget) => {
    const index = batchIndex().get(widget.id);

    if (index === undefined) return undefined;

    const chunk = Math.floor(index / DASHBOARD_BATCH_LIMIT);
    const offset = index % DASHBOARD_BATCH_LIMIT;
    const batch = () => batches[chunk];

    return {
      get data() {
        return batch()?.data?.results[offset];
      },
      get pending() {
        return batch()?.isPending ?? true;
      },
      get error() {
        return batch()?.error;
      },
      retry: () => void batch()?.refetch(),
    };
  };

  return (
    <DashboardWidgetBatchContext value={batchFor}>{props.children}</DashboardWidgetBatchContext>
  );
}

/** The shared batch lookup; present only inside the provider. */
export const useDashboardWidgetBatch = () => useContext(DashboardWidgetBatchContext);

export function DashboardWidgetView(props: {
  widget: DashboardWidget;
  tenantId: string;
  /** Present when the page fetched every widget with one batched request. */
  batch?: DashboardWidgetBatch;
}) {
  const config = () => configOf(props.widget);
  const dataset = () => config().dataset ?? "devices";
  const queryRequest = () => dashboardWidgetQueryRequest(props.widget);

  const columns = () => {
    const configured = config().columns;

    return configured && configured.length > 0 ? configured : defaultColumns(dataset());
  };

  const result = useQuery(() => ({
    queryKey: enterpriseKeys.dashboardQuery(props.tenantId, queryRequest()),
    queryFn: () => enterprise.queryDashboard(props.tenantId, queryRequest()),
    enabled: !isServer && !props.batch && props.widget.type !== "markdown",
  }));

  const data = () => props.batch?.data ?? result.data;
  const pending = () => props.batch?.pending ?? result.isPending;
  const error = () => props.batch?.error ?? result.error;
  const retry = () => (props.batch ? props.batch.retry() : void result.refetch());

  return (
    <Show
      when={props.widget.type !== "markdown"}
      fallback={<Markdown content={markdownOf(props.widget)} />}
    >
      <Show
        when={!pending()}
        fallback={
          <div
            role="status"
            aria-label="Loading widget data"
            class="h-16 animate-pulse rounded-lg bg-surface"
          />
        }
      >
        <Show
          when={!error()}
          fallback={
            <div class="rounded-lg border border-destructive/20 bg-destructive/[0.05] p-3 text-[11.5px]">
              <p class="font-medium text-destructive">
                {errorPresentation(raisedFailure(error())).title}
              </p>
              <p class="mt-0.5 text-muted-foreground">
                {errorPresentation(raisedFailure(error())).message}
              </p>
              <button
                type="button"
                class="mt-2 rounded border border-border px-2 py-1 text-[10.5px] text-foreground transition-[color,background-color,border-color] duration-[var(--duration-hover)] ease-swift hover:border-border-strong hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                onClick={() => retry()}
              >
                Try again
              </button>
            </div>
          }
        >
          <Show when={data()}>
            {(data) => (
              <Show
                when={props.widget.type !== "stat"}
                fallback={
                  <div class="flex h-full flex-col justify-center">
                    <p class="text-[30px] font-semibold leading-none tracking-[-0.04em] tabular-nums text-foreground">
                      {data().total}
                    </p>
                    <p class="mt-1.5 text-[11px] text-muted-foreground">
                      {config().label ?? datasetNoun(dataset())}
                    </p>
                    <p class="mt-0.5 text-[10.5px] text-muted-foreground">
                      {datasetCaption(dataset())}
                    </p>
                  </div>
                }
              >
                <Show
                  when={props.widget.type !== "pie"}
                  fallback={<PieBuckets buckets={data().buckets} total={data().total} />}
                >
                  <Show
                    when={data().rows.length > 0}
                    fallback={
                      <div class="flex h-full items-center justify-center text-[11.5px] text-muted-foreground">
                        No rows match this query.
                      </div>
                    }
                  >
                    <div class="overflow-x-auto" aria-busy={pending() ? "true" : undefined}>
                      <table class="w-full text-[11.5px]">
                        <caption class="sr-only">
                          {datasetRowsLabel(dataset())} matching this widget
                        </caption>
                        <thead class="text-left text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground">
                          <tr>
                            <For each={columns()}>
                              {(column) => (
                                <th scope="col" class="whitespace-nowrap px-1.5 py-1.5 font-medium">
                                  {columnsFor(dataset()).get(column) ?? column}
                                </th>
                              )}
                            </For>
                          </tr>
                        </thead>
                        <tbody class="divide-y divide-border">
                          <For each={data().rows}>
                            {(row) => (
                              <tr class="transition-colors duration-[var(--duration-hover)] ease-swift hover:bg-hover">
                                <For each={columns()}>
                                  {(column) => (
                                    <td class="max-w-[24ch] px-1.5 py-1.5 text-muted-foreground">
                                      {cellValue(row, column, dataset())}
                                    </td>
                                  )}
                                </For>
                              </tr>
                            )}
                          </For>
                        </tbody>
                      </table>
                    </div>
                    <p role="status" class="mt-1.5 text-[10px] text-muted-foreground">
                      {data().rows.length} of {data().total} rows
                    </p>
                  </Show>
                </Show>
              </Show>
            )}
          </Show>
        </Show>
      </Show>
    </Show>
  );
}

function PieBuckets(props: {
  buckets: ReadonlyArray<{ label: string; value: number }>;
  total: number;
}) {
  const slices = createMemo(() => {
    const total = props.buckets.reduce((sum, bucket) => sum + bucket.value, 0);

    if (total <= 0) return [];
    let offset = 0;

    return props.buckets.map((bucket, index) => {
      const start = (offset / total) * 100;
      offset += bucket.value;
      const end = (offset / total) * 100;

      return { ...bucket, start, end, color: CHART_COLORS[index % CHART_COLORS.length] };
    });
  });

  const gradient = () =>
    slices()
      .map((slice) => `${slice.color} ${slice.start}% ${slice.end}%`)
      .join(", ");

  return (
    <Show
      when={props.buckets.length > 0}
      fallback={
        <div class="flex h-full items-center justify-center text-[11.5px] text-muted-foreground">
          No data to chart.
        </div>
      }
    >
      <div class="flex h-full flex-wrap items-center gap-4">
        <div
          class="relative size-28 shrink-0 rounded-full"
          style={{
            background: `conic-gradient(${gradient()})`,
          }}
          role="img"
          aria-label={props.buckets.map((bucket) => `${bucket.label}: ${bucket.value}`).join(", ")}
        >
          <div class="absolute inset-[18%] flex flex-col items-center justify-center rounded-full bg-card">
            <span class="text-[18px] font-semibold leading-none tabular-nums">{props.total}</span>
            <span class="mt-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
              total
            </span>
          </div>
        </div>
        <div class="min-w-0 flex-1 space-y-1.5">
          <For each={slices()}>
            {(slice) => (
              <div class="flex items-center gap-2 text-[11px]">
                <span
                  class="size-2 shrink-0 rounded-full"
                  style={{ "background-color": slice.color }}
                  aria-hidden="true"
                />
                <span class="min-w-0 flex-1 truncate text-muted-foreground">{slice.label}</span>
                <span class="tabular-nums text-foreground">{slice.value}</span>
              </div>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}
