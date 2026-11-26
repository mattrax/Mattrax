import { Option, Schema } from "effect";
import { For, Show, createMemo } from "solid-js";
import { useDashboardWidgetBatch } from "~/components/dashboard/widget";
import { LayoutDashboard } from "~/components/ui/icons";
import type { DashboardQueryResponse, DashboardWidget } from "~/lib/enterprise";
import { cn } from "~/lib/utils";

/** The accent ramp used only in gallery previews; detail widgets keep the app's quieter chart ramp. */
const PREVIEW_COLORS = [
  "var(--brand-solid)",
  "var(--success)",
  "var(--warning)",
  "var(--info)",
] as const;

const STAT_SPARKS = [
  {
    color: "text-brand",
    points: "1,19 10,15 19,17 28,10 37,13 46,6 55,8 63,4",
  },
  {
    color: "text-success",
    points: "1,20 10,12 19,16 28,8 37,12 46,6 55,10 63,4",
  },
  {
    color: "text-info",
    points: "1,8 10,12 19,7 28,14 37,10 46,16 55,9 63,12",
  },
] as const;

const hashString = (value: string): number => {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1)
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;

  return hash;
};

const MarkdownConfig = Schema.Struct({ markdown: Schema.optional(Schema.String) });
const decodeMarkdown = Schema.decodeUnknownOption(MarkdownConfig);

const markdownOf = (config: unknown): string =>
  Option.getOrUndefined(decodeMarkdown(config))?.markdown ?? "";

const secondaryValue = (row: DashboardQueryResponse["rows"][number]): string =>
  row.version ?? row.email ?? row.platform ?? row.status ?? row.health ?? "";

/**
 * A miniature of a dashboard's first few widgets, drawn from the same batched
 * query data as the real dashboard. Cards stay readable because each widget is
 * reduced to the one shape that identifies it: a count, a donut, a few rows or
 * a note.
 */
