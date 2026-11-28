import { useParams } from "@solidjs/router";
import type { RoutePreloadFuncArgs } from "@solidjs/router";
import { Option, Schema } from "effect";
import { BULK_MEMBER_LIMIT } from "@mattrax/enterprise-domain/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { ErrorText, Panel, formatDate } from "~/components/mdm/common";
import SetupNotice from "~/components/settings/setup-notice";
import { toast } from "~/components/toast";
import { Checkbox, IndeterminateBar, LoadingState } from "@mattrax/ui";
import { Input } from "@mattrax/ui";
import { Button } from "@mattrax/ui";
import ConfirmDialog from "~/components/ui/confirm-dialog";
import { ArrowUpRight, RotateCcw } from "~/components/ui/app-icons";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";
import { bulkFailureReason, bulkReport, runBulkBatches } from "~/lib/bulk-members";
import type { BulkFailure } from "~/lib/bulk-members";
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
  "h-8 w-full rounded-lg border border-input bg-surface px-2.5 text-base text-foreground sm:text-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 sm:max-w-60";

export const route = {
  preload: ({ params, intent }: RoutePreloadFuncArgs) => {
    if (intent === "initial") return;

    return preloadPage([
      () => queryClient.ensureQueryData(enterpriseQueries.directorySync(params.tenantId)),
      () => queryClient.ensureQueryData(enterpriseQueries.googleDirectorySync(params.tenantId)),
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

  const someUsersSelected = () => selectedUsers().length > 0 && !allUsersSelected();

  // Keep the picker on a group that still exists as the directory reloads.
  createEffect(
    () =>
      userGroups()
        .map((group) => group.id)
        .join(","),
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

  /**
   * The Entra callback refuses to auto-link an account that belongs to several
   * tenants. This is the administrator-confirmed version of that link: the
   * callback finds the directory person's Entra object id here and resolves
   * the Mattrax account with the same email.
   */
  const [linkTarget, setLinkTarget] = createSignal<{
    id: string;
    name: string;
    email: string;
  } | null>(null);

  const [linkNotice, setLinkNotice] = createSignal<string | null>(null);

  const linkSso = useMutation(() => ({
    mutationFn: (target: { id: string; name: string; email: string }) =>
      enterprise.linkDirectoryUserSso(params.tenantId, target.id),
    onSuccess: (_result, target) => {
      setLinkTarget(null);
      setLinkNotice(
        `${target.name} can now sign in to this tenant with Microsoft Entra single sign-on.`,
      );
      void qc.invalidateQueries({ queryKey: enterpriseKeys.directory(params.tenantId) });
    },
  }));

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

  const google = useQuery(() => ({
    ...enterpriseQueries.googleDirectorySync(params.tenantId),
    refetchInterval: (query) =>
      shouldPollDirectorySync({
        remoteStatus: query.state.data?.status,
        lastAttemptedAt: query.state.data?.lastAttemptedAt,
        lastHeartbeatAt: query.state.data?.lastHeartbeatAt,
      })
        ? 3000
        : false,
  }));

  const [googleFormOpen, setGoogleFormOpen] = createSignal(false);
  const [googleAdminEmail, setGoogleAdminEmail] = createSignal("");
  const [googleCustomer, setGoogleCustomer] = createSignal("");
  const [googleServiceAccountJson, setGoogleServiceAccountJson] = createSignal("");
  const [googleRemoveOpen, setGoogleRemoveOpen] = createSignal(false);

  const invalidateGoogle = async () => {
    await qc.invalidateQueries({ queryKey: enterpriseKeys.googleDirectorySync(params.tenantId) });
    await qc.invalidateQueries({ queryKey: enterpriseKeys.directory(params.tenantId) });
  };

  const googleToggle = useMutation(() => ({
    mutationFn: (enabled: boolean) =>
      enterprise.patchGoogleDirectorySync(params.tenantId, { enabled }),
    onSettled: () => void invalidateGoogle(),
  }));

  const googleInterval = useMutation(() => ({
    mutationFn: (syncIntervalMinutes: number) =>
      enterprise.patchGoogleDirectorySync(params.tenantId, { syncIntervalMinutes }),
    onSettled: () => void invalidateGoogle(),
  }));

  const googleSync = useMutation(() => ({
    mutationFn: () => enterprise.syncGoogleDirectory(params.tenantId),
    onSettled: () => void invalidateGoogle(),
  }));

  const googleCredentials = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: () =>
      enterprise.putGoogleDirectoryCredentials(params.tenantId, {
        serviceAccountJson: googleServiceAccountJson(),
        adminEmail: googleAdminEmail(),
        ...(googleCustomer().trim() ? { customer: googleCustomer() } : {}),
      }),
    onSuccess: () => {
      // The JSON is a private key; drop it from component state as soon as the
      // server has sealed it.
      setGoogleServiceAccountJson("");
      setGoogleFormOpen(false);
      toast.success("Google Workspace credentials saved", {
        description: "The key was validated and encrypted at rest.",
      });
      void invalidateGoogle();
    },
  }));

  const googleRemove = useMutation(() => ({
    mutationFn: () => enterprise.deleteGoogleDirectoryCredentials(params.tenantId),
    onSuccess: () => {
      setGoogleRemoveOpen(false);
      void invalidateGoogle();
    },
  }));

  const googleCounts = () => {
    const value = Option.getOrUndefined(
      Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Number))(
        google.data?.lastCounts,
      ),
    );

    if (!value) return null;

    return { users: value.users ?? 0, groups: value.groups ?? 0 };
  };

  const googleProgress = () =>
    directorySyncProgress({
      isPending: googleSync.isPending,
      localError: googleSync.isError,
      localErrorAt: googleSync.submittedAt,
      data: googleSync.data
        ? { users: googleSync.data.users, groups: googleSync.data.groups }
        : null,
      remoteStatus: google.data?.status ?? null,
      remoteError: google.data?.lastError ?? null,
      remoteCounts: googleCounts(),
      runningMessage: "Syncing users and groups from Google Workspace…",
      lastSyncedAt: google.data?.lastSyncedAt ?? null,
      lastAttemptedAt: google.data?.lastAttemptedAt ?? null,
      lastHeartbeatAt: google.data?.lastHeartbeatAt ?? null,
    });

  const googleIntervalOptions = () => {
    const minutes = google.data?.syncIntervalMinutes ?? 0;

    return SYNC_INTERVALS.some((option) => option.minutes === minutes)
      ? SYNC_INTERVALS
      : [...SYNC_INTERVALS, { minutes, label: `${minutes} minutes` }];
  };

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
              fallback={<LoadingState label="Loading directory sync status…" size={16} />}
            >
              <ErrorText error={status.error} />
            </Show>
          }
        >
          {(value) => (
            <>
              <Show
                when={value().configured}
                fallback={
                  <SetupNotice
                    title="Connect Microsoft Graph"
                    description="Directory sync needs a Microsoft Graph application with permission to read users, groups and domains. A Mattrax operator connects it for this deployment; the schedule and manual sync stay unavailable until then."
                    action={
                      <Show when={value().consentUrl}>
                        {(url) => (
                          <a
                            class="inline-flex text-xs font-medium text-brand underline underline-offset-2 transition-colors hover:text-brand/80"
                            href={url()}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Grant admin consent in Entra
                          </a>
                        )}
                      </Show>
                    }
                  />
                }
              >
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
                  <span class="inline-flex items-center gap-1.5 font-medium text-foreground">
                    <span class="size-1.5 rounded-full bg-success" />
                    Connected
                  </span>
                  <span class="text-muted-foreground">Sync {value().status}</span>
                  <span class="text-muted-foreground">
                    {value().enabled ? "Automatic" : "Manual only"}
                  </span>
                  <Show when={value().azureTenantId}>
                    {(tenant) => (
                      <span class="break-all font-mono text-xs text-muted-foreground">
                        {tenant()}
                      </span>
                    )}
                  </Show>
                </div>
              </Show>
              <Show when={value().configured}>
                <div class="mt-5 space-y-3 rounded-lg border border-border bg-surface/40 p-3.5">
                  <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
                    <label for="entra-sync-interval" class="min-w-0">
                      <span class="block text-xs font-medium text-foreground">
                        Automatic sync
                      </span>
                      <span class="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                        {automaticSyncHint(value())}
                      </span>
                    </label>
                    <select
                      id="entra-sync-interval"
                      class={cn(selectClass, "shrink-0 sm:w-60")}
                      disabled={!writable() || interval.isPending}
                      value={String(value().syncIntervalMinutes)}
                      onChange={(event) => interval.mutate(Number(event.currentTarget.value))}
                    >
                      {intervalOptions().map((option) => (
                        <option value={String(option.minutes)}>{option.label}</option>
                      ))}
                    </select>
                  </div>

                  <Show when={writable()}>
                    <div class="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                      <Button
                        variant="outline"
                        disabled={toggle.isPending}
                        onClick={() => toggle.mutate(!value().enabled)}
                      >
                        {value().enabled ? "Disable sync" : "Enable sync"}
                      </Button>
                      <Button pending={sync.isPending} onClick={() => sync.mutate()}>
                        <Show when={!sync.isPending}>
                          <RotateCcw class="size-4" />
                        </Show>
                        Sync now
                      </Button>
                    </div>
                  </Show>

                  <Show when={progress()}>
                    {(current) => (
                      <div
                        class="space-y-1.5 border-t border-border pt-3.5"
                        role="status"
                        aria-live="polite"
                        aria-atomic="true"
                      >
                        <Show when={current().state === "running"}>
                          <IndeterminateBar />
                        </Show>
                        <p
                          class={cn(
                            "text-xs leading-relaxed",
                            current().state === "running" && "text-muted-foreground",
                            current().state === "stale" && "text-warning-foreground",
                            current().state === "succeeded" && "text-success",
                            current().state === "failed" && "text-destructive",
                          )}
                        >
                          {current().message}
                        </p>
                      </div>
                    )}
                  </Show>
                </div>
              </Show>
              <Show
                when={
                  value().configured &&
                  (value().lastSyncedAt || value().lastAttemptedAt || counts())
                }
              >
                <div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border pt-3 text-xs text-muted-foreground">
                  <Show when={value().lastSyncedAt}>
                    {(at) => (
                      <span class="inline-flex items-center gap-1.5">
                        <span class="size-1.5 rounded-full bg-success" />
                        Last sync <span class="font-mono tabular-nums">{formatDate(at())}</span>
                      </span>
                    )}
                  </Show>
                  <Show when={!value().lastSyncedAt && value().lastAttemptedAt}>
                    {(at) => (
                      <span class="inline-flex items-center gap-1.5 text-warning-foreground">
                        <span class="size-1.5 rounded-full bg-warning" />
                        Last attempt <span class="font-mono tabular-nums">{formatDate(at())}</span>
                      </span>
                    )}
                  </Show>
                  <Show when={value().lastSyncedAt ? value().lastAttemptedAt : null}>
                    {(at) => (
                      <span>
                        Attempted <span class="font-mono tabular-nums">{formatDate(at())}</span>
                      </span>
                    )}
                  </Show>
                  <Show when={counts()}>
                    {(current) => (
                      <span class="font-mono tabular-nums">
                        {current().users ?? 0} users · {current().groups ?? 0} groups ·{" "}
                        {current().domains ?? 0} domains
                      </span>
                    )}
                  </Show>
                </div>
              </Show>
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
        title="Google Workspace directory sync"
        description="Import users and groups from Google Workspace so admins can correlate devices with people and scope policy by user or directory group. Sync uses a service account with domain-wide delegation; it never changes anything in Google."
      >
        <Show
          when={google.data}
          fallback={
            <Show
              when={google.isError}
              fallback={<LoadingState label="Loading Google Workspace status…" size={16} />}
            >
              <ErrorText error={google.error} />
            </Show>
          }
        >
          {(value) => (
            <>
              <Show
                when={value().configured}
                fallback={
                  <SetupNotice
                    title="Connect Google Workspace"
                    description="Add a service-account key for this tenant, or ask your deployment operator to set deployment-wide credentials. Sync stays unavailable until then."
                    action={
                      <>
                        <Show when={writable()}>
                          <Button
                            variant="outline"
                            onClick={() => setGoogleFormOpen((open) => !open)}
                          >
                            {googleFormOpen() ? "Close credentials form" : "Configure credentials"}
                          </Button>
                        </Show>
                        <Button
                          as="a"
                          href={value().adminDirectoryUrl}
                          target="_blank"
                          rel="noreferrer"
                          variant="ghost"
                          size="sm"
                        >
                          Google Admin
                          <ArrowUpRight class="size-3.5" />
                        </Button>
                      </>
                    }
                  >
                    <details class="rounded-lg border border-border bg-surface/60 p-3 text-xs leading-relaxed text-muted-foreground">
                      <summary class="cursor-pointer select-none font-medium text-foreground">
                        What the Google setup needs
                      </summary>
                      <ol class="mt-2 list-decimal space-y-1 pl-4">
                        <li>Create a Google Cloud service account and download a JSON key.</li>
                        <li>Enable the Admin SDK API for that project.</li>
                        <li>
                          In Google Admin → Security → API controls → Domain-wide delegation,
                          authorise the service account's client id for:
                          <span class="mt-1 block break-all font-mono text-xs">
                            https://www.googleapis.com/auth/admin.directory.user.readonly
                            https://www.googleapis.com/auth/admin.directory.group.readonly
                          </span>
                        </li>
                        <li>
                          Enter a Workspace super-admin below. The service account impersonates that
                          admin; the JSON key is encrypted at rest and never returned by the API.
                        </li>
                      </ol>
                    </details>
                  </SetupNotice>
                }
              >
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
                  <span class="inline-flex items-center gap-1.5 font-medium text-foreground">
                    <span class="size-1.5 rounded-full bg-success" />
                    Connected
                  </span>
                  <span class="text-muted-foreground">Sync {value().status}</span>
                  <span class="text-muted-foreground">
                    {value().enabled ? "Automatic" : "Manual only"}
                  </span>
                  <Show when={value().credentialsSource}>
                    {(source) => (
                      <span class="text-muted-foreground">
                        {source() === "tenant" ? "Tenant credentials" : "Deployment credentials"}
                      </span>
                    )}
                  </Show>
                </div>

                <Show when={value().serviceAccountEmail}>
                  {(email) => (
                    <p class="mt-2 break-all font-mono text-xs text-muted-foreground">
                      {email()} → {value().adminEmail ?? "no admin"} ·{" "}
                      {value().customer ?? "my_customer"}
                    </p>
                  )}
                </Show>
              </Show>
              <Show when={value().configured}>
                <div class="mt-5 space-y-3 rounded-lg border border-border bg-surface/40 p-3.5">
                  <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
                    <label for="google-sync-interval" class="min-w-0">
                      <span class="block text-xs font-medium text-foreground">
                        Automatic sync
                      </span>
                      <span class="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                        {automaticSyncHint(value())}
                      </span>
                    </label>
                    <select
                      id="google-sync-interval"
                      class={cn(selectClass, "shrink-0 sm:w-60")}
                      disabled={!writable() || googleInterval.isPending}
                      value={String(value().syncIntervalMinutes)}
                      onChange={(event) => googleInterval.mutate(Number(event.currentTarget.value))}
                    >
                      {googleIntervalOptions().map((option) => (
                        <option value={String(option.minutes)}>{option.label}</option>
                      ))}
                    </select>
                  </div>

                  <div class="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                    <Show when={writable()}>
                      <Button
                        variant="outline"
                        disabled={googleToggle.isPending}
                        onClick={() => googleToggle.mutate(!value().enabled)}
                      >
                        {value().enabled ? "Disable sync" : "Enable sync"}
                      </Button>
                      <Button pending={googleSync.isPending} onClick={() => googleSync.mutate()}>
                        <Show when={!googleSync.isPending}>
                          <RotateCcw class="size-4" />
                        </Show>
                        Sync now
                      </Button>
                      <Button variant="outline" onClick={() => setGoogleFormOpen((open) => !open)}>
                        {googleFormOpen() ? "Close credentials form" : "Configure credentials"}
                      </Button>
                      <Show when={value().credentialsSource === "tenant"}>
                        <Button
                          variant="ghost"
                          disabled={googleRemove.isPending}
                          onClick={() => setGoogleRemoveOpen(true)}
                        >
                          Remove tenant key
                        </Button>
                      </Show>
                    </Show>
                    <Button
                      as="a"
                      href={value().adminDirectoryUrl}
                      target="_blank"
                      rel="noreferrer"
                      variant="ghost"
                      size="sm"
                    >
                      Google Admin
                      <ArrowUpRight class="size-3.5" />
                    </Button>
                  </div>

                  <Show when={googleProgress()}>
                    {(current) => (
                      <div
                        class="space-y-1.5 border-t border-border pt-3.5"
                        role="status"
                        aria-live="polite"
                        aria-atomic="true"
                      >
                        <Show when={current().state === "running"}>
                          <IndeterminateBar />
                        </Show>
                        <p
                          class={cn(
                            "text-xs leading-relaxed",
                            current().state === "running" && "text-muted-foreground",
                            current().state === "stale" && "text-warning-foreground",
                            current().state === "succeeded" && "text-success",
                            current().state === "failed" && "text-destructive",
                          )}
                        >
                          {current().message}
                        </p>
                      </div>
                    )}
                  </Show>
                </div>
              </Show>
              <Show
                when={
                  value().configured &&
                  (value().lastSyncedAt || value().lastAttemptedAt || googleCounts())
                }
              >
                <div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border pt-3 text-xs text-muted-foreground">
                  <Show when={value().lastSyncedAt}>
                    {(at) => (
                      <span class="inline-flex items-center gap-1.5">
                        <span class="size-1.5 rounded-full bg-success" />
                        Last sync <span class="font-mono tabular-nums">{formatDate(at())}</span>
                      </span>
                    )}
                  </Show>
                  <Show when={!value().lastSyncedAt && value().lastAttemptedAt}>
                    {(at) => (
                      <span class="inline-flex items-center gap-1.5 text-warning-foreground">
                        <span class="size-1.5 rounded-full bg-warning" />
                        Last attempt <span class="font-mono tabular-nums">{formatDate(at())}</span>
                      </span>
                    )}
                  </Show>
                  <Show when={value().lastSyncedAt ? value().lastAttemptedAt : null}>
                    {(at) => (
                      <span>
                        Attempted <span class="font-mono tabular-nums">{formatDate(at())}</span>
                      </span>
                    )}
                  </Show>
                  <Show when={googleCounts()}>
                    {(counts) => (
                      <span class="font-mono tabular-nums">
                        {counts().users} users · {counts().groups} groups
                      </span>
                    )}
                  </Show>
                </div>
              </Show>

              <Show when={googleFormOpen() && writable()}>
                <div class="mt-4 grid gap-3 rounded-lg border border-border bg-surface/40 p-3">
                  <p class="text-xs leading-relaxed text-muted-foreground">
                    Saving validates the key with a single directory read before storing it. The
                    JSON is sealed with the deployment secret; only the service account's email is
                    kept readable.
                  </p>
                  <label class="grid gap-1 text-xs font-medium text-foreground">
                    Workspace super-admin email
                    <Input
                      type="email"
                      autocomplete="off"
                      placeholder="admin@example.com"
                      value={googleAdminEmail()}
                      onInput={(event) => setGoogleAdminEmail(event.currentTarget.value)}
                    />
                  </label>
                  <label class="grid gap-1 text-xs font-medium text-foreground">
                    Customer or primary domain (optional)
                    <Input
                      type="text"
                      autocomplete="off"
                      placeholder="my_customer"
                      value={googleCustomer()}
                      onInput={(event) => setGoogleCustomer(event.currentTarget.value)}
                    />
                  </label>
                  <label class="grid gap-1 text-xs font-medium text-foreground">
                    Service-account JSON
                    <textarea
                      rows={6}
                      autocomplete="off"
                      autocapitalize="off"
                      spellcheck={false}
                      class="w-full rounded-lg border border-input bg-surface px-2.5 py-2 font-mono text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                      placeholder={
                        '{\n  "type": "service_account",\n  "client_email": "…",\n  "private_key": "-----BEGIN PRIVATE KEY-----…"\n}'
                      }
                      value={googleServiceAccountJson()}
                      onInput={(event) => setGoogleServiceAccountJson(event.currentTarget.value)}
                    />
                  </label>
                  <div class="flex flex-wrap items-center gap-2">
                    <Button
                      pending={googleCredentials.isPending}
                      disabled={
                        googleCredentials.isPending ||
                        !googleServiceAccountJson().trim() ||
                        !googleAdminEmail().trim()
                      }
                      onClick={() => googleCredentials.mutate()}
                    >
                      Save and validate
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={googleCredentials.isPending}
                      onClick={() => setGoogleFormOpen(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                  <ErrorText error={googleCredentials.error} />
                </div>
              </Show>

              <Show when={value().lastError}>
                {(error) => (
                  <p class="mt-3 rounded-lg border border-destructive/25 bg-destructive/[0.07] p-3 text-xs leading-relaxed text-destructive">
                    {error()}
                  </p>
                )}
              </Show>

              <p class="mt-3 rounded-lg border border-border bg-surface/60 p-3 text-xs leading-relaxed text-muted-foreground">
                Google sign-in (OIDC) is not enabled by directory sync. Linking a Google user for
                dashboard or enrollment sign-in requires a Google OAuth client, an ID-token verifier
                and a tenant SSO binding for your deployment; this sync only imports the directory
                record. Microsoft Entra SSO is unaffected.
              </p>
            </>
          )}
        </Show>
        <ErrorText
          error={
            google.error ??
            googleSync.error ??
            googleToggle.error ??
            googleInterval.error ??
            googleRemove.error
          }
        />
      </Panel>

      <ConfirmDialog
        open={googleRemoveOpen()}
        onOpenChange={setGoogleRemoveOpen}
        title="Remove this tenant's Google Workspace credentials?"
        description="The sealed service-account key is deleted. Automatic sync stops until credentials are saved again or the deployment supplies its own. Imported users, groups and device links are kept."
        confirmLabel="Remove credentials"
        pending={googleRemove.isPending}
        error={googleRemove.error}
        onConfirm={() => googleRemove.mutate()}
      />

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
                  <p class="text-xs font-medium text-foreground">
                    Users{" "}
                    <span class="tabular-nums text-muted-foreground">({value().users.length})</span>
                  </p>
                  <Show when={usersSelectable()}>
                    <label class="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                      <Checkbox
                        checked={
                          allUsersSelected()
                            ? true
                            : someUsersSelected()
                              ? "indeterminate"
                              : false
                        }
                        onCheckedChange={(checked) => toggleAllUsers(checked === true)}
                        aria-label="Select all directory users"
                      />
                      Select all
                    </label>
                  </Show>
                </div>
                <Show
                  when={value().users.length > 0}
                  fallback={
                    <p class="text-xs text-muted-foreground">
                      No directory users synced yet.
                    </p>
                  }
                >
                  <div class="max-h-72 divide-y divide-border/60 overflow-auto rounded-lg border border-border">
                    <For each={value().users}>
                      {(user) => (
                        <div class="flex items-center gap-2 px-2.5 py-1.5 text-xs">
                          <Show when={usersSelectable()}>
                            <Checkbox
                              checked={selectedUserIds().has(user.id)}
                              onCheckedChange={(checked) => toggleUser(user.id, checked === true)}
                              aria-label={`Select ${user.name} (${user.email})`}
                            />
                          </Show>
                          <span class="min-w-0 flex-1">
                            <span class="flex items-center gap-1.5">
                              <span class="block truncate text-foreground">{user.name}</span>
                              <Show when={user.disabled}>
                                <span class="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                                  Disabled
                                </span>
                              </Show>
                            </span>
                            <span class="block truncate text-xs text-muted-foreground">
                              {user.email}
                            </span>
                            <Show when={user.externalId}>
                              {(externalId) => (
                                <span class="block truncate font-mono text-xs text-muted-foreground">
                                  {externalId()}
                                </span>
                              )}
                            </Show>
                          </span>
                          <span class="flex shrink-0 flex-col items-end gap-1">
                            <span class="text-xs uppercase tracking-widest text-muted-foreground">
                              {user.source}
                            </span>
                            <Show when={user.linked}>
                              <span class="shrink-0 rounded-full border border-success/25 bg-success/10 px-1.5 py-0.5 text-xs font-medium text-success">
                                SSO linked
                              </span>
                            </Show>
                            <Show
                              when={
                                writable() &&
                                !user.linked &&
                                user.source === "entra" &&
                                user.externalId
                                  ? user
                                  : undefined
                              }
                            >
                              {(linkable) => (
                                <Button
                                  size="xs"
                                  variant="outline"
                                  disabled={linkSso.isPending}
                                  onClick={() =>
                                    setLinkTarget({
                                      id: linkable().id,
                                      name: linkable().name,
                                      email: linkable().email,
                                    })
                                  }
                                >
                                  Link SSO
                                </Button>
                              )}
                            </Show>
                          </span>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
                <Show when={linkNotice()}>
                  {(notice) => (
                    <p role="status" class="mt-2 text-xs text-success">
                      {notice()}
                    </p>
                  )}
                </Show>
              </div>
              <div>
                <p class="mb-2 text-xs font-medium text-foreground">
                  Groups{" "}
                  <span class="tabular-nums text-muted-foreground">({value().groups.length})</span>
                </p>
                <Show
                  when={value().groups.length > 0}
                  fallback={
                    <p class="text-xs text-muted-foreground">
                      No directory groups synced yet.
                    </p>
                  }
                >
                  <div class="max-h-72 divide-y divide-border/60 overflow-auto rounded-lg border border-border">
                    <For each={value().groups}>
                      {(group) => (
                        <div class="flex items-center gap-2 px-2.5 py-1.5 text-xs">
                          <span class="min-w-0 flex-1 truncate text-foreground">{group.name}</span>
                          <span class="shrink-0 text-xs text-muted-foreground">
                            {group.memberCount} members
                          </span>
                          <span class="shrink-0 text-xs uppercase tracking-widest text-muted-foreground">
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
            class="fixed bottom-5 inset-x-4 z-40 mx-auto flex max-w-full flex-wrap items-center justify-center gap-3 rounded-xl border border-border bg-card px-3.5 py-2 shadow-popover"
          >
            <span class="flex items-center gap-2 text-xs font-medium tabular-nums">
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

      <ConfirmDialog
        open={linkTarget() !== null}
        onOpenChange={(open) => {
          if (!open) setLinkTarget(null);
        }}
        title={`Link single sign-on for ${linkTarget()?.name ?? "this directory user"}?`}
        description={`This links the Microsoft Entra identity imported for ${
          linkTarget()?.email ?? "this directory user"
        } to the Mattrax account with the same email. That account must already be a member of this tenant.`}
        confirmLabel="Link SSO"
        pending={linkSso.isPending}
        error={linkSso.error}
        onConfirm={() => {
          const target = linkTarget();

          if (target) void linkSso.mutate(target);
        }}
      />
    </div>
  );
}

/** One line describing whether, and when, directory sync runs. */
const automaticSyncHint = (status: {
  enabled: boolean;
  syncIntervalMinutes: number;
  nextSyncAt?: string | null;
}) => {
  if (!status.enabled) return "Sync is paused. The schedule applies once it is enabled.";

  if (status.syncIntervalMinutes <= 0)
    return 'Manual only. Use "Sync now" when you need a fresh import.';

  return status.nextSyncAt
    ? `Next automatic run ${formatDate(status.nextSyncAt)}.`
    : "Runs on the next scheduled sweep.";
};
