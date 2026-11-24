import { useParams } from "@solidjs/router";
import type { RoutePreloadFuncArgs } from "@solidjs/router";
import { useNavigate } from "~/lib/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import {
  EmptyState,
  ErrorText,
  Page,
  PageHeader,
  QueryError,
  relativeTime,
} from "~/components/mdm/common";
import { DashboardWidgetBatchProvider } from "~/components/dashboard/widget";
import { DashboardPreview } from "~/components/dashboard/preview";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@mattrax/ui";
import { Input } from "~/components/ui/input";
import { ScopeTagSelect } from "~/components/scope-tags/scope-tag-select";
import {
  ChevronDown,
  Ellipsis,
  LayoutDashboard,
  Pin,
  Plus,
  Search,
  Star,
} from "~/components/ui/icons";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";
import type { DashboardSummary } from "~/lib/enterprise";
import { errorMessage } from "~/lib/errors";
import { preloadPage } from "~/lib/page-data";
import { useCan } from "~/lib/permissions";
import { queryClient as appQueryClient } from "~/lib/query-client";
import { routes } from "~/lib/routes";
import { optimisticUpdate } from "~/lib/optimistic";
import {
  isDashboardPinned,
  prunePinnedDashboards,
  togglePinnedDashboard,
} from "~/lib/pinned-dashboards";
import { resolveTenantId } from "~/lib/tenant";
import { isSubmitEnter } from "~/lib/ime";
import { cn } from "~/lib/utils";

export const route = {
  preload: ({ params, intent }: RoutePreloadFuncArgs) => {
    if (intent === "initial") return;

    return preloadPage([
      () => appQueryClient.ensureQueryData(enterpriseQueries.dashboards(params.tenantId)),
    ]);
  },
};

type Filter = "all" | "pinned" | "custom";
type Sort = "name" | "recent" | "widgets";

const FILTER_LABELS: Record<Filter, string> = {
  all: "All",
  pinned: "Pinned",
  custom: "Custom",
};

