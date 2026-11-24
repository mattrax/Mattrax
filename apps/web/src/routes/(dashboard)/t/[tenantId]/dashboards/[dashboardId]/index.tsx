import { useParams, useSearchParams } from "@solidjs/router";
import type { RoutePreloadFuncArgs } from "@solidjs/router";
import { useNavigate } from "~/lib/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { DeviceQuery } from "@mattrax/enterprise-domain/client";
import { Match, Option, Schema } from "effect";
import { createEffect, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import { ErrorText, Page, QueryError, relativeTime } from "~/components/mdm/common";
import {
  DashboardWidgetBatchProvider,
  DashboardWidgetView,
  useDashboardWidgetBatch,
} from "~/components/dashboard/widget";
import { DeviceQueryBuilder } from "~/components/dashboard/query-builder";
import { Badge } from "~/components/ui/badge";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { toast } from "~/components/toast";
import { ScopeTagAssignmentEditor } from "~/components/scope-tags/scope-tag-select";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { BookOpen, GripVertical, Plus, Star, X } from "~/components/ui/icons";
import { Input } from "~/components/ui/input";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";
import type { DashboardWidget, DashboardWidgetType } from "~/lib/enterprise";
import { errorMessage, raisedFailure } from "~/lib/errors";
import { optimisticUpdate } from "~/lib/optimistic";
import { preloadPage } from "~/lib/page-data";
import { queryClient as appQueryClient } from "~/lib/query-client";
import { cn } from "~/lib/utils";
import { useCan } from "~/lib/permissions";
import { PinDashboardButton } from "~/components/pin-dashboard-button";
import { routes } from "~/lib/routes";
import { resolveTenantId } from "~/lib/tenant";
import { createDashboardLayoutResolver } from "./dashboard-layout";
import type { DashboardLayout } from "./dashboard-layout";

export const route = {
  preload: ({ params, intent }: RoutePreloadFuncArgs) => {
    if (intent === "initial") return;

    return preloadPage([
      () =>
        appQueryClient.ensureQueryData(
          enterpriseQueries.dashboard(params.tenantId, params.dashboardId),
        ),
    ]);
  },
};

type MutableJsonObject = { [key: string]: Schema.Json };

type Draft = {
  type: DashboardWidgetType;
  title: string;
  config: MutableJsonObject;
};

const decodeWidgetConfig = Schema.decodeUnknownOption(Schema.JsonObject);

const decodeDeviceQuery = Schema.decodeUnknownOption(DeviceQuery);

const decodeWidgetType = Schema.decodeUnknownOption(
  Schema.Literals(["table", "pie", "stat", "markdown"]),
);

const decodeDataset = Schema.decodeUnknownOption(Schema.Literals(["devices", "software", "users"]));

const widgetConfig = (widget: DashboardWidget): MutableJsonObject => {
  const decoded = Option.getOrUndefined(decodeWidgetConfig(widget.config));

  return decoded === undefined ? {} : { ...decoded };
};

const isDataset = Schema.is(Schema.Literals(["devices", "software", "users"]));

const configString = (config: MutableJsonObject, key: string) => {
  const value = config[key];

  return Schema.is(Schema.String)(value) ? value : undefined;
};

const configColumns = (config: MutableJsonObject) => {
  const columns = config.columns;

  return Array.isArray(columns) ? columns.filter(Schema.is(Schema.String)) : [];
};

/** `all` is represented by an empty filter, not a stored literal. */
const configUserStatus = (config: MutableJsonObject) => {
  const filter = config.userFilter;

  return Schema.is(Schema.JsonObject)(filter) && Schema.is(Schema.String)(filter.status)
    ? filter.status
    : "all";
};

const rowHeight = 64;

const gap = 12;

const defaultConfig = (type: DashboardWidgetType) => {
  const config: MutableJsonObject = {};

  if (type === "markdown") {
    config.markdown =
      "## Team notes\n\nAdd context, links and images here.\n\n- [Mattrax docs](/docs/)\n- Status page: https://status.otbeaumont.me";

    return config;
  }

  config.dataset = "devices";
  config.query = { all: [] };

  if (type === "pie") {
    config.dimension = "platform";

    return config;
  }

  if (type === "stat") {
    config.label = "devices";

    return config;
  }

  config.columns = ["name", "platform", "osVersion", "status", "health", "lastSeenAt"];
  config.limit = 10;

  return config;
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

const userDimensions = [
  ["status", "Status"],
  ["source", "Identity provider"],
] as const;

const userColumns = [
  ["name", "Name"],
  ["email", "Email"],
  ["status", "Status"],
  ["source", "Source"],
] as const;

const tableColumnsFor = (dataset: "devices" | "software" | "users") =>
  Match.value(dataset).pipe(
    Match.when("software", () => ["name", "version", "managed", "deviceCount"]),
    Match.when("users", () => ["name", "email", "status", "source"]),
    Match.orElse(() => ["name", "platform", "osVersion", "status", "health", "lastSeenAt"]),
  );

const pieDimensionFor = (dataset: "devices" | "software" | "users") =>
  Match.value(dataset).pipe(
    Match.when("software", () => "managed"),
    Match.when("users", () => "status"),
    Match.orElse(() => "platform"),
  );

const clampLayout = (
  layout: DashboardLayout,
  mode: "move" | "resize",
  dx: number,
  dy: number,
): DashboardLayout => {
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
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { can } = useCan();
  const writable = () => can("dashboards.write");

  const dashboard = useQuery(() =>
    enterpriseQueries.dashboard(params.tenantId, params.dashboardId),
  );

  // `?edit=1` is a request, not a grant: the dashboard only enters edit mode
  // when the role can write.
  const [editRequested, setEditRequested] = createSignal(
    untrack(() => (Array.isArray(searchParams.edit) ? searchParams.edit[0] : searchParams.edit)) ===
      "1",
  );

  const editing = () => writable() && editRequested();

  const toggleEditing = () => {
    if (!writable()) {
      setEditRequested(false);
      setSearchParams({ edit: undefined }, { replace: true });

      return;
    }

    const next = !editRequested();
    setEditRequested(next);
    setSearchParams({ edit: next ? "1" : undefined }, { replace: true });
  };

  const [layout, setLayout] = createSignal<Record<string, DashboardLayout>>({});
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
  const [confirmDeleteDashboard, setConfirmDeleteDashboard] = createSignal(false);
  const [removeWidgetTarget, setRemoveWidgetTarget] = createSignal<DashboardWidget | null>(null);
  const [layoutError, setLayoutError] = createSignal<unknown>(null);
  const [pendingLayout, setPendingLayout] = createSignal<Array<{ id: string } & DashboardLayout>>(
    [],
  );
  let gridRef: HTMLDivElement | undefined;
  let cleanDrag: (() => void) | undefined;

  const widgets = () => dashboard.data?.widgets ?? [];

  const currentLayout = (widget: DashboardWidget): DashboardLayout => layout()[widget.id] ?? widget;

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
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: enterpriseKeys.dashboard(params.tenantId, params.dashboardId),
      }),
      queryClient.invalidateQueries({ queryKey: enterpriseKeys.dashboards(params.tenantId) }),
    ]);
  };

  const saveSettings = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: () =>
      enterprise.patchDashboard(params.tenantId, params.dashboardId, {
        name: name(),
        description: description() || null,
      }),
    onMutate: async () => {
      setSettingsError(null);

      const restore = await optimisticUpdate<{ name: string; description?: string | null }>(
        queryClient,
        enterpriseKeys.dashboard(params.tenantId, params.dashboardId),
        (current) => ({ ...current, name: name(), description: description() || null }),
      );

      return { restore };
    },
    onSuccess: () => void invalidate(),
    onError: (cause, _payload, context) => {
      context?.restore();
      setSettingsError(
        errorMessage(raisedFailure(cause), "Could not save the dashboard. Try again."),
      );
    },
  }));

  const makeDefault = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: () =>
      enterprise.patchDashboard(params.tenantId, params.dashboardId, { isDefault: true }),
    onMutate: async () => {
      setMakeDefaultError(null);

      const restores = await Promise.all([
        optimisticUpdate<{ isDefault?: boolean }>(
          queryClient,
          enterpriseKeys.dashboard(params.tenantId, params.dashboardId),
          (current) => ({ ...current, isDefault: true }),
        ),
        optimisticUpdate<{ dashboards: { id: string; isDefault?: boolean }[] }>(
          queryClient,
          enterpriseKeys.dashboards(params.tenantId),
          (current) => ({
            ...current,
            dashboards: current.dashboards.map((dashboard) => ({
              ...dashboard,
              isDefault: dashboard.id === params.dashboardId,
            })),
          }),
        ),
      ]);

      return { restore: () => restores.forEach((restore) => restore()) };
    },
    onSuccess: () => {
      setMakeDefaultError(null);
      void invalidate();
    },
    onError: (cause, _payload, context) => {
      context?.restore();
      setMakeDefaultError(cause);
    },
  }));

  const removeDashboard = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: () => enterprise.deleteDashboard(params.tenantId, params.dashboardId),
    onMutate: async () => {
      setRemoveDashboardError(null);

      const restore = await optimisticUpdate<{ dashboards: { id: string }[] }>(
        queryClient,
        enterpriseKeys.dashboards(params.tenantId),
        (current) => ({
          ...current,
          dashboards: current.dashboards.filter((dashboard) => dashboard.id !== params.dashboardId),
        }),
      );

      navigate(`/t/${params.tenantId}/dashboards`, { replace: true });

      return { restore };
    },
    onSuccess: () => {
      setRemoveDashboardError(null);
      void queryClient.invalidateQueries({ queryKey: enterpriseKeys.dashboards(params.tenantId) });
    },
    onError: (cause, _payload, context) => {
      context?.restore();
      setRemoveDashboardError(cause);
      toast.error("Could not delete the dashboard", {
        description: errorMessage(raisedFailure(cause), "Try again in a moment."),
      });
    },
  }));

  const saveWidget = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: async () => {
      const value = draft();
      const title = value.title.trim();

      if (!title) throw new Error("Give the widget a title");

      const config = { ...value.config };

      if (value.type !== "markdown" && config.dataset !== "users")
        config.query = value.config.query ?? { all: [] };

      if (value.type === "markdown" && !String(config.markdown ?? "").trim())
        throw new Error("Write some markdown first");

      const columns = Array.isArray(config.columns) ? config.columns : [];

      if (value.type === "table" && columns.length === 0)
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
    onMutate: async () => {
      const existing = editingWidget();

      // A new widget's id is assigned by the server, so only an edit can be
      // painted from the form. Both paths close the dialog on submit.
      if (!existing) {
        setEditorOpen(false);

        return;
      }

      const value = draft();
      const title = value.title.trim();

      if (!title) return;

      const config = { ...value.config };

      if (value.type !== "markdown" && config.dataset !== "users")
        config.query = value.config.query ?? { all: [] };

      const restore = await optimisticUpdate<{ widgets: DashboardWidget[] }>(
        queryClient,
        enterpriseKeys.dashboard(params.tenantId, params.dashboardId),
        (current) => ({
          ...current,
          widgets: current.widgets.map((widget) =>
            widget.id === existing.id ? { ...widget, type: value.type, title, config } : widget,
          ),
        }),
      );

      setEditorOpen(false);

      return { restore };
    },
    onSuccess: () => {
      setFormError(null);
      void invalidate();
    },
    onError: (cause, _payload, context) => {
      context?.restore();
      setEditorOpen(true);
      setFormError(errorMessage(cause, "Could not save the widget. Try again."));
    },
  }));

  const removeWidget = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: (widget: DashboardWidget) =>
      enterprise.deleteDashboardWidget(params.tenantId, params.dashboardId, widget.id),
    onMutate: async (widget) => {
      setRemoveWidgetError(null);

      const restore = await optimisticUpdate<{ widgets: DashboardWidget[] }>(
        queryClient,
        enterpriseKeys.dashboard(params.tenantId, params.dashboardId),
        (current) => ({
          ...current,
          widgets: current.widgets.filter((candidate) => candidate.id !== widget.id),
        }),
      );

      setRemoveWidgetTarget(null);

      return { restore };
    },
    onSuccess: () => {
      setRemoveWidgetError(null);
      void invalidate();
    },
    onError: (cause, _widget, context) => {
      context?.restore();
      setRemoveWidgetError(cause);
    },
  }));

  const saveLayout = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: (widgets: Array<{ id: string } & DashboardLayout>) =>
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

  const defaultTitles: Record<DashboardWidgetType, string> = {
    table: "New table",
    pie: "New pie chart",
    stat: "New count",
    markdown: "New note",
  };

  const openCreate = () => {
    setEditingWidget(null);
    setDraft({ type: "table", title: defaultTitles.table, config: defaultConfig("table") });
    setFormError(null);
    setEditorOpen(true);
  };

  const openEdit = (widget: DashboardWidget) => {
    setEditingWidget(widget);
    setDraft({
      type: widget.type,
      title: widget.title,
      config: widgetConfig(widget),
    });
    setFormError(null);
    setEditorOpen(true);
  };

  const changeType = (type: DashboardWidgetType) => {
    setDraft((value) => ({
      type,
      // Only replace a title we generated; a typed title is the person's own.
      title: Object.values(defaultTitles).includes(value.title) ? defaultTitles[type] : value.title,
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
    const resolve = createDashboardLayoutResolver(before, widget.id);
    const startX = event.clientX;
    const startY = event.clientY;
    let latest = before;
    let frame: number | undefined;
    let queued: DashboardLayout | undefined;

    const commit = () => {
      frame = undefined;
      const next = queued;
      queued = undefined;

      if (!next) return;
      if (
        next.x === latest[widget.id]!.x &&
        next.y === latest[widget.id]!.y &&
        next.w === latest[widget.id]!.w &&
        next.h === latest[widget.id]!.h
      )
        return;

      latest = resolve(next);
      setLayout(latest);
    };

    const move = (pointer: PointerEvent) => {
      const dx = Math.round((pointer.clientX - startX) / column);
      const dy = Math.round((pointer.clientY - startY) / row);
      queued = clampLayout(origin, mode, dx, dy);

      // Coalesce pointer events into one resolver run and render per frame.
      if (frame === undefined) frame = window.requestAnimationFrame(commit);
    };

    const up = () => {
      // Persist the final pointer position even when it arrived after the last
      // animation frame.
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      commit();
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
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      frame = undefined;
      queued = undefined;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      cleanDrag = undefined;
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const dataset = (): "devices" | "software" | "users" => {
    const value = draft().config.dataset;

    return isDataset(value) ? value : "devices";
  };

  const dimensionOptions = () =>
    Match.value(dataset()).pipe(
      Match.when("software", () => softwareDimensions),
      Match.when("users", () => userDimensions),
      Match.orElse(() => deviceDimensions),
    );

  const columnOptions = () =>
    Match.value(dataset()).pipe(
      Match.when("software", () => softwareColumns),
      Match.when("users", () => userColumns),
      Match.orElse(() => deviceColumns),
    );

  const toggleColumn = (id: string) => {
    setDraft((value) => {
      const columns = configColumns(value.config);

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
            class="text-[11.5px] text-muted-foreground transition-colors duration-[var(--duration-hover)] ease-swift hover:text-foreground"
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
          <Show when={dashboard.data}>
            <Button
              as="a"
              href={routes.tenant(params.tenantId).dashboardReports(params.dashboardId!)}
              size="sm"
              variant="outline"
            >
              <BookOpen class="size-3.5" />
              Reports
            </Button>
          </Show>
          <Show when={dashboard.data}>
            {(current) => (
              <PinDashboardButton
                tenantId={resolveTenantId(params.tenantId) ?? params.tenantId ?? ""}
                dashboardId={current().id}
                name={current().name}
                size="sm"
              />
            )}
          </Show>
          <Show when={writable() && !dashboard.data?.isDefault}>
            <Button
              size="sm"
              variant="outline"
              disabled={makeDefault.isPending}
              onClick={() => makeDefault.mutate()}
            >
              Set as Overview
            </Button>
          </Show>
          <Show when={writable()}>
            <Show when={editing()}>
              <Button size="sm" variant="outline" onClick={openCreate}>
                <Plus class="size-3.5" />
                Add widget
              </Button>
            </Show>
            <Button size="sm" variant={editing() ? "default" : "outline"} onClick={toggleEditing}>
              {editing() ? "Done editing" : "Edit dashboard"}
            </Button>
          </Show>
        </div>
      </div>

      <Show when={makeDefaultError() || removeDashboardError()}>
        <div class="space-y-2">
          <ErrorText error={makeDefaultError()} />
          <ErrorText error={removeDashboardError()} />
        </div>
      </Show>

      <Show when={editing()}>
        <div class="rounded-lg border border-border bg-card px-2.5 py-2">
          <div class="flex flex-wrap items-center gap-1.5">
            <Input
              aria-label="Dashboard name"
              value={name()}
              onInput={(event) => setName(event.currentTarget.value)}
              class="h-7 min-w-[10rem] flex-1"
            />
            <Input
              aria-label="Dashboard description"
              value={description()}
              onInput={(event) => setDescription(event.currentTarget.value)}
              class="h-7 min-w-[14rem] flex-[2]"
              placeholder="What this dashboard is for"
            />
            <Button
              size="xs"
              disabled={saveSettings.isPending || !name().trim()}
              onClick={() => saveSettings.mutate()}
            >
              {saveSettings.isPending ? "Saving…" : "Save details"}
            </Button>
            <span class="hidden text-[10.5px] text-muted-foreground sm:inline">
              Drag to move · corner to resize
            </span>
            <Button
              size="xs"
              variant="ghost"
              class="ml-auto text-muted-foreground hover:text-destructive"
              disabled={removeDashboard.isPending}
              onClick={() => setConfirmDeleteDashboard(true)}
            >
              Delete dashboard
            </Button>
          </div>
          <Show when={settingsError()}>
            <p role="alert" class="mt-1.5 text-[12px] text-destructive">
              {settingsError()}
            </p>
          </Show>
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
          <div class="flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface px-6 text-center">
            <p class="text-[13px] font-medium">This dashboard is empty</p>
            <p class="mt-1 text-[12px] text-muted-foreground">
              Add a table, pie chart, count or markdown note.
            </p>
            <Button size="sm" class="mt-3" onClick={openCreate}>
              Add the first widget
            </Button>
          </div>
        }
      >
        <DashboardWidgetBatchProvider widgets={widgets()} tenantId={params.tenantId!}>
          <div
            ref={(element) => {
              gridRef = element;
            }}
            class="dashboard-grid"
          >
            <For each={widgets()}>
              {(widget) => {
                const position = () => currentLayout(widget);
                const batchFor = useDashboardWidgetBatch();

                return (
                  <article
                    class={cn(
                      "dashboard-widget group relative flex min-h-0 flex-col rounded-lg border border-border bg-card p-3 shadow-[var(--card-highlight)] transition-[border-color,box-shadow] duration-[var(--duration-hover)] ease-swift",
                      `dashboard-widget-${widget.type}`,
                      editing() && "hover:border-border-strong",
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
                          class="dashboard-drag-handle -ml-1 mt-0.5 flex size-7 cursor-grab touch-none items-center justify-center rounded text-muted-foreground transition-colors duration-[var(--duration-hover)] ease-swift hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 active:cursor-grabbing active:bg-hover"
                          onPointerDown={(event) => startDrag(event, widget, "move")}
                        >
                          <GripVertical class="size-3.5" />
                        </button>
                      </Show>
                      <div class="min-w-0 flex-1">
                        <h2 class="truncate text-[12.5px] font-medium text-foreground">
                          {widget.title}
                        </h2>
                        <p class="truncate text-[10px] capitalize text-muted-foreground">
                          {widget.type === "markdown"
                            ? "Markdown"
                            : `${widget.type} · ${String(widgetConfig(widget).dataset ?? "devices")}`}
                        </p>
                      </div>
                      <Show when={editing()}>
                        <div class="flex shrink-0 items-center gap-1">
                          <Button
                            size="xs"
                            variant="ghost"
                            class="min-h-9 sm:min-h-0"
                            onClick={() => openEdit(widget)}
                          >
                            Edit
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            aria-label={`Remove ${widget.title}`}
                            class="min-h-9 min-w-9 text-muted-foreground hover:text-destructive sm:min-h-0 sm:min-w-0"
                            disabled={removeWidget.isPending}
                            onClick={() => setRemoveWidgetTarget(widget)}
                          >
                            <X class="size-3" />
                          </Button>
                        </div>
                      </Show>
                    </header>
                    <div class="min-h-0 flex-1 overflow-hidden">
                      <DashboardWidgetView
                        widget={widget}
                        tenantId={params.tenantId!}
                        batch={batchFor?.(widget)}
                      />
                    </div>
                    <Show when={editing()}>
                      <button
                        type="button"
                        aria-label={`Resize ${widget.title}`}
                        class="dashboard-resize-handle absolute bottom-1 right-1 size-4 cursor-nwse-resize touch-none rounded-sm border-b border-r border-muted-foreground transition-colors duration-[var(--duration-hover)] ease-swift hover:border-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                        onPointerDown={(event) => startDrag(event, widget, "resize")}
                      />
                    </Show>
                  </article>
                );
              }}
            </For>
          </div>
        </DashboardWidgetBatchProvider>
      </Show>

      <Dialog open={editorOpen()} onOpenChange={setEditorOpen}>
        <DialogContent class="max-w-2xl rounded-xl border border-border bg-card p-5">
          <DialogHeader>
            <DialogTitle>{editingWidget() ? "Edit widget" : "Add widget"}</DialogTitle>
            <DialogDescription>
              Widgets run live queries against this tenant, so everyone sees current data.
            </DialogDescription>
          </DialogHeader>
          <div class="space-y-3">
            <div class="grid gap-2 sm:grid-cols-[140px_minmax(0,1fr)]">
              <label>
                <span class="mb-1 block text-[11px] font-medium text-muted-foreground">Type</span>
                <select
                  class="h-8 w-full rounded-md border border-input bg-background px-2 text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                  value={draft().type}
                  onChange={(event) => {
                    const type = Option.getOrUndefined(decodeWidgetType(event.currentTarget.value));

                    if (type !== undefined) changeType(type);
                  }}
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
                  value={configString(draft().config, "markdown") ?? ""}
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
                      const nextDataset = Option.getOrUndefined(
                        decodeDataset(event.currentTarget.value),
                      );

                      if (nextDataset === undefined) return;
                      setDraft((value) => {
                        const config = defaultConfig(value.type);

                        if (value.type === "table")
                          config.columns = [...tableColumnsFor(nextDataset)];

                        if (value.type === "pie") config.dimension = pieDimensionFor(nextDataset);

                        config.dataset = nextDataset;

                        if (nextDataset === "users") {
                          delete config.query;
                          config.userFilter = {};
                        } else {
                          delete config.userFilter;
                          config.query = { all: [] };
                        }

                        return {
                          ...value,
                          config: { ...config, dataset: nextDataset },
                        };
                      });
                    }}
                  >
                    <option value="devices">Devices</option>
                    <option value="software">Software inventory</option>
                    <option value="users">Users (directory)</option>
                  </select>
                </label>
                <Show when={draft().type === "pie"}>
                  <label>
                    <span class="mb-1 block text-[11px] font-medium text-muted-foreground">
                      Group by
                    </span>
                    <select
                      class="h-8 w-full rounded-md border border-input bg-background px-2 text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                      value={configString(draft().config, "dimension") ?? "platform"}
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
                      value={configString(draft().config, "label") ?? ""}
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

              <Show
                when={dataset() !== "users"}
                fallback={
                  <div class="rounded-lg border border-border bg-surface p-2.5">
                    <label class="block">
                      <span class="mb-1 block text-[11px] font-medium text-muted-foreground">
                        Directory filter
                      </span>
                      <select
                        class="h-8 w-full rounded-md border border-input bg-background px-2 text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                        value={configUserStatus(draft().config)}
                        onChange={(event) => {
                          const status = event.currentTarget.value;

                          const userFilter: MutableJsonObject = status === "all" ? {} : { status };

                          setDraft((value) => ({
                            ...value,
                            config: { ...value.config, userFilter },
                          }));
                        }}
                      >
                        <option value="all">All users</option>
                        <option value="active">Active only</option>
                        <option value="disabled">Inactive only</option>
                      </select>
                    </label>
                    <p class="mt-1.5 text-[11px] text-muted-foreground">
                      The tenant directory, including people who have never signed in. Inactive
                      people are accounts an administrator disabled.
                    </p>
                  </div>
                }
              >
                <div class="rounded-lg border border-border bg-surface p-2.5">
                  <DeviceQueryBuilder
                    compact
                    dataset={dataset()}
                    disabled={saveWidget.isPending}
                    query={Option.getOrUndefined(decodeDeviceQuery(draft().config.query)) ?? null}
                    onChange={(query) =>
                      setDraft((value) => ({
                        ...value,
                        config: { ...value.config, query: query ?? { all: [] } },
                      }))
                    }
                  />
                </div>
              </Show>

              <Show when={draft().type === "table"}>
                <div>
                  <span class="mb-1.5 block text-[11px] font-medium text-muted-foreground">
                    Columns
                  </span>
                  <div class="flex flex-wrap gap-1.5">
                    <For each={columnOptions()}>
                      {([id, label]) => {
                        const checked = () => configColumns(draft().config).includes(id);

                        return (
                          <button
                            type="button"
                            aria-pressed={checked() ? "true" : "false"}
                            onClick={() => toggleColumn(id)}
                            class={cn(
                              "rounded-full border px-2.5 py-1 text-[11px] transition-[color,background-color,border-color] duration-[var(--duration-hover)] ease-swift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                              checked()
                                ? "border-border bg-hover text-foreground hover:border-border-strong"
                                : "border-border text-muted-foreground hover:bg-hover hover:text-foreground",
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

      <section class="rounded-xl border border-border bg-card p-4">
        <h2 class="text-[12.5px] font-medium text-foreground">Scope tags</h2>
        <p class="mb-3 mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
          Limit which delegated administrators can see and edit this dashboard. Its widgets are
          tenant-wide queries, so a scoped administrator cannot run them yet.
        </p>
        <ScopeTagAssignmentEditor
          tenantId={params.tenantId!}
          resourceType="dashboard"
          resourceIds={[params.dashboardId!]}
        />
      </section>

      <p class="text-[11px] text-muted-foreground">
        Shared with everyone in this tenant.
        <Show when={dashboard.data?.updatedAt}>
          {" "}
          Last updated {relativeTime(dashboard.data!.updatedAt)}.
        </Show>
      </p>

      <ConfirmDialog
        open={confirmDeleteDashboard()}
        onOpenChange={setConfirmDeleteDashboard}
        title={`Delete “${dashboard.data?.name ?? "this dashboard"}”?`}
        description="This removes the dashboard and its layout. This cannot be undone."
        confirmLabel="Delete dashboard"
        destructive
        pending={removeDashboard.isPending}
        onConfirm={() => removeDashboard.mutate()}
      />

      <ConfirmDialog
        open={removeWidgetTarget() !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveWidgetTarget(null);
        }}
        title={`Remove “${removeWidgetTarget()?.title ?? "this widget"}”?`}
        description="The widget and its layout position are removed from this dashboard."
        confirmLabel="Remove widget"
        destructive
        pending={removeWidget.isPending}
        onConfirm={() => {
          const target = removeWidgetTarget();

          if (target) removeWidget.mutate(target);
        }}
      />
    </Page>
  );
}
