import { useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { ErrorText, Panel, formatDate } from "~/components/mdm/common";
import { Button } from "~/components/ui/button";
import { CircleAlert, RotateCcw } from "~/components/ui/icons";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";
import { cn } from "~/lib/utils";

const SYNC_INTERVALS = [
  { minutes: 0, label: "Off" },
  { minutes: 60, label: "Hourly" },
  { minutes: 1440, label: "Daily" },
  { minutes: 10080, label: "Weekly" },
] as const;

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-white/[0.02] px-2.5 text-base text-foreground sm:text-[13px] outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 sm:max-w-[15rem]";

const triggerLabel = (trigger: string | null | undefined) =>
  trigger === "scheduled" ? "scheduled run" : trigger === "manual" ? "manual run" : "run";

export default function DirectorySyncPage() {
  const params = useParams();
  const qc = useQueryClient();
  const status = useQuery(() => enterpriseQueries.directorySync(params.tenantId));

  const invalidate = async () =>
    qc.invalidateQueries({ queryKey: enterpriseKeys.directorySync(params.tenantId) });

  const toggle = useMutation(() => ({
    mutationFn: (enabled: boolean) =>
      enterprise.patchEntraDirectorySync(params.tenantId, { enabled }),
    onSuccess: invalidate,
  }));

  const interval = useMutation(() => ({
    mutationFn: (syncIntervalMinutes: number) =>
      enterprise.patchEntraDirectorySync(params.tenantId, { syncIntervalMinutes }),
    onSuccess: invalidate,
  }));

  const sync = useMutation(() => ({
    mutationFn: () => enterprise.syncEntraDirectory(params.tenantId),
    onSuccess: invalidate,
  }));

  const counts = () => status.data?.lastCounts as Record<string, number> | null | undefined;

  const intervalOptions = () => {
    const minutes = status.data?.syncIntervalMinutes ?? 0;

    return SYNC_INTERVALS.some((option) => option.minutes === minutes)
      ? SYNC_INTERVALS
      : [...SYNC_INTERVALS, { minutes, label: `${minutes} minutes` }];
  };

  return (
    <div class="grid gap-5">
      <Panel
        title="Microsoft Entra directory sync"
        description="Directory sync uses the tenant's Entra ID tenant and the platform app's Graph application permissions to import users and groups. Users are auto-provisioned only when the SSO setting allows it."
      >
        <Show
          when={status.data}
          fallback={
            <Show
              when={status.isError}
              fallback={
                <p class="text-[13px] text-muted-foreground">Loading directory sync status…</p>
              }
            >
              <ErrorText error={status.error} />
            </Show>
          }
        >
          {(value) => (
            <>
              <div class="flex flex-wrap items-center gap-2">
                <Chip tone={value().configured ? "success" : "warning"}>
                  {value().configured ? "Graph configured" : "Graph not configured"}
                </Chip>
                <Chip tone="neutral">Sync {value().status}</Chip>
                <Chip tone={value().enabled ? "success" : "neutral"}>
                  {value().enabled ? "Enabled" : "Disabled"}
                </Chip>
                <Show when={value().azureTenantId}>
                  {(tenant) => (
                    <span class="break-all font-mono text-[11px] text-muted-foreground">
                      {tenant()}
                    </span>
                  )}
                </Show>
              </div>

              <Show when={!value().configured}>
                <div class="mt-4 flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/[0.07] p-3 text-xs leading-relaxed text-warning-foreground">
                  <CircleAlert class="mt-px size-3.5 shrink-0" />
                  <span>
                    Set <code class="font-mono">AZURE_CLIENT_ID</code> and{" "}
                    <code class="font-mono">AZURE_CLIENT_SECRET</code>, then grant admin consent for{" "}
                    <code class="font-mono">User.Read.All</code>,{" "}
                    <code class="font-mono">Group.Read.All</code> and{" "}
                    <code class="font-mono">Domain.Read.All</code>.
                  </span>
                </div>
              </Show>
              <Show when={value().consentUrl}>
                {(url) => (
                  <a
                    class="mt-3 inline-flex text-[13px] font-medium text-brand underline underline-offset-2 transition-colors hover:text-brand/80"
                    href={url()}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Grant admin consent in Entra
                  </a>
                )}
              </Show>

              <div class="mt-5 divide-y divide-white/[0.05]">
                <div class="flex flex-col gap-2 pb-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
                  <label for="entra-sync-interval" class="min-w-0">
                    <span class="block text-[13px] font-medium text-foreground">
                      Automatic sync
                    </span>
                    <span class="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                      {!value().enabled
                        ? "Enable sync to run automatically on this schedule."
                        : value().syncIntervalMinutes > 0
                          ? value().nextSyncAt
                            ? `Next automatic run ${formatDate(value().nextSyncAt)}.`
                            : "Runs on the next scheduled sweep."
                          : 'Automatic directory sync is off. Use "Sync now" to run it manually.'}
                    </span>
                  </label>
                  <select
                    id="entra-sync-interval"
                    class={cn(selectClass, "shrink-0 sm:w-[15rem]")}
                    disabled={!value().configured || interval.isPending}
                    value={String(value().syncIntervalMinutes)}
                    onChange={(event) => interval.mutate(Number(event.currentTarget.value))}
                  >
                    {intervalOptions().map((option) => (
                      <option value={String(option.minutes)}>{option.label}</option>
                    ))}
                  </select>
                </div>

                <div class="flex flex-wrap items-center gap-2 pt-3.5">
                  <Button
                    variant="outline"
                    disabled={!value().configured || toggle.isPending}
                    onClick={() => toggle.mutate(!value().enabled)}
                  >
                    {value().enabled ? "Disable sync" : "Enable sync"}
                  </Button>
                  <Button
                    disabled={!value().configured || sync.isPending}
                    onClick={() => sync.mutate()}
                  >
                    <RotateCcw class="size-4" />
                    {sync.isPending ? "Syncing…" : "Sync now"}
                  </Button>
                </div>
              </div>

              <div class="mt-4 space-y-1 border-t border-white/[0.06] pt-3.5 text-xs text-muted-foreground">
                <Show when={value().lastSyncedAt}>
                  {(at) => (
                    <p>
                      Last successful {triggerLabel(value().lastRunTrigger)} {formatDate(at())}
                    </p>
                  )}
                </Show>
                <Show when={value().lastAttemptedAt}>
                  {(at) => (
                    <p>
                      Last attempted {triggerLabel(value().lastRunTrigger)} {formatDate(at())}
                    </p>
                  )}
                </Show>
                <Show when={counts()}>
                  {(current) => (
                    <p>
                      Last run: {current().users ?? 0} users · {current().groups ?? 0} groups ·{" "}
                      {current().domains ?? 0} domains
                    </p>
                  )}
                </Show>
              </div>
              <Show when={value().lastError}>
                {(error) => (
                  <p class="mt-3 rounded-lg border border-destructive/25 bg-destructive/[0.07] p-3 text-xs leading-relaxed text-destructive">
                    {error()}
                  </p>
                )}
              </Show>
            </>
          )}
        </Show>
        <ErrorText error={status.error ?? sync.error ?? toggle.error ?? interval.error} />
      </Panel>
    </div>
  );
}

const chipTones = {
  neutral: "border-white/[0.08] bg-white/[0.03] text-muted-foreground",
  success: "border-success/25 bg-success/10 text-success-foreground",
  warning: "border-warning/25 bg-warning/10 text-warning-foreground",
  danger: "border-destructive/25 bg-destructive/10 text-destructive",
} as const;

function Chip(props: { tone: keyof typeof chipTones; children: JSX.Element }) {
  return (
    <span
      class={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        chipTones[props.tone],
      )}
    >
      <span class="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {props.children}
    </span>
  );
}
