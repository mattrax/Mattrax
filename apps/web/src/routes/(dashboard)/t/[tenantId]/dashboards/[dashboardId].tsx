import { useNavigate, useParams, useSearchParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import { ErrorText, Page, QueryError, relativeTime } from "~/components/mdm/common";
import { DashboardWidgetView } from "~/components/dashboard/widget";
import { DeviceQueryBuilder } from "~/components/dashboard/query-builder";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { GripVertical, Plus, Star, X } from "~/components/ui/icons";
import { Input } from "~/components/ui/input";
import {
  enterprise,
  enterpriseKeys,
  enterpriseQueries,
  type DashboardWidget,
  type DashboardWidgetType,
  type DeviceQuery,
} from "~/lib/enterprise";
import { errorMessage } from "~/lib/errors";
import { cn } from "~/lib/utils";

type Layout = { x: number; y: number; w: number; h: number };

type Draft = {
  type: DashboardWidgetType;
  title: string;
  config: Record<string, any>;
};

const rowHeight = 64;
const gap = 12;

const defaultConfig = (type: DashboardWidgetType): Record<string, any> => {
  if (type === "markdown")
    return {
      markdown:
        "## Team notes\n\nAdd context, links and images here.\n\n- [Mattrax docs](/docs/)\n- Status page: https://status.otbeaumont.me",
    };

  if (type === "pie") return { dataset: "devices", query: { all: [] }, dimension: "platform" };

  if (type === "stat") return { dataset: "devices", query: { all: [] }, label: "devices" };

  return {
    dataset: "devices",
    query: { all: [] },
    columns: ["name", "platform", "osVersion", "status", "health", "lastSeenAt"],
    limit: 10,
  };
};

const deviceDimensions = [
  ["platform", "Platform"],
  ["health", "Health"],
  ["status", "Status"],
  ["osVersion", "OS version"],
  ["model", "Model"],
  ["fileVault", "FileVault"],
  ["enrolledDays", "Enrollment age"],
  ["staleDays", "Check-in age"],
  ["osEdition", "OS edition"],
  ["batteryHealth", "Battery health"],
] as const;

const softwareDimensions = [
  ["managed", "Managed"],
  ["updates", "Update state"],
  ["name", "Application"],
] as const;

const deviceColumns = [
  ["name", "Name"],
  ["platform", "Platform"],
  ["osVersion", "OS"],
  ["status", "Status"],
  ["health", "Health"],
  ["lastSeenAt", "Last seen"],
  ["enrolledAt", "Enrolled"],
  ["model", "Model"],
  ["serial", "Serial"],
] as const;

const softwareColumns = [
  ["name", "Application"],
  ["version", "Version"],
  ["managed", "Managed"],
  ["deviceCount", "Devices"],
  ["bundleId", "Bundle ID"],
] as const;

const overlaps = (left: Layout, right: Layout) =>
  left.x < right.x + right.w &&
  left.x + left.w > right.x &&
  left.y < right.y + right.h &&
  left.y + left.h > right.y;

/**
 * Push widgets down until a move or resize no longer overlaps them. Keeping
 * this client-side makes drag feedback instant; only the final positions are
 * persisted, and only for widgets that actually changed.
 */
const resolveLayout = (
  input: Record<string, Layout>,
  priorityId?: string,
): Record<string, Layout> => {
  const placed: Record<string, Layout> = {};

  const ordered = Object.entries(input).sort(([leftId, left], [rightId, right]) => {
    if (leftId === priorityId) return -1;

    if (rightId === priorityId) return 1;

    return left.y - right.y || left.x - right.x;
  });

  for (const [id, layout] of ordered) {
    let next = { ...layout };

    for (let guard = 0; guard < 100; guard++) {
      const blockers = Object.entries(placed).filter(([, other]) => overlaps(next, other));

      if (blockers.length === 0) break;
      next = {
        ...next,
        y: Math.max(...blockers.map(([, other]) => other.y + other.h)),
      };
    }

    placed[id] = next;
  }

  return placed;
};

const clampLayout = (layout: Layout, mode: "move" | "resize", dx: number, dy: number): Layout => {
  if (mode === "move")
    return {
      ...layout,
      x: Math.min(Math.max(layout.x + dx, 0), 12 - layout.w),
      y: Math.max(layout.y + dy, 0),
    };

  return {
    ...layout,
    w: Math.min(Math.max(layout.w + dx, 1), 12 - layout.x),
    h: Math.min(Math.max(layout.h + dy, 1), 24),
  };
};

export default function DashboardPage() {
  const params = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const dashboard = useQuery(() =>
    enterpriseQueries.dashboard(params.tenantId, params.dashboardId),
  );

  const [editing, setEditing] = createSignal(
    untrack(() => (Array.isArray(searchParams.edit) ? searchParams.edit[0] : searchParams.edit)) ===
      "1",
  );

  const [layout, setLayout] = createSignal<Record<string, Layout>>({});
  const [editorOpen, setEditorOpen] = createSignal(false);
  const [editingWidget, setEditingWidget] = createSignal<DashboardWidget | null>(null);

  const [draft, setDraft] = createSignal<Draft>({
    type: "table",
    title: "New table",
    config: defaultConfig("table"),
  });

  const [formError, setFormError] = createSignal<string | null>(null);
  const [name, setName] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [settingsError, setSettingsError] = createSignal<string | null>(null);
  const [makeDefaultError, setMakeDefaultError] = createSignal<unknown>(null);
  const [removeDashboardError, setRemoveDashboardError] = createSignal<unknown>(null);
  const [removeWidgetError, setRemoveWidgetError] = createSignal<unknown>(null);
  const [layoutError, setLayoutError] = createSignal<unknown>(null);
  const [pendingLayout, setPendingLayout] = createSignal<Array<{ id: string } & Layout>>([]);
  let gridRef: HTMLDivElement | undefined;
  let cleanDrag: (() => void) | undefined;

  const widgets = () => dashboard.data?.widgets ?? [];
  const currentLayout = (widget: DashboardWidget): Layout => layout()[widget.id] ?? widget;

  createEffect(
    () => dashboard.data,
    (data) => {
      if (!data) return;
      setName(data.name);
      setDescription(data.description ?? "");
      setLayout(
        Object.fromEntries(
          data.widgets.map((widget) => [
            widget.id,
            { x: widget.x, y: widget.y, w: widget.w, h: widget.h },
          ]),
        ),
      );
    },
  );
  onCleanup(() => cleanDrag?.());

  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: enterpriseKeys.dashboard(params.tenantId, params.dashboardId),
    });
    await queryClient.invalidateQueries({ queryKey: enterpriseKeys.dashboards(params.tenantId) });
  };

  const saveSettings = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: () =>
      enterprise.patchDashboard(params.tenantId, params.dashboardId, {
        name: name(),
        description: description() || null,
      }),
    onSuccess: async () => {
      setSettingsError(null);
      await invalidate();
    },
    onError: (cause) =>
      setSettingsError(errorMessage(cause, "Could not save the dashboard. Try again.")),
  }));

  const makeDefault = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: () =>
      enterprise.patchDashboard(params.tenantId, params.dashboardId, { isDefault: true }),
    onMutate: () => setMakeDefaultError(null),
    onSuccess: async () => {
      setMakeDefaultError(null);
      await invalidate();
    },
    onError: (cause) => setMakeDefaultError(cause),
  }));

  const removeDashboard = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: () => enterprise.deleteDashboard(params.tenantId, params.dashboardId),
    onMutate: () => setRemoveDashboardError(null),
    onSuccess: async () => {
      setRemoveDashboardError(null);
      await queryClient.invalidateQueries({ queryKey: enterpriseKeys.dashboards(params.tenantId) });
      navigate(`/t/${params.tenantId}/dashboards`, { replace: true });
    },
    onError: (cause) => setRemoveDashboardError(cause),
  }));

  const saveWidget = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: async () => {
      const value = draft();
      const title = value.title.trim();

      if (!title) throw new Error("Give the widget a title");

      const config: Record<string, any> = {
        ...value.config,
        ...(value.type === "markdown" ? {} : { query: value.config.query ?? { all: [] } }),
      };

      if (value.type === "markdown" && !String(config.markdown ?? "").trim())
        throw new Error("Write some markdown first");

      if (value.type === "table" && !(config.columns?.length > 0))
        throw new Error("Choose at least one column");

      if (value.type === "pie" && !config.dimension) throw new Error("Choose a pie dimension");
      const existing = editingWidget();

      if (existing)
        return enterprise.patchDashboardWidget(params.tenantId, params.dashboardId, existing.id, {
          type: value.type,
          title,
          config,
        });
      const nextY = widgets().reduce((bottom, widget) => Math.max(bottom, widget.y + widget.h), 0);

      return enterprise.createDashboardWidget(params.tenantId, params.dashboardId, {
        type: value.type,
        title,
        config,
        x: 0,
        y: nextY,
        w: 6,
        h: 4,
      });
    },
    onSuccess: async () => {
      setEditorOpen(false);
      setFormError(null);
      await invalidate();
    },
    onError: (cause) => setFormError(errorMessage(cause, "Could not save the widget. Try again.")),
  }));

  const removeWidget = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: (widget: DashboardWidget) =>
      enterprise.deleteDashboardWidget(params.tenantId, params.dashboardId, widget.id),
    onMutate: () => setRemoveWidgetError(null),
    onSuccess: async () => {
      setRemoveWidgetError(null);
      await invalidate();
    },
    onError: (cause) => setRemoveWidgetError(cause),
  }));

  const saveLayout = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: (widgets: Array<{ id: string } & Layout>) =>
      enterprise.patchDashboardLayout(params.tenantId, params.dashboardId, widgets),
    onMutate: (widgets) => {
      setLayoutError(null);
      setPendingLayout(widgets);
    },
    onSuccess: () => {
      setLayoutError(null);
      setPendingLayout([]);
    },
    onError: (cause) => setLayoutError(cause),
  }));

  const openCreate = () => {
    setEditingWidget(null);
    setDraft({ type: "table", title: "New table", config: defaultConfig("table") });
    setFormError(null);
    setEditorOpen(true);
  };

  const openEdit = (widget: DashboardWidget) => {
    setEditingWidget(widget);
    setDraft({
      type: widget.type,
      title: widget.title,
      config:
        typeof widget.config === "object" && widget.config !== null
          ? { ...(widget.config as Record<string, any>) }
          : defaultConfig(widget.type),
    });
    setFormError(null);
    setEditorOpen(true);
  };

  const changeType = (type: DashboardWidgetType) => {
    setDraft((value) => ({
      type,
      title: value.title,
      config: defaultConfig(type),
    }));
  };

  const startDrag = (event: PointerEvent, widget: DashboardWidget, mode: "move" | "resize") => {
    if (!editing() || !gridRef || window.matchMedia("(max-width: 900px)").matches) return;
    event.preventDefault();
    event.stopPropagation();
    cleanDrag?.();
    const rect = gridRef.getBoundingClientRect();
    const column = (rect.width - gap * 11) / 12 + gap;
    const row = rowHeight + gap;
    const before = { ...layout() };
    const origin = { ...currentLayout(widget) };
    const startX = event.clientX;
    const startY = event.clientY;
    let latest = before;

    const move = (pointer: PointerEvent) => {
      const dx = Math.round((pointer.clientX - startX) / column);
      const dy = Math.round((pointer.clientY - startY) / row);
      const next = clampLayout(origin, mode, dx, dy);

      if (
        next.x === latest[widget.id]!.x &&
        next.y === latest[widget.id]!.y &&
        next.w === latest[widget.id]!.w &&
        next.h === latest[widget.id]!.h
      )
        return;
      latest = resolveLayout({ ...before, [widget.id]: next }, widget.id);
      setLayout(latest);
    };

    const up = () => {
      cleanDrag?.();

      const changed = Object.entries(latest).filter(([id, position]) => {
        const previous = before[id];

        return (
          !previous ||
          previous.x !== position.x ||
          previous.y !== position.y ||
          previous.w !== position.w ||
          previous.h !== position.h
        );
      });

      if (changed.length > 0)
        saveLayout.mutate(changed.map(([id, position]) => ({ id, ...position })));
    };

    cleanDrag = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      cleanDrag = undefined;
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const dataset = () => draft().config.dataset ?? "devices";
  const dimensionOptions = () => (dataset() === "software" ? softwareDimensions : deviceDimensions);
  const columnOptions = () => (dataset() === "software" ? softwareColumns : deviceColumns);

  const toggleColumn = (id: string) => {
    setDraft((value) => {
      const columns: string[] = value.config.columns ?? [];

      return {
        ...value,
        config: {
          ...value.config,
          columns: columns.includes(id)
            ? columns.filter((column) => column !== id)
            : [...columns, id],
        },
      };
    });
  };

  return (
    <Page>
      <QueryError error={dashboard.error} onRetry={() => void dashboard.refetch()} />

      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <a
            href={`/t/${params.tenantId}/dashboards`}
            class="text-[11.5px] text-muted-foreground hover:text-foreground"
          >
            ← Dashboards
          </a>
          <div class="mt-1 flex flex-wrap items-center gap-2">
            <h1 class="truncate text-[19px] font-semibold tracking-[-0.02em]">
              {dashboard.data?.name ?? "Dashboard"}
            </h1>
            <Show when={dashboard.data?.isDefault}>
              <Badge variant="secondary" class="gap-1">
                <Star class="size-3" />
                Overview
              </Badge>
            </Show>
          </div>
          <p class="mt-1 max-w-2xl text-[12.5px] text-muted-foreground">
            {dashboard.data?.description?.trim() ||
              "A shared view of your fleet. Widgets run live queries and can be arranged on the grid."}
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <Show when={!dashboard.data?.isDefault}>
            <Button
              size="sm"
              variant="outline"
              disabled={makeDefault.isPending}
              onClick={() => makeDefault.mutate()}
            >
              Set as Overview
            </Button>
          </Show>
          <Show when={editing()}>
            <Button size="sm" variant="outline" onClick={openCreate}>
              <Plus class="size-3.5" />
              Add widget
            </Button>
          </Show>
          <Button
            size="sm"
            variant={editing() ? "default" : "outline"}
            onClick={() => setEditing((value) => !value)}
          >
            {editing() ? "Done editing" : "Edit dashboard"}
          </Button>
        </div>
      </div>

      <Show when={makeDefaultError() || removeDashboardError()}>
        <div class="space-y-2">
          <ErrorText error={makeDefaultError()} />
          <ErrorText error={removeDashboardError()} />
        </div>
      </Show>

      <Show when={editing()}>
        <div class="rounded-lg border border-white/[0.07] bg-card p-3.5">
          <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] sm:items-end">
            <label>
              <span class="mb-1 block text-[11px] font-medium text-muted-foreground">Name</span>
              <Input
                value={name()}
                onInput={(event) => setName(event.currentTarget.value)}
                class="h-8"
              />
            </label>
            <label>
              <span class="mb-1 block text-[11px] font-medium text-muted-foreground">
                Description
              </span>
              <Input
                value={description()}
                onInput={(event) => setDescription(event.currentTarget.value)}
                class="h-8"
                placeholder="What this dashboard is for"
              />
            </label>
            <Button
              size="sm"
              disabled={saveSettings.isPending || !name().trim()}
              onClick={() => saveSettings.mutate()}
            >
              {saveSettings.isPending ? "Saving…" : "Save details"}
            </Button>
          </div>
          <Show when={settingsError()}>
            <p role="alert" class="mt-2 text-[12px] text-destructive">
              {settingsError()}
            </p>
          </Show>
          <div class="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Drag widgets to move them. Use the corner handle to resize.</span>
            <Button
              size="xs"
              variant="ghost"
              class="text-muted-foreground hover:text-destructive"
              disabled={removeDashboard.isPending}
              onClick={() => {
                if (window.confirm(`Delete “${dashboard.data?.name ?? "this dashboard"}”?`))
                  removeDashboard.mutate();
              }}
            >
              Delete dashboard
            </Button>
          </div>
        </div>
      </Show>

      <Show when={removeWidgetError()}>
        <ErrorText error={removeWidgetError()} />
      </Show>

      <Show when={layoutError()}>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <ErrorText error={layoutError()} />
          <Button
            size="xs"
            variant="outline"
            disabled={saveLayout.isPending || pendingLayout().length === 0}
            onClick={() => saveLayout.mutate(pendingLayout())}
          >
            {saveLayout.isPending ? "Retrying…" : "Try again"}
          </Button>
        </div>
      </Show>

      <Show
        when={widgets().length > 0}
        fallback={
          <div class="flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed border-white/[0.09] bg-white/[0.01] px-6 text-center">
            <p class="text-[13px] font-medium">This dashboard is empty</p>
            <p class="mt-1 text-[12px] text-muted-foreground">
              Add a table, pie chart, count or markdown note.
            </p>
            <Button
              size="sm"
              class="mt-3"
              onClick={() => {
                setEditing(true);
                openCreate();
              }}
            >
              Add the first widget
            </Button>
          </div>
        }
      >
        <div ref={gridRef} class="dashboard-grid">
          <For each={widgets()}>
            {(widget) => {
              const position = () => currentLayout(widget);

              return (
                <article
                  class={cn(
                    "dashboard-widget group relative flex min-h-0 flex-col rounded-lg border border-white/[0.07] bg-card p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]",
                    editing() && "border-white/[0.11]",
                  )}
                  style={{
                    "grid-column": `${position().x + 1} / span ${position().w}`,
                    "grid-row": `${position().y + 1} / span ${position().h}`,
                  }}
                >
                  <header class="flex min-w-0 items-start gap-1.5 px-0.5 pb-2">
                    <Show when={editing()}>
                      <button
                        type="button"
                        aria-label={`Move ${widget.title}`}
                        class="dashboard-drag-handle -ml-1 mt-0.5 cursor-grab touch-none rounded p-0.5 text-muted-foreground/60 hover:bg-white/[0.06] hover:text-foreground active:cursor-grabbing"
                        onPointerDown={(event) => startDrag(event, widget, "move")}
                      >
                        <GripVertical class="size-3.5" />
                      </button>
                    </Show>
                    <div class="min-w-0 flex-1">
                      <h2 class="truncate text-[12.5px] font-medium text-foreground">
                        {widget.title}
                      </h2>
                      <p class="truncate text-[10px] capitalize text-muted-foreground/70">
                        {widget.type === "markdown"
                          ? "Markdown"
                          : `${widget.type} · ${String((widget.config as any)?.dataset ?? "devices")}`}
                      </p>
                    </div>
                    <Show when={editing()}>
                      <div class="flex shrink-0 items-center gap-1">
                        <Button size="xs" variant="ghost" onClick={() => openEdit(widget)}>
                          Edit
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          aria-label={`Remove ${widget.title}`}
                          class="text-muted-foreground hover:text-destructive"
                          disabled={removeWidget.isPending}
                          onClick={() => {
                            if (window.confirm(`Remove “${widget.title}”?`))
                              removeWidget.mutate(widget);
                          }}
                        >
                          <X class="size-3" />
                        </Button>
                      </div>
                    </Show>
                  </header>
                  <div class="min-h-0 flex-1 overflow-hidden">
                    <DashboardWidgetView widget={widget} tenantId={params.tenantId!} />
                  </div>
                  <Show when={editing()}>
                    <button
                      type="button"
                      aria-label={`Resize ${widget.title}`}
                      class="dashboard-resize-handle absolute bottom-1 right-1 size-3 cursor-nwse-resize touch-none rounded-sm border-b border-r border-muted-foreground/40"
                      onPointerDown={(event) => startDrag(event, widget, "resize")}
                    />
                  </Show>
                </article>
              );
            }}
          </For>
        </div>
      </Show>

      <Dialog open={editorOpen()} onOpenChange={setEditorOpen}>
        <DialogContent class="max-w-2xl rounded-xl border border-white/[0.09] bg-card p-5">
          <DialogHeader>
            <DialogTitle>{editingWidget() ? "Edit widget" : "Add widget"}</DialogTitle>
          </DialogHeader>
          <div class="space-y-3">
            <div class="grid gap-2 sm:grid-cols-[140px_minmax(0,1fr)]">
              <label>
                <span class="mb-1 block text-[11px] font-medium text-muted-foreground">Type</span>
                <select
                  class="h-8 w-full rounded-md border border-input bg-background px-2 text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                  value={draft().type}
                  onChange={(event) => changeType(event.currentTarget.value as DashboardWidgetType)}
                >
                  <option value="table">Table</option>
                  <option value="pie">Pie chart</option>
                  <option value="stat">Count</option>
                  <option value="markdown">Markdown</option>
                </select>
              </label>
              <label>
                <span class="mb-1 block text-[11px] font-medium text-muted-foreground">Title</span>
                <Input
                  class="h-8"
                  value={draft().title}
                  onInput={(event) =>
                    setDraft((value) => ({ ...value, title: event.currentTarget.value }))
                  }
                />
              </label>
            </div>

            <Show when={draft().type === "markdown"}>
              <label class="block">
                <span class="mb-1 block text-[11px] font-medium text-muted-foreground">
                  Markdown
                </span>
                <textarea
                  class="min-h-48 w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                  value={draft().config.markdown ?? ""}
                  onInput={(event) =>
                    setDraft((value) => ({
                      ...value,
                      config: { ...value.config, markdown: event.currentTarget.value },
                    }))
                  }
                />
                <span class="mt-1 block text-[10.5px] text-muted-foreground">
                  Supports headings, lists, links, images, bold/italic and fenced code.
                </span>
              </label>
            </Show>

            <Show when={draft().type !== "markdown"}>
              <div class="grid gap-2 sm:grid-cols-2">
                <label>
                  <span class="mb-1 block text-[11px] font-medium text-muted-foreground">
                    Dataset
                  </span>
                  <select
                    class="h-8 w-full rounded-md border border-input bg-background px-2 text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                    value={dataset()}
                    onChange={(event) => {
                      const nextDataset = event.currentTarget.value as "devices" | "software";
                      setDraft((value) => {
                        const config = defaultConfig(value.type);

                        if (value.type === "table")
                          config.columns =
                            nextDataset === "software"
                              ? ["name", "version", "managed", "deviceCount"]
                              : ["name", "platform", "osVersion", "status", "health", "lastSeenAt"];

                        if (value.type === "pie")
                          config.dimension = nextDataset === "software" ? "managed" : "platform";

                        return {
                          ...value,
                          config: { ...config, dataset: nextDataset },
                        };
                      });
                    }}
                  >
                    <option value="devices">Devices</option>
                    <option value="software">Software inventory</option>
                  </select>
                </label>
                <Show when={draft().type === "pie"}>
                  <label>
                    <span class="mb-1 block text-[11px] font-medium text-muted-foreground">
                      Group by
                    </span>
                    <select
                      class="h-8 w-full rounded-md border border-input bg-background px-2 text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                      value={draft().config.dimension ?? "platform"}
                      onChange={(event) =>
                        setDraft((value) => ({
                          ...value,
                          config: { ...value.config, dimension: event.currentTarget.value },
                        }))
                      }
                    >
                      <For each={dimensionOptions()}>
                        {([id, label]) => <option value={id}>{label}</option>}
                      </For>
                    </select>
                  </label>
                </Show>
                <Show when={draft().type === "stat"}>
                  <label>
                    <span class="mb-1 block text-[11px] font-medium text-muted-foreground">
                      Caption
                    </span>
                    <Input
                      class="h-8"
                      value={draft().config.label ?? ""}
                      placeholder="devices"
                      onInput={(event) =>
                        setDraft((value) => ({
                          ...value,
                          config: { ...value.config, label: event.currentTarget.value },
                        }))
                      }
                    />
                  </label>
                </Show>
              </div>

              <div class="rounded-lg border border-white/[0.07] bg-white/[0.015] p-2.5">
                <DeviceQueryBuilder
                  compact
                  dataset={dataset()}
                  disabled={saveWidget.isPending}
                  query={(draft().config.query as DeviceQuery | null) ?? null}
                  onChange={(query) =>
                    setDraft((value) => ({
                      ...value,
                      config: { ...value.config, query: query ?? { all: [] } },
                    }))
                  }
                />
              </div>

              <Show when={draft().type === "table"}>
                <div>
                  <span class="mb-1.5 block text-[11px] font-medium text-muted-foreground">
                    Columns
                  </span>
                  <div class="flex flex-wrap gap-1.5">
                    <For each={columnOptions()}>
                      {([id, label]) => {
                        const checked = () => (draft().config.columns ?? []).includes(id);

                        return (
                          <button
                            type="button"
                            aria-pressed={checked() ? "true" : "false"}
                            onClick={() => toggleColumn(id)}
                            class={cn(
                              "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                              checked()
                                ? "border-white/[0.14] bg-white/[0.08] text-foreground"
                                : "border-white/[0.07] text-muted-foreground hover:text-foreground",
                            )}
                          >
                            {label}
                          </button>
                        );
                      }}
                    </For>
                  </div>
                </div>
              </Show>
            </Show>

            <Show when={formError()}>
              <p role="alert" class="text-[12px] text-destructive">
                {formError()}
              </p>
            </Show>
          </div>
          <DialogFooter class="mt-4">
            <Button variant="outline" onClick={() => setEditorOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={saveWidget.isPending || !draft().title.trim()}
              onClick={() => saveWidget.mutate()}
            >
              {saveWidget.isPending ? "Saving…" : editingWidget() ? "Save widget" : "Add widget"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <p class="text-[11px] text-muted-foreground/70">
        Shared with everyone in this tenant.
        <Show when={dashboard.data?.updatedAt}>
          {" "}
          Last updated {relativeTime(dashboard.data!.updatedAt)}.
        </Show>
      </p>
    </Page>
  );
}
