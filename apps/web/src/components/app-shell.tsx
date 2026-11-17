import { useIsRouting, useLocation } from "@solidjs/router";
import { useNavigate } from "~/lib/navigation";
import { useQuery } from "@tanstack/solid-query";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Activity,
  BookOpen,
  Building2,
  ChevronsUpDown,
  HelpCircle,
  LogOut,
  Plus,
  Search as SearchIcon,
  User,
} from "~/components/ui/icons";
import { meQueryOptions } from "~/lib/enterprise";
import { routes } from "~/lib/routes";
import { resolveLandingTenant } from "~/lib/tenant";
import { announce, announcementText, Toaster } from "~/components/toast";
import {
  SETTINGS_READ_PERMISSIONS,
  tenantRoleName,
  tenantSectionPermission,
  useCan,
} from "~/lib/permissions";
import { cn } from "~/lib/utils";
import { isHydrated } from "~/lib/query-client";
import { isServer } from "@solidjs/web";
import { installTheme } from "~/lib/theme";
import { setCrossTabTenant } from "~/lib/cross-tab-sync";
import { BrandLogo } from "~/components/brand-logo";
import { ErrorPanel } from "~/components/error-boundary";

type NavItem = {
  id: string;
  label: string;
  href: string;
  match: (path: string) => boolean;
};

const LAST_TENANT_KEY = "mattrax:last-tenant";

function initials(name: string | undefined | null) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);

  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();

  return parts[0]?.[0]?.toUpperCase() ?? "?";
}

function tenantInitials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;

  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
        class="group flex h-7 min-w-0 max-w-[14rem] items-center gap-2 rounded-md px-1.5 pr-2 text-left outline-none transition-[color,background-color,scale] duration-150 ease-swift hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/60 data-expanded:bg-hover motion-safe:active:scale-[0.985]"
        title={active() ? `Switch tenant: ${active()!.name}` : "Select tenant"}
      >
        {/* The name is composed from the visible content so assistive tech and
            the visible label stay in sync; the leading text states the action. */}
        <span class="sr-only">Switch tenant: </span>
        <Show when={!active()}>
          <span
            aria-hidden="true"
            class="flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-border bg-surface text-muted-foreground"
          >
            <Building2 class="size-2.5" />
          </span>
        </Show>
        <span class="min-w-0 truncate text-[13px] font-[450] text-muted-foreground transition-colors group-hover:text-foreground group-data-[expanded]:text-foreground">
          <Show
            when={!loading()}
            fallback={<span class="block h-2.5 w-20 animate-pulse rounded-full bg-hover" />}
          >
            <Show when={active()} fallback="Select tenant">
              {(tenant) => tenant().name}
            </Show>
          </Show>
        </span>
        <ChevronsUpDown class="-ml-1 size-3 shrink-0 text-muted-foreground transition-colors group-hover:text-muted-foreground group-data-[expanded]:text-muted-foreground" />
      </DropdownMenuTrigger>

      <DropdownMenuContent class="w-[288px] rounded-lg border border-border bg-popover p-0.5 text-popover-foreground shadow-[var(--shadow-popover)]">
        <DropdownMenuGroup>
          <DropdownMenuLabel class="px-2.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Tenants
          </DropdownMenuLabel>
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
              onChange={(id) => {
                rememberTenant(id);
                const tenant = tenants().find((item) => item.id === id);
                navigate(routes.tenant(tenant?.slug || id).overview());
              }}
            >
              <For each={tenants()}>
                {(tenant) => (
                  <DropdownMenuRadioItem
                    value={tenant.id}
                    // RadioGroup onChange can be skipped when the group has no
                    // current value (unscoped pages), so navigate on select too.
                    onSelect={() => {
                      rememberTenant(tenant.id);
                      navigate(routes.tenant(tenant.slug || tenant.id).overview());
                    }}
                    aria-current={props.activeId === tenant.id ? "true" : undefined}
                    class="flex h-10 cursor-pointer items-center gap-2.5 rounded-[5px] px-2 pl-8 text-sm outline-none data-highlighted:bg-hover"
                  >
                    <span class="flex size-5 shrink-0 items-center justify-center rounded-[4px] bg-hover text-[9px] font-semibold leading-none text-foreground/90 ring-1 ring-inset ring-border">
                      {tenantInitials(tenant.name)}
                    </span>
                    <span class="min-w-0 flex-1 leading-none">
                      <span class="block truncate text-[13px] font-[450] text-foreground">
                        {tenant.name}
                      </span>
                      <span class="mt-1 block truncate text-[10.5px] leading-none text-muted-foreground">
                        <span class="capitalize">{tenantRoleName(tenant) ?? tenant.role}</span>
                        <span class="px-1 text-muted-foreground/40">·</span>
                        <span class="normal-case">{tenant.slug}</span>
                      </span>
                    </span>
                  </DropdownMenuRadioItem>
                )}
              </For>
            </DropdownMenuRadioGroup>
          </Show>
        </DropdownMenuGroup>
        <div class="mx-1 my-1 h-px bg-border" />
        <DropdownMenuItem
          onSelect={() => navigate("/tenants/new")}
          class="flex h-8 cursor-pointer items-center gap-2.5 rounded-[5px] px-2 text-[12.5px] text-muted-foreground outline-none data-highlighted:bg-hover data-highlighted:text-foreground"
        >
          <span class="flex size-5 items-center justify-center text-muted-foreground">
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
        "group flex h-7 items-center gap-2 rounded-md text-muted-foreground outline-none transition-[color,background-color,scale] duration-150 ease-swift hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 motion-safe:active:scale-[0.985]",
        props.compact ? "w-7 justify-center px-0 sm:w-auto sm:justify-start sm:px-2" : "px-2",
      )}
    >
      <SearchIcon class="size-3.5" aria-hidden="true" />
      <span class="sr-only">Search</span>
      <kbd
        aria-hidden="true"
        class="hidden rounded border border-border bg-surface px-1 py-px font-sans text-[9.5px] text-muted-foreground sm:inline"
      >
        ⌘K
      </kbd>
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

