import { useLocation, useNavigate } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { createEffect, createMemo, For, type ParentProps, Show } from "solid-js";
import { CommandPalette } from "~/components/command-palette";
import { TenantSwitcher } from "~/components/mdm/tenant-switcher";
import {
  Boxes,
  Laptop,
  LayoutDashboard,
  LinkIcon,
  LogOut,
  Settings,
  Search as SearchIcon,
  ShieldCheck,
  User,
  UsersRound,
} from "~/components/ui/icons";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "~/components/ui/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Separator } from "~/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  sidebarMenuButtonVariants,
  useSidebar,
} from "~/components/ui/sidebar";
import { enterprise, enterpriseKeys, resolveActiveTenant } from "~/lib/enterprise";
import { cn } from "~/lib/utils";
import { authClient } from "~/lib/auth";

type Crumb = { label: string; href?: string };

function breadcrumbForPath(path: string, tenantName?: string): Crumb[] {
  const crumbs: Crumb[] = [];
  if (path === "/dashboard") return [{ label: "Dashboard" }];
  if (path === "/account") return [{ label: "Account" }];
  if (path === "/settings") return [{ label: "Settings" }];
  if (path === "/tenants/new") return [{ label: "Tenants", href: "/dashboard" }, { label: "New tenant" }];

  const match = path.match(/^\/t\/([^/]+)(?:\/(.*))?$/);
  if (match) {
    const [, tenantId, rest = ""] = match;
    crumbs.push({ label: tenantName ?? "Tenant", href: `/t/${tenantId}/devices` });
    const [section, id, sub] = rest.split("/").filter(Boolean);
    const labels: Record<string, string> = {
      devices: "Devices",
      groups: "Groups",
      policies: "Policies",
      enrollment: "Enrollment",
      settings: "Settings",
    };
    if (section) {
      crumbs.push({ label: labels[section] ?? section });
      if (id)
        crumbs.push({
          label:
            id === "new"
              ? "New"
              : section === "settings"
                ? id.charAt(0).toUpperCase() + id.slice(1)
                : "Detail",
        });
      if (sub) crumbs.push({ label: sub === "editor" ? "Editor" : sub });
    }
  }
  if (crumbs.length === 0) crumbs.push({ label: "Dashboard" });
  return crumbs;
}

/** Close the mobile drawer whenever the route changes. */
function CloseMobileSidebarOnNavigate() {
  const location = useLocation();
  const { isMobile, setOpenMobile } = useSidebar();
  createEffect(
    () => location.pathname,
    () => {
      if (isMobile()) setOpenMobile(false);
    },
  );
  return null;
}

