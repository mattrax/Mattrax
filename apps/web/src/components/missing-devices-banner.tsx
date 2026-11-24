import { useQuery } from "@tanstack/solid-query";
import { DEVICE_MISSING_AFTER_DAYS } from "@mattrax/enterprise-domain/client";
import { isServer } from "@solidjs/web";
import { createSignal, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import { CircleAlert, X } from "~/components/ui/icons";
import { missingDeviceCount } from "~/lib/device-health";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";
import {
  readMiaBannerDismissed,
  shouldShowMiaBanner,
  writeMiaBannerDismissed,
} from "~/lib/mia-banner";
import type { MiaBannerStorage } from "~/lib/mia-banner";
import { useCan } from "~/lib/permissions";
import { routes } from "~/lib/routes";

const browserSessionStorage = (): MiaBannerStorage | undefined => {
  if (isServer) return undefined;

  try {
    return window.sessionStorage;
  } catch {
    return undefined;
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
/** Read secondary query data only after success so pending async values never throw or suspend during render. */
function settledQueryData<T>(query: {
  readonly isSuccess: boolean;
  readonly data: T | undefined;
}): T | undefined {
  return query.isSuccess ? query.data : undefined;
}

export function MissingDevicesBanner(props: { tenantId: string }) {
  const { can } = useCan();
  // Dismissal is per tenant. The component survives a tenant switch, so the
  // stored flag must be re-read for the current tenant rather than captured
  // once at mount.
  const [dismissedTenant, setDismissedTenant] = createSignal<string | null>(null);

  const dismissed = () =>
    dismissedTenant() === props.tenantId ||
    readMiaBannerDismissed(browserSessionStorage(), props.tenantId);

  const summary = useQuery(() => ({
    queryKey: enterpriseKeys.deviceHealthSummary(props.tenantId),
    queryFn: () => enterprise.getDeviceHealthSummary(props.tenantId),
    enabled: can("devices.read"),
  }));

  const count = () => missingDeviceCount(settledQueryData(summary)?.counts);

  const visible = () =>
    shouldShowMiaBanner({
      count: count(),
      canRead: can("devices.read"),
      dismissed: dismissed(),
    });

  const dismiss = () => {
    setDismissedTenant(props.tenantId);
    writeMiaBannerDismissed(browserSessionStorage(), props.tenantId);
  };

  const title = () =>
    count() === 1
      ? "1 device is MIA (missing in action)"
      : `${count()} devices are MIA (missing in action)`;

  return (
    <Show when={visible()}>
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
            Review {count() === 1 ? "it" : "them"} before the configured auto-unenrol (30 days by
            default).
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
