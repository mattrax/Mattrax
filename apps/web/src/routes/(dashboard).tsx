import { useLocation, useNavigate } from "@solidjs/router";
import { createEffect, createMemo, For, type ParentProps, Show } from "solid-js";
import { TenantSwitcher } from "~/components/mdm/tenant-switcher";
import {
  Boxes,
  Laptop,
  LayoutDashboard,
  LinkIcon,
  LogOut,
  Settings,
  ShieldCheck,
  User,
  UsersRound,
} from "~/components/ui/icons";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
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
} from "~/components/ui/sidebar";
import { authClient } from "~/lib/auth";

function breadcrumbForPath(path: string) {
  if (path === "/dashboard") return "Dashboard";
  if (path === "/account") return "Account";
  if (path === "/settings") return "Settings";
  if (path.includes("/devices")) return "Devices";
  if (path.includes("/groups")) return "Groups";
  if (path.includes("/policies")) return "Policies";
  if (path.includes("/enrollment")) return "Enrollment";
  if (path.includes("/tenants/new")) return "Create tenant";
  return "Dashboard";
}

export default function DashboardLayout(props: ParentProps) {
  const session = authClient.useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const user = () => session().data?.user;
  const tenantId = createMemo(() => location.pathname.match(/^\/t\/([^/]+)/)?.[1]);
  const tenantBase = () => (tenantId() ? `/t/${tenantId()}` : "/dashboard");
  const navItems = () => [
    {
      href: "/dashboard",
      label: "Dashboard",
      icon: LayoutDashboard,
      active: location.pathname === "/dashboard",
    },
    {
      href: `${tenantBase()}/devices`,
      label: "Devices",
      icon: Laptop,
      active: location.pathname.includes("/devices"),
      disabled: !tenantId(),
    },
    {
      href: `${tenantBase()}/groups`,
      label: "Groups",
      icon: UsersRound,
      active: location.pathname.includes("/groups"),
      disabled: !tenantId(),
    },
    {
      href: `${tenantBase()}/policies`,
      label: "Policies",
      icon: ShieldCheck,
      active: location.pathname.includes("/policies"),
      disabled: !tenantId(),
    },
    {
      href: `${tenantBase()}/enrollment`,
      label: "Enrollment",
      icon: LinkIcon,
      active: location.pathname.includes("/enrollment"),
      disabled: !tenantId(),
    },
    {
      href: `${tenantBase()}/settings`,
      label: "Tenant settings",
      icon: Settings,
      active: location.pathname.includes("/settings") && Boolean(tenantId()),
      disabled: !tenantId(),
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
                <Boxes class="size-5" />
                <span class="font-semibold tracking-tight">Mattrax</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <TenantSwitcher />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarMenu>
            <For each={navItems()}>
              {(item) => (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    as="a"
                    href={item.disabled ? "/tenants/new" : item.href}
                    isActive={item.active}
                    tooltip={item.label}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </For>
          </SidebarMenu>
        </SidebarContent>

        <SidebarFooter class="border-t border-sidebar-border">
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu placement="top-start">
                <DropdownMenuTrigger
                  as={SidebarMenuButton}
                  size="lg"
                  class="gap-2 data-expanded:bg-sidebar-accent"
                  tooltip={user()?.name ?? "Account"}
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
                  <div class="min-w-0 flex-1 text-left">
                    <p class="truncate text-sm font-medium leading-none">{user()?.name}</p>
                    <p class="truncate text-xs text-muted-foreground mt-0.5">{user()?.email}</p>
                  </div>
                </DropdownMenuTrigger>

                <DropdownMenuContent class="w-52 rounded-xl border bg-white p-1 shadow-lg">
                  <div class="px-3 py-2 border-b border-stone-100 mb-1">
                    <p class="text-sm font-medium text-stone-900 truncate">{user()?.name}</p>
                    <p class="text-xs text-stone-500 truncate mt-0.5">{user()?.email}</p>
                  </div>
                  <DropdownMenuItem
                    as="a"
                    href="/account"
                    class="rounded-lg px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 flex items-center gap-2"
                  >
                    <User class="size-4" />
                    Account
                  </DropdownMenuItem>
                  <DropdownMenuSeparator class="my-1" />
                  <DropdownMenuItem
                    onSelect={handleSignOut}
                    class="rounded-lg px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 flex items-center gap-2"
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
              <BreadcrumbItem>
                <BreadcrumbPage>{breadcrumbForPath(location.pathname)}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </header>
        {props.children}
      </SidebarInset>
    </SidebarProvider>
  );
}
