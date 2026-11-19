import { type RoutePreloadFuncArgs, useParams } from "@solidjs/router";
import { Match, Option, Schema } from "effect";
import { BULK_MEMBER_LIMIT } from "@mattrax/enterprise-domain/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { ErrorText, Panel, formatDate } from "~/components/mdm/common";
import { toast } from "~/components/toast";
import { Button } from "~/components/ui/button";
import { CircleAlert, RotateCcw } from "~/components/ui/icons";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";
import { bulkFailureReason, bulkReport, runBulkBatches, type BulkFailure } from "~/lib/bulk-members";
import { optimisticUpdate } from "~/lib/optimistic";
import { directorySyncProgress, shouldPollDirectorySync } from "~/lib/directory-sync";
import { preloadPage } from "~/lib/page-data";
import { queryClient } from "~/lib/query-client";
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

export const route = {
  preload: ({ params, intent }: RoutePreloadFuncArgs) => {
    if (intent === "initial") return;

    return preloadPage([
      () => queryClient.ensureQueryData(enterpriseQueries.directorySync(params.tenantId)),
      () => queryClient.ensureQueryData(enterpriseQueries.directory(params.tenantId)),
    ]);
  },
};

export default function DirectorySyncPage() {
  const params = useParams();
  const qc = useQueryClient();
  const { can } = useCan();
  const writable = () => can("identity.write");

  const status = useQuery(() => ({
    ...enterpriseQueries.directorySync(params.tenantId),
    // A scheduled run writes `running` before it starts and `idle` when it
    // finishes; poll only while that state is live and still inside the lock's
    // stale window, so a crashed worker does not keep the page busy forever.
    refetchInterval: (query) =>
      shouldPollDirectorySync({
        remoteStatus: query.state.data?.status,
        lastAttemptedAt: query.state.data?.lastAttemptedAt,
        lastHeartbeatAt: query.state.data?.lastHeartbeatAt,
      })
        ? 3000
        : false,
  }));

  const directory = useQuery(() => enterpriseQueries.directory(params.tenantId));

  const [selectedUserIds, setSelectedUserIds] = createSignal<ReadonlySet<string>>(new Set());
  const [targetGroupId, setTargetGroupId] = createSignal("");

  const directoryUsers = () => directory.data?.users ?? [];
  const userGroups = () => directory.data?.groups ?? [];
  const membersWritable = () => can("members.write");
  const usersSelectable = () => membersWritable() && userGroups().length > 0;

  const selectedUsers = createMemo(() =>
    directoryUsers().filter((user) => selectedUserIds().has(user.id)),
  );

  const allUsersSelected = () =>
    directoryUsers().length > 0 && selectedUsers().length === directoryUsers().length;

  const someUsersSelected = () =>
    selectedUsers().length > 0 && !allUsersSelected();

  let selectAllUsersRef: HTMLInputElement | undefined;

  createEffect(
    () => someUsersSelected(),
    (selected) => {
      if (selectAllUsersRef) selectAllUsersRef.indeterminate = selected;
    },
  );

  // Keep the picker on a group that still exists as the directory reloads.
  createEffect(
    () => userGroups().map((group) => group.id).join(","),
    () => {
      const groups = userGroups();

      if (!groups.some((group) => group.id === targetGroupId()))
        setTargetGroupId(groups[0]?.id ?? "");
    },
  );

  const toggleUser = (userId: string, selected: boolean) =>
    setSelectedUserIds((current) => {
      const next = new Set(current);

      if (selected) next.add(userId);
      else next.delete(userId);

      return next;
    });

  const toggleAllUsers = (selected: boolean) =>
    setSelectedUserIds(
      selected ? new Set(directoryUsers().map((user) => user.id)) : new Set<string>(),
    );

  const addToGroup = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: async () => {
      const groupId = targetGroupId();

      if (!groupId) throw new Error("Choose a directory group");

      const userIds = selectedUsers().map((user) => user.id);

      if (userIds.length === 0) throw new Error("Select at least one directory user");

      return runBulkBatches(userIds, BULK_MEMBER_LIMIT, (batch) =>
        enterprise.addUserGroupMembers(params.tenantId, groupId, batch),
      );
    },
    onSuccess: async (result) => {
      const names = new Map(directoryUsers().map((user) => [user.id, user.name]));

      const failures: BulkFailure[] = result.failed.map((row) => ({
        id: row.id,
        name: names.get(row.id) ?? row.id,
        reason: bulkFailureReason(row.reason),
      }));

      const report = bulkReport(
        { one: "directory user", many: "directory users" },
        { ok: "added or kept in", fail: "could not add" },
        { succeeded: result.updated.length, failed: failures },
      );

      toast[report.tone](report.title, {
        description: report.description,
        details: report.details,
      });

      setSelectedUserIds(new Set(failures.map((row) => row.id)));
      await qc.invalidateQueries({ queryKey: enterpriseKeys.directory(params.tenantId) });
    },
  }));

  type DirectorySyncStatus = Awaited<ReturnType<typeof enterprise.getEntraDirectorySync>>;

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: enterpriseKeys.directorySync(params.tenantId) });
    // A sync imports users and groups used by policy assignment pickers.
    await qc.invalidateQueries({ queryKey: enterpriseKeys.directory(params.tenantId) });
  };

  const toggle = useMutation(() => ({
    mutationFn: (enabled: boolean) =>
      enterprise.patchEntraDirectorySync(params.tenantId, { enabled }),
    onMutate: async (enabled) =>
      optimisticUpdate<DirectorySyncStatus>(
        qc,
        enterpriseKeys.directorySync(params.tenantId),
        (current) => ({
          ...current,
          enabled,
        }),
      ),
    onError: (_error, _enabled, restore) => restore?.(),
    onSettled: () => void invalidate(),
  }));

  const interval = useMutation(() => ({
    mutationFn: (syncIntervalMinutes: number) =>
      enterprise.patchEntraDirectorySync(params.tenantId, { syncIntervalMinutes }),
    onMutate: async (syncIntervalMinutes) =>
      optimisticUpdate<DirectorySyncStatus>(
        qc,
        enterpriseKeys.directorySync(params.tenantId),
        (current) => ({
          ...current,
          syncIntervalMinutes,
        }),
      ),
    onError: (_error, _minutes, restore) => restore?.(),
    onSettled: () => void invalidate(),
  }));

  const sync = useMutation(() => ({
    mutationFn: () => enterprise.syncEntraDirectory(params.tenantId),
    // Refresh on settled, not only success: a 409 lock failure must learn the
    // outcome of the run that beat it instead of freezing a red error.
    onSettled: invalidate,
  }));

  const counts = () =>
    Option.getOrUndefined(
      Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Number))(
        status.data?.lastCounts,
      ),
    );

  /** Last counts in the shape the progress copy expects. */
  const remoteCounts = () => {
    const current = counts();

    if (!current) return null;

    return {
      users: current.users ?? 0,
      groups: current.groups ?? 0,
      domains: current.domains ?? 0,
    };
  };

  const progress = () =>
    directorySyncProgress({
      isPending: sync.isPending,
      localError: sync.isError,
      localErrorAt: sync.submittedAt,
      data: sync.data ?? null,
      remoteStatus: status.data?.status ?? null,
      remoteError: status.data?.lastError ?? null,
      remoteCounts: remoteCounts(),
      lastSyncedAt: status.data?.lastSyncedAt ?? null,
      lastAttemptedAt: status.data?.lastAttemptedAt ?? null,
      lastHeartbeatAt: status.data?.lastHeartbeatAt ?? null,
    });

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
                      pending={sync.isPending}
                      disabled={!value().configured}
                      title={
                        value().configured
                          ? undefined
                          : "Directory sync is not available on this deployment yet"
                      }
                      onClick={() => sync.mutate()}
                    >
                      <Show when={!sync.isPending}>
                        <RotateCcw class="size-4" />
                      </Show>
                      Sync now
                    </Button>
                  </Show>
                </div>

                <div
                  class={cn("space-y-1.5", progress() && "mt-3")}
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  <Show when={progress()}>
                    {(current) => (
                      <>
                        <Show when={current().state === "running"}>
                          <div
                            class="h-0.5 overflow-hidden rounded-full bg-border"
                            aria-hidden="true"
                          >
                            <div class="route-progress h-full w-2/5 bg-gradient-to-r from-brand/0 via-brand to-brand/0" />
                          </div>
                        </Show>
                        <p
                          class={cn(
                            "text-[11.5px] leading-relaxed",
                            current().state === "running" && "text-muted-foreground",
                            current().state === "stale" && "text-warning-foreground",
                            current().state === "succeeded" && "text-success-foreground",
                            current().state === "failed" && "text-destructive",
                          )}
                        >
                          {current().message}
                        </p>
                      </>
                    )}
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
        description="Directory users are available for per-user policy assignment. Groups can be assigned policies as user groups. Adding users to a group is a manual change; a synced group is refreshed from its directory, so the provider may replace it."
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
                <div class="mb-2 flex items-center justify-between gap-2">
                  <p class="text-[12px] font-medium text-foreground">
                    Users{" "}
                    <span class="tabular-nums text-muted-foreground">({value().users.length})</span>
                  </p>
                  <Show when={usersSelectable()}>
                    <label class="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
                      <input
                        ref={(element) => {
                          selectAllUsersRef = element;
                        }}
                        type="checkbox"
                        class="size-3.5 accent-[var(--primary)]"
                        checked={allUsersSelected()}
                        onChange={(event) => toggleAllUsers(event.currentTarget.checked)}
                        aria-label="Select all directory users"
                      />
                      Select all
                    </label>
                  </Show>
                </div>
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
                          <Show when={usersSelectable()}>
                            <input
                              type="checkbox"
                              class="size-3.5 shrink-0 accent-[var(--primary)]"
                              checked={selectedUserIds().has(user.id)}
                              onChange={(event) =>
                                toggleUser(user.id, event.currentTarget.checked)
                              }
                              aria-label={`Select ${user.name} (${user.email})`}
                            />
                          </Show>
                          <span class="min-w-0 flex-1">
                            <span class="flex items-center gap-1.5">
                              <span class="block truncate text-foreground">{user.name}</span>
                              <Show when={user.disabled}>
                                <span class="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                  Disabled
                                </span>
                              </Show>
                            </span>
                            <span class="block truncate text-[11px] text-muted-foreground">
                              {user.email}
                            </span>
                            <Show when={user.externalId}>
                              {(externalId) => (
                                <span class="block truncate font-mono text-[10px] text-muted-foreground">
                                  {externalId()}
                                </span>
                              )}
                            </Show>
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
        <Show when={selectedUsers().length > 0}>
          <div
            role="group"
            aria-label="Bulk directory user actions"
            class="fixed bottom-5 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-3 rounded-xl border border-border bg-card px-3.5 py-2 shadow-popover"
          >
            <span class="flex items-center gap-2 text-[12px] font-[550] tabular-nums">
              <span class="size-1.5 rounded-full bg-primary" aria-hidden="true" />
              {selectedUsers().length} selected
            </span>
            <span class="h-4 w-px bg-border" aria-hidden="true" />
            <select
              class={cn(selectClass, "sm:w-auto")}
              value={targetGroupId()}
              onChange={(event) => setTargetGroupId(event.currentTarget.value)}
              aria-label="Directory group to add the selected users to"
              disabled={addToGroup.isPending || userGroups().length === 0}
            >
              <For each={userGroups()}>
                {(group) => (
                  <option value={group.id}>
                    {group.name} · {group.source}
                  </option>
                )}
              </For>
            </select>
            <Button
              size="sm"
              class="min-h-11 sm:min-h-0"
              onClick={() => addToGroup.mutate()}
              disabled={addToGroup.isPending || !targetGroupId() || selectedUsers().length === 0}
            >
              {addToGroup.isPending ? "Adding…" : "Add to group"}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setSelectedUserIds(new Set<string>())}
              disabled={addToGroup.isPending}
            >
              Clear
            </Button>
          </div>
        </Show>
        <ErrorText error={addToGroup.error} />
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