export default function DashboardLayout(props: ParentProps) {
  const session = authClient.useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const me = useQuery(() => ({ queryKey: enterpriseKeys.me(), queryFn: enterprise.me }));
  const user = () => session().data?.user;
  const routeTenantId = createMemo(() => location.pathname.match(/^\/t\/([^/]+)/)?.[1]);
  const activeTenant = createMemo(() => resolveActiveTenant(me.data, routeTenantId()));
  const tenantId = () => activeTenant()?.id;
  const tenantBase = () => (tenantId() ? `/t/${tenantId()}` : "");
  const hasTenant = () => Boolean(tenantId());
  const crumbs = () => breadcrumbForPath(location.pathname, activeTenant()?.name);

  const navItems = () => [
    {
      href: "/dashboard",
      label: "Dashboard",
      icon: LayoutDashboard,
      active: location.pathname === "/dashboard",
      disabled: false,
    },
    {
      href: `${tenantBase()}/devices`,
      label: "Devices",
      icon: Laptop,
      active: location.pathname.includes("/devices"),
      disabled: !hasTenant(),
    },
    {
      href: `${tenantBase()}/groups`,
      label: "Groups",
      icon: UsersRound,
      active: location.pathname.includes("/groups"),
      disabled: !hasTenant(),
    },
    {
      href: `${tenantBase()}/policies`,
      label: "Policies",
      icon: ShieldCheck,
      active: location.pathname.includes("/policies"),
      disabled: !hasTenant(),
    },
    {
      href: `${tenantBase()}/settings/enrollment`,
      label: "Enrollment",
      icon: LinkIcon,
      active: location.pathname.includes("/settings/enrollment"),
      disabled: !hasTenant(),
    },
    {
      href: `${tenantBase()}/settings`,
      label: "Tenant settings",
      icon: Settings,
      active: location.pathname.includes("/settings") && Boolean(routeTenantId()),
      disabled: !hasTenant(),
    },
    {
      href: "/docs",
      label: "Documentation",
      icon: LinkIcon,
      active: false,
      disabled: false,
    },
  ];

  createEffect(
    () => ({ pending: session().isPending, user: user(), path: location.pathname }),
    ({ pending, user, path }) => {
      if (!pending && !user) {
        navigate(`/login?returnTo=${encodeURIComponent(path)}`, { replace: true });
      }
    },
  );

  const handleSignOut = async () => {
    await authClient.signOut();
    navigate("/login", { replace: true });
  };

  function getInitials(name: string) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts[0]?.[0]?.toUpperCase() ?? "?";
  }

  return (
    <SidebarProvider>
      <CloseMobileSidebarOnNavigate />
      <Sidebar collapsible="icon">
        <SidebarHeader class="border-b border-sidebar-border">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                as="a"
                href="/dashboard"
                size="lg"
                class="gap-2.5 px-2 hover:bg-sidebar-accent"
                tooltip="Mattrax"
              >
                <Boxes class="size-5 shrink-0" />
                <span class="truncate font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
                  Mattrax
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <TenantSwitcher />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarMenu class="gap-0.5 p-1">
            <For each={navItems()}>
              {(item) => (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    as="a"
                    href={item.disabled ? "/tenants/new" : item.href}
                    isActive={item.active}
                    tooltip={item.disabled ? `${item.label} — create a tenant first` : item.label}
                    aria-disabled={item.disabled ? "true" : undefined}
                    class={item.disabled ? "opacity-50" : undefined}
                  >
                    <item.icon />
                    <span class="truncate group-data-[collapsible=icon]:hidden">{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </For>
          </SidebarMenu>
        </SidebarContent>

        <SidebarFooter class="border-t border-sidebar-border">
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger
                  class={cn(
                    sidebarMenuButtonVariants({ size: "lg" }),
                    "gap-2 data-expanded:bg-sidebar-accent",
                  )}
                  title={user()?.name ?? "Account"}
                >
                  <span class="flex size-7 shrink-0 items-center justify-center rounded-full bg-stone-900 text-stone-50 text-xs font-semibold">
                    <Show
                      when={user()?.image}
                      fallback={<span>{getInitials(user()?.name ?? "?")}</span>}
                    >
                      <img
                        src={user()!.image!}
                        alt={user()?.name ?? ""}
                        class="size-full rounded-full object-cover"
                      />
                    </Show>
                  </span>
                  <div class="min-w-0 flex-1 text-left group-data-[collapsible=icon]:hidden">
                    <p class="truncate text-sm font-medium leading-none">{user()?.name}</p>
                    <p class="mt-0.5 truncate text-xs text-muted-foreground">{user()?.email}</p>
                  </div>
                </DropdownMenuTrigger>

                <DropdownMenuContent class="w-52 rounded-xl border bg-white p-1 shadow-lg">
                  <div class="mb-1 border-b border-stone-100 px-3 py-2">
                    <p class="truncate text-sm font-medium text-stone-900">{user()?.name}</p>
                    <p class="mt-0.5 truncate text-xs text-stone-500">{user()?.email}</p>
                  </div>
                  <DropdownMenuItem
                    onSelect={() => navigate("/account")}
                    class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-stone-700 hover:bg-stone-50"
                  >
                    <User class="size-4" />
                    Account
                  </DropdownMenuItem>
                  <DropdownMenuSeparator class="my-1" />
                  <DropdownMenuItem
                    onSelect={handleSignOut}
                    class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-stone-700 hover:bg-stone-50"
                  >
                    <LogOut class="size-4" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>

        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <header class="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger class="-ml-1" />
          <Separator orientation="vertical" class="mr-2 data-[orientation=vertical]:h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              <For each={crumbs()}>
                {(crumb, index) => (
                  <>
                    <Show when={index() > 0}>
                      <BreadcrumbSeparator />
                    </Show>
                    <BreadcrumbItem>
                      <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </>
                )}
              </For>
            </BreadcrumbList>
          </Breadcrumb>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("mattrax:open-command-palette"))}
            class="ml-auto hidden items-center gap-2 rounded-lg border bg-white px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-stone-50 sm:flex"
          >
            <SearchIcon class="size-4" />
            <span>Search</span>
            <kbd class="rounded border px-1.5 py-0.5 text-[10px]">⌘K</kbd>
          </button>
        </header>
        {props.children}
      </SidebarInset>
      <CommandPalette />
    </SidebarProvider>
  );
}
