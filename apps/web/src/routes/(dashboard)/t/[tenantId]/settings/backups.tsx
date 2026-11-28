import { useParams } from "@solidjs/router";
import type { RoutePreloadFuncArgs } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { Schema } from "effect";
import { TenantExportEnvelope } from "@mattrax/enterprise-domain/client";
import { createSignal, Show } from "solid-js";
import { ErrorText, Panel, QueryError } from "~/components/mdm/common";
import { Button } from "@mattrax/ui";
import ConfirmDialog from "~/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@mattrax/ui";
import { Input } from "@mattrax/ui";
import { useTenantProfileDraft } from "~/components/settings/tenant-profile-draft";
import StatusChip from "~/components/settings/status-chip";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";
import type { BackupRunInfo } from "~/lib/enterprise";
import {
  optimisticallyRemoveCollectionItems,
  optimisticallyUpdateCollection,
} from "~/lib/optimistic";
import { preloadSettingsPage } from "~/components/settings/preload";
import { queryClient } from "~/lib/query-client";
import { ReadOnlyNotice, useCan } from "~/lib/permissions";
import { downloadBlob } from "~/lib/download";
import { responseFailure } from "~/components/settings/http-failure";

export const route = {
  preload: (args: RoutePreloadFuncArgs) =>
    preloadSettingsPage(args, [
      {
        permission: "backups.read",
        load: async () => {
          await queryClient.ensureQueryData(enterpriseQueries.backups(args.params.tenantId));
        },
      },
    ]),
};

