import { Show } from "solid-js";
import { Button } from "~/components/ui/button";
import { Pin } from "~/components/ui/icons";
import { isDashboardPinned, togglePinnedDashboard } from "~/lib/pinned-dashboards";
import { cn } from "~/lib/utils";

/**
 * Pin control shared by the dashboard list and a dashboard's own header.
 * Pinning is browser-local; see `~/lib/pinned-dashboards`.
 */
export default function PinDashboardButton(props: {
  tenantId: string;
  dashboardId: string;
  name: string;
  size?: "xs" | "sm";
  compact?: boolean;
  class?: string;
}) {
  const pinned = () => isDashboardPinned(props.tenantId, props.dashboardId);
  const label = () => (pinned() ? "Unpin from sidebar" : "Pin to sidebar");

  return (
    <Button
      size={props.size ?? "xs"}
      variant={pinned() ? "secondary" : "outline"}
      aria-pressed={pinned() ? "true" : "false"}
      aria-label={`${label()}: ${props.name}`}
      title={label()}
      onClick={() => {
        togglePinnedDashboard({
          tenantId: props.tenantId,
          dashboardId: props.dashboardId,
          name: props.name,
        });
      }}
    >
      <Pin class={cn("size-3.5", pinned() && "")} />
      <Show when={!props.compact}>{pinned() ? "Pinned" : "Pin"}</Show>
    </Button>
  );
}
