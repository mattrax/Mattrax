import { Show } from "solid-js";
import { errorPresentation } from "~/lib/errors";
import { dismissGlobalError, globalError } from "~/lib/global-errors";
import { CircleAlert, X } from "~/components/ui/icons";

/**
 * Last-resort display for mutation failures. Individual forms still render
 * inline errors; this ensures a missed `.error` never fails silently.
 */
export function GlobalErrorBanner() {
  return (
    <Show when={globalError()}>
      {(notice) => {
        const presentation = () => errorPresentation(notice().error);

        return (
          <div class="pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex justify-center px-4">
            <div
              role="alert"
              aria-live="assertive"
              class="pointer-events-auto flex w-full max-w-lg items-start gap-2.5 rounded-xl border border-destructive/30 bg-card p-3.5 text-foreground shadow-[var(--shadow-popover)]"
            >
              <CircleAlert class="mt-0.5 size-4 shrink-0 text-destructive" />
              <div class="min-w-0 flex-1">
                <p class="text-[12.5px] font-medium">{presentation().title}</p>
                <p class="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                  {presentation().message}
                </p>
              </div>
              <button
                type="button"
                aria-label="Dismiss error"
                class="rounded p-1 text-muted-foreground hover:bg-hover hover:text-foreground"
                onClick={dismissGlobalError}
              >
                <X class="size-3.5" />
              </button>
            </div>
          </div>
        );
      }}
    </Show>
  );
}
