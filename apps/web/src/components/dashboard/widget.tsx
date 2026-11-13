import { useQuery } from "@tanstack/solid-query";
import { For, Show, createMemo } from "solid-js";
import { isServer } from "@solidjs/web";
import { relativeTime } from "~/components/mdm/common";
import { Markdown } from "~/components/dashboard/markdown";
import {
  enterprise,
  enterpriseKeys,
  type DashboardWidget,
  type DeviceQuery,
} from "~/lib/enterprise";
import { cn } from "~/lib/utils";

const CHART_COLORS = [
  "var(--brand)",
  "var(--success)",
  "var(--warning)",
  "var(--destructive)",
  "oklch(0.68 0.14 250)",
  "oklch(0.7 0.12 330)",
  "oklch(0.72 0.12 160)",
  "oklch(0.75 0.12 80)",
];

type QueryConfig = {
  dataset?: "devices" | "software";
  query?: DeviceQuery;
  label?: string;
  dimension?: string;
  columns?: ReadonlyArray<string>;
  limit?: number;
};

const configOf = (widget: DashboardWidget): QueryConfig =>
  typeof widget.config === "object" && widget.config !== null ? (widget.config as QueryConfig) : {};

const DEVICE_COLUMNS: Record<string, string> = {
  name: "Name",
  platform: "Platform",
  osVersion: "OS",
  status: "Status",
  health: "Health",
  lastSeenAt: "Last seen",
  enrolledAt: "Enrolled",
  model: "Model",
  serial: "Serial",
};

const SOFTWARE_COLUMNS: Record<string, string> = {
  name: "Application",
  version: "Version",
  managed: "Managed",
  deviceCount: "Devices",
  bundleId: "Bundle ID",
};

const defaultColumns = (dataset: string | undefined) =>
  dataset === "software"
    ? ["name", "version", "managed", "deviceCount"]
    : ["name", "platform", "osVersion", "status", "health", "lastSeenAt"];

const healthClass = (value: string | null | undefined) =>
  value === "healthy"
    ? "text-success"
    : value === "attention"
      ? "text-warning"
      : value === "critical"
        ? "text-destructive"
        : "text-muted-foreground";

const platformLabel = (value: string | null | undefined) =>
  value === "apple"
    ? "Apple"
    : value === "win"
      ? "Windows"
      : value === "android"
        ? "Android"
        : (value ?? "—");

const cellValue = (row: Record<string, unknown>, column: string, dataset: string | undefined) => {
  const value = row[column];
  if (column === "platform") return platformLabel(value as string | null);
  if (column === "managed") return value === true ? "Managed" : value === false ? "Unmanaged" : "—";
  if (column === "lastSeenAt" || column === "enrolledAt")
    return value ? relativeTime(String(value)) : "—";
  if (column === "health")
    return (
      <span class={cn("capitalize", healthClass(value as string | null))}>
        {typeof value === "string" ? value : "Unknown"}
      </span>
    );
  if (column === "status")
    return <span class="capitalize">{typeof value === "string" ? value : "—"}</span>;
  if (column === "deviceCount") return typeof value === "number" ? value : "—";
  if (column === "name" && dataset === "software")
    return (
      <span class="block min-w-0">
        <span class="block truncate font-medium text-foreground">{String(value ?? "—")}</span>
        <Show when={typeof row.bundleId === "string"}>
          <span class="block max-w-[28ch] truncate font-mono text-[10.5px] text-muted-foreground">
            {String(row.bundleId)}
          </span>
        </Show>
      </span>
    );
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
};

export function DashboardWidgetView(props: { widget: DashboardWidget; tenantId: string }) {
  const config = () => configOf(props.widget);
  const dataset = () => config().dataset ?? "devices";
  const query = createMemo(() => config().query ?? { all: [] });
  const queryRequest = (groupBy?: string, limit?: number) => ({
    dataset: dataset(),
    query: query(),
    ...(groupBy ? { groupBy } : {}),
    ...(limit ? { limit } : {}),
  });
  const result = useQuery(() => ({
    queryKey: enterpriseKeys.dashboardQuery(
      props.tenantId,
      queryRequest(config().dimension, config().limit),
    ),
    queryFn: () =>
      enterprise.queryDashboard(props.tenantId, queryRequest(config().dimension, config().limit)),
    enabled: !isServer && props.widget.type !== "markdown",
  }));

  return (
    <Show
      when={props.widget.type !== "markdown"}
      fallback={
        <Markdown
          content={String((props.widget.config as { markdown?: string })?.markdown ?? "")}
        />
      }
    >
      <Show
        when={!result.isPending}
        fallback={<div class="h-16 animate-pulse rounded-lg bg-white/[0.04]" />}
      >
        <Show
          when={!result.error}
          fallback={
            <div class="rounded-lg border border-destructive/20 bg-destructive/[0.05] p-3 text-[11.5px] text-destructive">
              This query could not run. Check the dashboard settings.
            </div>
          }
        >
          <Show when={result.data}>
            {(data) => (
              <Show
                when={props.widget.type !== "stat"}
                fallback={
                  <div class="flex h-full flex-col justify-center">
                    <p class="text-[30px] font-semibold leading-none tracking-[-0.04em] tabular-nums text-foreground">
                      {data().total}
                    </p>
                    <p class="mt-1.5 text-[11px] text-muted-foreground">
                      {config().label ?? (dataset() === "software" ? "applications" : "devices")}
                    </p>
                    <p class="mt-0.5 text-[10.5px] text-muted-foreground/70">
                      {dataset() === "software"
                        ? "matching installed software"
                        : "matching the current query"}
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
                    <div class="overflow-x-auto">
                      <table class="w-full text-[11.5px]">
                        <thead class="text-left text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground/80">
                          <tr>
                            <For
                              each={
                                config().columns?.length
                                  ? config().columns!
                                  : defaultColumns(dataset())
                              }
                            >
                              {(column) => (
                                <th class="whitespace-nowrap px-1.5 py-1.5 font-medium">
                                  {(dataset() === "software" ? SOFTWARE_COLUMNS : DEVICE_COLUMNS)[
                                    column
                                  ] ?? column}
                                </th>
                              )}
                            </For>
                          </tr>
                        </thead>
                        <tbody class="divide-y divide-white/[0.05]">
                          <For each={data().rows}>
                            {(row) => (
                              <tr class="hover:bg-white/[0.025]">
                                <For
                                  each={
                                    config().columns?.length
                                      ? config().columns!
                                      : defaultColumns(dataset())
                                  }
                                >
                                  {(column) => (
                                    <td class="max-w-[24ch] px-1.5 py-1.5 text-muted-foreground">
                                      {cellValue(
                                        row as unknown as Record<string, unknown>,
                                        column,
                                        dataset(),
                                      )}
                                    </td>
                                  )}
                                </For>
                              </tr>
                            )}
                          </For>
                        </tbody>
                      </table>
                    </div>
                    <p class="mt-1.5 text-[10px] text-muted-foreground/70">
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
      return { ...bucket, start, end, color: CHART_COLORS[index % CHART_COLORS.length]! };
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
