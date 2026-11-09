import { useNavigate, useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { For, Show } from "solid-js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { SidebarMenuButton, sidebarMenuButtonVariants, useSidebar } from "~/components/ui/sidebar";
import { Building2, Check, ChevronsUpDown, Plus } from "~/components/ui/icons";
import { enterprise, enterpriseKeys, resolveActiveTenant } from "~/lib/enterprise";
import { cn } from "~/lib/utils";

export function TenantSwitcher() {
  const params = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { state } = useSidebar();
  const me = useQuery(() => ({ queryKey: enterpriseKeys.me(), queryFn: enterprise.me }));

  const active = () => resolveActiveTenant(me.data, params.tenantId);

  const switchTenant = useMutation(() => ({
    mutationFn: (tenantId: string) => enterprise.updateMe({ activeTenantId: tenantId }),
    onSuccess: async (_result, tenantId) => {
      await queryClient.invalidateQueries({ queryKey: enterpriseKeys.me() });
      navigate(`/t/${tenantId}/devices`);
    },
  }));

  return (
    <DropdownMenu placement="bottom-start">
      <DropdownMenuTrigger
        class={cn(
          sidebarMenuButtonVariants({ size: "lg" }),
          "h-auto w-full gap-2 px-2 py-2 data-expanded:bg-sidebar-accent",
        )}
        title={active()?.name ?? "Select tenant"}
      >
        <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-stone-900 text-white">
          <Building2 class="size-4" />
        </span>
        <span class="min-w-0 flex-1 text-left group-data-[collapsible=icon]:hidden">
          <span class="block truncate text-sm font-semibold">{active()?.name ?? "No tenant"}</span>
          <span class="block truncate text-xs text-muted-foreground">
            {active()?.slug ?? "Create a tenant"}
          </span>
        </span>
        <ChevronsUpDown class="size-4 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden" />
      </DropdownMenuTrigger>
      <DropdownMenuContent class="w-64 rounded-xl border bg-white p-1 shadow-lg">
        <DropdownMenuGroup>
          <DropdownMenuLabel class="flex items-center justify-between px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Tenants
            <Show when={switchTenant.isPending}>
              <span class="text-[10px] font-normal normal-case">Switching…</span>
            </Show>
          </DropdownMenuLabel>
          <Show
            when={(me.data?.tenants.length ?? 0) > 0}
            fallback={
              <p class="px-3 py-2 text-sm text-muted-foreground">
                You don't belong to a tenant yet.
              </p>
            }
          >
            <For each={me.data?.tenants ?? []}>
              {(tenant) => (
                <DropdownMenuItem
                  onSelect={() => switchTenant.mutate(tenant.id)}
                  disabled={switchTenant.isPending}
                  class="rounded-lg px-3 py-2 text-sm"
                >
                  <span class="flex size-7 shrink-0 items-center justify-center rounded-md bg-stone-100 text-stone-600">
                    <Building2 class="size-4" />
                  </span>
                  <div class="min-w-0 flex-1">
                    <p class="truncate font-medium text-stone-900">{tenant.name}</p>
                    <p class="truncate text-xs capitalize text-muted-foreground">{tenant.role}</p>
                  </div>
                  <Check
                    class={cn(
                      "ml-auto size-4 shrink-0",
                      active()?.id === tenant.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                </DropdownMenuItem>
              )}
            </For>
          </Show>
        </DropdownMenuGroup>
        <DropdownMenuSeparator class="my-1" />
        <DropdownMenuItem
          onSelect={() => navigate("/tenants/new")}
          class="rounded-lg px-3 py-2 text-sm"
        >
          <Plus class="mr-2 size-4" />
          Create tenant
        </DropdownMenuItem>
        <Show when={switchTenant.error}>
          <p class="px-3 py-2 text-xs text-red-600">
            {switchTenant.error instanceof Error
              ? switchTenant.error.message
              : "Could not switch tenant"}
          </p>
        </Show>
        <Show when={state() === "collapsed"}>
          <DropdownMenuSeparator class="my-1" />
          <p class="px-3 py-1 text-[11px] text-muted-foreground">
            Expand the sidebar to see tenant names.
          </p>
        </Show>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
