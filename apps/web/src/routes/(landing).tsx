import { useLocation } from "@solidjs/router";
import { type ParentProps, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import { UserDropdown } from "~/components/user-dropdown";
import { authClient } from "~/lib/auth";

export default function Layout(props: ParentProps) {
  const location = useLocation();
  return (
    <div
      class={`dark flex min-h-screen flex-col bg-background font-sans text-foreground ${
        location.pathname === "/designer" ? "h-svh min-h-0 overflow-hidden" : ""
      }`}
    >
      <TopNavigation />
      {props.children}
      {/* The designer is a full-height tenant; a footer would create a
          second page-level scrollbar around it. */}
      <Show when={location.pathname !== "/designer"}>
        <Footer />
      </Show>
    </div>
  );
}

function NavigationLink(props: { href: string; label: string; target?: string; active: boolean }) {
  return (
    <a
      href={props.href}
      class={`transition-colors ${props.active ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
      target={props.target}
    >
      {props.label}
    </a>
  );
}

function FooterLink(props: { href: string; label: string; target?: string }) {
  return (
    <a href={props.href} class="transition-colors hover:text-foreground" target={props.target}>
      {props.label}
    </a>
  );
}

const navigation = [
  { href: "/#platforms", label: "Platforms" },
  { href: "/#product", label: "Product" },
  { href: "/#migration", label: "Migration" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/docs/", label: "Docs", target: "_self" },
];

function TopNavigation() {
  const session = authClient.useSession();
  const location = useLocation();

  const isActive = (href: string) =>
    href.startsWith("/") && !href.startsWith("/#") && location.pathname === href;

  const handleLogout = async () => {
    await authClient.signOut();
    window.location.href = "/";
  };

  return (
    <header class="sticky top-0 z-50 border-b border-white/[0.07] bg-background">
      <div class="mx-auto flex h-12 max-w-[1600px] items-center justify-between px-4 sm:px-6 lg:px-8">
        <a href="/" class="flex shrink-0 items-center gap-2.5" aria-label="Mattrax home">
          <img
            src="/assets/brand/mattrax-white.png"
            alt="Mattrax"
            class="h-4 w-auto"
            width="922"
            height="142"
          />
        </a>

        <nav class="hidden items-center gap-6 text-[12.5px] md:flex">
          {navigation.map((item) => (
            <NavigationLink
              href={item.href}
              label={item.label}
              target={item.target}
              active={isActive(item.href)}
            />
          ))}
        </nav>

        <div class="flex shrink-0 items-center gap-2.5">
          <Show when={!session().isPending && session().data?.user}>
            <Button
              as="a"
              href="/dashboard"
              variant="outline"
              size="sm"
              class="hidden h-8 rounded-md border-white/[0.12] text-muted-foreground hover:bg-white/[0.04] hover:text-foreground sm:inline-flex"
            >
              Dashboard
            </Button>
          </Show>
          <UserDropdown
            user={session().data?.user}
            pending={session().isPending}
            signInHref="/login"
            showDashboardLink
            onSignOut={handleLogout}
          />

          <details class="relative md:hidden">
            <summary class="flex size-8 cursor-pointer list-none items-center justify-center rounded-md border border-white/[0.12] text-muted-foreground [&::-webkit-details-marker]:hidden">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                aria-hidden="true"
              >
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </summary>
            <div class="absolute right-0 top-10 w-56 overflow-hidden rounded-lg border border-white/[0.09] bg-[#232326] p-1 shadow-xl shadow-black/40">
              {navigation.map((item) => (
                <a
                  href={item.href}
                  target={item.target}
                  class="block rounded-md px-3 py-2 text-[13px] text-muted-foreground hover:bg-white/[0.05] hover:text-foreground"
                >
                  {item.label}
                </a>
              ))}
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer class="border-t border-white/[0.07] bg-background">
      <div class="mx-auto max-w-[1600px] px-4 py-12 sm:px-6 lg:px-8">
        <div class="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <a href="/" class="flex items-center gap-2.5" aria-label="Mattrax home">
              <img
                src="/assets/brand/mattrax-white.png"
                alt="Mattrax"
                class="h-4 w-auto"
                width="922"
                height="142"
              />
            </a>
            <p class="mt-4 max-w-xs text-[12px] leading-5 text-muted-foreground">
              Device management infrastructure for Apple, Windows and Android fleets.
            </p>
            <p class="mt-5 flex items-center gap-2 text-[11px] text-muted-foreground/80">
              <span class="size-1.5 rounded-full bg-success" />
              All systems operational
            </p>
          </div>

          <FooterColumn
            title="Product"
            links={[
              { href: "/#platforms", label: "Platforms" },
              { href: "/#product", label: "Features" },
              { href: "/#pricing", label: "Pricing" },
              { href: "/designer", label: "Policy designer" },
            ]}
          />
          <FooterColumn
            title="Developers"
            links={[
              { href: "/docs/", label: "Documentation", target: "_self" },
              { href: "/docs/api/", label: "REST API", target: "_self" },
              { href: "/docs/migration/", label: "Migration", target: "_self" },
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

        <div class="mt-12 flex flex-col gap-3 border-t border-white/[0.07] pt-6 text-[11px] text-muted-foreground/80 sm:flex-row sm:items-center sm:justify-between">
          <span>© 2020 Mattrax Technologies Inc.</span>
          <span>Built with Effect, Cloudflare and SolidJS.</span>
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
      <p class="text-[11px] font-medium text-muted-foreground/80">{props.title}</p>
      <ul class="mt-4 space-y-2.5 text-[12px] text-muted-foreground">
        {props.links.map((link) => (
          <li>
            <FooterLink href={link.href} label={link.label} target={link.target} />
          </li>
        ))}
      </ul>
    </div>
  );
}
