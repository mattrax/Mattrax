import { useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { Show } from "solid-js";
import { ErrorText, formatDate } from "~/components/mdm/common";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";

const SYNC_INTERVALS = [
  { minutes: 0, label: "Off" },
  { minutes: 60, label: "Hourly" },
  { minutes: 1440, label: "Daily" },
  { minutes: 10080, label: "Weekly" },
] as const;

const selectClass =
  "w-full max-w-xs rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-stone-500 focus:ring-2 focus:ring-stone-200 transition-colors disabled:cursor-not-allowed disabled:opacity-60";

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
    <div class="space-y-4">
      <Card>
        <CardHeader class="border-b">
          <CardTitle class="text-base">Microsoft Entra directory sync</CardTitle>
        </CardHeader>
        <CardContent class="space-y-4 text-sm">
          <Show
            when={status.data}
            fallback={
              <Show
                when={status.isError}
                fallback={<p class="text-stone-500">Loading directory sync status…</p>}
              >
                <ErrorText error={status.error} />
              </Show>
            }
          >
            {(value) => (
              <>
                <div class="flex flex-wrap items-center gap-2">
                  <Badge variant={value().configured ? "secondary" : "outline"}>
                    {value().configured ? "Graph configured" : "Graph not configured"}
                  </Badge>
                  <Badge variant="secondary">Sync {value().status}</Badge>
                  <Badge variant="secondary">{value().enabled ? "Enabled" : "Disabled"}</Badge>
                  <Show when={value().azureTenantId}>
                    {(tenant) => <span class="font-mono text-xs text-stone-400">{tenant()}</span>}
                  </Show>
                </div>
                <p class="max-w-3xl text-stone-500">
                  Directory sync uses the tenant's Entra ID tenant and the platform app's Graph
                  application permissions to import users and groups. Users are auto-provisioned
                  only when the SSO setting allows it.
                </p>
                <Show when={!value().configured}>
                  <div class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                    Set <code>AZURE_CLIENT_ID</code> and <code>AZURE_CLIENT_SECRET</code>, then
                    grant admin consent for <code>User.Read.All</code>, <code>Group.Read.All</code>{" "}
                    and <code>Domain.Read.All</code>.
                  </div>
                </Show>
                <Show when={value().consentUrl}>
                  {(url) => (
                    <a
                      class="inline-flex text-sm font-medium underline"
                      href={url()}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Grant admin consent in Entra
                    </a>
                  )}
                </Show>
                <div class="space-y-1.5">
                  <label for="entra-sync-interval" class="text-xs font-medium text-stone-700">
                    Automatic sync
                  </label>
                  <select
                    id="entra-sync-interval"
                    class={selectClass}
                    disabled={!value().configured || interval.isPending}
                    value={String(value().syncIntervalMinutes)}
                    onChange={(event) => interval.mutate(Number(event.currentTarget.value))}
                  >
                    {intervalOptions().map((option) => (
                      <option value={String(option.minutes)}>{option.label}</option>
                    ))}
                  </select>
                  <p class="text-xs text-stone-400">
                    {!value().enabled
                      ? "Enable sync to run automatically on this schedule."
                      : value().syncIntervalMinutes > 0
                        ? value().nextSyncAt
                          ? `Next automatic run ${formatDate(value().nextSyncAt)}.`
                          : "Runs on the next scheduled sweep."
                        : 'Automatic directory sync is off. Use "Sync now" to run it manually.'}
                  </p>
                </div>
                <div class="flex flex-wrap items-center gap-2">
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
                    {sync.isPending ? "Syncing…" : "Sync now"}
                  </Button>
                </div>
                <Show when={value().lastSyncedAt}>
                  {(at) => (
                    <p class="text-xs text-stone-400">
                      Last successful {triggerLabel(value().lastRunTrigger)} {formatDate(at())}
                    </p>
                  )}
                </Show>
                <Show when={value().lastAttemptedAt}>
                  {(at) => (
                    <p class="text-xs text-stone-400">
                      Last attempted {triggerLabel(value().lastRunTrigger)} {formatDate(at())}
                    </p>
                  )}
                </Show>
                <Show when={counts()}>
                  {(value) => (
                    <p class="text-xs text-stone-400">
                      Last run: {value().users ?? 0} users · {value().groups ?? 0} groups ·{" "}
                      {value().domains ?? 0} domains
                    </p>
                  )}
                </Show>
                <Show when={value().lastError}>
                  {(error) => (
                    <p class="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                      {error()}
                    </p>
                  )}
                </Show>
              </>
            )}
          </Show>
          <ErrorText error={status.error ?? sync.error ?? toggle.error ?? interval.error} />
        </CardContent>
      </Card>
    </div>
  );
}
