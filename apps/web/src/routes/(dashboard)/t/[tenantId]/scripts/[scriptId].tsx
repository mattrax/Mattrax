import { type RoutePreloadFuncArgs, useParams } from "@solidjs/router";
import { useNavigate } from "~/lib/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { scriptTriggerLabel } from "@mattrax/enterprise-domain/client";
import {
  DataTable,
  ErrorText,
  Page,
  PageHeader,
  Panel,
  QueryError,
  formatDate,
  relativeTime,
} from "~/components/mdm/common";
import { ScriptEditor, type ScriptDraftValues } from "~/components/mdm/script-editor";
import { toast } from "~/components/toast";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { ChevronDown } from "~/components/ui/icons";
import {
  enterprise,
  enterpriseKeys,
  enterpriseQueries,
  type ScriptExecutionInfo,
} from "~/lib/enterprise";
import { preloadPage } from "~/lib/page-data";
import { ReadOnlyNotice, AccessDenied, useCan } from "~/lib/permissions";
import { queryClient } from "~/lib/query-client";
import { downloadBlob } from "~/lib/download";

export const route = {
  preload: ({ params, intent }: RoutePreloadFuncArgs) => {
    if (intent === "initial") return;

    return preloadPage([
      () => queryClient.ensureQueryData(enterpriseQueries.script(params.tenantId, params.scriptId)),
      () =>
        queryClient.ensureQueryData(
          enterpriseQueries.scriptAssignments(params.tenantId, params.scriptId),
        ),
    ]);
  },
};

const statusTone = (status: string) => {
  switch (status) {
    case "succeeded":
      return "border-success/30 text-success-foreground";
    case "failed":
      return "border-destructive/30 text-destructive";
    case "expired":
      return "border-warning/30 text-warning-foreground";
    default:
      return "border-border text-muted-foreground";
  }
};

const outputFor = (run: ScriptExecutionInfo) =>
  [
    `# ${run.scriptName} on ${run.deviceName}`,
    `# status: ${run.status}  exit: ${run.exitCode ?? "—"}  duration: ${run.durationMs ?? "—"}ms`,
    `# ${run.createdAt}`,
    "",
    "## stdout",
    run.stdout || "(empty)",
    "",
    "## stderr",
    run.stderr || "(empty)",
    run.detail ? `\n## detail\n${run.detail}` : "",
  ].join("\n");

const downloadText = (filename: string, text: string) =>
  downloadBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), filename);