export default function DashboardsPage() {
  const params = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useCan();
  const writable = () => can("dashboards.write");
  const dashboards = useQuery(() => enterpriseQueries.dashboards(params.tenantId));
  const tenantId = () => resolveTenantId(params.tenantId) ?? params.tenantId ?? "";

  // A deleted dashboard must not leave a dead link in the rail.
  createEffect(
    () => dashboards.data?.dashboards,
    (list) => {
      if (list) prunePinnedDashboards(tenantId(), new Set(list.map((dashboard) => dashboard.id)));
    },
  );

  const [name, setName] = createSignal("");
  const [scopeTags, setScopeTags] = createSignal<Array<string>>([]);
  const [error, setError] = createSignal<string | null>(null);
  const [createOpen, setCreateOpen] = createSignal(false);
  const [filter, setFilter] = createSignal<Filter>("all");
  const [search, setSearch] = createSignal("");
  const [sort, setSort] = createSignal<Sort>("name");
  const [makeDefaultError, setMakeDefaultError] = createSignal<unknown>(null);
  const [removeError, setRemoveError] = createSignal<unknown>(null);
  const [removeTarget, setRemoveTarget] = createSignal<{ id: string; name: string } | null>(null);

  const all = () => dashboards.data?.dashboards ?? [];

  const counts = createMemo(() => ({
    all: all().length,
    pinned: all().filter((dashboard) => isDashboardPinned(tenantId(), dashboard.id)).length,
    custom: all().filter((dashboard) => !dashboard.isDefault).length,
  }));

  const visible = createMemo(() => {
    const query = search().trim().toLowerCase();
    const filtered = all().filter((dashboard) => {
      if (filter() === "pinned" && !isDashboardPinned(tenantId(), dashboard.id)) return false;
      if (filter() === "custom" && dashboard.isDefault) return false;
      if (!query) return true;

      return (
        dashboard.name.toLowerCase().includes(query) ||
        (dashboard.description ?? "").toLowerCase().includes(query)
      );
    });

    return [...filtered].sort((a, b) => {
      if (sort() === "widgets") return b.widgetCount - a.widgetCount;
      if (sort() === "recent")
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;

      return a.name.localeCompare(b.name);
    });
  });

  const previewWidgets = createMemo(() =>
    visible().flatMap((dashboard) => dashboard.previewWidgets ?? []),
  );

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: enterpriseKeys.dashboards(params.tenantId) });

  const create = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: async () => {
      const title = name().trim();

      if (!title) throw new Error("Give the dashboard a name first");

      return enterprise.createDashboard(params.tenantId, { name: title });
    },
    onSuccess: async (result) => {
      // Tagging is a second request. If it fails, keep the created resource
      // and let the detail page's tag editor retry rather than leaving the
      // form ready to create a duplicate on the next click.
      if (scopeTags().length > 0) {
        try {
          await enterprise.setScopeTagAssignments(params.tenantId, {
            resourceType: "dashboard",
            resourceIds: [result.id],
            tagIds: scopeTags(),
          });
        } catch {
          // The resource exists; its tag editor remains available.
        }
      }

      setCreateOpen(false);
      setName("");
      setScopeTags([]);
      setError(null);
      navigate(routes.tenant(params.tenantId).dashboard(result.id, { edit: "1" }));
      void invalidate();
    },
    onError: (cause) => setError(errorMessage(cause, "Could not create the dashboard. Try again.")),
  }));

  const makeDefault = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: (id: string) => enterprise.patchDashboard(params.tenantId, id, { isDefault: true }),
    onMutate: async (id) => {
      setMakeDefaultError(null);

      const restore = await optimisticUpdate<{ dashboards: { id: string; isDefault?: boolean }[] }>(
        queryClient,
        enterpriseKeys.dashboards(params.tenantId),
        (current) => ({
          ...current,
          dashboards: current.dashboards.map((dashboard) => ({
            ...dashboard,
            isDefault: dashboard.id === id,
          })),
        }),
      );

      return { restore };
    },
    onSuccess: () => {
      setMakeDefaultError(null);
      void invalidate();
    },
    onError: (cause, _id, context) => {
      context?.restore();
      setMakeDefaultError(cause);
    },
  }));

  const remove = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: (id: string) => enterprise.deleteDashboard(params.tenantId, id),
    onMutate: async (id) => {
      setRemoveError(null);

      const restore = await optimisticUpdate<{ dashboards: { id: string }[] }>(
        queryClient,
        enterpriseKeys.dashboards(params.tenantId),
        (current) => ({
          ...current,
          dashboards: current.dashboards.filter((dashboard) => dashboard.id !== id),
        }),
      );

      setRemoveTarget(null);

      return { restore };
    },
    onSuccess: () => {
      setRemoveError(null);
      void invalidate();
    },
    onError: (cause, _id, context) => {
      context?.restore();
      setRemoveError(cause);
    },
  }));

  const openCreate = () => {
    setName("");
    setError(null);
    setCreateOpen(true);
  };

  const pin = (dashboard: DashboardSummary) =>
    togglePinnedDashboard({
      tenantId: tenantId(),
      dashboardId: dashboard.id,
      name: dashboard.name,
    });

  return (
    <Page>
      <PageHeader
        eyebrow="Shared views"
        title="Dashboards"
        description="Build shared views of your fleet. The default dashboard is what everyone sees on Overview."
        meta={
          <Show when={dashboards.data}>
            <span class="tabular-nums">
              {counts().all} dashboard{counts().all === 1 ? "" : "s"}
              <Show when={counts().pinned > 0}>
                <span class="px-1.5 text-subtle-foreground/40">·</span>
                {counts().pinned} pinned
              </Show>
            </span>
          </Show>
        }
        actions={
          <>
            <Button
              as="a"
              href={routes.tenant(params.tenantId).overview()}
              size="sm"
              variant="outline"
            >
              Open overview
            </Button>
            <Show when={writable()}>
              <Button size="sm" onClick={openCreate}>
                <Plus class="size-3.5" />
                New dashboard
              </Button>
            </Show>
          </>
        }
      />

      <QueryError error={dashboards.error} onRetry={() => void dashboards.refetch()} />

      <Show when={makeDefaultError() || removeError()}>
        <div class="space-y-2">
          <ErrorText error={makeDefaultError()} />
          <ErrorText error={removeError()} />
        </div>
      </Show>

      <Show
        when={dashboards.data}
        fallback={
          <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <For each={[0, 1, 2, 3, 4, 5]}>
              {() => (
                <div class="overflow-hidden rounded-xl border border-border bg-card">
                  <div class="h-[168px] animate-pulse border-b border-border bg-surface/60" />
                  <div class="space-y-2 p-4">
                    <span class="block h-2 w-16 animate-pulse rounded-full bg-hover" />
                    <span class="block h-3 w-2/3 animate-pulse rounded-full bg-hover" />
                    <span class="block h-2 w-full animate-pulse rounded-full bg-hover" />
                  </div>
                </div>
              )}
            </For>
          </div>
        }
      >
        <Show
          when={counts().all > 0}
          fallback={
            <EmptyState
              icon={LayoutDashboard}
              title="No dashboards yet"
              description="Create a dashboard to build shared tables, charts and team notes. The first one becomes the Overview."
            />
          }
        >
          <div class="flex flex-wrap items-center gap-2">
            <div class="inline-flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5 shadow-card">
              <For each={Object.keys(FILTER_LABELS) as Filter[]}>
                {(value) => (
                  <button
                    type="button"
                    onClick={() => setFilter(value)}
                    aria-pressed={filter() === value ? "true" : "false"}
                    class={cn(
                      "inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[11.5px] font-[500] transition-colors",
                      filter() === value
                        ? "bg-hover text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {FILTER_LABELS[value]}
                    <span class="tabular-nums text-[10px] text-subtle-foreground">
                      {counts()[value]}
                    </span>
                  </button>
                )}
              </For>
            </div>

            <div class="relative min-w-[13rem] flex-1 sm:max-w-xs">
              <Search
                class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={search()}
                onInput={(event) => setSearch(event.currentTarget.value)}
                placeholder="Search dashboards"
                class="h-7 pl-8"
                aria-label="Search dashboards"
              />
            </div>

            <div class="ml-auto">
              <DropdownMenu placement="bottom-end">
                <DropdownMenuTrigger class="flex h-7 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[11.5px] text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60">
                  Sort: {sort() === "name" ? "Name" : sort() === "recent" ? "Recent" : "Widgets"}
                  <ChevronDown class="size-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent class="w-40">
                  <DropdownMenuRadioGroup
                    value={sort()}
                    onValueChange={(value) => setSort(value as Sort)}
                  >
                    <DropdownMenuRadioItem value="name" indicator="check">
                      Name
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="recent" indicator="check">
                      Recently updated
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="widgets" indicator="check">
                      Most widgets
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <Show
            when={visible().length > 0}
            fallback={
              <EmptyState
                icon={Search}
                title="No dashboards match"
                description={
                  filter() !== "all" || search().trim()
                    ? "Try a different filter or search term."
                    : "Create a dashboard to get started."
                }
              />
            }
          >
            <DashboardWidgetBatchProvider widgets={previewWidgets()} tenantId={tenantId()}>
              <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <For each={visible()}>
                  {(dashboard) => (
                    <article class="group flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card transition-[border-color,box-shadow] duration-[var(--duration-hover)] ease-swift hover:border-border-strong hover:shadow-card">
                      <a
                        href={routes.tenant(params.tenantId).dashboard(dashboard.id)}
                        class="block outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                        aria-label={`Open ${dashboard.name}`}
                      >
                        <DashboardPreview
                          widgets={dashboard.previewWidgets}
                          widgetCount={dashboard.widgetCount}
                        />
                      </a>

                      <div class="flex flex-1 flex-col p-4">
                        <div class="flex min-w-0 items-center gap-2">
                          <span class="label-caps inline-flex items-center gap-1 rounded-full border border-border bg-surface px-1.5 py-0.5 text-[9px]">
                            <Show when={dashboard.isDefault}>
                              <Star class="size-2.5" />
                            </Show>
                            {dashboard.isDefault ? "Overview" : "Custom"}
                          </span>
                          <span class="tabular-nums text-[10.5px] text-muted-foreground">
                            {dashboard.widgetCount} widget
                            {dashboard.widgetCount === 1 ? "" : "s"}
                          </span>
                          <Show when={isDashboardPinned(tenantId(), dashboard.id)}>
                            <span class="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                              <Pin class="size-3 fill-current" />
                              Pinned
                            </span>
                          </Show>
                        </div>

                        <a
                          href={routes.tenant(params.tenantId).dashboard(dashboard.id)}
                          class="mt-2.5 rounded-[4px] outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                        >
                          <h2 class="truncate text-[14px] font-[560] tracking-[-0.012em] text-foreground group-hover:underline">
                            {dashboard.name}
                          </h2>
                          <p class="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-muted-foreground">
                            {dashboard.description?.trim() || "No description yet."}
                          </p>
                        </a>

                        <div class="mt-auto flex items-center justify-between gap-2 pt-4">
                          <span class="truncate text-[10.5px] text-muted-foreground">
                            Updated {relativeTime(dashboard.updatedAt)}
                          </span>
                          <DashboardCardMenu
                            dashboard={dashboard}
                            tenantId={tenantId()}
                            writable={writable()}
                            pendingDefault={makeDefault.isPending}
                            pendingDelete={remove.isPending}
                            onOpen={() =>
                              navigate(routes.tenant(params.tenantId).dashboard(dashboard.id))
                            }
                            onEdit={() =>
                              navigate(
                                routes
                                  .tenant(params.tenantId)
                                  .dashboard(dashboard.id, { edit: "1" }),
                              )
                            }
                            onPin={() => pin(dashboard)}
                            onSetDefault={() => makeDefault.mutate(dashboard.id)}
                            onDelete={() =>
                              setRemoveTarget({ id: dashboard.id, name: dashboard.name })
                            }
                          />
                        </div>
                      </div>
                    </article>
                  )}
                </For>
              </div>
            </DashboardWidgetBatchProvider>
          </Show>
        </Show>
      </Show>

      <Dialog
        open={createOpen()}
        onOpenChange={(open) => {
          setCreateOpen(open);

          if (!open) {
            setName("");
            setError(null);
          }
        }}
      >
        <DialogContent class="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New dashboard</DialogTitle>
            <DialogDescription>
              Start empty, then add tables, charts, counts and markdown notes.
            </DialogDescription>
          </DialogHeader>
          <label class="mt-1 block">
            <span class="mb-1 block text-[11px] font-medium text-muted-foreground">Name</span>
            <Input
              value={name()}
              onInput={(event) => setName(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (isSubmitEnter(event) && name().trim() && !create.isPending) {
                  event.preventDefault();
                  create.mutate();
                }
              }}
              placeholder="Fleet operations"
              autofocus
            />
          </label>
          <ScopeTagSelect
            tenantId={params.tenantId!}
            value={scopeTags()}
            onChange={setScopeTags}
          />
          <Show when={error()}>
            <p role="alert" class="text-[12px] text-destructive">
              {error()}
            </p>
          </Show>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={create.isPending || !name().trim()}
              onClick={() => create.mutate()}
            >
              {create.isPending ? "Creating…" : "Create dashboard"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={removeTarget() !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        title={`Delete “${removeTarget()?.name ?? "this dashboard"}”?`}
        description="This removes the dashboard and its layout. This cannot be undone."
        confirmLabel="Delete dashboard"
        destructive
        pending={remove.isPending}
        onConfirm={() => {
          const target = removeTarget();

          if (target) remove.mutate(target.id);
        }}
      />
    </Page>
  );
}

function DashboardCardMenu(props: {
  dashboard: DashboardSummary;
  tenantId: string;
  writable: boolean;
  pendingDefault: boolean;
  pendingDelete: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onPin: () => void;
  onSetDefault: () => void;
  onDelete: () => void;
}) {
  const pinned = () => isDashboardPinned(props.tenantId, props.dashboard.id);

  return (
    <DropdownMenu placement="bottom-end">
      <DropdownMenuTrigger
        aria-label={`Actions for ${props.dashboard.name}`}
        class="flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <Ellipsis class="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent class="w-44">
        <DropdownMenuItem onSelect={props.onOpen}>Open</DropdownMenuItem>
        <Show when={props.writable}>
          <DropdownMenuItem onSelect={props.onEdit}>Edit dashboard</DropdownMenuItem>
        </Show>
        <DropdownMenuItem onSelect={props.onPin}>
          {pinned() ? "Unpin from sidebar" : "Pin to sidebar"}
        </DropdownMenuItem>
        <Show when={props.writable && !props.dashboard.isDefault}>
          <DropdownMenuItem disabled={props.pendingDefault} onSelect={props.onSetDefault}>
            Set as overview
          </DropdownMenuItem>
        </Show>
        <Show when={props.writable}>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={props.pendingDelete}
            onSelect={props.onDelete}
          >
            Delete dashboard
          </DropdownMenuItem>
        </Show>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
