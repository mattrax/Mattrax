import { useNavigate, useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createMemo, For, Show } from "solid-js";
import { defaultOverviewWidgets } from "@mattrax/enterprise-domain";
import { Page, QueryError } from "~/components/mdm/common";
import { DashboardWidgetView } from "~/components/dashboard/widget";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Star } from "~/components/ui/icons";
import {
  enterprise,
  enterpriseKeys,
  enterpriseQueries,
  type DashboardSummary,
  type DashboardWidget,
} from "~/lib/enterprise";

const previewWidgets = (): DashboardWidget[] =>
  defaultOverviewWidgets().map((widget, index) => ({
    id: `preview-${index}`,
    type: widget.type,
    title: widget.title,
    config: widget.config,
    x: widget.x,
    y: widget.y,
    w: widget.w,
    h: widget.h,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  }));

function WidgetGrid(props: { widgets: ReadonlyArray<DashboardWidget>; tenantId: string }) {
  return (
    <div class="dashboard-grid">
      <For each={props.widgets}>
        {(widget) => (
          <article
            class="dashboard-widget flex min-h-0 flex-col rounded-lg border border-white/[0.07] bg-card p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]"
            style={{
              "grid-column": `${widget.x + 1} / span ${widget.w}`,
              "grid-row": `${widget.y + 1} / span ${widget.h}`,
            }}
          >
            <header class="px-0.5 pb-2">
              <h2 class="truncate text-[12.5px] font-medium text-foreground">{widget.title}</h2>
              <p class="truncate text-[10px] capitalize text-muted-foreground/70">
                {widget.type === "markdown"
                  ? "Markdown"
                  : `${widget.type} · ${String((widget.config as any)?.dataset ?? "devices")}`}
              </p>
            </header>
            <div class="min-h-0 flex-1 overflow-hidden">
              <DashboardWidgetView widget={widget} tenantId={props.tenantId} />
            </div>
          </article>
        )}
      </For>
    </div>
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
}) {
  return (
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Overview
        </p>
        <div class="mt-1 flex flex-wrap items-center gap-2">
          <h1 class="truncate text-[19px] font-semibold tracking-[-0.02em]">{props.name}</h1>
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
        <p class="mt-1 max-w-2xl text-[12.5px] text-muted-foreground">
          {props.description?.trim() ||
            "Shared live views of your fleet. Create a dashboard to make this page your own."}
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <Show when={props.dashboardId}>
          {(id) => (
            <Button
              as="a"
              href={`/t/${props.tenantId}/dashboards/${id()}`}
              size="sm"
              variant="outline"
            >
              Open dashboard
            </Button>
          )}
        </Show>
        <Button as="a" href={`/t/${props.tenantId}/dashboards`} size="sm" variant="ghost">
          All dashboards
        </Button>
        <Button size="sm" disabled={props.creating} onClick={props.create}>
          {props.creating ? "Creating…" : props.preview ? "Customise overview" : "New dashboard"}
        </Button>
      </div>
    </div>
  );
}

function LoadedOverview(props: {
  tenantId: string;
  summary: DashboardSummary;
  create: () => void;
  creating: boolean;
}) {
  const dashboard = useQuery(() => enterpriseQueries.dashboard(props.tenantId, props.summary.id));
  return (
    <Page class="gap-5">
      <OverviewHeader
        name={dashboard.data?.name ?? props.summary.name}
        description={dashboard.data?.description ?? props.summary.description}
        isDefault={dashboard.data?.isDefault ?? props.summary.isDefault}
        dashboardId={props.summary.id}
        tenantId={props.tenantId}
        create={props.create}
        creating={props.creating}
      />
      <QueryError error={dashboard.error} onRetry={() => void dashboard.refetch()} />
      <Show
        when={(dashboard.data?.widgets.length ?? 0) > 0}
        fallback={
          <div class="flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed border-white/[0.09] bg-white/[0.01] px-6 text-center">
            <p class="text-[13px] font-medium">This dashboard is empty</p>
            <p class="mt-1 text-[12px] text-muted-foreground">
              Add widgets from the dashboard editor to share tables, charts and notes.
            </p>
            <Button
              as="a"
              href={`/t/${props.tenantId}/dashboards/${props.summary.id}?edit=1`}
              size="sm"
              class="mt-3"
            >
              Edit dashboard
            </Button>
          </div>
        }
      >
        <WidgetGrid widgets={dashboard.data?.widgets ?? []} tenantId={props.tenantId} />
      </Show>
    </Page>
  );
}

function PreviewOverview(props: { tenantId: string; create: () => void; creating: boolean }) {
  const widgets = createMemo(previewWidgets);
  return (
    <Page class="gap-5">
      <OverviewHeader
        name="Fleet overview"
        preview
        tenantId={props.tenantId}
        create={props.create}
        creating={props.creating}
      />
      <WidgetGrid widgets={widgets()} tenantId={props.tenantId} />
      <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-white/[0.09] bg-white/[0.01] px-3.5 py-3">
        <p class="text-[12px] text-muted-foreground">
          This is the built-in overview. Create a dashboard to add widgets, write team notes and
          share a layout with everyone.
        </p>
        <Button size="sm" disabled={props.creating} onClick={props.create}>
          {props.creating ? "Creating…" : "Create from this layout"}
        </Button>
      </div>
    </Page>
  );
}

export default function TenantOverviewPage() {
  const params = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const tenantId = () => params.tenantId!;
  const dashboards = useQuery(() => enterpriseQueries.dashboards(tenantId()));

  const create = useMutation(() => ({
    mutationFn: () =>
      enterprise.createDashboard(tenantId(), { name: "Overview", template: "overview" }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: enterpriseKeys.dashboards(tenantId()) });
      navigate(`/t/${tenantId()}/dashboards/${result.id}?edit=1`);
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
          />
        }
      >
        {(summary) => (
          <LoadedOverview
            tenantId={tenantId()}
            summary={summary()}
            create={() => create.mutate()}
            creating={create.isPending}
          />
        )}
      </Show>
    </Show>
  );
}