export default function ScriptDetailPage() {
  const params = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useCan();
  const writable = () => can("scripts.write");

  const script = useQuery(() => enterpriseQueries.script(params.tenantId, params.scriptId));

  const assignments = useQuery(() =>
    enterpriseQueries.scriptAssignments(params.tenantId, params.scriptId),
  );

  const [deviceFilter, setDeviceFilter] = createSignal("");

  const executions = useQuery(() =>
    enterpriseQueries.scriptExecutions(
      params.tenantId,
      params.scriptId,
      deviceFilter() || undefined,
    ),
  );

  const groups = useQuery(() => ({
    queryKey: enterpriseKeys.list(params.tenantId, "group"),
    queryFn: () => enterprise.list(params.tenantId, "group"),
  }));

  const devices = useQuery(() => ({
    queryKey: enterpriseKeys.list(params.tenantId, "device"),
    queryFn: () => enterprise.list(params.tenantId, "device"),
  }));

  const [groupIds, setGroupIds] = createSignal<Set<string>>(new Set());
  const [selectedDeviceIds, setSelectedDeviceIds] = createSignal<Set<string>>(new Set());
  const [message, setMessage] = createSignal<string | null>(null);
  const [confirmDelete, setConfirmDelete] = createSignal(false);

  createEffect(
    () => assignments.data,
    (data) => {
      setGroupIds(new Set(data?.groups.map((group) => group.id) ?? []));
      setSelectedDeviceIds(new Set(data?.devices.map((device) => device.id) ?? []));
    },
  );

  const draft = createMemo<ScriptDraftValues | undefined>(() => {
    const value = script.data;

    if (!value) return undefined;

    return {
      name: value.script.name,
      description: value.script.description ?? "",
      language: value.script.language,
      body: value.body,
      runAs: value.script.runAs,
      timeoutSeconds: value.script.timeoutSeconds,
      environment: [...value.script.environment],
      trigger: value.script.trigger,
    };
  });

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: enterpriseKeys.script(params.tenantId, params.scriptId) }),
      qc.invalidateQueries({
        queryKey: enterpriseKeys.scriptAssignments(params.tenantId, params.scriptId),
      }),
      qc.invalidateQueries({ queryKey: enterpriseKeys.scripts(params.tenantId) }),
      qc.invalidateQueries({
        queryKey: enterpriseKeys.scriptExecutions(params.tenantId, params.scriptId, undefined),
      }),
    ]);
  };

  const save = useMutation(() => ({
    mutationFn: (values: ScriptDraftValues) =>
      enterprise.patchScript(params.tenantId, params.scriptId, {
        ...values,
        description: values.description || null,
        environment: values.environment.filter((entry) => entry.name.trim()),
      }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Script saved");
    },
  }));

  const saveAssignments = useMutation(() => ({
    mutationFn: () => {
      const current = assignments.data ?? { devices: [], groups: [] };
      const currentGroups = new Set(current.groups.map((group) => group.id));
      const currentDevices = new Set(current.devices.map((device) => device.id));
      const nextGroups = groupIds();
      const nextDevices = selectedDeviceIds();

      return enterprise.patchScriptAssignments(params.tenantId, params.scriptId, {
        assign: {
          groups: [...nextGroups].filter((id) => !currentGroups.has(id)),
          devices: [...nextDevices].filter((id) => !currentDevices.has(id)),
        },
        unassign: {
          groups: [...currentGroups].filter((id) => !nextGroups.has(id)),
          devices: [...currentDevices].filter((id) => !nextDevices.has(id)),
        },
      });
    },
    onSuccess: async () => {
      await invalidate();
      toast.success("Assignments saved", {
        description: "Devices receive the profile on their next check-in.",
      });
    },
    onError: (error) => toast.error("Could not save assignments", { description: String(error) }),
  }));

  const run = useMutation(() => ({
    mutationFn: () => enterprise.runScript(params.tenantId, params.scriptId, {}),
    onSuccess: async (result) => {
      const skipped = result.targets.filter((target) => target.skippedReason);
      setMessage(
        `Queued ${result.queued} run${result.queued === 1 ? "" : "s"}${
          result.skipped > 0 ? `, skipped ${result.skipped}` : ""
        }.`,
      );

      if (skipped.length > 0)
        toast.warning("Some devices were skipped", {
          description: skipped
            .map((target) => `${target.deviceName}: ${target.skippedReason}`)
            .join("; "),
        });
      else
        toast.success("Run queued", { description: "Devices collect it on their next check-in." });
      await invalidate();
    },
    onError: (error) => toast.error("Could not queue the run", { description: String(error) }),
  }));

  const remove = useMutation(() => ({
    mutationFn: () => enterprise.deleteScript(params.tenantId, params.scriptId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: enterpriseKeys.scripts(params.tenantId) });
      toast.success("Script deleted");
      navigate(`/t/${params.tenantId}/scripts`);
    },
  }));

  const runs = () => [...(executions.data?.executions ?? [])];
  const assignedDevices = () => assignments.data?.devices ?? [];

  const runColumns = [
    {
      header: "Device",
      cell: (row: ScriptExecutionInfo) => (
        <span class="font-medium text-foreground">{row.deviceName}</span>
      ),
    },
    {
      header: "Trigger",
      cell: (row: ScriptExecutionInfo) => (
        <span class="text-muted-foreground">{scriptTriggerLabel(row.trigger)}</span>
      ),
    },
    {
      header: "Status",
      cell: (row: ScriptExecutionInfo) => (
        <Badge variant="outline" class={statusTone(row.status)}>
          {row.status}
        </Badge>
      ),
    },
    {
      header: "Exit",
      cell: (row: ScriptExecutionInfo) => (
        <span class="tabular-nums text-muted-foreground">{row.exitCode ?? "—"}</span>
      ),
    },
    {
      header: "Duration",
      cell: (row: ScriptExecutionInfo) => (
        <span class="tabular-nums text-muted-foreground">
          {row.durationMs === null || row.durationMs === undefined
            ? "—"
            : `${(row.durationMs / 1000).toFixed(1)}s`}
        </span>
      ),
    },
    {
      header: "When",
      cell: (row: ScriptExecutionInfo) => (
        <span class="text-muted-foreground" title={formatDate(row.createdAt)}>
          {relativeTime(row.createdAt)}
        </span>
      ),
    },
    {
      header: "Output",
      cell: (row: ScriptExecutionInfo) => (
        <details class="max-w-xl">
          <summary class="inline-flex cursor-pointer list-none items-center gap-1 text-[12px] text-muted-foreground transition-colors duration-[var(--duration-hover)] ease-swift hover:text-foreground">
            {row.stdout || row.stderr ? "View output" : "No output"}
            <ChevronDown class="disclosure-chevron size-3 shrink-0" />
          </summary>
          <div class="mt-2 space-y-2">
            <div class="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard.writeText(outputFor(row));
                  toast.success("Output copied");
                }}
              >
                Copy
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  downloadText(
                    `script-${row.scriptId}-${row.deviceId}-${row.id}.log`,
                    outputFor(row),
                  )
                }
              >
                Download
              </Button>
            </div>
            <Show when={row.stdoutTruncated || row.stderrTruncated}>
              <p class="text-[11.5px] text-muted-foreground">
                Output was capped at 64 KiB per stream before storage.
              </p>
            </Show>
            <pre class="max-h-80 overflow-auto rounded-md border border-border bg-surface p-3 font-mono text-[11.5px] leading-relaxed text-foreground">
              {outputFor(row)}
            </pre>
          </div>
        </details>
      ),
    },
  ];

  return (
    <Show when={can("scripts.read")} fallback={<AccessDenied />}>
      <Page>
        <Show
          when={script.data}
          fallback={
            <Show
              when={script.isError}
              fallback={
                <div class="h-64 animate-pulse rounded-lg border border-border bg-surface" />
              }
            >
              <QueryError error={script.error} onRetry={() => void script.refetch()} />
            </Show>
          }
        >
          {(detail) => (
            <>
              <PageHeader
                eyebrow="Scripts"
                title={detail().script.name}
                description={
                  detail().script.description ||
                  "Scripts execute arbitrary code on managed devices."
                }
                meta={
                  <>
                    <Badge variant="outline">
                      {scriptTriggerLabel(detail().script.trigger.type)}
                    </Badge>
                    <span class="font-mono text-[11.5px] text-muted-foreground">
                      {detail().script.language} · {detail().script.runAs}
                    </span>
                    <span class="text-muted-foreground">
                      {detail().script.assignedDeviceCount} device
                      {detail().script.assignedDeviceCount === 1 ? "" : "s"}
                    </span>
                  </>
                }
                actions={
                  <Show when={writable()}>
                    <div class="flex items-center gap-2">
                      <Button
                        disabled={run.isPending || !detail().script.enabled}
                        onClick={() => run.mutate()}
                      >
                        {run.isPending ? "Queueing…" : "Run on assigned devices"}
                      </Button>
                      <Button variant="outline" onClick={() => setConfirmDelete(true)}>
                        Delete
                      </Button>
                    </div>
                  </Show>
                }
              />

              <Show when={!writable()}>
                <ReadOnlyNotice />
              </Show>

              <Show when={message()}>
                <p role="status" class="text-[12.5px] text-muted-foreground">
                  {message()}
                </p>
              </Show>

              <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
                <div class="space-y-5">
                  <Panel title="Script" description="Changing the body re-delivers the profile.">
                    <Show
                      when={writable()}
                      fallback={
                        <pre class="overflow-auto rounded-md border border-border bg-surface p-3 font-mono text-[12px] leading-relaxed">
                          {detail().body}
                        </pre>
                      }
                    >
                      <ScriptEditor
                        identity={params.scriptId}
                        initial={draft()}
                        submitLabel="Save script"
                        saving={save.isPending}
                        error={save.error}
                        disabled={!detail().script.enabled}
                        onSubmit={(values) => save.mutate(values)}
                      />
                    </Show>
                  </Panel>

                  <Panel
                    title="Run history"
                    description="Output is redacted and capped before it is stored."
                    actions={
                      <select
                        class="h-8 rounded-md border border-input bg-transparent px-2 text-[12px] text-foreground"
                        value={deviceFilter()}
                        onChange={(event) => setDeviceFilter(event.currentTarget.value)}
                      >
                        <option value="">All devices</option>
                        <For each={assignedDevices()}>
                          {(device) => <option value={device.id}>{device.name}</option>}
                        </For>
                      </select>
                    }
                  >
                    <Show
                      when={executions.isSuccess}
                      fallback={<div class="h-32 animate-pulse rounded-md bg-surface" />}
                    >
                      <DataTable<ScriptExecutionInfo>
                        rows={runs()}
                        columns={runColumns}
                        caption="Script run history"
                        empty={
                          <p class="text-[12.5px] text-muted-foreground">
                            No runs yet. Run the script, or wait for its trigger to fire on a
                            device.
                          </p>
                        }
                      />
                    </Show>
                  </Panel>
                </div>

                <div class="space-y-5">
                  <Panel
                    title="Assignments"
                    description="A device receives the script when it matches any assignment."
                  >
                    <Show when={writable()} fallback={<AssignmentsReadOnly />}>
                      <div class="space-y-4">
                        <div>
                          <p class="mb-2 text-[12px] font-medium text-foreground">Groups</p>
                          <div class="max-h-52 space-y-1.5 overflow-y-auto">
                            <For each={groups.data?.rows ?? []}>
                              {(group) => (
                                <label class="flex cursor-pointer items-center gap-2 text-[12.5px]">
                                  <input
                                    type="checkbox"
                                    checked={groupIds().has(group.id)}
                                    onChange={(event) =>
                                      setGroupIds((current) => {
                                        const next = new Set(current);

                                        if (event.currentTarget.checked) next.add(group.id);
                                        else next.delete(group.id);

                                        return next;
                                      })
                                    }
                                  />
                                  <span class="truncate">{group.name}</span>
                                </label>
                              )}
                            </For>
                          </div>
                        </div>
                        <div>
                          <p class="mb-2 text-[12px] font-medium text-foreground">Devices</p>
                          <div class="max-h-60 space-y-1.5 overflow-y-auto">
                            <For each={devices.data?.rows ?? []}>
                              {(device) => (
                                <label class="flex cursor-pointer items-center gap-2 text-[12.5px]">
                                  <input
                                    type="checkbox"
                                    checked={selectedDeviceIds().has(device.id)}
                                    onChange={(event) =>
                                      setSelectedDeviceIds((current) => {
                                        const next = new Set(current);

                                        if (event.currentTarget.checked) next.add(device.id);
                                        else next.delete(device.id);

                                        return next;
                                      })
                                    }
                                  />
                                  <span class="truncate">{device.name}</span>
                                </label>
                              )}
                            </For>
                          </div>
                        </div>
                        <Button
                          disabled={saveAssignments.isPending}
                          onClick={() => saveAssignments.mutate()}
                        >
                          {saveAssignments.isPending ? "Saving…" : "Save assignments"}
                        </Button>
                        <Show when={saveAssignments.error}>
                          <ErrorText error={saveAssignments.error} />
                        </Show>
                      </div>
                    </Show>
                  </Panel>

                  <Panel title="Delivery">
                    <dl class="space-y-2 text-[12px] leading-relaxed">
                      <div class="flex justify-between gap-3">
                        <dt class="text-muted-foreground">Apple</dt>
                        <dd class="text-right">Profile + mattraxd</dd>
                      </div>
                      <div class="flex justify-between gap-3">
                        <dt class="text-muted-foreground">Windows</dt>
                        <dd class="text-right">mattraxd</dd>
                      </div>
                      <div class="flex justify-between gap-3">
                        <dt class="text-muted-foreground">Android</dt>
                        <dd class="text-right text-muted-foreground">Unsupported</dd>
                      </div>
                    </dl>
                    <p class="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
                      Manual runs expire after 24 hours if the device never collects them. Results
                      are retained for 30 days.
                    </p>
                  </Panel>

                  <Panel title="Details">
                    <dl class="space-y-2 text-[12px]">
                      <div class="flex justify-between gap-3">
                        <dt class="text-muted-foreground">Timeout</dt>
                        <dd class="tabular-nums">{detail().script.timeoutSeconds}s</dd>
                      </div>
                      <div class="flex justify-between gap-3">
                        <dt class="text-muted-foreground">Environment</dt>
                        <dd>{detail().script.environment.length} variable(s)</dd>
                      </div>
                      <div class="flex justify-between gap-3">
                        <dt class="text-muted-foreground">Created</dt>
                        <dd>{formatDate(detail().script.createdAt)}</dd>
                      </div>
                      <div class="flex justify-between gap-3">
                        <dt class="text-muted-foreground">Updated</dt>
                        <dd>{formatDate(detail().script.updatedAt)}</dd>
                      </div>
                    </dl>
                  </Panel>
                </div>
              </div>

              <ConfirmDialog
                open={confirmDelete()}
                onOpenChange={setConfirmDelete}
                title={`Delete ${detail().script.name}?`}
                description="The script, its assignments and its run history are removed. This cannot be undone."
                confirmLabel="Delete script"
                destructive
                pending={remove.isPending}
                onConfirm={() => remove.mutate()}
              />
            </>
          )}
        </Show>
      </Page>
    </Show>
  );
}

/** Assignment summary for read-only members. */
function AssignmentsReadOnly() {
  const params = useParams();

  const assignments = useQuery(() =>
    enterpriseQueries.scriptAssignments(params.tenantId, params.scriptId),
  );

  return (
    <Show
      when={(assignments.data?.groups.length ?? 0) + (assignments.data?.devices.length ?? 0) > 0}
      fallback={<p class="text-[12.5px] text-muted-foreground">Not assigned to any target.</p>}
    >
      <div class="space-y-3 text-[12.5px]">
        <div>
          <p class="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Groups</p>
          <p>{assignments.data?.groups.map((group) => group.name).join(", ") || "None"}</p>
        </div>
        <div>
          <p class="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Devices</p>
          <p>{assignments.data?.devices.map((device) => device.name).join(", ") || "None"}</p>
        </div>
      </div>
    </Show>
  );
}
