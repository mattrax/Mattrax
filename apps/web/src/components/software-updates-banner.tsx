import { useQuery } from "@tanstack/solid-query";
import { Show } from "solid-js";
import { Button } from "~/components/ui/button";
import { CircleAlert } from "~/components/ui/icons";
import { enterpriseQueries } from "~/lib/enterprise";
import { useCan } from "~/lib/permissions";
import { routes } from "~/lib/routes";

const plural = (count: number, singular: string, pluralForm = `${singular}s`) =>
  count === 1 ? singular : pluralForm;

/**
 * A compact overview warning when macOS devices are behind the published
 * release. It deliberately reports only `behind` devices: non-macOS platforms
 * and macOS devices the feed could not evaluate are unknown, not healthy.
 *
 * The backend caches the feed and reports no behind devices when it is
 * unavailable, so this component makes no network call of its own and cannot
 * turn a SOFA outage into a dashboard error.
 */
export function SoftwareUpdatesBanner(props: { tenantId: string }) {
  const { can } = useCan();

  const summary = useQuery(() => ({
    ...enterpriseQueries.softwareUpdates(props.tenantId),
    enabled: can("devices.read"),
  }));

  const counts = () => summary.data?.counts;
  const behind = () => counts()?.behind ?? 0;

  const breakdown = () => {
    const value = counts();

    if (!value) return "";

    const parts = [
      value.securityRequired > 0
        ? `${value.securityRequired} security ${plural(value.securityRequired, "update", "updates")} required`
        : null,
      value.updateAvailable > 0
        ? `${value.updateAvailable} ${plural(value.updateAvailable, "major upgrade", "major upgrades")} available`
        : null,
    ].filter(Boolean);

    return parts.join(" · ");
  };

  return (
    <Show when={can("devices.read") && behind() > 0}>
      <div
        role="status"
        aria-live="polite"
        class="flex items-start gap-2.5 rounded-xl border border-warning/25 bg-warning/[0.06] px-3.5 py-3 text-[12.5px] leading-relaxed text-warning-foreground"
      >
        <CircleAlert class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div class="min-w-0 flex-1">
          <p class="font-medium">
            {behind()} {plural(behind(), "device is", "devices are")} behind on macOS updates
          </p>
          <Show when={breakdown()}>
            <p class="mt-0.5 text-muted-foreground">{breakdown()}</p>
          </Show>
          <Show when={summary.data?.feed.stale}>
            <p class="mt-0.5 text-[11px] text-muted-foreground">
              The update feed is stale; these statuses may be out of date.
            </p>
          </Show>
          <Button
            as="a"
            href={routes.tenant(props.tenantId).devices()}
            size="xs"
            variant="outline"
            class="mt-2"
          >
            Review devices
          </Button>
        </div>
      </div>
    </Show>
  );
}
