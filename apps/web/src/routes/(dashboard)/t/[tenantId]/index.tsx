import { useTenantParam } from "~/lib/route-params";
import { useNavigate } from "~/lib/navigation";
import { Option, Schema } from "effect";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createMemo, For, Show } from "solid-js";
import { defaultOverviewWidgets } from "@mattrax/enterprise-domain/client";
import {
  EmptyState as UIEmptyState,
  Page,
  PageActions,
  PageDescription,
  PageHeader,
  PageHeaderBody,
  PageTitle,
} from "@mattrax/ui";
import { ErrorText, QueryError } from "~/components/mdm/common";
import { MigrationBanner } from "~/components/migration-banner";
import { MissingDevicesBanner } from "~/components/missing-devices-banner";
import { OnboardingChecklist } from "~/components/onboarding-checklist";
import { SoftwareUpdatesBanner } from "~/components/software-updates-banner";
import { OsComplianceSummary } from "~/components/os-compliance-summary";
import {
  DashboardWidgetBatchProvider,
  DashboardWidgetView,
  useDashboardWidgetBatch,
} from "~/components/dashboard/widget";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Star } from "~/components/ui/icons";
import { cn } from "~/lib/utils";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";
import type { DashboardSummary, DashboardWidget } from "~/lib/enterprise";
import { useCan } from "~/lib/permissions";
import { routes } from "~/lib/routes";
import { preloadPage } from "~/lib/page-data";
import { queryClient } from "~/lib/query-client";

/** Preview widgets share the built-in layout, but stat, chart, table and note
 * rows are capped so an empty fleet never leaves a page-tall blank surface. */
function previewHeight(type: string): number | undefined {
  if (type === "stat") return 2;

  if (type === "pie" || type === "table") return 4;

  if (type === "markdown") return 2;

  return undefined;
}

const previewWidgets = (): DashboardWidget[] => {
  const widgets = defaultOverviewWidgets().map((widget, index) => ({
    id: `preview-${index}`,
    type: widget.type,
    title: widget.title,
    config: widget.config,
    x: widget.x,
    y: widget.y,
    w: widget.w,
    h: Math.min(widget.h, previewHeight(widget.type) ?? widget.h),
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  }));

  // Capping a row's height leaves a hole unless the rows below move up. Walk
  // the original bands in order and re-stack them at their capped heights.
  const bands = [...new Set(widgets.map((widget) => widget.y))].sort((a, b) => a - b);
  let cursor = 0;

  for (const band of bands) {
    const rows = widgets.filter((widget) => widget.y === band);

    for (const widget of rows) widget.y = cursor;
    cursor += Math.max(...rows.map((widget) => widget.h));
  }

  return widgets;
};

/** A quiet monochrome ramp for widget charts, scoped to the overview. The
 * design system intentionally leaves the chart slots to the page. */
const chartRamp = {
  "--chart-1": "var(--foreground)",
  "--chart-2": "color-mix(in oklab, var(--foreground) 62%, var(--background))",
  "--chart-3": "color-mix(in oklab, var(--foreground) 42%, var(--background))",
  "--chart-4": "color-mix(in oklab, var(--foreground) 26%, var(--background))",
  "--chart-5": "color-mix(in oklab, var(--foreground) 14%, var(--background))",
};

