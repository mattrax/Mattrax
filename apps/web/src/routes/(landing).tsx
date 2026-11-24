import { useLocation } from "@solidjs/router";
import { raisedFailure } from "~/lib/errors";
import { Errored, Show } from "solid-js";
import type { ParentProps } from "solid-js";
import { Button } from "~/components/ui/button";
import { BrandLogo } from "~/components/brand-logo";
import { PageErrorFallback } from "~/components/error-boundary";
import { UserDropdown } from "~/components/user-dropdown";
import { authClient } from "~/lib/auth";
import { reportGlobalError } from "~/lib/global-errors";

export default function Layout(props: ParentProps) {
  const location = useLocation();

  return (
    <div
      class={`lx-layout flex min-h-screen flex-col bg-background font-sans text-foreground ${
        location.pathname === "/designer" ? "h-svh min-h-0 overflow-hidden" : ""
      }`}
    >
      {/* Keyboard users land here first; the landing header repeats five links
          before the content starts. Other (landing) routes need their own
          `#main-content` target before this can apply to them. */}
      <Show when={location.pathname === "/"}>
        <SkipLink />
      </Show>
      <TopNavigation />
      <Errored
        fallback={(error, reset) => (
          <PageErrorFallback boundary="landing" error={error()} reset={reset} />
        )}
      >
        {props.children}
      </Errored>
      {/* The designer is a full-height tenant; a footer would create a
          second page-level scrollbar around it. */}
      <Show when={location.pathname !== "/designer"}>
        <Footer />
      </Show>
    </div>
  );
}

function SkipLink() {
  // Fragment navigation scrolls but does not move keyboard focus through the
  // client router, so focus the target explicitly.
  const focusMain = (event: MouseEvent) => {
    const target = document.getElementById("main-content");

    if (!target) return;

    event.preventDefault();
    target.focus({ preventScroll: true });
    target.scrollIntoView();
    history.replaceState(null, "", "#main-content");
  };

  return (
    <a
      href="#main-content"
      onClick={focusMain}
      class="sr-only z-[100] rounded-md bg-primary px-3 py-2 text-[12.5px] font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
    >
      Skip to content
    </a>
  );
}

