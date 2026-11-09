import { useNavigate } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { For, Show } from "solid-js";
import { EmptyState, PageHeader } from "~/components/mdm/common";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Building2, Plus } from "~/components/ui/icons";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";

/**
 * Workspace picker. Tenant ids always travel in the URL (`/t/:tenantId/...`),
 * so this page never stores a selection; choosing a workspace navigates to its
 * tenant-scoped route.
 */
export default function DashboardPage() {
  const navigate = useNavigate();
  const me = useQuery(() => ({ queryKey: enterpriseKeys.me(), queryFn: enterprise.me }));

  return (
    <div class="flex flex-1 flex-col gap-6 p-6">
      <PageHeader
        title="Workspaces"
        description="Choose a tenant to manage its devices, groups and policies."
        actions={
          <Show when={me.data?.tenants.length}>
            <Button onClick={() => navigate("/tenants/new")}>
              <Plus class="size-4" />
              Create tenant
            </Button>
          </Show>
        }
      />

      <Show
        when={(me.data?.tenants.length ?? 0) > 0}
        fallback={
          <Show when={me.isSuccess}>
            <EmptyState
              title="No tenant yet"
              description="Tenants hold your devices, groups, policies, and team. Create one to get started."
              action={
                <Button onClick={() => navigate("/tenants/new")}>
                  <Plus class="size-4" />
                  Create tenant
                </Button>
              }
            />
          </Show>
        }
      >
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <For each={me.data?.tenants ?? []}>
            {(tenant) => (
              <button
                type="button"
                onClick={() => navigate(`/t/${tenant.id}`)}
                class="flex items-start gap-4 rounded-xl border bg-card p-5 text-left transition-colors hover:bg-muted/40"
              >
                <span class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-stone-900 text-white">
                  <Building2 class="size-5" />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-semibold text-stone-900">
                    {tenant.name}
                  </span>
                  <span class="block truncate text-xs text-muted-foreground">{tenant.slug}</span>
                  <Badge variant="outline" class="mt-2 capitalize">
                    {tenant.role}
                  </Badge>
                </span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
