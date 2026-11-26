import { useLocation } from "@solidjs/router";
import { createEffect, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import { RefreshCw } from "~/components/ui/icons";
import {
  dismissDeploymentNotice,
  markDeploymentNoticeShown,
  pendingDeployment,
  reloadForDeployment,
} from "~/lib/skew-protection";

/**
 * Routes that render the dashboard shell. The shell carries its own compact
 * update affordance above the account menu, so a second floating notice would
 * duplicate it.
 */
const APP_SHELL_PREFIXES = [
  "/dashboard",
  "/account",
  "/t/",
  "/tenants",
  "/settings",
  "/admin",
] as const;

const matchesPrefix = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`);

export const usesAppShell = (pathname: string): boolean =>
  APP_SHELL_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix));

/**
 * A new deployment is serving this origin while the tab still runs the old
 * bundle. The notice is deliberate rather than automatic: reloading can discard
 * an in-progress form, and a tab that keeps working does not need interrupting.
 *
 * Outside the dashboard this is a bottom-right toast. Inside the dashboard the
 * sidebar shows the update above the account menu instead.
 */
export function NewVersionNotice() {
  const location = useLocation();
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

  const showToast = () => pendingDeployment() !== null && !usesAppShell(location.pathname);

  return (
    <div class="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-end p-4 sm:p-6">
      {/* Keep the live region permanently mounted and empty until there is an
          update; inserting the region and its text together is unreliable in
          several screen readers. */}
      <div role="status" aria-live="polite" class="pointer-events-none w-full max-w-sm">
        <Show when={showToast()}>
          <div class="pointer-events-auto flex items-start gap-3 rounded-xl border border-border bg-card p-3.5 text-foreground shadow-popover">
            <span
              aria-hidden="true"
              class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground"
            >
              <RefreshCw class="size-3.5" />
            </span>
            <div class="min-w-0 flex-1">
              <p class="text-xs font-medium">A new version is available</p>
              <p class="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                Reload to get the latest changes. This page keeps working until you do.
              </p>
              <div class="mt-2.5 flex items-center gap-1.5">
                <Button size="sm" onClick={reloadForDeployment}>
                  Reload
                </Button>
                <Button size="sm" variant="ghost" onClick={dismissDeploymentNotice}>
                  Later
                </Button>
              </div>
            </div>
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