function WidgetGrid(props: { widgets: ReadonlyArray<DashboardWidget>; tenantId: string }) {
  return (
    <DashboardWidgetBatchProvider widgets={props.widgets} tenantId={props.tenantId}>
      <div class="dashboard-grid min-[901px]:[grid-auto-rows:56px]" style={chartRamp}>
        <For each={props.widgets}>
          {(widget) => {
            const batchFor = useDashboardWidgetBatch();

            return (
              <article
                class={cn(
                  "dashboard-widget flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card p-3.5 shadow-card",
                  `dashboard-widget-${widget.type}`,
                  // Stat widgets are rendered by the shared widget view; on the
                  // overview they follow the design system's compact metric scale.
                  widget.type === "stat" &&
                    "[&_p.tabular-nums]:text-[19px] [&_p.tabular-nums]:font-[560] [&_p.tabular-nums]:tracking-[-0.025em]",
                )}
                style={{
                  "grid-column": `${widget.x + 1} / span ${widget.w}`,
                  "grid-row": `${widget.y + 1} / span ${widget.h}`,
                }}
              >
                <header class="px-0.5 pb-2">
                  <h2 class="truncate text-[12.5px] font-[500] text-foreground">{widget.title}</h2>
                  <Show when={widget.type !== "stat"}>
                    <p class="truncate text-[10px] capitalize text-subtle-foreground">
                      {widget.type === "markdown"
                        ? "Markdown"
                        : `${widget.type} · ${String(
                            Option.getOrUndefined(
                              Schema.decodeUnknownOption(
                                Schema.Struct({ dataset: Schema.optional(Schema.Json) }),
                              )(widget.config),
                            )?.dataset ?? "devices",
                          )}`}
                    </p>
                  </Show>
                </header>
                <div class="min-h-0 flex-1 overflow-hidden">
                  <DashboardWidgetView
                    widget={widget}
                    tenantId={props.tenantId}
                    batch={batchFor?.(widget)}
                  />
                </div>
              </article>
            );
          }}
        </For>
      </div>
    </DashboardWidgetBatchProvider>
  );
}

function OverviewHeader(props: {
  name: string;
  description?: string | null;
  isDefault?: boolean;
  preview?: boolean;
  dashboardId?: string;
  tenantId: string;
  create: () => void;
  creating: boolean;
  error?: unknown;
}) {
  const { can } = useCan();

  return (
    <>
      <PageHeader class="gap-3 border-0 pb-0">
        <PageHeaderBody>
          <div class="label-caps mb-1.5">Overview</div>
          <div class="flex flex-wrap items-center gap-2">
            <PageTitle class="text-[21px] font-[560] tracking-[-0.026em]">{props.name}</PageTitle>
            <Show when={props.isDefault}>
              <Badge variant="secondary" class="gap-1">
                <Star class="size-3" />
                Default
              </Badge>
            </Show>
            <Show when={props.preview}>
              <Badge variant="outline">Built-in preview</Badge>
            </Show>
          </div>
          <PageDescription class="mt-1 max-w-2xl text-[12.5px] leading-5">
            {props.description?.trim() ||
              "Shared live views of your fleet. Create a dashboard to make this page your own."}
          </PageDescription>
        </PageHeaderBody>
        <PageActions>
          <Show when={props.dashboardId}>
            {(id) => (
              <Button
                as="a"
                href={routes.tenant(props.tenantId).dashboard(id())}
                size="sm"
                variant="outline"
              >
                Open dashboard
              </Button>
            )}
          </Show>
          <Button
            as="a"
            href={routes.tenant(props.tenantId).dashboards()}
            size="sm"
            variant="ghost"
          >
            All dashboards
          </Button>
          <Show when={can("dashboards.write")}>
            <Button size="sm" disabled={props.creating} onClick={props.create}>
              {props.creating
                ? "Creating…"
                : props.preview
                  ? "Customise overview"
                  : "New dashboard"}
            </Button>
          </Show>
        </PageActions>
      </PageHeader>
      <Show when={props.error}>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <ErrorText error={props.error} />
          <Show when={can("dashboards.write")}>
            <Button
              size="xs"
              variant="outline"
              disabled={props.creating}
              onClick={() => props.create()}
            >
              Try again
            </Button>
          </Show>
        </div>
      </Show>
    </>
  );
}

function LoadedOverview(props: {
  tenantId: string;
  summary: DashboardSummary;
  create: () => void;
  creating: boolean;
  error?: unknown;
}) {
  const dashboard = useQuery(() => enterpriseQueries.dashboard(props.tenantId, props.summary.id));
  const { can } = useCan();

  return (
    <Page class="dashboard-reveal gap-5">
      <OverviewHeader
        name={dashboard.data?.name ?? props.summary.name}
        description={dashboard.data?.description ?? props.summary.description}
        isDefault={dashboard.data?.isDefault ?? props.summary.isDefault}
        dashboardId={props.summary.id}
        tenantId={props.tenantId}
        create={props.create}
        creating={props.creating}
        error={props.error}
      />
      <MigrationBanner tenantId={props.tenantId} />
      <MissingDevicesBanner tenantId={props.tenantId} />
      <SoftwareUpdatesBanner tenantId={props.tenantId} />
      <OnboardingChecklist tenantId={props.tenantId} />
      <OsComplianceSummary tenantId={props.tenantId} />
      <QueryError error={dashboard.error} onRetry={() => void dashboard.refetch()} />
      <Show
        when={(dashboard.data?.widgets.length ?? 0) > 0}
        fallback={
          <UIEmptyState
            class="py-10"
            title="This dashboard is empty"
            description="Add widgets from the dashboard editor to share tables, charts and notes."
            action={
              <Show when={can("dashboards.write")}>
                <Button
                  as="a"
                  href={routes.tenant(props.tenantId).dashboard(props.summary.id, { edit: "1" })}
                  size="sm"
                >
                  Edit dashboard
                </Button>
              </Show>
            }
          />
        }
      >
        <WidgetGrid widgets={dashboard.data?.widgets ?? []} tenantId={props.tenantId} />
      </Show>
    </Page>
  );
}