function UserMenu(props: { user: ShellUser | undefined; onSignOut: () => void | Promise<void> }) {
  const user = () => props.user;
  const navigate = useNavigate();

  return (
    <DropdownMenu placement="bottom-end">
      <DropdownMenuTrigger
        class="flex size-6 items-center justify-center overflow-hidden rounded-full bg-hover text-[9.5px] font-semibold text-foreground outline-none ring-1 ring-inset ring-border transition-[box-shadow,scale] duration-150 ease-swift hover:ring-input focus-visible:ring-2 focus-visible:ring-ring/60 motion-safe:active:scale-[0.985]"
        title={user()?.name ?? "Account"}
        aria-label={user()?.image ? "Account menu" : `${initials(user()?.name)}, account menu`}
      >
        <Show
          when={user()?.image}
          fallback={<span aria-hidden="true">{initials(user()?.name)}</span>}
        >
          {(image) => <img src={image()} alt="" class="size-full object-cover" />}
        </Show>
      </DropdownMenuTrigger>
      <DropdownMenuContent class="w-[248px] rounded-lg border border-border bg-popover p-0.5 text-popover-foreground shadow-[var(--shadow-popover)]">
        <DropdownMenuGroup>
          <div class="flex items-center gap-2.5 px-2 py-2">
            <span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-hover text-[9.5px] font-semibold ring-1 ring-inset ring-border">
              <span aria-hidden="true">{initials(user()?.name)}</span>
            </span>
            <span class="min-w-0">
              <DropdownMenuLabel class="block truncate text-[13px] font-medium">
                {user()?.name}
              </DropdownMenuLabel>
              <span class="block truncate text-[11px] text-muted-foreground">{user()?.email}</span>
            </span>
          </div>
        </DropdownMenuGroup>
        <DropdownMenuSeparator class="my-1 h-px bg-border" />
        <DropdownMenuItem
          onSelect={() => navigate("/account")}
          class="flex h-8 cursor-pointer items-center gap-2.5 rounded-[5px] px-2 text-[12.5px] outline-none focus:bg-hover"
        >
          <User class="size-3.5 text-muted-foreground" />
          Account settings
        </DropdownMenuItem>
        <DropdownMenuItem
          as="a"
          role="menuitem"
          href="/docs/"
          target="_self"
          class="flex h-8 cursor-pointer items-center gap-2.5 rounded-[5px] px-2 text-[12.5px] outline-none focus:bg-hover"
        >
          <BookOpen class="size-3.5 text-muted-foreground" />
          Documentation
        </DropdownMenuItem>
        <DropdownMenuItem
          as="a"
          role="menuitem"
          href="mailto:hello@mattrax.app?subject=Mattrax%20support"
          class="flex h-8 cursor-pointer items-center gap-2.5 rounded-[5px] px-2 text-[12.5px] outline-none focus:bg-hover"
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
          class="flex h-8 cursor-pointer items-center gap-2.5 rounded-[5px] px-2 text-[12.5px] outline-none focus:bg-hover"
        >
          <Activity class="size-3.5 text-muted-foreground" />
          System status
        </DropdownMenuItem>
        <DropdownMenuSeparator class="my-1 h-px bg-border" />
        <DropdownMenuItem
          onSelect={() => props.onSignOut()}
          class="flex h-8 cursor-pointer items-center gap-2.5 rounded-[5px] px-2 text-[12.5px] text-muted-foreground outline-none focus:bg-hover focus:text-foreground"
        >
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

  const item = (id: string, label: string, href: string, exact = false): NavItem => ({
    id,
    label,
    href,
    match: (value) => value === href || (!exact && value.startsWith(`${href}/`)),
  });

  // Overview is the tenant root; a prefix match would also match every child.
  return [
    item("overview", "Overview", base, true),
    item("dashboards", "Dashboards", tenant.dashboards()),
    item("devices", "Devices", tenant.devices()),
    item("groups", "Groups", tenant.groups()),
    item("policies", "Policies", tenant.policies()),
    item("applications", "Applications", tenant.applications()),
    item("scripts", "Scripts", tenant.scripts()),
    item("settings", "Settings", tenant.settings()),
  ];
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
  const [lastTenant, setLastTenant] = createSignal<string | undefined>();

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
      defaultTenantId: me.data?.user.defaultTenantId,
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
  const { can, canAny } = useCan();

  // Mutations broadcast to other tabs under the tenant currently on screen.
  createEffect(
    () => scopedTenant() ?? null,
    (tenantId) => setCrossTabTenant(tenantId),
  );

  const navItems = createMemo(() =>
    navFor(tenantSegment()).filter((item) => {
      if (item.id === "settings") return canAny(SETTINGS_READ_PERMISSIONS);

      const required = tenantSectionPermission(item.id);

      return !required || can(required);
    }),
  );

  const settingsLabels = new Map([
    ["", "General"],
    ["administrators", "Members"],
    ["identity", "Identity"],
    ["enrollment", "Enrollment"],
    ["management", "Management"],
    ["delivery", "Delivery"],
    ["integrations", "Integrations"],
    ["audit", "Audit log"],
    ["billing", "Billing"],
  ]);

  const pageLabel = createMemo(() => {
    const path = location.pathname;

    if (path === "/account") return "Account";

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

      // A dialog owns focus while it is open; moving focus into the inert
      // background would strand it.
      if (document.querySelector('[data-slot="dialog-content"], [data-slot="command-palette"]'))
        return;

      document.getElementById("main")?.focus({ preventScroll: true });
      announce(untrack(pageTitle));
    },
  );

  let navRef: HTMLElement | undefined;
  const [indicator, setIndicator] = createSignal<{ left: number; width: number } | null>(null);
  const [indicatorReady, setIndicatorReady] = createSignal(false);
  let indicatorFrame: number | undefined;

  const measureIndicator = () => {
    if (!navRef) return;
    const activeLink = navRef.querySelector<HTMLElement>('[aria-current="page"]');

    if (!activeLink) {
      setIndicator(null);

      return;
    }

    setIndicator({
      left: activeLink.offsetLeft + 12,
      width: Math.max(0, activeLink.offsetWidth - 24),
    });
  };

  const queueMeasure = () => {
    if (typeof window === "undefined") return;

    if (indicatorFrame !== undefined) cancelAnimationFrame(indicatorFrame);
    indicatorFrame = requestAnimationFrame(() => {
      indicatorFrame = undefined;
      measureIndicator();
    });
  };

  onSettled(() => {
    queueMeasure();
    requestAnimationFrame(() => setIndicatorReady(true));
    const observer = new ResizeObserver(queueMeasure);

    if (navRef) observer.observe(navRef);
    window.addEventListener("resize", queueMeasure);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", queueMeasure);

      if (indicatorFrame !== undefined) cancelAnimationFrame(indicatorFrame);
    };
  });

  createEffect(
    () => navItems(),
    () => queueMeasure(),
  );

  createEffect(
    () => location.pathname,
    () => {
      queueMeasure();
      queueMicrotask(() => {
        navRef?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({
          inline: "nearest",
          block: "nearest",
          behavior: prefersReducedMotion() ? "auto" : "smooth",
        });
      });
    },
  );

  return (
    <div class="flex min-h-svh flex-col bg-background text-foreground selection:bg-brand/30 selection:text-foreground">
      <a
        href="#main"
        class="sr-only z-[100] rounded-lg bg-primary px-3 py-2 text-[13px] font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>
      <header class="sticky top-0 z-40 border-b border-border bg-background">
        <div class="mx-auto flex h-12 max-w-[1600px] items-center gap-2 px-3 sm:px-5 lg:px-6">
          <a
            href="/dashboard"
            class="flex shrink-0 items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            aria-label="Mattrax home"
          >
            <BrandLogo class="h-3.5" />
          </a>

          <span class="mx-1 hidden h-3.5 w-px bg-border sm:block" aria-hidden="true" />
          <TenantSwitcher activeId={activeId()} userId={props.user?.id} />

          <div class="ml-auto flex items-center gap-1">
            <SearchButton />
            <UserMenu user={props.user} onSignOut={props.onSignOut} />
          </div>
        </div>

        <div class="mx-auto flex max-w-[1600px] items-center gap-3 px-3 sm:px-5 lg:px-6">
          <div class="relative min-w-0 flex-1">
            <nav
              ref={(element) => {
                navRef = element;
              }}
              aria-label="Primary"
              class="no-scrollbar relative -mb-px flex h-11 items-center gap-0.5 overflow-x-auto"
            >
              <For each={navItems()}>
                {(item) => {
                  const active = () => item.match(location.pathname);

                  return (
                    <a
                      href={item.href}
                      aria-current={active() ? "page" : undefined}
                      class={cn(
                        "relative flex h-11 shrink-0 items-center px-3 text-[13px] font-[450] transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60",
                        active()
                          ? "text-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {item.label}
                    </a>
                  );
                }}
              </For>
              <Show when={indicator()}>
                {(position) => (
                  <span
                    class={cn(
                      "pointer-events-none absolute bottom-0 left-0 h-[2px] rounded-full bg-foreground",
                      indicatorReady() &&
                        "transition-[transform,width] duration-200 ease-swift motion-reduce:transition-none",
                    )}
                    style={{
                      transform: `translateX(${position().left}px)`,
                      width: `${position().width}px`,
                    }}
                    aria-hidden="true"
                  />
                )}
              </Show>
            </nav>
            <span
              class="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent sm:hidden"
              aria-hidden="true"
            />
          </div>
        </div>

        {/* Route progress: a slim indeterminate segment pinned to the header
            edge. It disappears the moment the router settles, so it never
            competes with the page's own entrance. */}
        <Show when={isRouting()}>
          <div
            class="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden"
            aria-hidden="true"
          >
            <div class="route-progress h-full w-2/5 bg-gradient-to-r from-brand/0 via-brand to-brand/0" />
          </div>
        </Show>
      </header>

      <main
        id="main"
        tabindex="-1"
        class={cn(
          "relative z-10 mx-auto flex w-full max-w-[1600px] flex-1 scroll-mt-24 flex-col transition-opacity duration-[140ms] ease-swift focus:outline-none",
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
      <div role="status" aria-live="polite" aria-atomic="true" class="sr-only">
        {announcementText()}
      </div>
      <Toaster />
    </div>
  );
}
