import { useLocation, useNavigate } from "@solidjs/router";
import { LogOut, Settings, User, LayoutDashboard } from "lucide-solid";
import { createEffect, type ParentProps, Show } from "solid-js";
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
  return "Dashboard";
}

export default function DashboardLayout(props: ParentProps) {
  const session = authClient.useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const user = () => session().data?.user;

  createEffect(() => {
    if (!session().isPending && !user()) {
      navigate(`/login?returnTo=${encodeURIComponent(location.pathname)}`, { replace: true });
    }
  });

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
                <span class="font-semibold tracking-tight">Mattrax</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                as="a"
                href="/dashboard"
                isActive={location.pathname === "/dashboard"}
                tooltip="Dashboard"
              >
                <LayoutDashboard />
                <span>Dashboard</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                as="a"
                href="/account"
                isActive={location.pathname === "/account"}
                tooltip="Account"
              >
                <User />
                <span>Account</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                as="a"
                href="/settings"
                isActive={location.pathname === "/settings"}
                tooltip="Settings"
              >
                <Settings />
                <span>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
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
