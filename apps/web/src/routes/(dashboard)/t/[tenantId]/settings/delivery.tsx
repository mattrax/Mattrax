import { useParams } from "@solidjs/router";
import type { RoutePreloadFuncArgs } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { For, Show } from "solid-js";
import { Panel, QueryError, relativeTime } from "~/components/mdm/common";
import { LoadingState } from "@mattrax/ui";
import { Badge } from "@mattrax/ui";
import { Button } from "@mattrax/ui";
import { CheckCircle2, CircleAlert, MonitorSmartphone } from "~/components/ui/icons";
import { enterpriseQueries } from "~/lib/enterprise";
import { preloadPage } from "~/lib/page-data";
import { queryClient } from "~/lib/query-client";
import { cn } from "~/lib/utils";

/**
 * Settings → Delivery: APNs diagnostics.
 *
 * Push is a wake-up hint, not the only way a policy reaches a device, so this
 * lives with the debugging surfaces rather than on the tenant overview.
 */

export const route = {
  preload: ({ params, intent }: RoutePreloadFuncArgs) => {
    if (intent === "initial") return;

    return preloadPage([
      () => queryClient.ensureQueryData(enterpriseQueries.devicePushHealth(params.tenantId)),
      () => queryClient.ensureQueryData(enterpriseQueries.apns(params.tenantId)),
      () => queryClient.ensureQueryData(enterpriseQueries.windowsFailures(params.tenantId)),
    ]);
  },
};

export default function DeliverySettingsPage() {
  const params = useParams();
  const tenantId = () => params.tenantId!;

  const pushHealth = useQuery(() => enterpriseQueries.devicePushHealth(tenantId()));

  const apns = useQuery(() => enterpriseQueries.apns(tenantId()));

  const windowsFailures = useQuery(() => enterpriseQueries.windowsFailures(tenantId()));

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
        tone: "text-success",
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
          <Badge variant={apns.data?.configured ? "success" : "warning"}>
            {apns.data?.configured ? (
              <CheckCircle2 class="size-3.5" />
            ) : (
              <CircleAlert class="size-3.5" />
            )}
            {apns.data?.configured ? "APNs configured" : "APNs not configured"}
          </Badge>
          <Show when={apns.data?.topic}>
            <span class="break-all font-mono text-xs text-muted-foreground">
              {apns.data.topic}
            </span>
          </Show>
        </div>

        <div class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          <For each={cards()}>
            {(card) => (
              <div
                title={card.hint}
                class="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border bg-surface px-3 py-2.5"
              >
                <span class="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span class={cn("size-1.5 rounded-full", card.dot)} aria-hidden="true" />
                  <span class="truncate">{card.label}</span>
                </span>
                <span
                  class={cn(
                    "text-lg font-semibold leading-none tracking-tight tabular-nums",
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
            <p class="rounded-lg border border-dashed border-border bg-surface px-4 py-5 text-xs text-muted-foreground">
              No recent push failures.
            </p>
          }
        >
          <ul class="divide-y divide-border overflow-hidden rounded-lg border border-border">
            <For each={pushHealth.data?.recentFailures ?? []}>
              {(failure) => (
                <li>
                  <a
                    href={`/t/${tenantId()}/devices/${failure.deviceId}`}
                    class="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-xs transition-colors hover:bg-hover"
                  >
                    <span class="min-w-0">
                      <span class="block truncate font-medium text-foreground">
                        {failure.deviceName}
                      </span>
                      <span class="mt-0.5 block truncate text-xs text-muted-foreground">
                        {failure.errorCode === "invalid_token"
                          ? "Invalid token · the device must enroll again"
                          : (failure.error ?? "Delivery failed")}
                      </span>
                    </span>
                    <span class="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
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

      <Panel
        title="Windows enrollment & management"
        description="Faults returned to Windows devices at discovery, certificate issuance, policy or check-in. A device that never enrolls appears only here."
        actions={
          <Badge variant="outline">
            <MonitorSmartphone class="size-3.5" />
            {windowsFailures.data?.count ?? 0}{" "}
            {windowsFailures.data?.retentionDays
              ? `in ${windowsFailures.data.retentionDays} days`
              : "all time"}
          </Badge>
        }
      >
        <Show
          when={(windowsFailures.data?.failures.length ?? 0) > 0}
          fallback={
            <Show
              when={windowsFailures.isPending}
              fallback={
                <p class="rounded-lg border border-dashed border-border bg-surface px-4 py-5 text-xs text-muted-foreground">
                  No failures recorded.
                </p>
              }
            >
              <div class="flex justify-center rounded-lg border border-dashed border-border bg-surface px-4 py-5">
                <LoadingState label="Loading delivery failures…" size={16} />
              </div>
            </Show>
          }
        >
          <ul class="divide-y divide-border overflow-hidden rounded-lg border border-border">
            <For each={windowsFailures.data?.failures ?? []}>
              {(failure) => {
                const label =
                  failure.hostname ??
                  failure.deviceIdentifier ??
                  failure.serial ??
                  "Unknown device";

                const body = () => (
                  <>
                    <span class="min-w-0">
                      <span class="block truncate font-medium text-foreground">{label}</span>
                      <span class="mt-0.5 block truncate text-xs text-muted-foreground">
                        {failure.phase.toUpperCase()} · {failure.message}
                      </span>
                    </span>
                    <span class="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                      <span class="font-mono">{failure.code}</span>
                      <span class="text-muted-foreground/40" aria-hidden="true">
                        ·
                      </span>
                      <span>{relativeTime(failure.at)}</span>
                    </span>
                  </>
                );

                return (
                  <li>
                    <Show
                      when={failure.deviceId}
                      fallback={
                        <div class="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-xs">
                          {body()}
                        </div>
                      }
                    >
                      {(deviceId) => (
                        <a
                          href={`/t/${tenantId()}/devices/${deviceId()}`}
                          class="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-xs transition-colors hover:bg-hover"
                        >
                          {body()}
                        </a>
                      )}
                    </Show>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
        <Show when={windowsFailures.isError}>
          <QueryError
            error={windowsFailures.error}
            class="mt-3"
            onRetry={() => void windowsFailures.refetch()}
          />
        </Show>
      </Panel>
    </div>
  );
}
