import { useQuery } from "@tanstack/solid-query";
import { isServer } from "@solidjs/web";
import { createSignal, Show } from "solid-js";
import { Button } from "@mattrax/ui";
import { ArrowRightLeft, X } from "~/components/ui/icons";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";
import {
  readMigrationBannerDismissed,
  shouldShowMigrationBanner,
  writeMigrationBannerDismissed,
} from "~/lib/migration-banner";
import type { MigrationBannerStorage } from "~/lib/migration-banner";
import { useCan } from "~/lib/permissions";
import { routes } from "~/lib/routes";

const browserStorage = (): MigrationBannerStorage | undefined => {
  if (isServer) return undefined;

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

/**
 * A one-time invitation to migrate from another MDM, shown only while the
 * tenant has no devices. The device-health query is already on the overview for
 * the MIA warning, so this adds no request of its own.
 */
export default function MigrationBanner(props: { tenantId: string }) {
  const { can } = useCan();
  const [dismissedTenant, setDismissedTenant] = createSignal<string | null>(null);

  const dismissed = () =>
    dismissedTenant() === props.tenantId ||
    readMigrationBannerDismissed(browserStorage(), props.tenantId);

  const summary = useQuery(() => ({
    queryKey: enterpriseKeys.deviceHealthSummary(props.tenantId),
    queryFn: () => enterprise.getDeviceHealthSummary(props.tenantId),
    enabled: can("devices.read"),
  }));

  const visible = () =>
    shouldShowMigrationBanner({
      deviceCount: summary.data?.counts.total,
      canRead: can("devices.read"),
      dismissed: dismissed(),
    });

  const dismiss = () => {
    setDismissedTenant(props.tenantId);
    writeMigrationBannerDismissed(browserStorage(), props.tenantId);
  };

  return (
    <Show when={visible()}>
      <div
        role="status"
        class="flex items-start gap-3 rounded-xl border border-brand/20 bg-brand-muted/60 px-3.5 py-3 text-xs leading-relaxed"
      >
        <span class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-card text-brand ring-1 ring-inset ring-brand/15">
          <ArrowRightLeft class="size-4" aria-hidden="true" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="font-medium text-foreground">Bring a fleet over from another MDM</p>
          <p class="mt-0.5 text-muted-foreground">
            Leaving Jamf, Intune or Kandji? Open a migration cohort to hand devices over without
            losing their history.
          </p>
          <Button
            as="a"
            href={routes.tenant(props.tenantId).settingsMigration()}
            size="xs"
            class="mt-2"
          >
            Open migration
          </Button>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Dismiss migration banner"
          onClick={dismiss}
        >
          <X class="size-3.5" />
        </Button>
      </div>
    </Show>
  );
}
