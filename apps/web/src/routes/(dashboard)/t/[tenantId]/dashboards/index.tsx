import { type RoutePreloadFuncArgs, useParams } from "@solidjs/router";
import { useNavigate } from "~/lib/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createSignal, For, Show } from "solid-js";
import {
  EmptyState,
  ErrorText,
  LinkButton,
  Page,
  PageHeader,
  Panel,
  QueryError,
  relativeTime,
} from "~/components/mdm/common";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Input } from "~/components/ui/input";
import { LayoutDashboard, Plus, Star } from "~/components/ui/icons";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";
import { errorMessage } from "~/lib/errors";
import { preloadPage } from "~/lib/page-data";
import { useCan } from "~/lib/permissions";
import { queryClient as appQueryClient } from "~/lib/query-client";
import { routes } from "~/lib/routes";
import { optimisticUpdate } from "~/lib/optimistic";

export const route = {
  preload: ({ params, intent }: RoutePreloadFuncArgs) => {
    if (intent === "initial") return;

    return preloadPage([
      () => appQueryClient.ensureQueryData(enterpriseQueries.dashboards(params.tenantId)),
    ]);
  },
};

export default function DashboardsPage() {
  const params = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useCan();
  const writable = () => can("dashboards.write");
  const dashboards = useQuery(() => enterpriseQueries.dashboards(params.tenantId));
  const [name, setName] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [makeDefaultError, setMakeDefaultError] = createSignal<unknown>(null);
  const [removeError, setRemoveError] = createSignal<unknown>(null);
  const [removeTarget, setRemoveTarget] = createSignal<{ id: string; name: string } | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: enterpriseKeys.dashboards(params.tenantId) });

  const create = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: async () => {
      const title = name().trim();

      if (!title) throw new Error("Give the dashboard a name first");

      return enterprise.createDashboard(params.tenantId, { name: title });
    },
    onSuccess: (result) => {
      setName("");
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

  return (
    <Page>
      <PageHeader
        eyebrow="Shared views"
        title="Dashboards"
        description="Build shared views of your fleet. The default dashboard is what everyone sees on Overview."
        meta={
          <Show when={dashboards.data}>
            <span class="tabular-nums">
              {dashboards.data!.dashboards.length} dashboard
              {dashboards.data!.dashboards.length === 1 ? "" : "s"}
            </span>
          </Show>
        }
        actions={
          <LinkButton href={routes.tenant(params.tenantId).overview()}>Open Overview</LinkButton>
        }
      />

      <QueryError error={dashboards.error} onRetry={() => void dashboards.refetch()} />

      <Show when={writable()}>
        <Panel
          title="Create a dashboard"
          description="Start empty, then add tables, charts, counts and markdown notes."
        >
          <form
            class="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();

              if (!create.isPending) create.mutate();
            }}
          >
            <label class="min-w-0 flex-1">
              <span class="mb-1 block text-[11px] font-medium text-muted-foreground">Name</span>
              <Input
                value={name()}
                onInput={(event) => setName(event.currentTarget.value)}
                placeholder="Fleet operations"
                class="h-8"
              />
            </label>
            <Button type="submit" size="sm" disabled={create.isPending || !name().trim()}>
              <Plus class="size-3.5" />
              {create.isPending ? "Creating…" : "Create dashboard"}
            </Button>
          </form>
          <Show when={error()}>
            <p role="alert" class="mt-2 text-[12px] text-destructive">
              {error()}
            </p>
          </Show>
        </Panel>
      </Show>

      <Show when={makeDefaultError() || removeError()}>
        <div class="space-y-2">
          <ErrorText error={makeDefaultError()} />
          <ErrorText error={removeError()} />
        </div>
      </Show>

      <Show
        when={(dashboards.data?.dashboards.length ?? 0) > 0}
        fallback={
          <EmptyState
            icon={LayoutDashboard}
            title="No dashboards yet"
            description="Create a dashboard to build shared tables, charts and team notes. The first one becomes the Overview."
          />
        }
      >
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <For each={dashboards.data!.dashboards}>
            {(dashboard) => (
              <article class="group flex min-w-0 flex-col rounded-lg border border-border bg-card p-4 transition-[border-color,box-shadow] duration-[var(--duration-hover)] ease-swift hover:border-border-strong hover:shadow-card">
                <div class="flex items-start justify-between gap-2">
                  <a
                    href={routes.tenant(params.tenantId).dashboard(dashboard.id)}
                    class="min-w-0 flex-1 rounded-[4px] outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  >
                    <h2 class="truncate text-[13.5px] font-medium text-foreground group-hover:underline">
                      {dashboard.name}
                    </h2>
                    <p class="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-muted-foreground">
                      {dashboard.description?.trim() || "No description"}
                    </p>
                  </a>
                  <Show when={dashboard.isDefault}>
                    <Badge variant="secondary" class="shrink-0 gap-1">
                      <Star class="size-3" />
                      Overview
                    </Badge>
                  </Show>
                </div>
                <div class="mt-4 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span class="tabular-nums">
                    {dashboard.widgetCount} widget{dashboard.widgetCount === 1 ? "" : "s"}
                  </span>
                  <span class="text-muted-foreground/40" aria-hidden="true">
                    ·
                  </span>
                  <span>Updated {relativeTime(dashboard.updatedAt)}</span>
                </div>
                <div class="mt-4 flex flex-wrap gap-2">
                  <Button
                    as="a"
                    href={routes.tenant(params.tenantId).dashboard(dashboard.id)}
                    size="xs"
                    variant="outline"
                  >
                    Open
                  </Button>
                  <Show when={writable()}>
                    <Button
                      as="a"
                      href={routes.tenant(params.tenantId).dashboard(dashboard.id, { edit: "1" })}
                      size="xs"
                      variant="ghost"
                    >
                      Edit
                    </Button>
                  </Show>
                  <Show when={writable() && !dashboard.isDefault}>
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={makeDefault.isPending}
                      onClick={() => makeDefault.mutate(dashboard.id)}
                    >
                      Set as Overview
                    </Button>
                  </Show>
                  <Show when={writable()}>
                    <Button
                      size="xs"
                      variant="destructive"
                      class="ml-auto"
                      disabled={remove.isPending}
                      onClick={() => setRemoveTarget({ id: dashboard.id, name: dashboard.name })}
                    >
                      Delete
                    </Button>
                  </Show>
                </div>
              </article>
            )}
          </For>
        </div>
      </Show>

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