function PreviewOverview(props: {
  tenantId: string;
  create: () => void;
  creating: boolean;
  error?: unknown;
}) {
  const widgets = createMemo(previewWidgets);
  const { can } = useCan();

  return (
    <Page class="dashboard-reveal gap-5">
      <OverviewHeader
        name="Fleet overview"
        preview
        tenantId={props.tenantId}
        create={props.create}
        creating={props.creating}
        error={props.error}
      />
      <MigrationBanner tenantId={props.tenantId} />
      <MissingDevicesBanner tenantId={props.tenantId} />
      <SoftwareUpdatesBanner tenantId={props.tenantId} />
      <OnboardingChecklist tenantId={props.tenantId} />
      <OsComplianceSummary tenantId={props.tenantId} />
      <WidgetGrid widgets={widgets()} tenantId={props.tenantId} />
      <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-border-strong bg-card px-3.5 py-3">
        <p class="text-[12px] text-muted-foreground">
          This is the built-in overview. Create a dashboard to add widgets, write team notes and
          share a layout with everyone.
        </p>
        <Show when={can("dashboards.write")}>
          <Button size="sm" disabled={props.creating} onClick={props.create}>
            {props.creating ? "Creating…" : "Create from this layout"}
          </Button>
        </Show>
      </div>
    </Page>
  );
}

export const route = {
  preload: ({ params, intent }: { params: { tenantId?: string }; intent: string }) => {
    const tenantId = params.tenantId;

    if (intent === "initial" || !tenantId) return;

    return preloadPage([() => queryClient.ensureQueryData(enterpriseQueries.dashboards(tenantId))]);
  },
};

export default function TenantOverviewPage() {
  const tenant = useTenantParam();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const tenantId = () => tenant()!;
  const dashboards = useQuery(() => enterpriseQueries.dashboards(tenantId()));

  const create = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: () =>
      enterprise.createDashboard(tenantId(), { name: "Overview", template: "overview" }),
    onSuccess: (result) => {
      // Navigate before the refresh settles: awaiting the invalidation keeps
      // the mutation pending and the route never changes.
      void queryClient.invalidateQueries({ queryKey: enterpriseKeys.dashboards(tenantId()) });
      navigate(routes.tenant(tenantId()).dashboard(result.id, { edit: "1" }));
    },
  }));

  const selected = () =>
    dashboards.data?.dashboards.find((dashboard) => dashboard.isDefault) ??
    dashboards.data?.dashboards[0];

  return (
    <Show
      when={dashboards.data}
      fallback={
        <Show
          when={!dashboards.error}
          fallback={
            <Page>
              <QueryError error={dashboards.error} onRetry={() => void dashboards.refetch()} />
            </Page>
          }
        >
          <PreviewOverview
            tenantId={tenantId()}
            create={() => create.mutate()}
            creating={create.isPending}
            error={create.error}
          />
        </Show>
      }
    >
      <Show
        when={selected()}
        fallback={
          <PreviewOverview
            tenantId={tenantId()}
            create={() => create.mutate()}
            creating={create.isPending}
            error={create.error}
          />
        }
      >
        {(summary) => (
          <LoadedOverview
            tenantId={tenantId()}
            summary={summary()}
            create={() => create.mutate()}
            creating={create.isPending}
            error={create.error}
          />
        )}
      </Show>
    </Show>
  );
}
