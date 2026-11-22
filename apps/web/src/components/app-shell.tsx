import { useIsRouting, useLocation } from "@solidjs/router";
import { useNavigate } from "~/lib/navigation";
import { useQuery, useQueryClient } from "@tanstack/solid-query";
import {
  createEffect,
  createMemo,
  createSignal,
  Errored,
  For,
  onSettled,
  Show,
  untrack,
} from "solid-js";
import type { JSX } from "@solidjs/web";
import {
  Avatar,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Kbd,
  Separator,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@mattrax/ui";
import {
  Activity,
  BookOpen,
  Building2,
  ChevronsUpDown,
  CommandIcon,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  Menu,
  MonitorSmartphone,
  Package,
  PanelRight,
  Plus,
  Search as SearchIcon,
  Settings,
  ShieldCheck,
  User,
  UsersRound,
} from "~/components/ui/icons";
import { enterpriseKeys, meQueryOptions } from "~/lib/enterprise";
import { installPinnedDashboards, pinnedDashboardsFor } from "~/lib/pinned-dashboards";
import type { Permission } from "@mattrax/enterprise-domain/client";
import { routes } from "~/lib/routes";
import { supportUrl } from "~/lib/support-config-store";
import { resolveLandingTenant } from "~/lib/tenant";
import { announce, announcementText, Toaster } from "~/components/toast";
import { SETTINGS_READ_PERMISSIONS, tenantRoleName, useCan } from "~/lib/permissions";
import { cn } from "~/lib/utils";
import { isHydrated } from "~/lib/query-client";
import { isServer } from "@solidjs/web";
import { installTheme } from "~/lib/theme";
import { setCrossTabTenant } from "~/lib/cross-tab-sync";
import { BrandLogo } from "~/components/brand-logo";
import { ErrorPanel } from "~/components/error-boundary";
import { IndeterminateBar, Skeleton } from "@mattrax/ui";

type NavGroup = "workspace" | "pinned";

type NavItem = {
  id: string;
  label: string;
  href: string;
  group: NavGroup;
  icon: (props: { class?: string }) => JSX.Element;
  match: (path: string) => boolean;
  /** Permission the section needs to appear; absent means always visible. */
  permission?: Permission;
  /** Settings is only useful when at least one settings tab is readable. */
  settingsGate?: boolean;
};

const NAV_GROUPS: ReadonlyArray<{ id: NavGroup; label: string }> = [
  { id: "workspace", label: "Workspace" },
  { id: "pinned", label: "Pinned" },
];

const LAST_TENANT_KEY = "mattrax:last-tenant";

function initials(name: string | undefined | null) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);

  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();

  return parts[0]?.[0]?.toUpperCase() ?? "?";
}

function tenantInitials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** The tenant most recently used on this device, so unscoped pages still
 * have somewhere to go without guessing from the server's order. */
export function readLastTenant(): string | undefined {
  if (typeof localStorage === "undefined") return undefined;

  return localStorage.getItem(LAST_TENANT_KEY) ?? undefined;
}

export function rememberTenant(id: string | undefined) {
  if (typeof localStorage === "undefined" || !id) return;
  localStorage.setItem(LAST_TENANT_KEY, id);
}

/**
 * The shell owns one polite status region. Actions elsewhere in the dashboard
 * (bulk delete, sync, unenroll, …) report their result through it so the
 * confirmation is spoken without adding another live region per page.
 *
 * `announce` and the visible toast surface live in `~/components/toast`; the
 * re-export keeps the original import path working.
 */
export { announce } from "~/components/toast";

