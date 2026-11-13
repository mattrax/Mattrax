import { useLocation, useNavigate } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, For, onSettled, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  BookOpen,
  Boxes,
  Building2,
  Check,
  ChevronsUpDown,
  CircleAlert,
  LayoutDashboard,
  LogOut,
  Search as SearchIcon,
  Sparkles,
  User,
  X,
} from "~/components/ui/icons";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";
import { authClient } from "~/lib/auth";
import { cn } from "~/lib/utils";

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

/** The workspace most recently used on this device, so unscoped pages still
 * have somewhere to go without guessing from the server's tenant order. */
export function readLastTenant(): string | undefined {
  if (typeof localStorage === "undefined") return undefined;
  return localStorage.getItem(LAST_TENANT_KEY) ?? undefined;
}

export function rememberTenant(id: string | undefined) {
  if (typeof localStorage === "undefined" || !id) return;
  localStorage.setItem(LAST_TENANT_KEY, id);
}

function TenantSwitcher(props: {
  activeId: string | undefined;
  onOpenWorkspaces: () => void;
}) {
  const me = useQuery(() => ({ queryKey: enterpriseKeys.me(), queryFn: enterprise.me }));
  const navigate = useNavigate();
  const active = () => me.data?.tenants.find((tenant) => tenant.id === props.activeId);
  const tenants = () => me.data?.tenants ?? [];

  return (
    <DropdownMenu placement="bottom-start">
      <DropdownMenuTrigger
        class="group flex h-8 min-w-0 max-w-[15rem] items-center gap-2 rounded-lg px-1.5 pr-2 text-left outline-none transition-colors hover:bg-white/[0.055] focus-visible:ring-2 focus-visible:ring-ring/60 data-expanded:bg-white/[0.07]"
        aria-label="Switch workspace"
      >
        <Show
          when={active()}
          fallback={
            <span class="flex size-6 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-muted-foreground">
              <Building2 class="size-3.5" />
            </span>
          }
        >
          {(tenant) => (
            <span class="flex size-6 shrink-0 items-center justify-center rounded-md bg-brand text-[10px] font-semibold text-brand-foreground shadow-[inset_0_1px_0_rgba(255,255,255,.25)]">
              {tenantInitials(tenant().name)}
            </span>
          )}
        </Show>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-[13px] font-medium leading-4 text-foreground">
            <Show when={active()} fallback="Select workspace">
              {(tenant) => tenant().name}
            </Show>
          </span>
          <Show when={active()}>
            {(tenant) => (
              <span class="block truncate text-[10px] capitalize leading-3 text-muted-foreground">
                {tenant().role} · {tenant().slug}
              </span>
            )}
          </Show>
        </span>
        <ChevronsUpDown class="size-3.5 shrink-0 text-muted-foreground/70 transition-colors group-hover:text-muted-foreground" />
      </DropdownMenuTrigger>

      <DropdownMenuContent class="w-72 rounded-xl border border-border bg-popover p-1.5 shadow-2xl shadow-black/50">
        <div class="px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Workspaces
        </div>
        <Show
          when={tenants().length > 0}
          fallback={
            <div class="px-2 py-3 text-xs text-muted-foreground">
              You don't belong to a workspace yet.
            </div>
          }
        >
          <For each={tenants()}>
            {(tenant) => (
              <DropdownMenuItem
                as="a"
                href={`/t/${tenant.id}`}
                role="menuitem"
                onClick={(event) => {
                  event.preventDefault();
                  rememberTenant(tenant.id);
                  navigate(`/t/${tenant.id}`);
                }}
                class="mb-0.5 flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-sm outline-none focus:bg-white/[0.06]"
              >
                <span class="flex size-7 shrink-0 items-center justify-center rounded-md bg-white/[0.06] text-[10px] font-semibold text-foreground ring-1 ring-inset ring-white/[0.06]">
                  {tenantInitials(tenant.name)}
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-[13px] font-medium">{tenant.name}</span>
                  <span class="block truncate text-[11px] capitalize text-muted-foreground">
                    {tenant.role} · {tenant.slug}
                  </span>
                </span>
                <Show when={props.activeId === tenant.id}>
                  <Check class="size-3.5 shrink-0 text-brand" />
                </Show>
              </DropdownMenuItem>
            )}
          </For>
        </Show>
        <DropdownMenuSeparator class="my-1 h-px bg-border" />
        <DropdownMenuItem
          onSelect={props.onOpenWorkspaces}
          class="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-[13px] outline-none focus:bg-white/[0.06]"
        >
          <span class="flex size-7 items-center justify-center rounded-md bg-white/[0.04] text-muted-foreground">
            <LayoutDashboard class="size-3.5" />
          </span>
          All workspaces
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => navigate("/tenants/new")}
          class="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-[13px] outline-none focus:bg-white/[0.06]"
        >
          <span class="flex size-7 items-center justify-center rounded-md bg-white/[0.04] text-muted-foreground">
            <Sparkles class="size-3.5" />
          </span>
          Create workspace
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SearchButton(props: { compact?: boolean }) {
  const open = () =>
    window.dispatchEvent(new Event("mattrax:open-command-palette"));

  return (
    <button
      type="button"
      onClick={open}
      aria-label="Search"
      class={cn(
        "group flex h-8 items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.025] text-muted-foreground outline-none transition-colors hover:bg-white/[0.055] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60",
        props.compact ? "w-8 justify-center px-0 sm:w-auto sm:justify-start sm:px-2.5" : "px-2.5",
      )}
    >
      <SearchIcon class="size-3.5" />
      <span class="hidden text-xs sm:inline">Search</span>
      <kbd class="ml-6 hidden rounded border border-white/[0.08] bg-white/[0.04] px-1 py-px font-sans text-[10px] text-muted-foreground sm:inline">
        ⌘K
      </kbd>
    </button>
  );
}

type ShellUser = {
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
        class="flex size-8 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-white/[0.18] to-white/[0.06] text-[11px] font-semibold text-foreground outline-none ring-1 ring-inset ring-white/[0.12] transition-shadow hover:ring-white/25 focus-visible:ring-2 focus-visible:ring-ring/60"
        aria-label="Account menu"
      >
        <Show
          when={user()?.image}
          fallback={<span>{initials(user()?.name)}</span>}
        >
          {(image) => (
            <img src={image()} alt={user()?.name ?? ""} class="size-full object-cover" />
          )}
        </Show>
      </DropdownMenuTrigger>
      <DropdownMenuContent class="w-64 rounded-xl border border-border bg-popover p-1.5 shadow-2xl shadow-black/50">
        <div class="flex items-center gap-2.5 px-2 py-2">
          <span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-[11px] font-semibold ring-1 ring-inset ring-white/[0.08]">
            {initials(user()?.name)}
          </span>
          <span class="min-w-0">
            <span class="block truncate text-[13px] font-medium">{user()?.name}</span>
            <span class="block truncate text-[11px] text-muted-foreground">{user()?.email}</span>
          </span>
        </div>
        <DropdownMenuSeparator class="my-1 h-px bg-border" />
        <DropdownMenuItem
          onSelect={() => navigate("/account")}
          class="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-[13px] outline-none focus:bg-white/[0.06]"
        >
          <User class="size-3.5 text-muted-foreground" />
          Account settings
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => navigate("/dashboard")}
          class="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-[13px] outline-none focus:bg-white/[0.06]"
        >
          <LayoutDashboard class="size-3.5 text-muted-foreground" />
          All workspaces
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => navigate("/instances")}
          class="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-[13px] outline-none focus:bg-white/[0.06]"
        >
          <Boxes class="size-3.5 text-muted-foreground" />
          Instances
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => navigate("/docs/")}
          class="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-[13px] outline-none focus:bg-white/[0.06]"
        >
          <BookOpen class="size-3.5 text-muted-foreground" />
          Documentation
        </DropdownMenuItem>
        <DropdownMenuItem
          as="a"
          role="menuitem"
          href="mailto:hello@mattrax.app?subject=Mattrax%20feedback"
          class="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-[13px] outline-none focus:bg-white/[0.06]"
        >
          <Sparkles class="size-3.5 text-muted-foreground" />
          Send feedback
        </DropdownMenuItem>
        <DropdownMenuSeparator class="my-1 h-px bg-border" />
        <DropdownMenuItem
          onSelect={() => props.onSignOut()}
          class="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-[13px] text-muted-foreground outline-none focus:bg-white/[0.06] focus:text-foreground"
        >
          <LogOut class="size-3.5" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function EmailVerificationBanner(props: { user: ShellUser | undefined }) {
  const user = () => props.user;
  const [dismissed, setDismissed] = createSignal(false);
  const [sent, setSent] = createSignal(false);
  const [sending, setSending] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  onSettled(() => {
    if (sessionStorage.getItem("mattrax:verify-banner-dismissed") === "1") setDismissed(true);
  });

  const resend = async () => {
    setSending(true);
    setError(null);
    const result = await authClient.requestEmailVerification();
    setSending(false);
    if (result.error) setError(result.error.message ?? "Could not send the email.");
    else setSent(true);
  };

  return (
    <Show when={user() && !user()!.emailVerified && !dismissed()}>
      <div class="relative border-b border-warning/20 bg-warning/[0.07]">
        <div class="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-[12px] text-warning-foreground sm:px-6 lg:px-8">
          <CircleAlert class="size-3.5 shrink-0" />
          <span class="font-medium">Verify your email</span>
          <span class="hidden text-warning-foreground/75 sm:inline">
            to enable passwordless sign-in and account recovery.
          </span>
          <Show
            when={!sent()}
            fallback={
              <span class="font-medium text-success-foreground">
                Verification email sent — check your inbox.
              </span>
            }
          >
            <button
              type="button"
              disabled={sending()}
              onClick={resend}
              class="font-medium underline decoration-warning-foreground/40 underline-offset-2 transition-colors hover:decoration-warning-foreground disabled:opacity-60"
            >
              {sending() ? "Sending…" : "Resend email"}
            </button>
          </Show>
          <Show when={error()}>
            {(message) => <span class="text-destructive">{message()}</span>}
          </Show>
          <button
            type="button"
            aria-label="Dismiss email verification reminder"
            onClick={() => {
              setDismissed(true);
              sessionStorage.setItem("mattrax:verify-banner-dismissed", "1");
            }}
            class="ml-auto rounded p-1 text-warning-foreground/60 transition-colors hover:bg-warning/10 hover:text-warning-foreground"
          >
            <X class="size-3.5" />
          </button>
        </div>
      </div>
    </Show>
  );
}

