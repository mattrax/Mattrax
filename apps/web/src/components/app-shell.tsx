import { useIsRouting, useLocation, useNavigate } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, Errored, For, onSettled, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Activity,
  BookOpen,
  Building2,
  Check,
  ChevronsUpDown,
  CircleAlert,
  HelpCircle,
  LogOut,
  Plus,
  Search as SearchIcon,
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

function TenantSwitcher(props: { activeId: string | undefined }) {
  const me = useQuery(() => ({ queryKey: enterpriseKeys.me(), queryFn: enterprise.me }));
  const navigate = useNavigate();
  const active = () => me.data?.tenants.find((tenant) => tenant.id === props.activeId);
  const tenants = () => me.data?.tenants ?? [];

  return (
    <DropdownMenu placement="bottom-start">
      <DropdownMenuTrigger
        class="group flex h-7 min-w-0 max-w-[14rem] items-center gap-2 rounded-md px-1.5 pr-2 text-left outline-none transition-[color,background-color,scale] duration-150 ease-swift hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-ring/60 data-expanded:bg-white/[0.08] motion-safe:active:scale-[0.985]"
        aria-label="Switch tenant"
        title={active() ? `Switch tenant: ${active()!.name}` : "Select tenant"}
      >
        <Show
          when={active()}
          fallback={
            <span class="flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-white/10 bg-white/[0.04] text-muted-foreground">
              <Building2 class="size-2.5" />
            </span>
          }
        >
          {(tenant) => (
            <span class="flex size-4 shrink-0 items-center justify-center rounded-[4px] bg-white/[0.09] text-[8px] font-semibold leading-none text-foreground/90 ring-1 ring-inset ring-white/[0.08]">
              {tenantInitials(tenant().name)}
            </span>
          )}
        </Show>
        <span class="min-w-0 truncate text-[13px] font-[450] text-muted-foreground transition-colors group-hover:text-foreground group-data-[expanded]:text-foreground">
          <Show when={active()} fallback="Select tenant">
            {(tenant) => tenant().name}
          </Show>
        </span>
        <ChevronsUpDown class="-ml-1 size-3 shrink-0 text-muted-foreground/70 transition-colors group-hover:text-muted-foreground group-data-[expanded]:text-muted-foreground" />
      </DropdownMenuTrigger>

      <DropdownMenuContent class="w-[288px] rounded-lg border border-white/[0.09] bg-[#232326] p-0.5 text-popover-foreground shadow-[0_8px_24px_rgba(0,0,0,.45),0_2px_6px_rgba(0,0,0,.3),inset_0_0_0_1px_rgba(255,255,255,.02)]">
        <div class="px-2.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">
          Tenants
        </div>
        <Show
          when={tenants().length > 0}
          fallback={
            <div class="px-2.5 py-3 text-[12px] text-muted-foreground">
              You don't belong to a tenant yet.
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
                class="flex h-10 cursor-pointer items-center gap-2.5 rounded-[5px] px-2 text-sm outline-none focus:bg-white/[0.07] data-highlighted:bg-white/[0.07]"
              >
                <span class="flex size-5 shrink-0 items-center justify-center rounded-[4px] bg-white/[0.08] text-[9px] font-semibold leading-none text-foreground/90 ring-1 ring-inset ring-white/[0.06]">
                  {tenantInitials(tenant.name)}
                </span>
                <span class="min-w-0 flex-1 leading-none">
                  <span class="block truncate text-[13px] font-[450] text-foreground">
                    {tenant.name}
                  </span>
                  <span class="mt-1 block truncate text-[10.5px] leading-none text-muted-foreground">
                    <span class="capitalize">{tenant.role}</span>
                    <span class="px-1 text-muted-foreground/40">·</span>
                    <span class="normal-case">{tenant.slug}</span>
                  </span>
                </span>
                <Show when={props.activeId === tenant.id}>
                  <Check class="size-3.5 shrink-0 text-foreground" />
                </Show>
              </DropdownMenuItem>
            )}
          </For>
        </Show>
        <div class="mx-1 my-1 h-px bg-white/[0.07]" />
        <DropdownMenuItem
          onSelect={() => navigate("/tenants/new")}
          class="flex h-8 cursor-pointer items-center gap-2.5 rounded-[5px] px-2 text-[12.5px] text-muted-foreground outline-none focus:bg-white/[0.07] focus:text-foreground"
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
      aria-label="Search"
      class={cn(
        "group flex h-7 items-center gap-2 rounded-md text-muted-foreground outline-none transition-[color,background-color,scale] duration-150 ease-swift hover:bg-white/[0.07] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 motion-safe:active:scale-[0.985]",
        props.compact ? "w-7 justify-center px-0 sm:w-auto sm:justify-start sm:px-2" : "px-2",
      )}
    >
      <SearchIcon class="size-3.5" />
      <kbd class="hidden rounded border border-white/[0.08] bg-white/[0.03] px-1 py-px font-sans text-[9.5px] text-muted-foreground/80 sm:inline">
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
        class="flex size-6 items-center justify-center overflow-hidden rounded-full bg-white/[0.08] text-[9.5px] font-semibold text-foreground outline-none ring-1 ring-inset ring-white/[0.1] transition-[box-shadow,scale] duration-150 ease-swift hover:ring-white/20 focus-visible:ring-2 focus-visible:ring-ring/60 motion-safe:active:scale-[0.985]"
        aria-label="Account menu"
      >
        <Show when={user()?.image} fallback={<span>{initials(user()?.name)}</span>}>
          {(image) => <img src={image()} alt={user()?.name ?? ""} class="size-full object-cover" />}
        </Show>
      </DropdownMenuTrigger>
      <DropdownMenuContent class="w-[248px] rounded-lg border border-white/[0.09] bg-[#232326] p-0.5 text-popover-foreground shadow-[0_8px_24px_rgba(0,0,0,.45),0_2px_6px_rgba(0,0,0,.3),inset_0_0_0_1px_rgba(255,255,255,.02)]">
        <div class="flex items-center gap-2.5 px-2 py-2">
          <span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-[9.5px] font-semibold ring-1 ring-inset ring-white/[0.08]">
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
          class="flex h-8 cursor-pointer items-center gap-2.5 rounded-[5px] px-2 text-[12.5px] outline-none focus:bg-white/[0.07]"
        >
          <User class="size-3.5 text-muted-foreground" />
          Account settings
        </DropdownMenuItem>
        <DropdownMenuItem
          as="a"
          role="menuitem"
          href="/docs/"
          target="_self"
          class="flex h-8 cursor-pointer items-center gap-2.5 rounded-[5px] px-2 text-[12.5px] outline-none focus:bg-white/[0.07]"
        >
          <BookOpen class="size-3.5 text-muted-foreground" />
          Documentation
        </DropdownMenuItem>
        <DropdownMenuItem
          as="a"
          role="menuitem"
          href="mailto:hello@mattrax.app?subject=Mattrax%20support"
          class="flex h-8 cursor-pointer items-center gap-2.5 rounded-[5px] px-2 text-[12.5px] outline-none focus:bg-white/[0.07]"
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
          class="flex h-8 cursor-pointer items-center gap-2.5 rounded-[5px] px-2 text-[12.5px] outline-none focus:bg-white/[0.07]"
        >
          <Activity class="size-3.5 text-muted-foreground" />
          System status
        </DropdownMenuItem>
        <DropdownMenuSeparator class="my-1 h-px bg-border" />
        <DropdownMenuItem
          onSelect={() => props.onSignOut()}
          class="flex h-8 cursor-pointer items-center gap-2.5 rounded-[5px] px-2 text-[12.5px] text-muted-foreground outline-none focus:bg-white/[0.07] focus:text-foreground"
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
      <div class="relative border-b border-white/[0.07] bg-white/[0.02]">
        <div class="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-2.5 gap-y-1 px-4 py-1.5 text-[11.5px] text-muted-foreground sm:px-5 lg:px-6">
          <span class="size-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true" />
          <span class="font-[500] text-foreground">Verify your email</span>
          <span class="hidden text-muted-foreground sm:inline">
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
              class="font-medium text-warning-foreground underline decoration-warning-foreground/30 underline-offset-2 transition-colors hover:decoration-warning-foreground disabled:opacity-60"
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
            class="ml-auto rounded p-1 text-muted-foreground/60 transition-colors hover:bg-white/[0.05] hover:text-muted-foreground"
          >
            <X class="size-3" />
          </button>
        </div>
      </div>
    </Show>
  );
}

