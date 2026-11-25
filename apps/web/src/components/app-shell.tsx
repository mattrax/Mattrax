import { useIsRouting, useLocation } from "@solidjs/router";
import { useNavigate } from "~/lib/navigation";
import { useQuery, useQueryClient } from "@tanstack/solid-query";
import {
  createEffect,
  createMemo,
  createSignal,
  Errored,
  For,
  Loading,
  onCleanup,
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
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
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  Plus,
  RefreshCw,
  Search as SearchIcon,
  Settings,
  ShieldAlert,
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
import { firstReadableSettingsTab, tenantRoleName, useCan } from "~/lib/permissions";
import { settingsTabById } from "~/components/settings/settings-tabs";
import { cn } from "~/lib/utils";
import { isHydrated } from "~/lib/query-client";
import { pendingDeployment, reloadForDeployment } from "~/lib/skew-protection";
import { isServer } from "@solidjs/web";
import { installTheme } from "~/lib/theme";
import { setCrossTabTenant } from "~/lib/cross-tab-sync";
import { BrandLogo } from "~/components/brand-logo";
import { ErrorPanel } from "~/components/error-boundary";
import { IndeterminateBar, LoadingState, Skeleton } from "@mattrax/ui";

type NavGroup = "tenant" | "pinned";

type NavItem = {
  id: string;
  label: string;
  href: string;
  group: NavGroup;
  icon: (props: { class?: string }) => JSX.Element;
  match: (path: string) => boolean;
  /** Permission the section needs to appear; absent means always visible. */
  permission?: Permission;
};

const NAV_GROUPS: ReadonlyArray<{ id: NavGroup; label: string }> = [
  { id: "tenant", label: "Tenant" },
  { id: "pinned", label: "Pinned" },
];

const LAST_TENANT_KEY = "mattrax:last-tenant";
const SIDEBAR_COLLAPSED_KEY = "mattrax:sidebar-collapsed";

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

function TenantSwitcher(props: {
  activeId: string | undefined;
  userId: string | undefined;
  collapsed?: boolean;
}) {
  const me = useQuery(() => meQueryOptions(props.userId));
  const navigate = useNavigate();
  const active = () => me.data?.tenants.find((tenant) => tenant.id === props.activeId);
  const tenants = () => me.data?.tenants ?? [];
  const loading = () => me.isPending && !me.data;

  /**
   * Selecting a tenant leaves the menu for another page, so the default
   * "return focus to the trigger" would fight the shell's focus management and
   * leave keyboard users on the old sidebar. Send focus to the destination's
   * main landmark instead; choosing a tenant is an explicit navigation, like
   * following a link. Reset when the menu opens again so cancelling it still
   * returns to the trigger.
   */
  const [navigating, setNavigating] = createSignal(false);

  return (
    <DropdownMenu
      placement="bottom-start"
      onOpenChange={(open) => {
        if (open) setNavigating(false);
      }}
    >
      <DropdownMenuTrigger
        class={cn(
          "group flex min-w-0 items-center rounded-md text-left outline-none transition-colors duration-[var(--duration-hover)] ease-swift hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/50 data-expanded:bg-hover",
          props.collapsed ? "mx-auto h-9 w-10 justify-center px-0" : "h-8 w-full gap-2 px-2",
        )}
        title={active() ? `Switch tenant: ${active()!.name}` : "Select tenant"}
      >
        {/* The name is composed from the visible content so assistive tech and
            the visible label stay in sync; the leading text states the action. */}
        <span class="sr-only">Switch tenant: </span>
        <span
          aria-hidden="true"
          class={cn(
            "flex shrink-0 items-center justify-center rounded-[6px] bg-card font-[600] leading-none text-foreground/70 ring-1 ring-inset ring-border transition-colors group-hover:text-foreground",
            props.collapsed ? "size-6 text-[9px]" : "size-5 text-[8.5px]",
          )}
        >
          <Show when={active()} fallback={<Building2 class="size-3.5" />}>
            {(tenant) => tenantInitials(tenant().name)}
          </Show>
        </span>
        <span class={props.collapsed ? "sr-only" : "min-w-0 flex-1"}>
          <Show when={!loading()} fallback={<Skeleton class="my-0.5 h-2.5 w-24 rounded-full" />}>
            <span class="block truncate text-[12.5px] font-[500] leading-4 text-muted-foreground transition-colors group-hover:text-foreground group-data-[expanded]:text-foreground">
              <Show when={active()} fallback="Select tenant">
                {(tenant) => tenant().name}
              </Show>
            </span>
          </Show>
        </span>
        <Show when={!props.collapsed}>
          <ChevronsUpDown class="size-3.5 shrink-0 text-subtle-foreground transition-colors duration-[var(--duration-hover)] ease-swift group-hover:text-foreground" />
        </Show>
      </DropdownMenuTrigger>

      {/* The mobile switcher lives inside the navigation sheet. Rendering the
          menu into the sheet keeps its items inside the modal: a menu portaled
          to the body is treated as an outside press, so the sheet closed on
          pointerdown and the item never received the click. */}
      <DropdownMenuContent
        class="max-h-[32rem] w-[272px]"
        finalFocus={() => (navigating() ? "none" : undefined)}
        container={
          typeof document === "undefined"
            ? undefined
            : (document.querySelector<HTMLElement>('[data-slot="dialog-content"]') ?? undefined)
        }
      >
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
                setNavigating(true);
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

/**
 * The header's help destination. The docs are served from `/docs/` by both the
 * hosted Worker and the self-hosted image, and support is whatever the
 * deployment configured (`SUPPORT_URL`, falling back to mailto). Both links are
 * native anchors: `target="_self"` keeps the router from treating the docs as
 * an SPA route, so the static documentation document loads even when its chunk
 * has not been visited yet.
 */
function HelpMenu() {
  const support = () => supportUrl();
  const externalSupport = () => support().startsWith("http");

  return (
    <DropdownMenu placement="bottom-end">
      <DropdownMenuTrigger
        class="inline-flex size-7 items-center justify-center rounded-[7px] border border-transparent text-muted-foreground outline-none transition-[color,background-color,border-color,box-shadow] duration-[var(--duration-hover)] ease-swift hover:bg-hover hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
        aria-label="Help and documentation"
        title="Help and documentation"
      >
        <HelpCircle class="size-4" aria-hidden="true" />
        <span class="sr-only">Help and documentation</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent class="w-[232px]">
        <DropdownMenuItem as="a" role="menuitem" href="/docs/" target="_self">
          <BookOpen class="size-3.5 text-muted-foreground" aria-hidden="true" />
          Documentation
        </DropdownMenuItem>
        <DropdownMenuItem
          as="a"
          role="menuitem"
          href={support()}
          target={externalSupport() ? "_blank" : undefined}
          rel={externalSupport() ? "noopener" : undefined}
        >
          <HelpCircle class="size-3.5 text-muted-foreground" aria-hidden="true" />
          Support
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
  collapsed?: boolean;
}) {
  const user = () => props.user;
  const navigate = useNavigate();
  const sidebar = () => props.variant !== "bar";
  const collapsed = () => sidebar() && props.collapsed === true;

  return (
    <DropdownMenu placement={sidebar() ? "top-start" : "bottom-end"}>
      <DropdownMenuTrigger
        class={cn(
          "outline-none transition-[background-color,border-color,box-shadow] duration-[var(--duration-hover)] ease-swift focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30",
          sidebar()
            ? collapsed()
              ? "mx-auto flex size-9 items-center justify-center rounded-lg hover:bg-hover data-expanded:bg-hover"
              : "group flex h-10 w-full items-center gap-2.5 rounded-lg px-1.5 text-left hover:bg-hover data-expanded:bg-hover"
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
          <Show when={!collapsed()}>
            <span class="min-w-0 flex-1" aria-hidden="true">
              <span class="block truncate text-[12.5px] font-[500] leading-4 text-foreground">
                {user()?.name ?? "Account"}
              </span>
            </span>
            <ChevronsUpDown class="size-3.5 shrink-0 text-muted-foreground transition-colors duration-[var(--duration-hover)] ease-swift group-hover:text-foreground" />
          </Show>
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
          Account
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
    item("overview", "Overview", base, LayoutDashboard, "tenant", {
      exact: true,
      permission: "tenant.read",
    }),
    item("dashboards", "Dashboards", tenant.dashboards(), PanelRight, "tenant", {
      permission: "dashboards.read",
    }),
    item("devices", "Devices", tenant.devices(), MonitorSmartphone, "tenant", {
      permission: "devices.read",
    }),
    item("users", "Users", tenant.users(), User, "tenant", {
      permission: "members.read",
    }),
    item("groups", "Groups", tenant.groups(), UsersRound, "tenant", {
      permission: "groups.read",
    }),
    item("policies", "Policies", tenant.policies(), ShieldCheck, "tenant", {
      permission: "policies.read",
    }),
    item("applications", "Applications", tenant.applications(), Package, "tenant", {
      permission: "applications.read",
    }),
    item("scripts", "Scripts", tenant.scripts(), CommandIcon, "tenant", {
      permission: "scripts.read",
    }),
    item(
      "restricted-software",
      "Restricted software",
      tenant.restrictedSoftware(),
      ShieldAlert,
      "tenant",
      { permission: "restricted_software.read" },
    ),
  ];
}

/**
 * Settings lives below the scrollable sections and directly above the account
 * row. It keeps the same permission gate as the old navigation entry; the shell
 * only renders it when at least one settings tab is readable.
 */
function settingsNavItem(tenantId: string, href: string): NavItem {
  const settings = routes.tenant(tenantId).settings();

  return {
    id: "settings",
    label: "Settings",
    href,
    group: "tenant",
    icon: Settings,
    // Any settings pane highlights the one footer entry, even when the link
    // lands on a later readable tab.
    match: (value) => value === settings || value.startsWith(`${settings}/`),
  };
}

function SidebarLink(props: {
  item: NavItem;
  active: boolean;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <a
      href={props.item.href}
      aria-current={props.active ? "page" : undefined}
      onClick={() => props.onNavigate?.()}
      class={cn(
        "group flex items-center rounded-md border text-[12.5px] leading-none outline-none transition-[color,background-color,border-color,box-shadow] duration-[var(--duration-hover)] ease-swift focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30",
        props.collapsed ? "mx-auto h-8 w-10 justify-center px-0" : "h-7 gap-2 px-2",
        props.active
          ? "border-border bg-card font-[500] text-foreground shadow-[0_1px_2px_rgb(24_24_22/0.05)]"
          : "border-transparent text-muted-foreground hover:bg-hover hover:text-foreground",
      )}
      title={props.collapsed ? props.item.label : undefined}
    >
      <props.item.icon
        class={cn(
          "shrink-0 transition-colors duration-[var(--duration-hover)] ease-swift",
          props.collapsed ? "size-4" : "size-3.5",
          props.active ? "text-foreground" : "text-subtle-foreground group-hover:text-foreground",
        )}
      />
      <span class={props.collapsed ? "sr-only" : "truncate"}>{props.item.label}</span>
    </a>
  );
}

function NavGroups(props: {
  items: NavItem[];
  path: string;
  label: string;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const grouped = (group: NavGroup) => props.items.filter((item) => item.group === group);

  // Each entry owns its own subtree; the deepest matching href wins when two
  // prefixes overlap. Settings is rendered separately in the footer.
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
              <div
                class={cn(
                  props.collapsed
                    ? "mt-1 border-t border-border/70 pt-2 first:mt-0 first:border-0 first:pt-0"
                    : "pt-3 first:pt-1",
                )}
              >
                <Show when={!props.collapsed}>
                  <div class="label-caps px-2 pb-1.5">{group.label}</div>
                </Show>
                <ul class={cn(props.collapsed ? "space-y-1" : "space-y-0.5")}>
                  <For each={items()}>
                    {(item) => {
                      const active = () => activeId() === item.id;

                      return (
                        <li>
                          <SidebarLink
                            item={item}
                            active={active()}
                            collapsed={props.collapsed}
                            onNavigate={props.onNavigate}
                          />
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

function SidebarUpdate(props: { collapsed?: boolean }) {
  return (
    <Show when={pendingDeployment()}>
      <Tooltip>
        <TooltipTrigger as="span" class={props.collapsed ? "block" : "block w-full"}>
          <button
            type="button"
            onClick={reloadForDeployment}
            aria-label="A new version is available. Reload to update."
            class={cn(
              "group mb-1 flex items-center rounded-lg text-left outline-none transition-[background-color,color] duration-[var(--duration-hover)] ease-swift hover:bg-hover focus-visible:ring-[3px] focus-visible:ring-ring/30",
              props.collapsed ? "mx-auto size-9 justify-center" : "h-10 w-full gap-2.5 px-1.5",
            )}
          >
            <span class="relative flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors duration-[var(--duration-hover)] ease-swift group-hover:text-foreground">
              <RefreshCw class="size-3.5" aria-hidden="true" />
              <span
                aria-hidden="true"
                class="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-brand ring-2 ring-shell"
              />
            </span>
            <Show when={!props.collapsed}>
              <span class="min-w-0 flex-1" aria-hidden="true">
                <span class="block truncate text-[12px] font-[500] leading-4 text-foreground">
                  Update available
                </span>
                <span class="block truncate text-[11px] text-muted-foreground">
                  Reload to apply
                </span>
              </span>
            </Show>
          </button>
        </TooltipTrigger>
        <TooltipContent side={props.collapsed ? "right" : "top"}>
          <p class="text-[11px] font-medium">A new version is available</p>
          <p class="mt-0.5 text-[11px]">
            Reload to get the latest changes. This page keeps working until you do.
          </p>
        </TooltipContent>
      </Tooltip>
    </Show>
  );
}

function SidebarPanel(props: {
  user: ShellUser | undefined;
  onSignOut: () => void | Promise<void>;
  superadmin?: boolean;
  activeId: string | undefined;
  items: NavItem[];
  settings?: NavItem;
  settingsActive?: boolean;
  path: string;
  label: string;
  collapsed?: boolean;
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
          <Show when={!props.collapsed} fallback={<BrandLogo mark class="text-[18px]" />}>
            <BrandLogo class="h-3" />
          </Show>
        </a>
      </div>

      <div class="px-2.5 pb-2">
        <TenantSwitcher
          activeId={props.activeId}
          userId={props.user?.id}
          collapsed={props.collapsed}
        />
      </div>

      <div class="no-scrollbar min-h-0 flex-1 overflow-y-auto px-2.5 pb-4">
        <NavGroups
          items={props.items}
          path={props.path}
          label={props.label}
          collapsed={props.collapsed}
          onNavigate={props.onNavigate}
        />
      </div>

      <Separator />
      <div class="shrink-0 p-2">
        <SidebarUpdate collapsed={props.collapsed} />
        <Show when={props.settings}>
          {(item) => (
            <nav aria-label="Tenant settings" class="mb-1">
              <SidebarLink
                item={item()}
                active={props.settingsActive === true}
                collapsed={props.collapsed}
                onNavigate={props.onNavigate}
              />
            </nav>
          )}
        </Show>
        <UserMenu
          user={props.user}
          onSignOut={props.onSignOut}
          superadmin={props.superadmin}
          collapsed={props.collapsed}
        />
      </div>
    </div>
  );
}

/**
 * The fallback for a route chunk that is still loading. It lives inside the
 * shell's main region, so a nested-route change keeps the sidebar, header and
 * this page's own layout mounted instead of replacing the whole dashboard with
 * the boot splash.
 */
function PageContentLoading() {
  return (
    <div class="flex flex-1 items-center justify-center py-24">
      <LoadingState label="Loading page…" size={18} />
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
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false);

  onSettled(() => {
    setLastTenant(readLastTenant());

    if (typeof localStorage !== "undefined") {
      setSidebarCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1");
    }
  });

  const toggleSidebar = () => {
    const next = !sidebarCollapsed();

    setSidebarCollapsed(next);

    if (typeof localStorage !== "undefined") {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
    }
  };

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

  const { can } = useCan();

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
    ...navFor(navTenant()).filter((item) => !item.permission || can(item.permission)),
    ...pinnedItems(),
  ]);

  /**
   * Settings is pinned to the sidebar footer, above the account row. Visibility
   * and the destination both come from the readable tab list, so a role whose
   * only settings access is `devices.read` (OS updates and Migration) sees the
   * entry and lands on that tab instead of General's denial.
   */
  const settings = createMemo<NavItem | undefined>(() => {
    const tenant = navTenant();

    if (!tenant) return undefined;
    const href = firstReadableSettingsTab(can, tenant);

    return href ? settingsNavItem(tenant, href) : undefined;
  });

  const settingsActive = createMemo(() => settings()?.match(location.pathname) ?? false);

  const pageLabel = createMemo(() => {
    // Track the router so client navigations recompute, but prefer the address
    // bar: while an async route guard settles the router can still report the
    // parent path, and a cold deep link would name the wrong settings section.
    const routed = location.pathname;
    const path = !isServer && window.location.pathname ? window.location.pathname : routed;

    if (path === "/account") return "Account";

    if (path === "/admin/accounts") return "Platform accounts";

    if (path === "/tenants/new") return "Create tenant";

    if (path === "/dashboard") return "Tenant";

    if (path.startsWith("/docs")) return "Documentation";

    // Settings sections share one navigation entry; naming the section keeps
    // tabs, history and screen-reader announcements distinguishable.
    const settingsSection = /\/settings(?:\/([^/]+))?/.exec(path)?.[1] ?? "";

    if (path.includes("/settings")) {
      const section = settingsTabById(settingsSection);

      if (section) return `Settings · ${section.label}`;
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
   * After a completed pathname change, move focus to the main landmark so
   * keyboard and screen-reader users land on the new page instead of the link
   * they followed. Closing sheets and menus keep their content mounted for an
   * exit transition, so wait until those overlays and the route transition have
   * settled before moving focus. Query-string-only navigations (filters,
   * pagination) never trigger this because only the pathname is tracked.
   */
  let initialRoute = true;
  let pendingFocusPath: string | undefined;
  let focusFrame: number | undefined;
  let focusDeadline = 0;

  const cancelPendingFocus = () => {
    if (focusFrame !== undefined) cancelAnimationFrame(focusFrame);
    focusFrame = undefined;
    pendingFocusPath = undefined;
  };

  const focusMainWhenReady = () => {
    focusFrame = undefined;

    if (!pendingFocusPath || pendingFocusPath !== location.pathname) return;
    if (typeof document === "undefined") return;

    // Menus are non-modal and their exit transition must not hold focus on the
    // page the operator just left. Only modals and the palette own focus.
    const overlayOpen = document.querySelector(
      '[data-slot="dialog-content"], [data-slot="command-palette"]',
    );

    if (isRouting() || mobileNavOpen() || overlayOpen) {
      // A dialog that intentionally stays open must not cause a stale focus
      // jump when it is dismissed much later.
      if (performance.now() >= focusDeadline) {
        pendingFocusPath = undefined;

        return;
      }

      focusFrame = requestAnimationFrame(focusMainWhenReady);

      return;
    }

    pendingFocusPath = undefined;
    document.getElementById("main")?.focus({ preventScroll: true });
    announce(untrack(pageTitle));
  };

  onCleanup(cancelPendingFocus);

  createEffect(
    () => location.pathname,
    () => {
      if (initialRoute) {
        initialRoute = false;

        return;
      }

      if (typeof document === "undefined") return;

      cancelPendingFocus();

      // The shell scrolls inside `main`, not the document, so the router's
      // pathname change has to reset that scrollport explicitly.
      document.getElementById("main")?.scrollTo({ top: 0 });

      pendingFocusPath = location.pathname;
      focusDeadline = performance.now() + 2_000;
      focusFrame = requestAnimationFrame(focusMainWhenReady);
    },
  );

  return (
    <div
      data-slot="app-shell"
      class="flex h-dvh overflow-hidden bg-background text-foreground selection:bg-brand/30 selection:text-foreground"
    >
      <a
        href="#main"
        onClick={() => document.getElementById("main")?.focus({ preventScroll: true })}
        class="sr-only z-[100] rounded-lg bg-primary px-3 py-2 text-[13px] font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>

      <div
        data-slot="app-frame"
        class="flex h-full min-h-0 w-full min-w-0 overflow-hidden bg-shell"
      >
        <aside
          class={cn(
            "hidden h-full shrink-0 overflow-hidden border-r border-border transition-[width] duration-[180ms] ease-swift lg:block",
            sidebarCollapsed() ? "w-16" : "w-[244px]",
          )}
        >
          <SidebarPanel
            user={props.user}
            onSignOut={props.onSignOut}
            superadmin={superadmin()}
            activeId={activeId()}
            items={navItems()}
            settings={settings()}
            settingsActive={settingsActive()}
            path={location.pathname}
            label="Primary"
            collapsed={sidebarCollapsed()}
          />
        </aside>

        <div class="flex min-h-0 min-w-0 flex-1 flex-col">
          <header
            data-slot="app-header"
            class="relative z-40 shrink-0 border-b border-border bg-shell/95 backdrop-blur supports-[backdrop-filter]:bg-shell/85"
          >
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
              <Button
                variant="ghost"
                size="icon-sm"
                class="hidden lg:inline-flex"
                aria-label={sidebarCollapsed() ? "Expand sidebar" : "Collapse sidebar"}
                aria-pressed={sidebarCollapsed() ? "true" : "false"}
                title={sidebarCollapsed() ? "Expand sidebar" : "Collapse sidebar"}
                onClick={toggleSidebar}
              >
                <Show when={sidebarCollapsed()} fallback={<PanelLeftClose class="size-4" />}>
                  <PanelLeftOpen class="size-4" />
                </Show>
              </Button>
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
                <HelpMenu />
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
            aria-busy={isRouting() ? "true" : undefined}
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
              <Show when={!isServer && isHydrated()}>
                <Loading fallback={<PageContentLoading />}>{props.children}</Loading>
              </Show>
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
            settings={settings()}
            settingsActive={settingsActive()}
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
