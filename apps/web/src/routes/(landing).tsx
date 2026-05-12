import { useLocation } from "@solidjs/router";
import { type ParentProps, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import { UserDropdown } from "~/components/user-dropdown";
import { authClient } from "~/lib/auth";

export default function Layout(props: ParentProps) {
  return (
    <div class="min-h-screen bg-stone-50 text-stone-900 font-sans flex flex-col">
      <TopNavigation />
      {props.children}
      <Footer />
    </div>
  );
}

function NavigationLink(props: { href: string; label: string; active: boolean }) {
  return (
    <a
      href={props.href}
      class={`transition-colors ${props.active ? "text-stone-900 font-medium" : "text-stone-500 hover:text-stone-900"}`}
    >
      {props.label}
    </a>
  );
}

function FooterLink(props: { href: string; label: string }) {
  return (
    <a href={props.href} class="hover:text-stone-900 transition-colors">
      {props.label}
    </a>
  );
}

function TopNavigation() {
  const session = authClient.useSession();
  const location = useLocation();

  const isActive = (href: string) =>
    href.startsWith("/") && !href.startsWith("/#") && location.pathname === href;

  const handleLogout = async () => {
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          window.location.href = "/";
        },
      },
    });
  };

  return (
    <header class="sticky top-0 z-50 bg-stone-50/95 backdrop-blur-sm border-b border-stone-200">
      <div class="mx-auto max-w-7xl px-8 flex h-16 items-center justify-between">
        <a href="/" class="flex items-center gap-2 shrink-0">
          <span class="font-semibold tracking-tight">Mattrax</span>
        </a>

        <nav class="hidden md:flex items-center gap-8 text-sm">
          <NavigationLink href="/#product" label="Product" active={isActive("/#product")} />
          <NavigationLink
            href="/#enterprise"
            label="Enterprise"
            active={isActive("/#enterprise")}
          />
          <NavigationLink href="/#pricing" label="Pricing" active={isActive("/#pricing")} />
        </nav>

        <div class="flex items-center gap-3 shrink-0">
          <Show when={!session().isPending && session().data?.user}>
            <Button
              as="a"
              href="/dashboard"
              variant="outline"
              size="sm"
              class="rounded-full border-stone-300 text-stone-600 hover:bg-stone-100 animate-in fade-in duration-300"
            >
              Dashboard →
            </Button>
          </Show>
          <UserDropdown
            user={session().data?.user}
            pending={session().isPending}
            signInHref="/login"
            showDashboardLink
            onSignOut={handleLogout}
          />
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer class="border-t border-stone-200 py-8 px-8">
      <div class="mx-auto max-w-7xl flex flex-col md:flex-row items-center justify-between gap-6 text-sm text-stone-400">
        <div class="flex items-center gap-2">
          <span>© 2020 Mattrax Technologies Inc.</span>
        </div>
        <div class="flex flex-wrap justify-center gap-6">
          <FooterLink href="/privacy" label="Privacy" />
          <FooterLink href="/terms" label="Terms" />
          <FooterLink href="mailto:hello@mattrax.io" label="Support" />
        </div>
      </div>
    </footer>
  );
}