export default function BackupsSettingsPage() {
  const params = useParams();
  const qc = useQueryClient();
  const { can } = useCan();
  const { tenant } = useTenantProfileDraft();
  const canRead = () => can("backups.read");
  const canWrite = () => can("backups.write");

  // Backups are an operational admin surface. Skip the request entirely for
  // roles that cannot read it instead of retrying a 403 on every visit.
  const backups = useQuery(() => ({
    ...enterpriseQueries.backups(params.tenantId),
    enabled: canRead(),
    retry: false,
  }));

  const [backupDownloadError, setBackupDownloadError] = createSignal<unknown>(null);
  const [backupActionError, setBackupActionError] = createSignal<unknown>(null);

  const backupNow = useMutation(() => ({
    mutationFn: () => enterprise.runTenantBackup(params.tenantId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: enterpriseKeys.backups(params.tenantId) });
    },
  }));

  const refetchBackups = () =>
    qc.invalidateQueries({ queryKey: enterpriseKeys.backups(params.tenantId) });

  const [restoreTarget, setRestoreTarget] = createSignal<{ id: string; startedAt: string } | null>(
    null,
  );

  const [restoreConfirm, setRestoreConfirm] = createSignal("");

  const [restoreResult, setRestoreResult] = createSignal<{
    preRestoreBackupId: string;
    counts: {
      groups: number;
      policies: number;
      applications: number;
      preRegistrations: number;
      devices: number;
      deviceAssignments: number;
    };
    skipped: { deviceAssignments: number };
  } | null>(null);

  const [deleteBackupTarget, setDeleteBackupTarget] = createSignal<{
    id: string;
    startedAt: string;
  } | null>(null);

  /**
   * Solid Query v6 calls `onMutate` without forwarding its return value to
   * `onError`, so a rollback closure has to live beside the mutation.
   * Keeping the promise preserves the helper's cancel-then-snapshot order.
   */
  let pendingPinRestore: Promise<() => void> | undefined;

  const pinBackup = useMutation(() => ({
    // The failure renders inline beside the table, so the global toast would
    // repeat the same message.
    meta: { inlineError: true },
    mutationFn: (run: { id: string; retention: string }) =>
      run.retention === "pinned"
        ? enterprise.unpinTenantBackup(params.tenantId, run.id)
        : enterprise.pinTenantBackup(params.tenantId, run.id),
    onMutate: (run) => {
      const pinned = run.retention !== "pinned";
      setBackupActionError(null);
      pendingPinRestore = optimisticallyUpdateCollection(
        qc,
        enterpriseKeys.backups(params.tenantId),
        "backups",
        (rows: BackupRunInfo[]) =>
          rows.map((row): BackupRunInfo =>
            row.id === run.id ? { ...row, retention: pinned ? "pinned" : "default" } : row,
          ),
      );
    },
    onSuccess: () => {
      pendingPinRestore = undefined;
      void refetchBackups();
    },
    onError: (error) => {
      const restore = pendingPinRestore;
      pendingPinRestore = undefined;
      void restore?.then((revert) => revert());
      setBackupActionError(error);
    },
  }));

  const removeBackup = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: (id: string) => enterprise.deleteTenantBackup(params.tenantId, id),
    onMutate: async (id) => {
      setBackupActionError(null);

      return optimisticallyRemoveCollectionItems(
        qc,
        enterpriseKeys.backups(params.tenantId),
        "backups",
        [id],
      );
    },
    onSuccess: () => {
      setDeleteBackupTarget(null);
      void refetchBackups();
    },
    onError: (error, _variables, restore) => {
      restore?.();
      setBackupActionError(error);
    },
  }));

  const restoreBackup = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: (input: { id: string; confirm: string }) =>
      enterprise.restoreTenantBackup(params.tenantId, input.id, input.confirm),
    onMutate: () => setBackupActionError(null),
    onSuccess: async (result) => {
      setRestoreResult({
        preRestoreBackupId: result.preRestoreBackupId,
        counts: result.counts,
        skipped: { deviceAssignments: result.skipped.deviceAssignments },
      });
      await Promise.all([
        refetchBackups(),
        qc.invalidateQueries({ queryKey: enterpriseKeys.tenant(params.tenantId) }),
      ]);
    },
    onError: setBackupActionError,
  }));

  // Plain functions, not memos: a memo created in the component body would
  // eagerly read the query's pending async value and suspend the whole page.
  const latestBackup = () => backups.data?.backups?.[0];

  const backupWarning = () => {
    const latest = latestBackup();

    if (!latest) return "No backup has run yet.";

    if (latest.status === "failed")
      return "The most recent backup failed. Retry it or check the error below.";

    if (latest.status === "running") return "A backup is currently running.";
    const age = Date.now() - new Date(latest.startedAt).getTime();

    if (Number.isFinite(age) && age > 48 * 60 * 60 * 1000)
      return "The most recent successful backup is more than two days old.";

    return null;
  };

  const formatBackupSize = (bytes: number | null | undefined) => {
    if (bytes == null) return "—";

    if (bytes < 1024) return `${bytes} B`;

    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;

    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const downloadBackup = async (id: string) => {
    setBackupDownloadError(null);

    try {
      const response = await enterprise.downloadTenantBackup(params.tenantId, id);

      if (!response.ok)
        throw await responseFailure(response, "Download failed (" + response.status + ")");
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filename =
        /filename="([^"]+)"/.exec(disposition)?.[1] ??
        "tenant-" + (tenant.data?.slug ?? params.tenantId ?? "backup") + "-backup.json";

      const body = await response.text();
      Schema.decodeUnknownSync(TenantExportEnvelope)(JSON.parse(body));
      downloadBlob(new Blob([body], { type: "application/json" }), filename);
    } catch (error) {
      setBackupDownloadError(error);
    }
  };

  const exportBase = () => `/t/${params.tenantId}/settings/migration/export`;

  return (
    <div class="grid gap-5">
      <Show
        when={canRead()}
        fallback={
          <ReadOnlyNotice>
            Your role cannot view tenant backups. Ask a tenant owner if you need the backup history
            or restore controls.
          </ReadOnlyNotice>
        }
      >
        <QueryError error={backups.error} onRetry={() => void backups.refetch()} />

        <Panel
          title="Automatic tenant backups"
          description="A JSON bundle is written to private object storage every day and after manual runs. Bundles use the same shape as the tenant export: credentials, private keys, token hashes and object bytes are never included."
        >
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0 max-w-2xl">
              <p class="text-xs leading-relaxed text-muted-foreground">
                Downloads are authenticated and go through the API; the object store is never
                public. Restore replaces this tenant's groups, policies, applications and
                pre-registrations in place, keeps its members, devices and certificates, and takes a
                pinned snapshot first.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => backupNow.mutate()}
              disabled={!canWrite() || backupNow.isPending}
            >
              {backupNow.isPending ? "Backing up…" : "Back up now"}
            </Button>
          </div>

          <Show when={!canWrite()}>
            <ReadOnlyNotice class="mt-3">
              Your role can view and download backups but cannot run, restore, pin or delete them.
            </ReadOnlyNotice>
          </Show>

          <Show when={backups.isError || backupNow.isError}>
            <ErrorText error={backups.error ?? backupNow.error} />
          </Show>
          <Show when={backupDownloadError()}>{(error) => <ErrorText error={error()} />}</Show>

          <Show when={latestBackup()}>
            {(latest) => (
              <div class="mt-4 rounded-lg border border-border bg-surface p-3 text-xs">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <span class="text-muted-foreground">
                    Last backup:{" "}
                    <span class="font-medium text-foreground">
                      {latest().status === "succeeded" ? "Succeeded" : latest().status}
                    </span>{" "}
                    <span>{new Date(latest().startedAt).toLocaleString()}</span>
                  </span>
                  <Show when={latest().status === "succeeded"}>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void downloadBackup(latest().id)}
                    >
                      Download
                    </Button>
                  </Show>
                </div>
                <Show when={latest().error}>
                  <p class="mt-1 text-xs text-destructive">{latest().error}</p>
                </Show>
              </div>
            )}
          </Show>

          <Show when={backupWarning()}>
            {(warning) => (
              <p
                role="status"
                class={
                  latestBackup()?.status === "failed"
                    ? "mt-3 rounded-lg border border-destructive/25 bg-destructive/[0.07] px-3 py-2 text-xs text-destructive"
                    : "mt-3 rounded-lg border border-warning/25 bg-warning/[0.07] px-3 py-2 text-xs text-warning-foreground"
                }
              >
                {warning()}
              </p>
            )}
          </Show>

          <Show when={(backups.data?.backups ?? []).length > 0}>
            <div class="mt-4 overflow-x-auto rounded-lg border border-border">
              <table class="w-full min-w-136 text-left text-xs">
                <thead class="border-b border-border bg-surface text-xs uppercase tracking-widest text-muted-foreground">
                  <tr>
                    <th class="px-3 py-2 font-medium">Started</th>
                    <th class="px-3 py-2 font-medium">Trigger</th>
                    <th class="px-3 py-2 font-medium">Status</th>
                    <th class="px-3 py-2 font-medium">Size</th>
                    <th class="px-3 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody class="divide-y divide-border">
                  {(backups.data?.backups ?? []).slice(0, 8).map((run) => (
                    <tr class="transition-colors duration-150 ease-swift hover:bg-surface">
                      <td class="whitespace-nowrap px-3 py-2 text-muted-foreground">
                        {new Date(run.startedAt).toLocaleString()}
                      </td>
                      <td class="px-3 py-2 capitalize text-muted-foreground">{run.trigger}</td>
                      <td class="px-3 py-2">
                        <StatusChip
                          tone={
                            run.status === "succeeded"
                              ? "success"
                              : run.status === "failed"
                                ? "danger"
                                : "warning"
                          }
                          capitalize
                        >
                          {run.status}
                        </StatusChip>
                        <Show when={run.retention === "pinned"}>
                          <span class="ml-1 text-xs font-medium text-warning-foreground">
                            pinned
                          </span>
                        </Show>
                        <Show when={run.error}>
                          <span class="ml-1 text-xs text-destructive" title={run.error ?? ""}>
                            ({run.error?.slice(0, 60)})
                          </span>
                        </Show>
                      </td>
                      <td class="px-3 py-2 text-muted-foreground">
                        {formatBackupSize(run.sizeBytes)}
                      </td>
                      <td class="px-3 py-2 text-right">
                        <div class="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
                          <Show when={run.status === "succeeded"}>
                            <Button
                              type="button"
                              variant="link"
                              size="xs"
                              onClick={() => void downloadBackup(run.id)}
                            >
                              Download
                            </Button>
                            <Button
                              type="button"
                              variant="link"
                              size="xs"
                              disabled={!canWrite()}
                              onClick={() => {
                                setBackupActionError(null);
                                setRestoreResult(null);
                                setRestoreConfirm("");
                                setRestoreTarget({ id: run.id, startedAt: run.startedAt });
                              }}
                            >
                              Restore
                            </Button>
                          </Show>
                          <Show when={run.status !== "running"}>
                            <Button
                              type="button"
                              variant="link"
                              size="xs"
                              disabled={!canWrite()}
                              onClick={() => pinBackup.mutate(run)}
                            >
                              {run.retention === "pinned" ? "Unpin" : "Pin"}
                            </Button>
                            <Button
                              type="button"
                              variant="link"
                              size="xs"
                              disabled={!canWrite()}
                              onClick={() =>
                                setDeleteBackupTarget({ id: run.id, startedAt: run.startedAt })
                              }
                            >
                              <span class="text-destructive">Delete</span>
                            </Button>
                          </Show>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Show>

          <ErrorText error={backupActionError()} />

          <p class="mt-3 text-xs leading-relaxed text-muted-foreground">
            Runs older than the configured retention window are deleted automatically. Pin a run to
            keep it until you unpin it. To restore into a separate tenant instead,{" "}
            <a
              class="text-foreground underline decoration-border underline-offset-2 transition-colors duration-150 ease-swift hover:decoration-foreground"
              href={`${exportBase()}#restore`}
            >
              import a bundle from Migration
            </a>
            .
          </p>
        </Panel>

        <Dialog
          open={restoreTarget() !== null}
          onOpenChange={(open) => {
            if (!open) {
              setRestoreTarget(null);
              setRestoreResult(null);
              setRestoreConfirm("");
              setBackupActionError(null);
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Restore this backup?</DialogTitle>
              <DialogDescription>
                {restoreTarget()
                  ? `Backup from ${new Date(restoreTarget()!.startedAt).toLocaleString()} replaces this tenant's groups, policies, applications and pre-registrations. Members, devices, certificates and audit history are kept, and a pinned snapshot is taken before anything changes.`
                  : ""}
              </DialogDescription>
            </DialogHeader>
            <Show
              when={restoreResult()}
              fallback={
                <>
                  <p class="text-xs leading-relaxed text-muted-foreground">
                    Type the tenant slug{" "}
                    <span class="font-mono font-medium">
                      {tenant.data?.slug ?? params.tenantId}
                    </span>{" "}
                    to confirm.
                  </p>
                  <Input
                    value={restoreConfirm()}
                    onInput={(e) => setRestoreConfirm(e.currentTarget.value)}
                    placeholder={tenant.data?.slug}
                  />
                  <ErrorText error={backupActionError()} />
                </>
              }
            >
              {(result) => (
                <div class="space-y-2 rounded-lg border border-success/25 bg-success/[0.07] p-3 text-sm">
                  <p class="font-medium text-success">Backup restored</p>
                  <p class="text-muted-foreground">
                    {result().counts.groups} groups, {result().counts.policies} policies,{" "}
                    {result().counts.applications} applications, {result().counts.preRegistrations}{" "}
                    pre-registrations, {result().counts.devices} group device assignments and{" "}
                    {result().counts.deviceAssignments} direct device assignments.
                  </p>
                  <Show when={result().skipped.deviceAssignments > 0}>
                    <p class="text-xs text-muted-foreground">
                      {result().skipped.deviceAssignments} direct device assignment
                      {result().skipped.deviceAssignments === 1 ? "" : "s"} referenced a device that
                      no longer exists and were skipped.
                    </p>
                  </Show>
                  <p class="text-xs text-muted-foreground">
                    A pinned pre-restore snapshot was saved as{" "}
                    <code>{result().preRestoreBackupId}</code>. Restore it if this was the wrong
                    backup.
                  </p>
                </div>
              )}
            </Show>
            <DialogFooter>
              <Show
                when={restoreResult()}
                fallback={
                  <>
                    <Button variant="outline" onClick={() => setRestoreTarget(null)}>
                      Cancel
                    </Button>
                    <Button
                      disabled={
                        !restoreTarget() ||
                        restoreConfirm() !== (tenant.data?.slug ?? params.tenantId) ||
                        restoreBackup.isPending ||
                        !canWrite()
                      }
                      onClick={() => {
                        const target = restoreTarget();

                        if (!target) return;

                        restoreBackup.mutate({ id: target.id, confirm: restoreConfirm() });
                      }}
                    >
                      {restoreBackup.isPending ? "Restoring…" : "Restore backup"}
                    </Button>
                  </>
                }
              >
                <Button onClick={() => setRestoreTarget(null)}>Close</Button>
              </Show>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <ConfirmDialog
          open={deleteBackupTarget() !== null}
          onOpenChange={(open) => {
            if (!open) setDeleteBackupTarget(null);
          }}
          title="Delete this backup?"
          description={
            deleteBackupTarget()
              ? `The backup from ${new Date(deleteBackupTarget()!.startedAt).toLocaleString()} and its stored object are removed permanently.`
              : ""
          }
          confirmLabel="Delete backup"
          destructive
          pending={removeBackup.isPending}
          onConfirm={() => {
            const target = deleteBackupTarget();

            if (target) removeBackup.mutate(target.id);
          }}
        />
      </Show>
    </div>
  );
}