function navFor(tenantId: string | undefined): NavItem[] {
  if (!tenantId) return [];
  const base = `/t/${tenantId}`;
  return [
    { id: "overview", label: "Overview", href: base, match: (value) => value === base },
    {
      id: "devices",
      label: "Devices",
      href: `${base}/devices`,
      match: (value) => value.startsWith(`${base}/devices`),
    },
    {
      id: "groups",
      label: "Groups",
      href: `${base}/groups`,
      match: (value) => value.startsWith(`${base}/groups`),
    },
    {
      id: "policies",
      label: "Policies",
      href: `${base}/policies`,
      match: (value) => value.startsWith(`${base}/policies`),
    },
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
      match: (value) =>
        value.startsWith(`${base}/settings`) && !value.startsWith(`${base}/settings/enrollment`),
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
  const isRouting = useIsRouting();
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
  const pageLabel = createMemo(() => {
    const path = location.pathname;
    if (path === "/account") return "Account";
    if (path === "/tenants/new") return "Create tenant";
    if (path === "/dashboard") return "Tenant";
    if (path.startsWith("/docs")) return "Documentation";
    return navItems().find((item) => item.match(path))?.label ?? "Tenant";
  });

  createEffect(
    () => pageLabel(),
    (label) => {
      if (typeof document !== "undefined") document.title = `${label} · Mattrax`;
    },
  );

  let navRef: HTMLElement | undefined;
  createEffect(
    () => location.pathname,
    () => {
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
    <div class="dark flex min-h-svh flex-col bg-background text-foreground selection:bg-brand/30 selection:text-foreground">
      <a
        href="#main"
        class="sr-only z-[100] rounded-lg bg-primary px-3 py-2 text-[13px] font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>
      <header class="sticky top-0 z-40 border-b border-white/[0.07] bg-background">
        <div class="mx-auto flex h-12 max-w-[1600px] items-center gap-2 px-3 sm:px-5 lg:px-6">
          <a
            href="/dashboard"
            class="flex shrink-0 items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            aria-label="Mattrax home"
          >
            <img
              src="/assets/brand/mattrax-white.png"
              alt="Mattrax"
              class="h-3.5 w-auto"
              width="922"
              height="142"
            />
          </a>

          <span class="mx-1 hidden h-3.5 w-px bg-white/[0.09] sm:block" aria-hidden="true" />
          <TenantSwitcher activeId={activeId()} />

          <div class="ml-auto flex items-center gap-1">
            <SearchButton />
            <UserMenu user={props.user} onSignOut={props.onSignOut} />
          </div>
        </div>

        <div class="mx-auto flex max-w-[1600px] items-center gap-3 px-3 sm:px-5 lg:px-6">
          <div class="relative min-w-0 flex-1">
            <nav
              ref={navRef}
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
                        "relative flex h-11 shrink-0 items-center px-3 text-[13px] font-[450] transition-colors duration-150 outline-none after:absolute after:inset-x-3 after:bottom-0 after:h-[2px] after:rounded-full after:bg-transparent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60",
                        active()
                          ? "text-foreground after:bg-foreground"
                          : "text-muted-foreground hover:text-foreground",
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

      <Show when={!location.pathname.endsWith("/design")}>
        <EmailVerificationBanner user={props.user} />
      </Show>

      <main
        id="main"
        tabindex="-1"
        class={cn(
          "relative z-10 mx-auto flex w-full max-w-[1600px] flex-1 scroll-mt-24 flex-col transition-opacity duration-[140ms] ease-swift focus:outline-none",
          isRouting() && "opacity-70",
        )}
      >
        <Errored
          fallback={(error, reset) => {
            const value = typeof error === "function" ? (error as () => unknown)() : error;
            console.error("Mattrax page render error", value);
            return (
              <div class="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-16">
                <div class="rounded-xl border border-destructive/25 bg-destructive/[0.06] p-5">
                  <h2 class="text-[14px] font-semibold text-foreground">This page couldn't load</h2>
                  <p class="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                    {value instanceof Error ? value.message : "An unexpected error occurred."}
                  </p>
                  <div class="mt-4 flex gap-2">
                    <button
                      type="button"
                      class="rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-medium text-primary-foreground"
                      onClick={() => reset()}
                    >
                      Try again
                    </button>
                    <button
                      type="button"
                      class="rounded-lg border border-white/[0.09] px-3 py-1.5 text-[12.5px] font-medium text-foreground hover:bg-white/[0.05]"
                      onClick={() => window.location.reload()}
                    >
                      Reload
                    </button>
                  </div>
                </div>
              </div>
            );
          }}
        >
          {props.children}
        </Errored>
        <div aria-live="polite" class="sr-only">
          {pageLabel()}
        </div>
      </main>
    </div>
  );
}