function TenantSwitcher(props: { activeId: string | undefined; userId: string | undefined }) {
  const me = useQuery(() => meQueryOptions(props.userId));
  const navigate = useNavigate();
  const active = () => me.data?.tenants.find((tenant) => tenant.id === props.activeId);
  const tenants = () => me.data?.tenants ?? [];
  const loading = () => me.isPending && !me.data;

  return (
    <DropdownMenu placement="bottom-start">
      <DropdownMenuTrigger
        class="group flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left outline-none transition-colors duration-[var(--duration-hover)] ease-swift hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/50 data-expanded:bg-hover"
        title={active() ? `Switch tenant: ${active()!.name}` : "Select tenant"}
      >
        {/* The name is composed from the visible content so assistive tech and
            the visible label stay in sync; the leading text states the action. */}
        <span class="sr-only">Switch tenant: </span>
        <span
          aria-hidden="true"
          class="flex size-5 shrink-0 items-center justify-center rounded-[6px] bg-card text-[8.5px] font-[600] leading-none text-foreground/70 ring-1 ring-inset ring-border transition-colors group-hover:text-foreground"
        >
          <Show when={active()} fallback={<Building2 class="size-3.5" />}>
            {(tenant) => tenantInitials(tenant().name)}
          </Show>
        </span>
        <span class="min-w-0 flex-1">
          <Show when={!loading()} fallback={<Skeleton class="my-0.5 h-2.5 w-24 rounded-full" />}>
            <span class="block truncate text-[12.5px] font-[500] leading-4 text-muted-foreground transition-colors group-hover:text-foreground group-data-[expanded]:text-foreground">
              <Show when={active()} fallback="Select tenant">
                {(tenant) => tenant().name}
              </Show>
            </span>
          </Show>
        </span>
        <ChevronsUpDown class="size-3.5 shrink-0 text-subtle-foreground transition-colors duration-[var(--duration-hover)] ease-swift group-hover:text-foreground" />
      </DropdownMenuTrigger>

      <DropdownMenuContent class="w-[272px]">
        <DropdownMenuGroup>
          <Show
            when={tenants().length > 0}
            fallback={
              <div class="px-2.5 py-3 text-[12px] text-muted-foreground">
                You don't belong to a tenant yet.
              </div>
            }
          >
            <DropdownMenuRadioGroup
              value={props.activeId}
              onValueChange={(id) => {
                rememberTenant(id);
                const tenant = tenants().find((item) => item.id === id);
                navigate(routes.tenant(tenant?.slug || id).overview());
              }}
            >
              <For each={tenants()}>
                {(tenant) => (
                  <DropdownMenuRadioItem
                    value={tenant.id}
                    indicator="check"
                    aria-current={props.activeId === tenant.id ? "true" : undefined}
                    class="h-10 cursor-pointer gap-2.5 pl-2 pr-8"
                  >
                    <span class="flex size-6 shrink-0 items-center justify-center rounded-[5px] bg-surface text-[9px] font-semibold leading-none text-foreground/90 ring-1 ring-inset ring-border">
                      {tenantInitials(tenant.name)}
                    </span>
                    <span class="min-w-0 flex-1 leading-none">
                      <span class="block truncate text-[12.5px] font-[500] text-foreground">
                        {tenant.name}
                      </span>
                      <span class="mt-1 block truncate text-[10.5px] leading-none text-muted-foreground">
                        <span class="capitalize">{tenantRoleName(tenant) ?? tenant.role}</span>
                        <span class="px-1 text-subtle-foreground/40">·</span>
                        <span class="normal-case">{tenant.slug}</span>
                      </span>
                    </span>
                  </DropdownMenuRadioItem>
                )}
              </For>
            </DropdownMenuRadioGroup>
          </Show>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate("/tenants/new")} class="h-9 gap-2.5">
          <span class="flex size-6 items-center justify-center rounded-[5px] border border-dashed border-border text-muted-foreground">
            <Plus class="size-3.5" />
          </span>
          Create tenant
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SearchButton(props: { compact?: boolean }) {
  const open = () => window.dispatchEvent(new Event("mattrax:open-command-palette"));

  return (
    <button
      type="button"
      onClick={open}
      aria-keyshortcuts="Meta+K Control+K"
      class={cn(
        "group flex h-7 items-center gap-2 rounded-md text-muted-foreground outline-none transition-[color,background-color,border-color] duration-[var(--duration-hover)] ease-swift focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30",
        props.compact
          ? "w-7 justify-center border border-transparent hover:bg-hover hover:text-foreground sm:w-[196px] sm:justify-start sm:border-border sm:bg-card sm:px-2"
          : "w-[196px] justify-start border border-border bg-card px-2 hover:border-border-strong hover:text-foreground",
      )}
    >
      <SearchIcon class="size-3.5 shrink-0" aria-hidden="true" />
      <span class="sr-only">Search</span>
      <span class="hidden text-[12px] sm:inline" aria-hidden="true">
        Search
      </span>
      <Kbd class="ml-auto hidden sm:inline-flex" aria-hidden="true">
        ⌘K
      </Kbd>
    </button>
  );
}

type ShellUser = {
  id?: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  emailVerified?: boolean;
};

function UserMenu(props: {
  user: ShellUser | undefined;
  onSignOut: () => void | Promise<void>;
  superadmin?: boolean;
  variant?: "sidebar" | "bar";
}) {
  const user = () => props.user;
  const navigate = useNavigate();
  const sidebar = () => props.variant !== "bar";

  return (
    <DropdownMenu placement={sidebar() ? "top-start" : "bottom-end"}>
      <DropdownMenuTrigger
        class={cn(
          "outline-none transition-[background-color,border-color,box-shadow] duration-[var(--duration-hover)] ease-swift focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30",
          sidebar()
            ? "group flex h-10 w-full items-center gap-2.5 rounded-lg px-1.5 text-left hover:bg-hover data-expanded:bg-hover"
            : "flex size-7 items-center justify-center overflow-hidden rounded-full bg-hover text-[10px] font-[600] text-foreground ring-1 ring-inset ring-border hover:ring-input",
        )}
        title={user()?.name ?? "Account"}
      >
        <span class="sr-only">Account menu</span>
        <Show
          when={sidebar()}
          fallback={
            <Show
              when={user()?.image}
              fallback={<span aria-hidden="true">{initials(user()?.name)}</span>}
            >
              {(image) => <img src={image()} alt="" class="size-full object-cover" />}
            </Show>
          }
        >
          <Avatar size="sm" class="size-6 text-[9px]">
            <Show
              when={user()?.image}
              fallback={<span aria-hidden="true">{initials(user()?.name)}</span>}
            >
              {(image) => <img src={image()} alt="" class="size-full object-cover" />}
            </Show>
          </Avatar>
          <span class="min-w-0 flex-1" aria-hidden="true">
            <span class="block truncate text-[12.5px] font-[500] leading-4 text-foreground">
              {user()?.name ?? "Account"}
            </span>
          </span>
          <ChevronsUpDown class="size-3.5 shrink-0 text-muted-foreground transition-colors duration-[var(--duration-hover)] ease-swift group-hover:text-foreground" />
        </Show>
      </DropdownMenuTrigger>
      <DropdownMenuContent class="w-[248px]">
        <DropdownMenuGroup>
          <div class="flex items-center gap-2.5 px-2 py-2">
            <Avatar size="sm" class="size-6 text-[9px]">
              <span aria-hidden="true">{initials(user()?.name)}</span>
            </Avatar>
            <span class="min-w-0">
              <DropdownMenuLabel class="block h-auto truncate py-0 text-[12.5px] font-[550] text-foreground normal-case tracking-normal">
                {user()?.name}
              </DropdownMenuLabel>
              <span class="block truncate text-[11px] text-muted-foreground">{user()?.email}</span>
            </span>
          </div>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate("/account")}>
          <User class="size-3.5 text-muted-foreground" />
          Account settings
        </DropdownMenuItem>
        <Show when={props.superadmin}>
          <DropdownMenuItem onSelect={() => navigate(routes.adminAccounts())}>
            <ShieldCheck class="size-3.5 text-muted-foreground" />
            Platform accounts
          </DropdownMenuItem>
        </Show>
        <DropdownMenuItem as="a" role="menuitem" href="/docs/" target="_self">
          <BookOpen class="size-3.5 text-muted-foreground" />
          Documentation
        </DropdownMenuItem>
        <DropdownMenuItem as="a" role="menuitem" href="/docs/getting-started/alpha" target="_self">
          <BookOpen class="size-3.5 text-muted-foreground" />
          What alpha means
        </DropdownMenuItem>
        <DropdownMenuItem
          as="a"
          role="menuitem"
          href={supportUrl()}
          target={supportUrl().startsWith("http") ? "_blank" : undefined}
          rel={supportUrl().startsWith("http") ? "noopener" : undefined}
        >
          <HelpCircle class="size-3.5 text-muted-foreground" />
          Support
        </DropdownMenuItem>
        <DropdownMenuItem
          as="a"
          role="menuitem"
          href="https://status.otbeaumont.me"
          target="_blank"
          rel="noopener"
        >
          <Activity class="size-3.5 text-muted-foreground" />
          System status
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => props.onSignOut()}>
          <LogOut class="size-3.5" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function navFor(tenantId: string | undefined): NavItem[] {
  if (!tenantId) return [];
  const tenant = routes.tenant(tenantId);
  const base = tenant.overview();

  const item = (
    id: string,
    label: string,
    href: string,
    icon: NavItem["icon"],
    group: NavGroup,
    options: { exact?: boolean; permission?: Permission } = {},
  ): NavItem => ({
    id,
    label,
    href,
    icon,
    group,
    permission: options.permission,
    match: (value) => value === href || (!options.exact && value.startsWith(`${href}/`)),
  });

  // Overview is the tenant root; a prefix match would also match every child.
  return [
    item("overview", "Overview", base, LayoutDashboard, "workspace", {
      exact: true,
      permission: "tenant.read",
    }),
    item("dashboards", "Dashboards", tenant.dashboards(), PanelRight, "workspace", {
      permission: "dashboards.read",
    }),
    item("devices", "Devices", tenant.devices(), MonitorSmartphone, "workspace", {
      permission: "devices.read",
    }),
    item("users", "Users", tenant.users(), User, "workspace", {
      permission: "members.read",
    }),
    item("groups", "Groups", tenant.groups(), UsersRound, "workspace", {
      permission: "groups.read",
    }),
    item("policies", "Policies", tenant.policies(), ShieldCheck, "workspace", {
      permission: "policies.read",
    }),
    item("applications", "Applications", tenant.applications(), Package, "workspace", {
      permission: "applications.read",
    }),
    item("scripts", "Scripts", tenant.scripts(), CommandIcon, "workspace", {
      permission: "scripts.read",
    }),
    {
      id: "settings",
      label: "Settings",
      href: tenant.settings(),
      group: "workspace",
      icon: Settings,
      settingsGate: true,
      match: (value) => value === tenant.settings() || value.startsWith(`${tenant.settings()}/`),
    },
  ];
}

function NavGroups(props: {
  items: NavItem[];
  path: string;
  label: string;
  onNavigate?: () => void;
}) {
  const grouped = (group: NavGroup) => props.items.filter((item) => item.group === group);

  // Settings owns its whole subtree, so every settings pane highlights the one
  // Settings entry; other entries use their own prefix.
  const activeId = createMemo(
    () =>
      props.items
        .filter((item) => item.match(props.path))
        .sort((a, b) => b.href.length - a.href.length)[0]?.id,
  );

  return (
    <nav aria-label={props.label} class="flex flex-col gap-1">
      <For each={NAV_GROUPS}>
        {(group) => {
          const items = () => grouped(group.id);

          return (
            <Show when={items().length > 0}>
              <div class="pt-3 first:pt-1">
                <div class="label-caps px-2 pb-1.5">{group.label}</div>
                <ul class="space-y-0.5">
                  <For each={items()}>
                    {(item) => {
                      const active = () => activeId() === item.id;

                      return (
                        <li>
                          <a
                            href={item.href}
                            aria-current={active() ? "page" : undefined}
                            onClick={() => props.onNavigate?.()}
                            class={cn(
                              "group flex h-7 items-center gap-2 rounded-md border px-2 text-[12.5px] leading-none outline-none transition-[color,background-color,border-color,box-shadow] duration-[var(--duration-hover)] ease-swift focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30",
                              active()
                                ? "border-border bg-card font-[500] text-foreground shadow-[0_1px_2px_rgb(24_24_22/0.05)]"
                                : "border-transparent text-muted-foreground hover:bg-hover hover:text-foreground",
                            )}
                          >
                            <item.icon
                              class={cn(
                                "size-3.5 shrink-0 transition-colors duration-[var(--duration-hover)] ease-swift",
                                active()
                                  ? "text-foreground"
                                  : "text-subtle-foreground group-hover:text-foreground",
                              )}
                            />
                            <span class="truncate">{item.label}</span>
                          </a>
                        </li>
                      );
                    }}
                  </For>
                </ul>
              </div>
            </Show>
          );
        }}
      </For>
    </nav>
  );
}

function SidebarPanel(props: {
  user: ShellUser | undefined;
  onSignOut: () => void | Promise<void>;
  superadmin?: boolean;
  activeId: string | undefined;
  items: NavItem[];
  path: string;
  label: string;
  onNavigate?: () => void;
}) {
  return (
    <div class="flex h-full min-h-0 flex-col bg-shell">
      <div class="flex h-14 shrink-0 items-center justify-center px-4">
        <a
          href="/dashboard"
          class="flex items-center rounded-md outline-none transition-opacity duration-[var(--duration-hover)] ease-swift hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/60"
          aria-label="Mattrax home"
          onClick={() => props.onNavigate?.()}
        >
          <BrandLogo class="h-3" />
        </a>
      </div>

      <div class="px-2.5 pb-2">
        <TenantSwitcher activeId={props.activeId} userId={props.user?.id} />
      </div>

      <div class="no-scrollbar min-h-0 flex-1 overflow-y-auto px-2.5 pb-4">
        <NavGroups
          items={props.items}
          path={props.path}
          label={props.label}
          onNavigate={props.onNavigate}
        />
      </div>

      <Separator />
      <div class="shrink-0 p-2">
        <UserMenu user={props.user} onSignOut={props.onSignOut} superadmin={props.superadmin} />
      </div>
    </div>
  );
}

function ShellBreadcrumb(props: {
  tenantName: string | undefined;
  tenantHref: string | undefined;
  label: string;
}) {
  return (
    <nav aria-label="Breadcrumb" class="min-w-0">
      <ol class="flex min-w-0 items-center gap-1.5 text-[12px]">
        <Show when={props.tenantName && props.tenantHref}>
          <li class="hidden min-w-0 sm:block">
            <a
              href={props.tenantHref}
              class="block max-w-[16ch] truncate text-muted-foreground outline-none transition-colors duration-[var(--duration-hover)] ease-swift hover:text-foreground focus-visible:text-foreground"
            >
              {props.tenantName}
            </a>
          </li>
          <li aria-hidden="true" class="hidden text-subtle-foreground/70 sm:block">
            /
          </li>
        </Show>
        <li class="min-w-0">
          <span aria-current="page" class="block truncate font-[500] text-foreground">
            {props.label}
          </span>
        </li>
      </ol>
    </nav>
  );
}

export function AppShell(props: {
  children: JSX.Element;
  user: ShellUser | undefined;
  onSignOut: () => void | Promise<void>;
}) {
  const location = useLocation();
  const isRouting = useIsRouting();
  const routeTenantId = createMemo(() => location.pathname.match(/^\/t\/([^/]+)/)?.[1]);
  const me = useQuery(() => meQueryOptions(props.user?.id));
  const superadmin = () => me.data?.account.superadmin === true;
  const [lastTenant, setLastTenant] = createSignal<string | undefined>();
  const [mobileNavOpen, setMobileNavOpen] = createSignal(false);

  onSettled(() => {
    setLastTenant(readLastTenant());
  });

  // Swap the device-wide preference for this account's own choice. The effect
  // re-runs if the session user changes (sign-in as someone else in this tab).
  createEffect(
    () => props.user?.id,
    (userId) => installTheme(userId),
  );

  createEffect(
    () => routeTenantId(),
    (id) => {
      if (!id) return;
      rememberTenant(id);
      setLastTenant(id);
    },
  );

  // A sheet left open while the route changes would cover the page it opened.
  createEffect(
    () => location.pathname,
    () => {
      setMobileNavOpen(false);
    },
  );

  const activeId = createMemo(() => {
    const routeKey = routeTenantId();

    if (routeKey) {
      const tenant = (me.data?.tenants ?? []).find(
        (entry) => entry.id === routeKey || entry.slug === routeKey,
      );

      return tenant?.id ?? routeKey;
    }

    const known = me.data?.tenants ?? [];

    return resolveLandingTenant(known, {
      defaultTenantId: me.data?.account.defaultTenantId,
      lastTenantId: lastTenant(),
    })?.id;
  });

  createEffect(
    () => activeId(),
    (id) => {
      if (!id) return;
      rememberTenant(id);
      setLastTenant(id);
    },
  );

  /** Link segment: the slug when the membership is known, so clicks never start on an id URL. */
  const tenantSegment = createMemo(() => {
    const key = routeTenantId();

    if (!key) return undefined;
    const tenant = (me.data?.tenants ?? []).find((entry) => entry.id === key || entry.slug === key);

    return tenant?.slug ?? key;
  });

  const scopedTenant = createMemo(() => (routeTenantId() ? activeId() : undefined));

  /** Non-tenant pages still carry the console chrome, built from the tenant
   * the switcher is showing rather than from the URL. */
  const navTenant = createMemo(() => {
    const segment = tenantSegment();

    if (segment) return segment;
    const id = activeId();

    if (!id) return undefined;

    return me.data?.tenants.find((tenant) => tenant.id === id)?.slug ?? id;
  });

  const { can, canAny } = useCan();

  // Mutations broadcast to other tabs under the tenant currently on screen.
  createEffect(
    () => scopedTenant() ?? null,
    (tenantId) => setCrossTabTenant(tenantId),
  );

  onSettled(installPinnedDashboards);

  const pinned = createMemo(() => pinnedDashboardsFor(activeId()));
  const queryClient = useQueryClient();

  const pinnedItems = createMemo<NavItem[]>(() => {
    const tenant = navTenant();

    if (!tenant || !can("dashboards.read")) return [];
    // Names come from whatever the Dashboards page has already cached; the pin
    // itself stores a fallback so the rail renders before that page is visited.
    const known = queryClient.getQueryData<{
      dashboards: ReadonlyArray<{ id: string; name: string }>;
    }>(enterpriseKeys.dashboards(activeId()))?.dashboards;

    return pinned().flatMap((pin) => {
      const current = known?.find((dashboard) => dashboard.id === pin.dashboardId);

      // Drop a pin once the server confirms the dashboard no longer exists.
      if (known && !current) return [];
      const href = routes.tenant(tenant).dashboard(pin.dashboardId);

      return [
        {
          id: `pinned:${pin.dashboardId}`,
          label: current?.name ?? pin.name,
          href,
          group: "pinned" as const,
          icon: PanelRight,
          match: (value: string) => value === href,
        },
      ];
    });
  });

  const navItems = createMemo(() => [
    ...navFor(navTenant()).filter((item) => {
      if (item.settingsGate) return canAny(SETTINGS_READ_PERMISSIONS);

      return !item.permission || can(item.permission);
    }),
    ...pinnedItems(),
  ]);

  const settingsLabels = new Map([
    ["", "General"],
    ["administrators", "Administrators"],
    ["identity", "Identity"],
    ["enrollment", "Enrollment"],
    ["management", "Management"],
    ["migration", "Migration"],
    ["delivery", "Delivery"],
    ["integrations", "Integrations"],
    ["audit", "Audit log"],
    ["billing", "Billing"],
    ["storage", "Storage"],
  ]);

  const pageLabel = createMemo(() => {
    const path = location.pathname;

    if (path === "/account") return "Account";

    if (path === "/admin/accounts") return "Platform accounts";

    if (path === "/tenants/new") return "Create tenant";

    if (path === "/dashboard") return "Tenant";

    if (path.startsWith("/docs")) return "Documentation";

    // Settings sections share one navigation entry; naming the section keeps
    // tabs, history and screen-reader announcements distinguishable.
    const settingsSection = /\/settings(?:\/([^/]+))?/.exec(path)?.[1] ?? "";

    if (path.includes("/settings")) {
      const section = settingsLabels.get(settingsSection);

      if (section) return `Settings · ${section}`;
    }

    return navItems().find((item) => item.match(path))?.label ?? "Tenant";
  });

  const tenantName = createMemo(() => {
    const id = scopedTenant();

    if (!id) return undefined;

    return me.data?.tenants.find((tenant) => tenant.id === id)?.name;
  });

  /** Section plus tenant, so tabs and bookmarks distinguish their origin. */
  const pageTitle = createMemo(() => {
    const label = pageLabel();
    const tenant = tenantName();

    return tenant ? `${label} · ${tenant}` : label;
  });

  createEffect(
    () => pageTitle(),
    (title) => {
      if (typeof document === "undefined") return;
      document.title = `${title} · Mattrax`;
    },
  );

  /**
   * After a route change, move focus to the main landmark so keyboard and
   * screen-reader users land on the new page instead of the link they followed.
   * Modals keep focus while they are open, and query-string-only navigations
   * (filters, pagination) never trigger this because only the pathname is
   * tracked.
   */
  let initialRoute = true;
  createEffect(
    () => location.pathname,
    () => {
      if (initialRoute) {
        initialRoute = false;

        return;
      }

      if (typeof document === "undefined") return;

      // The shell scrolls inside `main`, not the document, so the router's
      // pathname change has to reset that scrollport explicitly.
      document.getElementById("main")?.scrollTo({ top: 0 });

      // A dialog owns focus while it is open; moving focus into the inert
      // background would strand it.
      if (document.querySelector('[data-slot="dialog-content"], [data-slot="command-palette"]'))
        return;

      document.getElementById("main")?.focus({ preventScroll: true });
      announce(untrack(pageTitle));
    },
  );

  return (
    <div class="flex h-dvh overflow-hidden bg-background p-3 text-foreground selection:bg-brand/30 selection:text-foreground sm:p-4 lg:p-6 xl:p-8">
      <a
        href="#main"
        class="sr-only z-[100] rounded-lg bg-primary px-3 py-2 text-[13px] font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>

      <div class="mx-auto flex h-full min-h-0 w-full max-w-[1800px] overflow-hidden rounded-[20px] border border-border bg-shell shadow-[0_1px_2px_rgb(24_24_22/0.04),0_20px_55px_-28px_rgb(24_24_22/0.22)]">
        <aside class="hidden h-full w-[244px] shrink-0 border-r border-border lg:block">
          <SidebarPanel
            user={props.user}
            onSignOut={props.onSignOut}
            superadmin={superadmin()}
            activeId={activeId()}
            items={navItems()}
            path={location.pathname}
            label="Primary"
          />
        </aside>

        <div class="flex min-h-0 min-w-0 flex-1 flex-col">
          <header class="relative z-40 shrink-0 border-b border-border bg-shell/95 backdrop-blur supports-[backdrop-filter]:bg-shell/85">
            <div class="flex h-12 items-center gap-2 px-3 sm:px-5">
              <Button
                variant="ghost"
                size="icon-sm"
                class="lg:hidden"
                aria-label="Open navigation"
                onClick={() => setMobileNavOpen(true)}
              >
                <Menu class="size-4" />
              </Button>
              <a
                href="/dashboard"
                class="flex shrink-0 items-center rounded-md outline-none transition-opacity duration-[var(--duration-hover)] ease-swift hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/60 lg:hidden"
                aria-label="Mattrax home"
              >
                <BrandLogo class="h-3" />
              </a>
              <span class="mx-1 hidden h-3.5 w-px bg-border lg:block" aria-hidden="true" />
              <div class="hidden min-w-0 flex-1 sm:block">
                <ShellBreadcrumb
                  tenantName={tenantName()}
                  tenantHref={
                    tenantSegment() ? routes.tenant(tenantSegment()).overview() : undefined
                  }
                  label={pageLabel()}
                />
              </div>
              <div class="ml-auto flex shrink-0 items-center gap-1 sm:ml-0">
                <SearchButton compact />
                <Button
                  as="a"
                  href="/docs/"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Documentation"
                  title="Documentation"
                >
                  <HelpCircle class="size-4" />
                </Button>
                <span
                  class="mx-0.5 hidden h-4 w-px bg-border sm:block lg:hidden"
                  aria-hidden="true"
                />
                <span class="lg:hidden">
                  <UserMenu
                    user={props.user}
                    onSignOut={props.onSignOut}
                    superadmin={superadmin()}
                    variant="bar"
                  />
                </span>
              </div>
            </div>

            {/* Route progress: a slim indeterminate segment pinned to the header
              edge. It disappears the moment the router settles, so it never
              competes with the page's own entrance. */}
            <Show when={isRouting()}>
              <div class="pointer-events-none absolute inset-x-0 bottom-0">
                <IndeterminateBar class="h-0.5 rounded-none bg-transparent" />
              </div>
            </Show>
          </header>

          <main
            id="main"
            tabindex="-1"
            class={cn(
              "relative z-10 flex min-h-0 w-full flex-1 flex-col overflow-y-auto bg-page transition-opacity duration-[140ms] ease-swift focus:outline-none",
              isRouting() && "opacity-70",
            )}
          >
            <Errored
              fallback={(error, reset) => (
                <ErrorPanel boundary="dashboard" error={error()} reset={reset} label="Dashboard" />
              )}
            >
              {/* Page content mounts after the shell is hydrated. Server-rendered
                page markup is data-independent, but the client resolves queries
                before claiming it, so hydration would silently detach controls
                (column pickers, filters, sort buttons). Rendering the page once
                hydration finishes keeps every control live on cold loads. */}
              <Show when={!isServer && isHydrated()}>{props.children}</Show>
            </Errored>
          </main>
        </div>
      </div>

      <Sheet open={mobileNavOpen()} onOpenChange={setMobileNavOpen}>
        <SheetContent
          side="left"
          class="left-0 right-auto w-[264px] max-w-[264px] border-l-0 border-r border-border bg-shell p-0 data-[starting-style]:-translate-x-full data-[ending-style]:-translate-x-full"
        >
          <SheetHeader class="sr-only">
            <SheetTitle>Navigation</SheetTitle>
            <SheetDescription>Dashboard sections and account menu</SheetDescription>
          </SheetHeader>
          <SidebarPanel
            user={props.user}
            onSignOut={props.onSignOut}
            superadmin={superadmin()}
            activeId={activeId()}
            items={navItems()}
            path={location.pathname}
            label="Primary"
            onNavigate={() => setMobileNavOpen(false)}
          />
        </SheetContent>
      </Sheet>

      <div role="status" aria-live="polite" aria-atomic="true" class="sr-only">
        {announcementText()}
      </div>
      <Toaster />
    </div>
  );
}
