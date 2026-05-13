import { useNavigate, useParams } from "@solidjs/router";
import { useQuery, useQueryClient } from "@tanstack/solid-query";
import { Building2, ChevronsUpDown, Plus } from "lucide-solid";
import { For, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "~/components/ui/dropdown-menu";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";
import { authClient } from "~/lib/auth";

export function TenantSwitcher() {
  const params = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useQuery(() => ({ queryKey: enterpriseKeys.me(), queryFn: enterprise.me }));
  const active = () => me.data?.tenants.find((tenant) => tenant.id === params.tenantId) ?? me.data?.activeTenant ?? me.data?.tenants[0];

  const switchTenant = async (tenantId: string) => {
    await authClient.setActiveTenant(tenantId);
    await queryClient.invalidateQueries({ queryKey: enterpriseKeys.me() });
    navigate(`/t/${tenantId}/devices`);
  };

  return (
    <DropdownMenu placement="bottom-start">
      <DropdownMenuTrigger as={Button} variant="ghost" class="h-auto w-full justify-start gap-2 px-2 py-2 text-left">
        <span class="flex size-8 items-center justify-center rounded-lg bg-stone-900 text-white"><Building2 class="size-4" /></span>
        <span class="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
          <span class="block truncate text-sm font-semibold">{active()?.name ?? "No tenant"}</span>
          <span class="block truncate text-xs text-muted-foreground">{active()?.slug ?? "Create a tenant"}</span>
        </span>
        <ChevronsUpDown class="size-4 text-muted-foreground group-data-[collapsible=icon]:hidden" />
      </DropdownMenuTrigger>
      <DropdownMenuContent class="w-64 rounded-xl border bg-white p-1 shadow-lg">
        <For each={me.data?.tenants ?? []}>{(tenant) => (
          <DropdownMenuItem onSelect={() => switchTenant(tenant.id)} class="rounded-lg px-3 py-2 text-sm">
            <div><p class="font-medium text-stone-900">{tenant.name}</p><p class="text-xs text-muted-foreground">{tenant.role}</p></div>
          </DropdownMenuItem>
        )}</For>
        <Show when={(me.data?.tenants.length ?? 0) > 0}><DropdownMenuSeparator class="my-1" /></Show>
        <DropdownMenuItem as="a" href="/tenants/new" class="rounded-lg px-3 py-2 text-sm"><Plus class="mr-2 size-4" />Create tenant</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