function navFor(tenantId: string | undefined): NavItem[] {
  if (!tenantId) {
    return [
      {
        id: "workspaces",
        label: "Workspaces",
        href: "/dashboard",
        match: (value) => value === "/dashboard" || value === "/tenants/new",
      },
      { id: "instances", label: "Instances", href: "/instances", match: (value) => value === "/instances" },
      { id: "docs", label: "Documentation", href: "/docs/", match: (value) => value.startsWith("/docs") },
    ];
  }
  const base = `/t/${tenantId}`;
  return [
    { id: "overview", label: "Overview", href: base, match: (value) => value === base },
    { id: "devices", label: "Devices", href: `${base}/devices`, match: (value) => value.startsWith(`${base}/devices`) },
    { id: "groups", label: "Groups", href: `${base}/groups`, match: (value) => value.startsWith(`${base}/groups`) },
    { id: "policies", label: "Policies", href: `${base}/policies`, match: (value) => value.startsWith(`${base}/policies`) },
    {
      id: "applications",
      label: "Applications",
      href: `${base}/applications`,
      match: (value) => value.startsWith(`${base}/applications`),
    },
    {
      id: "software",
      label: "Software",
      href: `${base}/software`,
      match: (value) => value.startsWith(`${base}/software`),
    },
    {
      id: "enrollment",
      label: "Enrollment",
      href: `${base}/settings/enrollment`,
      match: (value) => value.startsWith(`${base}/settings/enrollment`),
    },
    {
      id: "settings",
      label: "Settings",
      href: `${base}/settings`,
      match: (value) => value.startsWith(`${base}/settings`) && !value.startsWith(`${base}/settings/enrollment`),
    },
  ];
}

