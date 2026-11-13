import { useParams } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { For, Show } from "solid-js";
import { Panel, QueryError, relativeTime } from "~/components/mdm/common";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { CheckCircle2, CircleAlert } from "~/components/ui/icons";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";
import { cn } from "~/lib/utils";

/**
 * Settings → Delivery: APNs diagnostics.
 *
 * Push is a wake-up hint, not the only way a policy reaches a device, so this
 * lives with the debugging surfaces rather than on the tenant overview.
 */
export default function DeliverySettingsPage() {
  const params = useParams();
  const tenantId = () => params.tenantId!;

  const pushHealth = useQuery(() => ({
    queryKey: enterpriseKeys.devicePushHealth(tenantId()),
    queryFn: () => enterprise.getDevicePushHealth(tenantId()),
  }));

  const apns = useQuery(() => ({
    queryKey: enterpriseKeys.apns(tenantId()),
    queryFn: () => enterprise.getApns(tenantId()),
  }));

  const cards = () => {
    const counts = pushHealth.data?.counts;

    return [
      {
        label: "Configured",
        value: counts?.configured ?? 0,
        hint: "Apple devices with a push token",
        tone: "text-foreground",
        dot: "bg-foreground/60",
      },
      {
        label: "Attempted",
        value: counts?.attempted ?? 0,
        hint: "Devices with a recorded push",
        tone: "text-foreground",
        dot: "bg-muted-foreground/50",
      },
      {
        label: "Succeeding",
        value: counts?.succeeded ?? 0,
        hint: "Last push succeeded",
        tone: "text-success-foreground",
        dot: "bg-success",
      },
      {
        label: "Failing",
        value: counts?.failing ?? 0,
        hint: "Last push failed",
        tone: "text-warning-foreground",
        dot: "bg-warning",
      },
      {
        label: "Invalid token",
        value: counts?.invalidToken ?? 0,
        hint: "Device must re-enroll",
        tone: "text-destructive",
        dot: "bg-destructive",
      },
    ];
  };

  return (
    <div class="space-y-5">
      <Panel
        title="Apple push delivery"
        description="Diagnose APNs wake-ups. Push is a hint: devices still poll, so a failed push does not by itself make a device unhealthy."
        actions={
          <Button as="a" size="sm" variant="outline" href={`/t/${tenantId()}/settings/management`}>
            Push setup
          </Button>
        }
      >
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Badge
            variant="outline"
            class={cn(
              "gap-1.5",
              apns.data?.configured
                ? "border-success/25 bg-success/10 text-success-foreground"
                : "border-warning/25 bg-warning/10 text-warning-foreground",
            )}
          >
            {apns.data?.configured ? (
              <CheckCircle2 class="size-3.5" />
            ) : (
              <CircleAlert class="size-3.5" />
            )}
            {apns.data?.configured ? "APNs configured" : "APNs not configured"}
          </Badge>
          <Show when={apns.data?.topic}>
            <span class="break-all font-mono text-[11px] text-muted-foreground">
              {apns.data!.topic}
            </span>
          </Show>
        </div>

        <div class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          <For each={cards()}>
            {(card) => (
              <div
                title={card.hint}
                class="flex min-w-0 flex-col gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
              >
                <span class="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                  <span class={cn("size-1.5 rounded-full", card.dot)} aria-hidden="true" />
                  <span class="truncate">{card.label}</span>
                </span>
                <span
                  class={cn(
                    "text-[18px] font-semibold leading-none tracking-[-0.02em] tabular-nums",
                    card.tone,
                  )}
                >
                  {card.value}
                </span>
              </div>
            )}
          </For>
        </div>

        <Show when={pushHealth.isError}>
          <QueryError
            error={pushHealth.error}
            class="mt-3"
            onRetry={() => void pushHealth.refetch()}
          />
        </Show>
      </Panel>

      <Panel
        title="Recent failures"
        description="The last few delivery attempts Apple rejected, with the device that needs attention."
      >
        <Show
          when={(pushHealth.data?.recentFailures.length ?? 0) > 0}
          fallback={
            <p class="rounded-lg border border-dashed border-white/[0.08] bg-white/[0.012] px-4 py-5 text-[12.5px] text-muted-foreground">
              No recent push failures.
            </p>
          }
        >
          <ul class="divide-y divide-white/[0.06] overflow-hidden rounded-lg border border-white/[0.07]">
            <For each={pushHealth.data?.recentFailures ?? []}>
              {(failure) => (
                <li>
                  <a
                    href={`/t/${tenantId()}/devices/${failure.deviceId}`}
                    class="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-[12.5px] transition-colors hover:bg-white/[0.03]"
                  >
                    <span class="min-w-0">
                      <span class="block truncate font-medium text-foreground">
                        {failure.deviceName}
                      </span>
                      <span class="mt-0.5 block truncate text-[11px] text-muted-foreground">
                        {failure.errorCode === "invalid_token"
                          ? "Invalid token · the device must enroll again"
                          : (failure.error ?? "Delivery failed")}
                      </span>
                    </span>
                    <span class="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                      <span class="tabular-nums">{failure.consecutiveFailures} consecutive</span>
                      <span class="text-muted-foreground/40" aria-hidden="true">
                        ·
                      </span>
                      <span>{relativeTime(failure.at)}</span>
                    </span>
                  </a>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={pushHealth.isError}>
          <QueryError
            error={pushHealth.error}
            class="mt-3"
            onRetry={() => void pushHealth.refetch()}
          />
        </Show>
      </Panel>
    </div>
  );
}
