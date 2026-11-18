import { useQuery } from "@tanstack/solid-query";
import { DEVICE_MISSING_AFTER_DAYS } from "@mattrax/enterprise-domain/client";
import { isServer } from "@solidjs/web";
import { createSignal, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import { CircleAlert, X } from "~/components/ui/icons";
import { missingDeviceCount } from "~/lib/device-health";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";
import { useCan } from "~/lib/permissions";
import { routes } from "~/lib/routes";

const dismissKey = (tenantId: string) => `mattrax:mia-banner-dismissed:${tenantId}`;

const readSessionDismissal = (tenantId: string): boolean => {
  try {
    return window.sessionStorage.getItem(dismissKey(tenantId)) === "1";
  } catch {
    // Storage can be disabled; the banner simply stays visible.
    return false;
  }
};

/**
 * Proactive warning for enrolled devices that have stopped checking in.
 *
 * The API returns the MIA count on the fleet health summary, so this is one
 * bounded request on the overview. Dismissal lasts for the browser session:
 * the banner is a nudge, not a modal, and a tenant with a permanently lost
 * device must not be warned again on every navigation.
 */
export function MissingDevicesBanner(props: { tenantId: string }) {
  const { can } = useCan();
  const [dismissed, setDismissed] = createSignal(!isServer && readSessionDismissal(props.tenantId));

  const summary = useQuery(() => ({
    queryKey: enterpriseKeys.deviceHealthSummary(props.tenantId),
    queryFn: () => enterprise.getDeviceHealthSummary(props.tenantId),
    enabled: can("devices.read"),
  }));

  const count = () => missingDeviceCount(summary.data?.counts);

  const dismiss = () => {
    setDismissed(true);

    try {
      window.sessionStorage.setItem(dismissKey(props.tenantId), "1");
    } catch {
      // Same storage policy as the read above.
    }
  };

  const title = () =>
    count() === 1
      ? "1 device is MIA (missing in action)"
      : `${count()} devices are MIA (missing in action)`;

  return (
    <Show when={can("devices.read") && !dismissed() && count() > 0}>
      <div
        role="status"
        aria-live="polite"
        class="flex items-start gap-2.5 rounded-xl border border-warning/25 bg-warning/[0.06] px-3.5 py-3 text-[12.5px] leading-relaxed text-warning-foreground"
      >
        <CircleAlert class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div class="min-w-0 flex-1">
          <p class="font-medium">{title()}</p>
          <p class="mt-0.5 text-muted-foreground">
            {count() === 1 ? "It has" : "They have"} not checked in for more than{" "}
            {DEVICE_MISSING_AFTER_DAYS} days but {count() === 1 ? "is" : "are"} still enrolled.
            Review {count() === 1 ? "it" : "them"} before the 30-day automatic unenrol.
          </p>
          <Button
            as="a"
            href={routes.tenant(props.tenantId).devices({ health: "missing" })}
            size="xs"
            variant="outline"
            class="mt-2"
          >
            Review MIA devices
          </Button>
        </div>
        <button
          type="button"
          aria-label="Dismiss MIA device warning"
          class="rounded p-1 text-muted-foreground hover:bg-hover hover:text-foreground"
          onClick={dismiss}
        >
          <X class="size-3.5" />
        </button>
      </div>
    </Show>
  );
}
