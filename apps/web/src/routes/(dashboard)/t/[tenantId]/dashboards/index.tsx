import { useNavigate, useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createSignal, For, Show } from "solid-js";
import {
  EmptyState,
  LinkButton,
  Page,
  PageHeader,
  Panel,
  QueryError,
  relativeTime,
} from "~/components/mdm/common";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { LayoutDashboard, Plus, Star } from "~/components/ui/icons";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";

export default function DashboardsPage() {
  const params = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const dashboards = useQuery(() => enterpriseQueries.dashboards(params.tenantId));
  const [name, setName] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: enterpriseKeys.dashboards(params.tenantId) });

  const create = useMutation(() => ({
    mutationFn: async () => {
      const title = name().trim();
      if (!title) throw new Error("Give the dashboard a name first");
      return enterprise.createDashboard(params.tenantId, { name: title });
    },
    onSuccess: async (result) => {
      setName("");
      setError(null);
      await invalidate();
      navigate(`/t/${params.tenantId}/dashboards/${result.id}?edit=1`);
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : "Could not create the dashboard"),
  }));

  const makeDefault = useMutation(() => ({
    mutationFn: (id: string) => enterprise.patchDashboard(params.tenantId, id, { isDefault: true }),
    onSuccess: invalidate,
  }));

  const remove = useMutation(() => ({
    mutationFn: (id: string) => enterprise.deleteDashboard(params.tenantId, id),
    onSuccess: invalidate,
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
        actions={<LinkButton href={`/t/${params.tenantId}`}>Open Overview</LinkButton>}
      />

      <QueryError error={dashboards.error} onRetry={() => void dashboards.refetch()} />

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
              <article class="group flex min-w-0 flex-col rounded-lg border border-white/[0.07] bg-card p-4 transition-colors hover:border-white/[0.12]">
                <div class="flex items-start justify-between gap-2">
                  <a
                    href={`/t/${params.tenantId}/dashboards/${dashboard.id}`}
                    class="min-w-0 flex-1"
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
                    href={`/t/${params.tenantId}/dashboards/${dashboard.id}`}
                    size="xs"
                    variant="outline"
                  >
                    Open
                  </Button>
                  <Button
                    as="a"
                    href={`/t/${params.tenantId}/dashboards/${dashboard.id}?edit=1`}
                    size="xs"
                    variant="ghost"
                  >
                    Edit
                  </Button>
                  <Show when={!dashboard.isDefault}>
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={makeDefault.isPending}
                      onClick={() => makeDefault.mutate(dashboard.id)}
                    >
                      Set as Overview
                    </Button>
                  </Show>
                  <Button
                    size="xs"
                    variant="ghost"
                    class="ml-auto text-muted-foreground hover:text-destructive"
                    disabled={remove.isPending}
                    onClick={() => {
                      if (window.confirm(`Delete “${dashboard.name}”? This cannot be undone.`))
                        remove.mutate(dashboard.id);
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </article>
            )}
          </For>
        </div>
      </Show>
    </Page>
  );
}
