import { createEffect, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import { RefreshCw, X } from "~/components/ui/icons";
import {
  dismissDeploymentNotice,
  markDeploymentNoticeShown,
  pendingDeployment,
  reloadForDeployment,
} from "~/lib/skew-protection";

/**
 * A new deployment is serving this origin while the tab still runs the old
 * bundle. The notice is deliberate rather than automatic: reloading can discard
 * an in-progress form, and a tab that keeps working does not need interrupting.
 */
export function NewVersionNotice() {
  let announced: string | null = null;

  // Persist only after the notice has rendered. Polling dedupes while it is
  // pending with its own in-memory guard, so this is the first durable write.
  createEffect(
    () => pendingDeployment(),
    (build) => {
      if (!build || build === announced) return;

      announced = build;
      markDeploymentNoticeShown(build);
    },
  );

  return (
    <div class="pointer-events-none fixed inset-x-0 top-24 z-[65] flex flex-col items-center gap-2 px-4">
      {/* Keep the live region permanently mounted and empty until there is an
          update; inserting the region and its text together is unreliable in
          several screen readers. */}
      <div role="status" aria-live="polite" class="pointer-events-none w-full max-w-md">
        <Show when={pendingDeployment()}>
          <div class="pointer-events-auto flex items-start gap-3 rounded-xl border border-border bg-card p-3.5 text-foreground shadow-[var(--shadow-popover)]">
            <span
              aria-hidden="true"
              class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground"
            >
              <RefreshCw class="size-3.5" />
            </span>
            <div class="min-w-0 flex-1">
              <p class="text-[12.5px] font-medium">A new version is available</p>
              <p class="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                Reload to get the latest changes. This page keeps working until you do.
              </p>
              <div class="mt-2.5 flex items-center gap-2">
                <Button size="sm" onClick={reloadForDeployment}>
                  Reload
                </Button>
                <Button size="sm" variant="ghost" onClick={dismissDeploymentNotice}>
                  Not now
                </Button>
              </div>
            </div>
            <button
              type="button"
              aria-label="Dismiss update notice"
              class="rounded p-1 text-muted-foreground hover:bg-hover hover:text-foreground"
              onClick={dismissDeploymentNotice}
            >
              <X class="size-3.5" />
            </button>
          </div>
        </Show>
      </div>
      {/* Outside the live region: assistive technology should announce the
          update, not an opaque build id. */}
      <Show when={pendingDeployment()}>
        {(build) => <span class="sr-only">Build {build()}</span>}
      </Show>
    </div>
  );
}
