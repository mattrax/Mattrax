import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { Match, Schema } from "effect";
import { createMemo, createSignal, For, Show } from "solid-js";
import {
  DashboardReportFormat as ReportFormatSchema,
  DashboardReportFrequency as ReportFrequencySchema,
} from "@mattrax/enterprise-domain/client";
import type { JSX } from "@solidjs/web";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { ArrowUpRight, BookOpen, Download, Plus, X } from "~/components/ui/icons";
import { Panel, QueryError, relativeTime } from "~/components/mdm/common";
import { toast } from "~/components/toast";
import { downloadBlob } from "~/lib/download";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";
import type {
  DashboardReport,
  DashboardReportFormat,
  DashboardReportFrequency,
  DashboardReportRun,
} from "~/lib/enterprise";
import { errorMessage, raisedFailure } from "~/lib/errors";
import { useTenantPermissions } from "~/lib/permissions";
import { cn } from "~/lib/utils";

/**
 * Report settings for one dashboard.
 *
 * The dashboard *is* the report definition: every report attached here emails
 * the widgets above at its scheduled hour. Readers can download the current
 * dashboard; writers manage schedules; only built-in owners/admins may add an
 * external address (the API enforces the same rule).
 */
export function DashboardReportsPanel(props: { tenantId: string; dashboardId: string }) {
  const queryClient = useQueryClient();
  const permissions = useTenantPermissions();
  const writable = () => permissions.can("dashboards.write");

  const mayExternal = createMemo(() => {
    const role = permissions.role() ?? "";

    return (
      permissions.tenant()?.roleKind !== "custom" &&
      role
        .split(",")
        .map((value) => value.trim())
        .some((value) => value === "owner" || value === "admin")
    );
  });

  const reports = useQuery(() =>
    enterpriseQueries.dashboardReports(props.tenantId, props.dashboardId),
  );

  const accounts = useQuery(() => ({
    ...enterpriseQueries.accounts(props.tenantId),
    enabled: writable() && Boolean(props.tenantId),
  }));

  const [editorOpen, setEditorOpen] = createSignal(false);
  const [editing, setEditing] = createSignal<DashboardReport | null>(null);
  const [expanded, setExpanded] = createSignal<string | null>(null);
  const [removeTarget, setRemoveTarget] = createSignal<DashboardReport | null>(null);
  const [formError, setFormError] = createSignal<string | null>(null);
  const [downloadError, setDownloadError] = createSignal<unknown>(null);

  const [name, setName] = createSignal("");
  const [frequency, setFrequency] = createSignal<DashboardReportFrequency>("weekly");
  const [hour, setHour] = createSignal(8);
  const [format, setFormat] = createSignal<DashboardReportFormat>("csv");
  const [memberIds, setMemberIds] = createSignal<string[]>([]);
  const [emails, setEmails] = createSignal("");

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: enterpriseKeys.dashboardReports(props.tenantId, props.dashboardId),
    });
  };

  const openCreate = () => {
    setEditing(null);
    setName("");
    setFrequency("weekly");
    setHour(8);
    setFormat("csv");
    setMemberIds([]);
    setEmails("");
    setFormError(null);
    setEditorOpen(true);
  };

  const openEdit = (report: DashboardReport) => {
    setEditing(report);
    setName(report.name);
    setFrequency(report.frequency);
    setHour(report.hourUtc);
    setFormat(report.format);
    setMemberIds([...report.recipients.memberAccountIds]);
    setEmails(report.recipients.emails.join(", "));
    setFormError(null);
    setEditorOpen(true);
  };

  const toggleMember = (accountId: string) =>
    setMemberIds((current) =>
      current.includes(accountId)
        ? current.filter((value) => value !== accountId)
        : [...current, accountId],
    );

  const save = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: async () => {
      const title = name().trim();

      if (!title) throw new Error("Give the report a name first");

      const recipients = {
        memberAccountIds: memberIds(),
        // A member without the external-recipient right keeps whatever an
        // owner configured; the API only allows that exact list through.
        emails: mayExternal()
          ? emails()
              .split(/[\s,;]+/)
              .map((value) => value.trim())
              .filter(Boolean)
          : (editing()?.recipients.emails ?? []),
      };

      if (recipients.memberAccountIds.length + recipients.emails.length === 0)
        throw new Error("Choose at least one recipient");

      const existing = editing();

      if (existing)
        return enterprise.patchDashboardReport(props.tenantId, props.dashboardId, existing.id, {
          name: title,
          frequency: frequency(),
          hourUtc: hour(),
          format: format(),
          recipients,
        });

      return enterprise.createDashboardReport(props.tenantId, props.dashboardId, {
        name: title,
        frequency: frequency(),
        hourUtc: hour(),
        format: format(),
        recipients,
      });
    },
    onSuccess: () => {
      setEditorOpen(false);
      setFormError(null);
      invalidate();
      toast.success(editing() ? "Report updated" : "Report created");
    },
    onError: (cause) =>
      setFormError(errorMessage(raisedFailure(cause), "Could not save the report.")),
  }));

  const toggleEnabled = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: (report: DashboardReport) =>
      enterprise.patchDashboardReport(props.tenantId, props.dashboardId, report.id, {
        enabled: !report.enabled,
      }),
    onSuccess: () => invalidate(),
    onError: (cause) =>
      toast.error("Could not change the schedule", {
        description: errorMessage(raisedFailure(cause), "Try again in a moment."),
      }),
  }));

  const remove = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: (report: DashboardReport) =>
      enterprise.deleteDashboardReport(props.tenantId, props.dashboardId, report.id),
    onSuccess: () => {
      setRemoveTarget(null);
      invalidate();
      toast.success("Report deleted");
    },
    onError: (cause) => {
      setRemoveTarget(null);
      toast.error("Could not delete the report", {
        description: errorMessage(raisedFailure(cause), "Try again in a moment."),
      });
    },
  }));

  const send = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: (report: DashboardReport) =>
      enterprise.sendDashboardReport(props.tenantId, props.dashboardId, report.id),
    onSuccess: (run, report) => {
      setExpanded(report.id);
      invalidate();
      void queryClient.invalidateQueries({
        queryKey: enterpriseKeys.dashboardReportRuns(props.tenantId, props.dashboardId, report.id),
      });

      if (run.status === "failed")
        toast.error("The report could not be sent", {
          description: run.error ?? "Check that email is configured for this deployment.",
        });
      else toast.success("Report queued for delivery");
    },
    onError: (cause) =>
      toast.error("Could not send the report", {
        description: errorMessage(raisedFailure(cause), "Try again in a moment."),
      }),
  }));

  const download = async (wanted: DashboardReportFormat) => {
    setDownloadError(null);

    try {
      const bytes = await enterprise.downloadDashboardReport(
        props.tenantId,
        props.dashboardId,
        wanted,
      );

      const type = wanted === "pdf" ? "application/pdf" : "text/csv;charset=utf-8";
      const name = `${props.dashboardId}-${new Date().toISOString().slice(0, 10)}.${wanted}`;

      // SAFETY: the API returns the response bytes for this endpoint, and
      // Blob accepts a typed array as a buffer source.
      downloadBlob(new Blob([bytes as BlobPart], { type }), name);
    } catch (error) {
      setDownloadError(error);
    }
  };

  const scheduleLabel = (report: DashboardReport) =>
    `${Match.value(report.frequency).pipe(
      Match.when("daily", () => "Every day"),
      Match.when("weekly", () => "Every Monday"),
      Match.orElse(() => "1st of each month"),
    )} at ${String(report.hourUtc).padStart(2, "0")}:00 UTC`;

  return (
    <Panel
      title="Reports"
      description="Email this dashboard to people on a schedule, or download a snapshot now."
      actions={
        <>
          <Button size="sm" variant="outline" onClick={() => void download("csv")}>
            <Download class="size-3.5" />
            Download CSV
          </Button>
          <Button size="sm" variant="outline" onClick={() => void download("pdf")}>
            <BookOpen class="size-3.5" />
            Download PDF
          </Button>
          <Show when={writable()}>
            <Button size="sm" onClick={openCreate}>
              <Plus class="size-3.5" />
              New report
            </Button>
          </Show>
        </>
      }
    >
      <Show when={downloadError()}>
        <p role="alert" class="mb-2 text-[12px] text-destructive">
          {errorMessage(raisedFailure(downloadError()), "Could not download the dashboard.")}
        </p>
      </Show>

      <QueryError error={reports.error} onRetry={() => void reports.refetch()} />

      <Show
        when={(reports.data?.reports.length ?? 0) > 0}
        fallback={
          <div class="rounded-lg border border-dashed border-border bg-surface px-4 py-6 text-center">
            <ArrowUpRight class="mx-auto size-5 text-muted-foreground" />
            <p class="mt-2 text-[12.5px] font-medium">No scheduled reports</p>
            <p class="mt-1 text-[11.5px] text-muted-foreground">
              {writable()
                ? "Create one to email this dashboard on a daily, weekly or monthly schedule."
                : "Ask a dashboard administrator to schedule a report for this dashboard."}
            </p>
          </div>
        }
      >
        <ul class="divide-y divide-border">
          <For each={reports.data.reports}>
            {(report) => (
              <li class="py-3 first:pt-0 last:pb-0">
                <div class="flex flex-wrap items-start justify-between gap-2">
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <p class="truncate text-[12.5px] font-medium text-foreground">
                        {report.name}
                      </p>
                      <Badge variant={report.enabled ? "secondary" : "outline"}>
                        {report.enabled ? "Active" : "Paused"}
                      </Badge>
                      <span class="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {report.format}
                      </span>
                    </div>
                    <p class="mt-1 text-[11.5px] text-muted-foreground">
                      {scheduleLabel(report)} ·{" "}
                      {report.recipients.memberAccountIds.length + report.recipients.emails.length}{" "}
                      recipient
                      {report.recipients.memberAccountIds.length +
                        report.recipients.emails.length ===
                      1
                        ? ""
                        : "s"}
                      <Show when={report.nextRunAt}> · next {relativeTime(report.nextRunAt)}</Show>
                    </p>
                    <p class="mt-0.5 text-[10.5px] text-muted-foreground">
                      <Show when={report.lastRunAt} fallback="Not sent yet">
                        Last run {relativeTime(report.lastRunAt)}
                      </Show>
                    </p>
                  </div>
                  <div class="flex flex-wrap items-center gap-1">
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() =>
                        setExpanded((current) => (current === report.id ? null : report.id))
                      }
                    >
                      {expanded() === report.id ? "Hide history" : "History"}
                    </Button>
                    <Show when={writable()}>
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={send.isPending}
                        onClick={() => send.mutate(report)}
                      >
                        <ArrowUpRight class="size-3" />
                        {send.isPending ? "Sending…" : "Send now"}
                      </Button>
                      <Button size="xs" variant="ghost" onClick={() => openEdit(report)}>
                        Edit
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={toggleEnabled.isPending}
                        onClick={() => toggleEnabled.mutate(report)}
                      >
                        {report.enabled ? "Pause" : "Resume"}
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        class="text-muted-foreground hover:text-destructive"
                        aria-label={`Delete ${report.name}`}
                        onClick={() => setRemoveTarget(report)}
                      >
                        <X class="size-3" />
                      </Button>
                    </Show>
                  </div>
                </div>
                <Show when={expanded() === report.id}>
                  <ReportRuns
                    tenantId={props.tenantId}
                    dashboardId={props.dashboardId}
                    reportId={report.id}
                  />
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <Show when={removeTarget()}>
        {(target) => (
          <ConfirmDialog
            open={true}
            onOpenChange={(open) => {
              if (!open) setRemoveTarget(null);
            }}
            title={`Delete “${target().name}”?`}
            description="The schedule and its run history are removed. Emails already queued are still delivered."
            confirmLabel="Delete report"
            destructive
            pending={remove.isPending}
            onConfirm={() => remove.mutate(target())}
          />
        )}
      </Show>

      <Dialog open={editorOpen()} onOpenChange={setEditorOpen}>
        <DialogContent class="max-w-lg rounded-xl border border-border bg-card p-5">
          <DialogHeader>
            <DialogTitle>{editing() ? "Edit report" : "New report"}</DialogTitle>
            <DialogDescription>
              Every recipient gets this dashboard as a {format()} attachment.
            </DialogDescription>
          </DialogHeader>

          <div class="space-y-3">
            <label class="block">
              <span class="mb-1 block text-[11px] font-medium text-muted-foreground">Name</span>
              <Input
                class="h-8"
                value={name()}
                onInput={(event) => setName(event.currentTarget.value)}
                placeholder="Weekly fleet digest"
              />
            </label>

            <div class="grid gap-2 sm:grid-cols-2">
              <label>
                <span class="mb-1 block text-[11px] font-medium text-muted-foreground">
                  Schedule
                </span>
                <select
                  class="h-8 w-full rounded-md border border-input bg-background px-2 text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                  value={frequency()}
                  onChange={(event) => {
                    const value = event.currentTarget.value;

                    if (Schema.is(ReportFrequencySchema)(value)) setFrequency(value);
                  }}
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly (Monday)</option>
                  <option value="monthly">Monthly (1st)</option>
                </select>
              </label>
              <label>
                <span class="mb-1 block text-[11px] font-medium text-muted-foreground">
                  Hour (UTC)
                </span>
                <Input
                  class="h-8"
                  type="number"
                  min={0}
                  max={23}
                  value={hour()}
                  onInput={(event) => setHour(Number(event.currentTarget.value))}
                />
              </label>
            </div>

            <label class="block">
              <span class="mb-1 block text-[11px] font-medium text-muted-foreground">Format</span>
              <select
                class="h-8 w-full rounded-md border border-input bg-background px-2 text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                value={format()}
                onChange={(event) => {
                  const value = event.currentTarget.value;

                  if (Schema.is(ReportFormatSchema)(value)) setFormat(value);
                }}
              >
                <option value="csv">CSV (one section per widget)</option>
                <option value="pdf">PDF</option>
              </select>
            </label>

            <div>
              <span class="mb-1 block text-[11px] font-medium text-muted-foreground">
                Tenant members
              </span>
              <div class="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border bg-surface p-2">
                <Show
                  when={(accounts.data?.accounts.length ?? 0) > 0}
                  fallback={
                    <p class="px-1 py-1.5 text-[11.5px] text-muted-foreground">
                      No other members can be selected.
                    </p>
                  }
                >
                  <For each={accounts.data.accounts}>
                    {(account) => (
                      <label class="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-[12px] hover:bg-hover">
                        <input
                          type="checkbox"
                          class="size-3.5 accent-[var(--primary)]"
                          checked={memberIds().includes(account.accountId)}
                          onChange={() => toggleMember(account.accountId)}
                        />
                        <span class="min-w-0 flex-1 truncate">{account.name || account.email}</span>
                        <span class="truncate text-[10.5px] text-muted-foreground">
                          {account.email}
                        </span>
                      </label>
                    )}
                  </For>
                </Show>
              </div>
            </div>

            <Show when={mayExternal()}>
              <label class="block">
                <span class="mb-1 block text-[11px] font-medium text-muted-foreground">
                  External addresses
                </span>
                <Input
                  class="h-8"
                  value={emails()}
                  onInput={(event) => setEmails(event.currentTarget.value)}
                  placeholder="security@example.com, ops@example.com"
                />
                <span class="mt-1 block text-[10.5px] text-muted-foreground">
                  Comma-separated. Only owners and admins can add external recipients.
                </span>
              </label>
            </Show>

            <Show when={formError()}>
              <p role="alert" class="text-[12px] text-destructive">
                {formError()}
              </p>
            </Show>
          </div>

          <DialogFooter class="mt-4">
            <Button variant="outline" onClick={() => setEditorOpen(false)}>
              Cancel
            </Button>
            <Button disabled={save.isPending || !name().trim()} onClick={() => save.mutate()}>
              {save.isPending ? "Saving…" : editing() ? "Save report" : "Create report"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

function ReportRuns(props: {
  tenantId: string;
  dashboardId: string;
  reportId: string;
}): JSX.Element {
  const runs = useQuery(() =>
    enterpriseQueries.dashboardReportRuns(props.tenantId, props.dashboardId, props.reportId),
  );

  const label = (run: DashboardReportRun) => {
    switch (run.status) {
      case "queued":
        return "Queued";
      case "sending":
        return "Sending";
      case "failed":
        return "Failed";
      default:
        return "Pending";
    }
  };

  return (
    <div class="mt-2 rounded-lg border border-border bg-surface p-2.5">
      <QueryError error={runs.error} onRetry={() => void runs.refetch()} />
      <Show
        when={(runs.data?.runs.length ?? 0) > 0}
        fallback={<p class="text-[11.5px] text-muted-foreground">No runs recorded yet.</p>}
      >
        <ul class="space-y-1.5">
          <For each={runs.data.runs}>
            {(run) => (
              <li class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11.5px]">
                <span
                  class={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                    Match.value(run.status).pipe(
                      Match.when("failed", () => "bg-destructive/10 text-destructive"),
                      Match.when("queued", () => "bg-success/10 text-success"),
                      Match.orElse(() => "bg-hover text-muted-foreground"),
                    ),
                  )}
                >
                  {label(run)}
                </span>
                <span class="font-mono text-[10.5px] text-muted-foreground">{run.period}</span>
                <span class="text-muted-foreground">
                  {run.attempts} attempt{run.attempts === 1 ? "" : "s"}
                  {run.recipients.length > 0 ? ` · ${run.recipients.length} recipients` : ""}
                  {run.sizeBytes > 0 ? ` · ${formatBytes(run.sizeBytes)}` : ""}
                </span>
                <span class="ml-auto text-muted-foreground">{relativeTime(run.createdAt)}</span>
                <Show when={run.error}>
                  <span class="w-full text-[11px] text-destructive">{run.error}</span>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;

  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
