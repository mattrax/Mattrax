import { useParams } from "@solidjs/router";
import { Match, Option, Schema } from "effect";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { ErrorText, Panel, formatDate } from "~/components/mdm/common";
import { Button } from "~/components/ui/button";
import { CircleAlert, RotateCcw } from "~/components/ui/icons";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";
import { useCan } from "~/lib/permissions";
import { cn } from "~/lib/utils";

const SYNC_INTERVALS = [
  { minutes: 0, label: "Off" },
  { minutes: 60, label: "Hourly" },
  { minutes: 1440, label: "Daily" },
  { minutes: 10080, label: "Weekly" },
] as const;

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-surface px-2.5 text-base text-foreground sm:text-[13px] outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 sm:max-w-[15rem]";

const triggerLabel = (trigger: string | null | undefined) =>
  Match.value(trigger).pipe(
    Match.when("scheduled", () => "scheduled run"),
    Match.when("manual", () => "manual run"),
    Match.orElse(() => "run"),
  );

export default function DirectorySyncPage() {
  const params = useParams();
  const qc = useQueryClient();
  const { can } = useCan();
  const writable = () => can("identity.write");
  const status = useQuery(() => enterpriseQueries.directorySync(params.tenantId));
  const directory = useQuery(() => enterpriseQueries.directory(params.tenantId));

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: enterpriseKeys.directorySync(params.tenantId) });
    // A sync imports users and groups used by policy assignment pickers.
    await qc.invalidateQueries({ queryKey: enterpriseKeys.directory(params.tenantId) });
  };

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

  const counts = () =>
    Option.getOrUndefined(
      Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Number))(
        status.data?.lastCounts,
      ),
    );

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
                <Show
                  when={value().configured}
                  fallback={<Chip tone="warning">Setup required</Chip>}
                >
                  <Chip tone="success">Connected</Chip>
                  <Chip tone="neutral">Sync {value().status}</Chip>
                  <Chip tone={value().enabled ? "success" : "neutral"}>
                    {value().enabled ? "Automatic" : "Manual only"}
                  </Chip>
                </Show>
                <Show when={value().azureTenantId}>
                  {(tenant) => (
                    <span class="break-all font-mono text-[11px] text-muted-foreground">
                      {tenant()}
                    </span>
                  )}
                </Show>
              </div>
              <p class="mt-2 text-[11.5px] text-muted-foreground">
                {value().configured
                  ? "Microsoft Graph configured: directory sync can read users, groups and domains."
                  : "Graph not configured: the deployment is missing a Microsoft Graph application, so directory sync is unavailable."}
              </p>

              <Show when={!value().configured}>
                <div class="mt-4 flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/[0.07] p-3 text-xs leading-relaxed text-warning-foreground">
                  <CircleAlert class="mt-px size-3.5 shrink-0" />
                  <span>
                    Directory sync is not available on this deployment yet. Your Mattrax operator
                    needs to connect a Microsoft Graph application with permission to read users,
                    groups and domains. Everything below stays disabled until that is done.
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

              <div class="mt-5 divide-y divide-border">
                <div class="flex flex-col gap-2 pb-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
                  <label for="entra-sync-interval" class="min-w-0">
                    <span class="block text-[13px] font-medium text-foreground">
                      Automatic sync
                    </span>
                    <span class="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                      {automaticSyncHint(value())}
                    </span>
                  </label>
                  <select
                    id="entra-sync-interval"
                    class={cn(selectClass, "shrink-0 sm:w-[15rem]")}
                    disabled={!writable() || !value().configured || interval.isPending}
                    value={String(value().syncIntervalMinutes)}
                    onChange={(event) => interval.mutate(Number(event.currentTarget.value))}
                  >
                    {intervalOptions().map((option) => (
                      <option value={String(option.minutes)}>{option.label}</option>
                    ))}
                  </select>
                </div>

                <div class="flex flex-wrap items-center gap-2 pt-3.5">
                  <Show when={writable()}>
                    <Button
                      variant="outline"
                      disabled={!value().configured || toggle.isPending}
                      title={
                        value().configured
                          ? undefined
                          : "Directory sync is not available on this deployment yet"
                      }
                      onClick={() => toggle.mutate(!value().enabled)}
                    >
                      {value().enabled ? "Disable sync" : "Enable sync"}
                    </Button>
                    <Button
                      disabled={!value().configured || sync.isPending}
                      title={
                        value().configured
                          ? undefined
                          : "Directory sync is not available on this deployment yet"
                      }
                      onClick={() => sync.mutate()}
                    >
                      <RotateCcw class="size-4" />
                      {sync.isPending ? "Syncing…" : "Sync now"}
                    </Button>
                  </Show>
                </div>
              </div>

              <div class="mt-4 space-y-1 border-t border-border pt-3.5 text-xs text-muted-foreground">
                <Show when={!value().lastSyncedAt}>
                  <p>Never synced.</p>
                </Show>
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

      <Panel
        title="Synced users and groups"
        description="Directory users are available for per-user policy assignment. Groups can be assigned policies as user groups."
      >
        <Show
          when={directory.data}
          fallback={
            <Show
              when={directory.isError}
              fallback={<div class="h-24 animate-pulse rounded-lg bg-muted/40" />}
            >
              <ErrorText error={directory.error} />
            </Show>
          }
        >
          {(value) => (
            <div class="grid gap-5 md:grid-cols-2">
              <div>
                <p class="mb-2 text-[12px] font-medium text-foreground">
                  Users{" "}
                  <span class="tabular-nums text-muted-foreground">({value().users.length})</span>
                </p>
                <Show
                  when={value().users.length > 0}
                  fallback={
                    <p class="text-[12.5px] text-muted-foreground">
                      No directory users synced yet.
                    </p>
                  }
                >
                  <div class="max-h-72 divide-y divide-border/60 overflow-auto rounded-lg border border-border">
                    <For each={value().users}>
                      {(user) => (
                        <div class="flex items-center gap-2 px-2.5 py-1.5 text-[12.5px]">
                          <span class="min-w-0 flex-1">
                            <span class="block truncate text-foreground">{user.name}</span>
                            <span class="block truncate text-[11px] text-muted-foreground">
                              {user.email}
                            </span>
                          </span>
                          <span class="shrink-0 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                            {user.source}
                          </span>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
              <div>
                <p class="mb-2 text-[12px] font-medium text-foreground">
                  Groups{" "}
                  <span class="tabular-nums text-muted-foreground">({value().groups.length})</span>
                </p>
                <Show
                  when={value().groups.length > 0}
                  fallback={
                    <p class="text-[12.5px] text-muted-foreground">
                      No directory groups synced yet.
                    </p>
                  }
                >
                  <div class="max-h-72 divide-y divide-border/60 overflow-auto rounded-lg border border-border">
                    <For each={value().groups}>
                      {(group) => (
                        <div class="flex items-center gap-2 px-2.5 py-1.5 text-[12.5px]">
                          <span class="min-w-0 flex-1 truncate text-foreground">{group.name}</span>
                          <span class="shrink-0 text-[11px] text-muted-foreground">
                            {group.memberCount} members
                          </span>
                          <span class="shrink-0 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                            {group.source}
                          </span>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </div>
          )}
        </Show>
      </Panel>
    </div>
  );
}

const chipTones = {
  neutral: "border-border bg-surface text-muted-foreground",
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

/** One line describing whether, and when, directory sync runs. */
const automaticSyncHint = (status: {
  enabled: boolean;
  syncIntervalMinutes: number;
  nextSyncAt?: string | null;
}) => {
  if (!status.enabled) return "Enable sync to run automatically on this schedule.";

  if (status.syncIntervalMinutes <= 0)
    return 'Automatic directory sync is off. Use "Sync now" to run it manually.';

  return status.nextSyncAt
    ? `Next automatic run ${formatDate(status.nextSyncAt)}.`
    : "Runs on the next scheduled sweep.";
};