function NavigationLink(props: { href: string; label: string; target?: string; active: boolean }) {
  return (
    <a
      href={props.href}
      class={`rounded-sm transition-colors duration-[var(--duration-hover)] ease-swift focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${props.active ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
      target={props.target}
    >
      {props.label}
    </a>
  );
}

function FooterLink(props: { href: string; label: string; target?: string }) {
  return (
    <a
      href={props.href}
      class="touch-target rounded-sm transition-colors duration-[var(--duration-hover)] ease-swift hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background max-sm:inline-flex max-sm:min-h-11 max-sm:items-center"
      target={props.target}
    >
      {props.label}
    </a>
  );
}

const navigation = [
  { href: "/#platforms", label: "Platforms" },
  { href: "/#product", label: "Product" },
  { href: "/#security", label: "Security" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/docs/", label: "Docs", target: "_self" },
];

function TopNavigation() {
  const session = authClient.useSession();
  const location = useLocation();

  const isActive = (href: string) =>
    href.startsWith("/") && !href.startsWith("/#") && location.pathname === href;

  const handleLogout = async () => {
    try {
      const result = await authClient.signOut();

      if (result.error) {
        reportGlobalError(result.error);

        return;
      }
    } catch (error) {
      reportGlobalError(raisedFailure(error));

      return;
    }

    window.location.href = "/";
  };

  return (
    <header class="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-md supports-[backdrop-filter]:bg-background/90">
      <div class="mx-auto flex h-14 w-full max-w-[var(--lx-max)] items-center justify-between gap-6 px-[var(--lx-gutter)]">
        <div class="flex min-w-0 items-center gap-9">
          <a
            href="/"
            class="touch-target flex min-h-11 shrink-0 items-center gap-2.5 rounded-sm focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            aria-label="Mattrax home"
          >
            <BrandLogo class="h-3.5" />
          </a>

          <nav aria-label="Primary" class="hidden items-center gap-6 text-[12.5px] md:flex">
            {navigation.map((item) => (
              <NavigationLink
                href={item.href}
                label={item.label}
                target={item.target}
                active={isActive(item.href)}
              />
            ))}
          </nav>
        </div>

        <div class="flex shrink-0 items-center gap-2">
          <Show when={!session().isPending && session().data?.user}>
            <Button
              as="a"
              href="/dashboard"
              variant="default"
              size="sm"
              class="hidden h-7 px-2.5 text-[12px] sm:inline-flex"
            >
              Open dashboard
            </Button>
          </Show>
          <UserDropdown
            user={session().data?.user}
            pending={session().isPending}
            signInHref="/login"
            showDashboardLink
            onSignOut={handleLogout}
          />

          {/* Native popover: light-dismiss (outside click) and Escape come from
              the platform, with no JS listener to keep in sync. */}
          <button
            type="button"
            popovertarget="landing-site-menu"
            aria-label="Open navigation menu"
            class="touch-target flex size-7 cursor-pointer items-center justify-center rounded-md border border-border text-muted-foreground transition-colors duration-[var(--duration-hover)] ease-swift hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 md:hidden"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div
            id="landing-site-menu"
            popover="auto"
            class="fixed inset-auto top-[3.75rem] right-4 m-0 w-56 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-popover motion-safe:animate-[mt-rise-in_140ms_var(--ease-swift)_both] md:hidden"
          >
            <nav aria-label="Site">
              {navigation.map((item) => (
                <a
                  href={item.href}
                  target={item.target}
                  class="flex min-h-11 items-center rounded-md px-3 text-[13px] text-muted-foreground transition-colors duration-[var(--duration-hover)] ease-swift hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
                >
                  {item.label}
                </a>
              ))}
            </nav>
            <div class="mt-1 border-t border-border p-1">
              <a
                href={session().data?.user ? "/dashboard" : "/register"}
                class="flex min-h-11 items-center justify-center rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-colors duration-[var(--duration-hover)] ease-swift hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-popover"
              >
                {session().data?.user ? "Open dashboard" : "Create an account"}
              </a>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer class="border-t border-border bg-background">
      <div class="mx-auto w-full max-w-[var(--lx-max)] px-[var(--lx-gutter)] py-14">
        <div class="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div>
            <a
              href="/"
              class="touch-target flex min-h-11 items-center gap-2.5 rounded-sm focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              aria-label="Mattrax home"
            >
              <BrandLogo class="h-3.5" />
            </a>
            <p class="mt-4 max-w-[15rem] text-[12px] leading-5 text-muted-foreground">
              Device management infrastructure for Apple, Windows and Android fleets.
            </p>
          </div>

          <FooterColumn
            title="Product"
            links={[
              { href: "/#platforms", label: "Platforms" },
              { href: "/#product", label: "Product" },
              { href: "/#security", label: "Security" },
              { href: "/#pricing", label: "Pricing" },
              { href: "/designer", label: "Policy designer" },
            ]}
          />
          <FooterColumn
            title="Developers"
            links={[
              { href: "/docs/", label: "Documentation", target: "_self" },
              { href: "/docs/api/", label: "REST API", target: "_self" },
            ]}
          />
          <FooterColumn
            title="Company"
            links={[
              { href: "/privacy", label: "Privacy" },
              { href: "/terms", label: "Terms" },
              { href: "mailto:hello@mattrax.app", label: "Support" },
              {
                href: "https://github.com/oscartbeaumont/mattraxe",
                label: "GitHub",
                target: "_blank",
              },
            ]}
          />
        </div>

        <div class="mt-12 flex flex-col gap-3 border-t border-border pt-5 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Mattrax Technologies Inc.</p>
          <p>AGPL-3.0 source · free during alpha</p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn(props: {
  title: string;
  links: Array<{ href: string; label: string; target?: string }>;
}) {
  return (
    <div>
      <p class="label-caps">{props.title}</p>
      <ul class="mt-3.5 space-y-2 text-[12.5px] text-muted-foreground">
        {props.links.map((link) => (
          <li>
            <FooterLink href={link.href} label={link.label} target={link.target} />
          </li>
        ))}
      </ul>
    </div>
  );
}