export function AppShell(props: {
  children: JSX.Element;
  user: ShellUser | undefined;
  onSignOut: () => void | Promise<void>;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const routeTenantId = createMemo(() => location.pathname.match(/^\/t\/([^/]+)/)?.[1]);
  const me = useQuery(() => ({ queryKey: enterpriseKeys.me(), queryFn: enterprise.me }));
  const [lastTenant, setLastTenant] = createSignal<string | undefined>();

  onSettled(() => {
    setLastTenant(readLastTenant());
  });

  createEffect(
    () => routeTenantId(),
    (id) => {
      if (!id) return;
      rememberTenant(id);
      setLastTenant(id);
    },
  );

  const activeId = createMemo(() => {
    const routeId = routeTenantId();
    if (routeId) return routeId;
    const known = me.data?.tenants ?? [];
    const remembered = lastTenant();
    if (remembered && known.some((tenant) => tenant.id === remembered)) return remembered;
    return known[0]?.id;
  });

  createEffect(
    () => activeId(),
    (id) => {
      if (!id) return;
      rememberTenant(id);
      setLastTenant(id);
    },
  );

  const scopedTenant = createMemo(() => (routeTenantId() ? activeId() : undefined));
  const navItems = createMemo(() => navFor(scopedTenant()));

  return (
    <div class="dark flex min-h-svh flex-col bg-background text-foreground selection:bg-brand/30 selection:text-foreground">
      <a
        href="#main"
        class="sr-only z-[100] rounded-lg bg-primary px-3 py-2 text-[13px] font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>
      <div class="pointer-events-none fixed inset-x-0 top-0 z-0 h-72 bg-[radial-gradient(70%_100%_at_50%_0%,rgba(91,100,255,0.09),transparent_75%)]" />
      <header class="sticky top-0 z-40 border-b border-white/[0.065] bg-background/85 backdrop-blur-xl">
        <div class="mx-auto flex h-12 max-w-[1600px] items-center gap-2 px-3 sm:px-5 lg:px-6">
          <a
            href="/dashboard"
            class="flex shrink-0 items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            aria-label="Mattrax home"
          >
            <span class="flex size-7 items-center justify-center rounded-[7px] bg-gradient-to-b from-white to-white/85 text-[13px] font-bold tracking-tight text-black shadow-[inset_0_1px_0_rgba(255,255,255,.8),0_2px_8px_rgba(0,0,0,.4)]">
              M
            </span>
            <span class="hidden text-[13px] font-semibold tracking-[-0.01em] text-foreground sm:block">
              Mattrax
            </span>
          </a>

          <span class="mx-1 hidden h-4 w-px bg-white/[0.08] sm:block" aria-hidden="true" />
          <TenantSwitcher activeId={activeId()} onOpenWorkspaces={() => navigate("/dashboard")} />

          <div class="ml-auto flex items-center gap-1">
            <SearchButton />
            <a
              href="/docs/"
              aria-label="Documentation"
              class="hidden size-8 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-white/[0.055] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 sm:flex"
            >
              <BookOpen class="size-4" />
            </a>
            <span class="mx-1 hidden h-4 w-px bg-white/[0.08] sm:block" aria-hidden="true" />
            <UserMenu user={props.user} onSignOut={props.onSignOut} />
          </div>
        </div>

        <div class="mx-auto flex max-w-[1600px] items-center gap-3 px-3 sm:px-5 lg:px-6">
          <div class="relative min-w-0 flex-1">
            <nav
              aria-label="Primary"
              class="no-scrollbar -mb-px flex h-11 items-center gap-0.5 overflow-x-auto"
            >
              <For each={navItems()}>
                {(item) => {
                  const active = () => item.match(location.pathname);
                  return (
                    <a
                      href={item.href}
                      aria-current={active() ? "page" : undefined}
                      class={cn(
                        "relative flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                        active()
                          ? "bg-white/[0.075] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,.05)]"
                          : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
                      )}
                    >
                      {item.label}
                    </a>
                  );
                }}
              </For>
            </nav>
            <span
              class="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent sm:hidden"
              aria-hidden="true"
            />
          </div>
        </div>
      </header>

      <Show when={!location.pathname.endsWith("/design")}>
        <EmailVerificationBanner user={props.user} />
      </Show>

      <main id="main" class="relative z-10 mx-auto flex w-full max-w-[1600px] flex-1 flex-col">
        {props.children}
      </main>

      <Show when={!location.pathname.endsWith("/design")}>
        <footer class="relative z-10 mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-5 text-[11px] text-muted-foreground/60 sm:px-6 lg:px-8">
        <span>Mattrax</span>
        <a class="transition-colors hover:text-muted-foreground" href="/docs/">
          Documentation
        </a>
        <a class="transition-colors hover:text-muted-foreground" href="mailto:hello@mattrax.app">
          Support
        </a>
        <a
          class="ml-auto inline-flex items-center gap-1 transition-colors hover:text-muted-foreground"
          href="https://status.otbeaumont.me"
          target="_blank"
          rel="noopener"
        >
          All systems operational
          <span class="size-1.5 rounded-full bg-success" aria-hidden="true" />
          </a>
        </footer>
      </Show>
    </div>
  );
}
