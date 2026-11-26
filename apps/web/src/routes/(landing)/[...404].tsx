import { Button } from "~/components/ui/button";

export default function Page() {
  return (
    <main class="flex-1 flex items-center justify-center px-8 py-24">
      <div class="text-center max-w-sm">
        <p class="text-xs text-muted-foreground uppercase tracking-widest mb-7">404</p>
        <h1 class="text-5xl font-light tracking-tight text-foreground leading-tight mb-5">
          Page not found.
        </h1>
        <p class="text-subtle-foreground text-sm leading-relaxed mb-10">
          This page doesn't exist or was moved. Head back home and we'll get you sorted.
        </p>
        <div class="flex flex-wrap justify-center gap-3">
          <Button
            as="a"
            href="/"
            size="lg"
            class="h-11"
          >
            Go home
          </Button>
          <Button
            as="a"
            href="/dashboard"
            variant="outline"
            size="lg"
            class="h-11"
          >
            Dashboard →
          </Button>
        </div>
      </div>
    </main>
  );
}