export default function DashboardPreview(props: {
  widgets: ReadonlyArray<DashboardWidget> | undefined;
  widgetCount: number;
  class?: string;
}) {
  const widgets = createMemo(() => (props.widgets ?? []).slice(0, 3));

  const cellClass = (index: number) => {
    if (widgets().length === 1) return "col-span-6 row-span-2";
    if (widgets().length === 2) return "col-span-3 row-span-2";

    return index === 0 ? "col-span-3 row-span-2" : "col-span-3 row-span-1";
  };

  return (
    <div
      class={cn(
        "relative h-42 overflow-hidden border-b border-border bg-surface/50 p-3",
        props.class,
      )}
    >
      <Show
        when={widgets().length > 0}
        fallback={
          <div class="flex h-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/80 text-center">
            <span class="flex size-7 items-center justify-center rounded-md bg-card text-muted-foreground ring-1 ring-inset ring-border">
              <LayoutDashboard class="size-3.5" />
            </span>
            <span class="text-xs text-muted-foreground">
              {props.widgetCount > 0 ? "Preview unavailable" : "Empty dashboard"}
            </span>
          </div>
        }
      >
        <div class="grid h-full grid-cols-6 grid-rows-2 gap-2">
          <For each={widgets()}>
            {(widget, index) => (
              <div class={cn("min-h-0 min-w-0", cellClass(index()))}>
                <PreviewWidget widget={widget} />
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function PreviewWidget(props: { widget: DashboardWidget }) {
  const batchFor = useDashboardWidgetBatch({ preview: true });
  const batch = () => batchFor?.(props.widget);

  return (
    <Show
      when={props.widget.type !== "markdown"}
      fallback={<MarkdownPreview widget={props.widget} />}
    >
      <div class="relative flex h-full min-w-0 flex-col overflow-hidden rounded-lg bg-card/80 p-2.5 ring-1 ring-border/60">
        <Show
          when={!batch()?.pending}
          fallback={
            <div class="flex h-full flex-col justify-between">
              <span class="h-2 w-2/5 animate-pulse rounded-full bg-hover" />
              <span class="h-5 w-1/2 animate-pulse rounded bg-hover" />
              <span class="h-1.5 w-3/4 animate-pulse rounded-full bg-hover" />
            </div>
          }
        >
          <Show when={batch()?.data} fallback={<PreviewUnavailable />}>
            {(data) => (
              <Show
                when={props.widget.type !== "stat"}
                fallback={<StatPreview title={props.widget.title} data={data()} />}
              >
                <Show
                  when={props.widget.type !== "pie"}
                  fallback={<PiePreview title={props.widget.title} data={data()} />}
                >
                  <TablePreview title={props.widget.title} data={data()} />
                </Show>
              </Show>
            )}
          </Show>
        </Show>
      </div>
    </Show>
  );
}

function StatPreview(props: { title: string; data: DashboardQueryResponse }) {
  const spark = () => STAT_SPARKS[hashString(props.title) % STAT_SPARKS.length];

  return (
    <div class="flex h-full flex-col justify-between">
      <span class="label-caps truncate text-xs">{props.title}</span>
      <div class="flex items-end justify-between gap-2">
        <span
          data-numeric
          class="text-2xl font-semibold leading-none tracking-tighter text-foreground"
        >
          {props.data.total}
        </span>
        <svg viewBox="0 0 64 24" class={cn("h-6 w-14 shrink-0", spark().color)} aria-hidden="true">
          <polyline
            points={spark().points}
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            opacity="0.7"
          />
        </svg>
      </div>
      <span class="truncate text-xs text-muted-foreground">matching the current query</span>
    </div>
  );
}

function PiePreview(props: { title: string; data: DashboardQueryResponse }) {
  const buckets = () => props.data.buckets.slice(0, 4);
  const total = () => buckets().reduce((sum, bucket) => sum + bucket.value, 0);

  const background = () => {
    if (buckets().length === 0 || total() <= 0) return "conic-gradient(var(--border) 0deg 360deg)";
    let cursor = 0;
    const stops = buckets().map((bucket, index) => {
      const start = cursor;
      cursor += (bucket.value / total()) * 360;

      return `${PREVIEW_COLORS[index % PREVIEW_COLORS.length]} ${start}deg ${cursor}deg`;
    });

    return `conic-gradient(${stops.join(", ")})`;
  };

  return (
    <div class="flex h-full flex-col justify-between">
      <span class="label-caps truncate text-xs">{props.title}</span>
      <div class="flex min-h-0 items-center gap-2.5">
        <span
          class="relative size-11 shrink-0 rounded-full bg-(--preview-bg)"
          style={{ "--preview-bg": background() }}
          aria-hidden="true"
        >
          <span class="absolute inset-1/4 rounded-full bg-card" />
        </span>
        <div class="min-w-0 flex-1 space-y-1">
          <Show
            when={buckets().length > 0}
            fallback={<span class="text-xs text-muted-foreground">No data</span>}
          >
            <For each={buckets().slice(0, 3)}>
              {(bucket, index) => (
                <div class="flex min-w-0 items-center gap-1.5 text-xs leading-none">
                  <span
                    class="size-1.5 shrink-0 rounded-full bg-(--preview-bg)"
                    style={{ "--preview-bg": PREVIEW_COLORS[index() % PREVIEW_COLORS.length] }}
                  />
                  <span class="min-w-0 flex-1 truncate text-muted-foreground">{bucket.label}</span>
                  <span class="shrink-0 tabular-nums text-foreground">{bucket.value}</span>
                </div>
              )}
            </For>
          </Show>
        </div>
      </div>
    </div>
  );
}

function TablePreview(props: { title: string; data: DashboardQueryResponse }) {
  return (
    <div class="flex h-full min-h-0 flex-col gap-1">
      <span class="label-caps truncate text-xs">{props.title}</span>
      <Show
        when={props.data.rows.length > 0}
        fallback={<span class="text-xs text-muted-foreground">No rows match this query.</span>}
      >
        <div class="flex min-h-0 flex-1 flex-col justify-between gap-0.5">
          <For each={props.data.rows.slice(0, 3)}>
            {(row) => (
              <div class="flex min-w-0 items-center gap-2 text-xs leading-tight">
                <span class="min-w-0 flex-1 truncate font-medium text-foreground">{row.name}</span>
                <span class="max-w-2/5 shrink-0 truncate text-muted-foreground">
                  {secondaryValue(row)}
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function MarkdownPreview(props: { widget: DashboardWidget }) {
  const lines = createMemo(() =>
    markdownOf(props.widget.config)
      .split("\n")
      .map((line) => line.replace(/^#+\s*/, "").trim())
      .filter(Boolean)
      .slice(0, 3),
  );

  return (
    <div class="flex h-full min-w-0 flex-col gap-1 overflow-hidden rounded-lg bg-card/80 p-2.5 ring-1 ring-border/60">
      <span class="label-caps truncate text-xs">{props.widget.title}</span>
      <Show
        when={lines().length > 0}
        fallback={<span class="text-xs text-muted-foreground">Empty note</span>}
      >
        <p class="line-clamp-1 text-xs font-medium leading-snug text-foreground">{lines()[0]}</p>
        <p class="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {lines().slice(1).join(" ")}
        </p>
      </Show>
    </div>
  );
}

function PreviewUnavailable() {
  return (
    <div class="flex h-full flex-col items-center justify-center gap-1 text-center">
      <span class="text-xs text-muted-foreground">Preview unavailable</span>
    </div>
  );
}
