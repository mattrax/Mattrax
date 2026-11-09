import { Button } from "~/components/ui/button";

export default function Page() {
  return (
    <main class="flex-1 flex items-center justify-center px-8 py-24">
      <div class="text-center max-w-sm">
        <p class="text-xs text-stone-400 uppercase tracking-[0.2em] mb-7">404</p>
        <h1 class="text-5xl font-light tracking-tight text-stone-900 leading-tight mb-5">
          Page not found.
        </h1>
        <p class="text-stone-500 text-sm leading-relaxed mb-10">
          This page doesn't exist or was moved. Head back home and we'll get you sorted.
        </p>
        <div class="flex flex-wrap justify-center gap-3">
          <a href="/">
            <Button
              size="lg"
              class="bg-stone-900 hover:bg-stone-800 text-stone-50 rounded-full px-8 h-11"
            >
              Go home
            </Button>
          </a>
          <a href="/dashboard">
            <Button
              variant="outline"
              size="lg"
              class="border-stone-300 text-stone-600 hover:bg-stone-100 rounded-full px-8 h-11"
            >
              Dashboard →
            </Button>
          </a>
        </div>
      </div>
    </main>
  );
}
