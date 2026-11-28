import { useParams } from "@solidjs/router";
import type { RoutePreloadFuncArgs } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createSignal, For, Show } from "solid-js";
import { useNavigate } from "~/lib/navigation";
import { downloadBlob } from "~/lib/download";
import {
  DataTable,
  EmptyState,
  Field,
  Page,
  PageBreadcrumbs,
  PageHeader,
  Panel,
  QueryError,
  StatCard,
  formatDate,
  relativeTime,
} from "~/components/mdm/common";
import { Checkbox, Progress } from "@mattrax/ui";
import { Badge } from "@mattrax/ui";
import { Button } from "@mattrax/ui";
import ConfirmDialog from "~/components/ui/confirm-dialog";
import { Input } from "@mattrax/ui";
import { toast } from "~/components/toast";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";
import type { FleetMigrationDetail, FleetMigrationEntry } from "~/lib/enterprise";
import { preloadPage } from "~/lib/page-data";
import { AccessDenied, useCan } from "~/lib/permissions";
import { queryClient } from "~/lib/query-client";
import { resolveTenantId } from "~/lib/tenant";
import { routes } from "~/lib/routes";

export const route = {
  preload: ({ params, intent }: RoutePreloadFuncArgs) => {
    if (intent === "initial") return;

    return preloadPage([
      () =>
        queryClient.ensureQueryData(
          enterpriseQueries.fleetMigration(params.tenantId, params.migrationId),
        ),
    ]);
  },
};

const statusTone = (status: string) => {
  switch (status) {
    case "confirmed":
      return "success" as const;
    case "enrolled":
      return "brand" as const;
    case "awaiting-enrolment":
      return "info" as const;
    case "stuck":
      return "destructive" as const;
    default:
      return "outline" as const;
  }
};

const PLATFORM_LABELS = {
  apple: "Apple",
  win: "Windows",
  android: "Android",
} as const;

const SOURCE_LABELS = {
  jamf: "Jamf Pro",
  intune: "Microsoft Intune",
  kandji: "Kandji",
  other: "another MDM",
} as const;

const UNENROL_LABELS = {
  apple: "macOS unenrol",
  win: "Windows unenrol",
  android: "Android unenrol",
} as const;

const statusLabel = (status: string) => {
  switch (status) {
    case "unenrol-issued":
      return "Unenrol issued";
    case "awaiting-enrolment":
      return "Awaiting enrolment";
    default:
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
};

export default function MigrationDetailPage(props: { embedded?: boolean } = {}) {
  const params = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useCan();
  const writable = () => can("devices.write");

  const migrationId = () => params.migrationId ?? "";

  const detail = useQuery(() => enterpriseQueries.fleetMigration(params.tenantId, migrationId()));

  const [confirmSoleCopy, setConfirmSoleCopy] = createSignal(false);
  const [batchLimit, setBatchLimit] = createSignal(10);
  const [confirmDelete, setConfirmDelete] = createSignal(false);

  const invalidate = () =>
    void qc.invalidateQueries({
      queryKey: enterpriseKeys.fleetMigration(params.tenantId, migrationId()),
    });

  const issue = useMutation(() => ({
    mutationFn: (entryIds?: string[]) =>
      enterprise.issueFleetMigrationUnenrol(params.tenantId, migrationId(), {
        entryIds,
        limit: entryIds ? entryIds.length : batchLimit(),
        confirmSoleCopy: confirmSoleCopy(),
      }),
    onSuccess: (result) => {
      if (result.skipped > 0)
        toast.warning("Some devices were skipped", {
          description: result.results.find((row) => row.skippedReason)?.skippedReason ?? undefined,
        });
      else
        toast.success("Unenrol issued to " + result.issued + " device(s)", {
          description:
            result.remaining > 0
              ? result.remaining + " still waiting for a handoff."
              : "Every device has a handoff.",
        });
      invalidate();
    },
    onError: (error) => toast.error("Could not issue the unenrol", { description: String(error) }),
  }));

  const markUnenrolled = useMutation(() => ({
    mutationFn: (entry: FleetMigrationEntry) =>
      enterprise.markFleetMigrationUnenrolled(params.tenantId, migrationId(), entry.id),
    onSuccess: () => {
      toast.success("Marked as unenrolled");
      invalidate();
    },
    onError: (error) => toast.error("Could not update the device", { description: String(error) }),
  }));

  const confirmEntry = useMutation(() => ({
    mutationFn: (entry: FleetMigrationEntry) =>
      enterprise.confirmFleetMigrationEntry(params.tenantId, migrationId(), entry.id),
    onSuccess: () => {
      toast.success("Migration confirmed");
      invalidate();
    },
    onError: (error) => toast.error("Could not confirm the device", { description: String(error) }),
  }));

  const remove = useMutation(() => ({
    mutationFn: () => enterprise.deleteFleetMigration(params.tenantId, migrationId()),
    onSuccess: () => {
      setConfirmDelete(false);
      void qc.invalidateQueries({ queryKey: enterpriseKeys.fleetMigrations(params.tenantId) });
      navigate(
        props.embedded
          ? routes.tenant(params.tenantId).settingsMigration()
          : routes.tenant(params.tenantId).migrations(),
      );
    },
    onError: (error) => toast.error("Could not delete the cohort", { description: String(error) }),
  }));

  const exportCohort = async (format: "csv" | "json") => {
    try {
      const tenant = resolveTenantId(params.tenantId) ?? params.tenantId ?? "";

      const response = await enterprise.request(
        "/api/v1/tenants/" +
          encodeURIComponent(tenant) +
          "/migrations/" +
          encodeURIComponent(migrationId()) +
          "/export?format=" +
          format,
      );

      if (!response.ok) throw new Error("Export failed (" + response.status + ")");

      const body = await response.text();

      downloadBlob(
        new Blob([body], {
          type: format === "json" ? "application/json;charset=utf-8" : "text/csv;charset=utf-8",
        }),
        "migration-" + migrationId() + "." + format,
      );
    } catch (error) {
      toast.error("Could not export the cohort", { description: String(error) });
    }
  };

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(label + " copied");
    } catch {
      toast.error("Could not copy to the clipboard");
    }
  };

  const counts = () => detail.data?.migration.counts;

  const columns = [
    {
      header: "Serial",
      cell: (row: FleetMigrationEntry) => (
        <span class="font-mono text-xs text-foreground">{row.serial}</span>
      ),
    },
    {
      header: "Platform",
      cell: (row: FleetMigrationEntry) => (
        <Badge variant="outline">{PLATFORM_LABELS[row.platform] ?? row.platform}</Badge>
      ),
    },
    {
      header: "Status",
      cell: (row: FleetMigrationEntry) => (
        <Badge variant={statusTone(row.status)}>{statusLabel(row.status)}</Badge>
      ),
    },
    {
      header: "Device",
      cell: (row: FleetMigrationEntry) =>
        row.deviceId ? (
          <a
            href={routes.tenant(params.tenantId).device(row.deviceId)}
            class="font-medium text-foreground hover:underline"
          >
            {row.deviceName ?? row.deviceId}
          </a>
        ) : (
          <span class="text-subtle-foreground">Not enrolled</span>
        ),
    },
    {
      header: "Evidence",
      cell: (row: FleetMigrationEntry) => (
        <span class="line-clamp-2 text-xs text-muted-foreground" title={row.lastEvidence ?? ""}>
          {row.lastEvidence ?? "—"}
        </span>
      ),
    },
    {
      header: "Updated",
      cell: (row: FleetMigrationEntry) => (
        <span class="text-muted-foreground" title={formatDate(row.updatedAt)}>
          {relativeTime(row.updatedAt)}
        </span>
      ),
    },
    {
      header: "",
      class: "text-right",
      cell: (row: FleetMigrationEntry) => (
        <div class="flex justify-end gap-1.5">
          <Show when={writable() && row.actions.includes("unenrol")}>
            <Button
              size="xs"
              variant="outline"
              disabled={issue.isPending}
              onClick={() => issue.mutate([row.id])}
            >
              {row.status === "pending" ? "Issue unenrol" : "Re-issue unenrol"}
            </Button>
          </Show>
          <Show when={writable() && row.actions.includes("mark-unenrolled")}>
            <Button
              size="xs"
              variant="outline"
              disabled={markUnenrolled.isPending}
              onClick={() => markUnenrolled.mutate(row)}
            >
              Mark unenrolled
            </Button>
          </Show>
          <Show when={writable() && row.actions.includes("confirm")}>
            <Button
              size="xs"
              disabled={confirmEntry.isPending}
              onClick={() => confirmEntry.mutate(row)}
            >
              Confirm
            </Button>
          </Show>
        </div>
      ),
    },
  ];

  return (
    <Show when={can("devices.read")} fallback={<AccessDenied />}>
      <Page class={props.embedded ? "max-w-none p-0" : undefined}>
        <Show when={props.embedded} fallback={<PageBreadcrumbs title="Migration" />}>
          <a
            href={routes.tenant(params.tenantId).settingsMigration()}
            class="text-xs text-muted-foreground transition-colors duration-140 ease-swift hover:text-foreground"
          >
            ← Migration cohorts
          </a>
        </Show>
        <PageHeader
          eyebrow="Migration"
          title={detail.data?.migration.name ?? "Migration cohort"}
          description="The incumbent removes its own profile. This cohort tracks which devices came back."
          meta={
            <Show when={detail.data}>
              {(data) => (
                <span>
                  Leaving {SOURCE_LABELS[data().migration.sourceMdm] ?? data().migration.sourceMdm}
                  {" · stuck after "} {data().migration.stuckAfterDays} days
                </span>
              )}
            </Show>
          }
          actions={
            <div class="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void exportCohort("csv")}>
                Export CSV
              </Button>
              <Button variant="outline" size="sm" onClick={() => void exportCohort("json")}>
                Export JSON
              </Button>
              <Show when={writable()}>
                <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              </Show>
            </div>
          }
        />

        <QueryError error={detail.error} onRetry={() => void detail.refetch()} />

        <Show when={counts()}>
          {(value) => (
            <div class="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
              <Progress
                class="sm:col-span-3 xl:col-span-6"
                value={value().confirmed}
                max={value().total}
                label="Migration progress"
                valueLabel={`${value().confirmed} of ${value().total} confirmed`}
                showValue
              />
              <StatCard label="Total" value={value().total} />
              <StatCard label="Pending" value={value().pending} />
              <StatCard label="Unenrol issued" value={value().unenrolIssued} tone="warning" />
              <StatCard label="Awaiting" value={value().awaitingEnrolment} tone="warning" />
              <StatCard label="Enrolled" value={value().enrolled} tone="brand" />
              <StatCard label="Confirmed" value={value().confirmed} tone="success" />
              <StatCard label="Stuck" value={value().stuck} tone="danger" />
            </div>
          )}
        </Show>

        <Show when={writable() && counts() && counts().total > 0}>
          <Panel
            title="Issue the unenrol handoff"
            description="A batch is bounded so one click cannot touch a whole fleet. Devices only the incumbent can reach get the script back for you to deploy there."
          >
            <div class="grid gap-4 sm:grid-cols-3">
              <Field label="Batch size" hint="At most 50 per request.">
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={batchLimit()}
                  onInput={(event) => setBatchLimit(Number(event.currentTarget.value) || 10)}
                />
              </Field>
              <label class="flex items-start gap-2 self-end pb-2 text-xs text-muted-foreground sm:col-span-2">
                <Checkbox
                  class="mt-0.5"
                  checked={confirmSoleCopy()}
                  onCheckedChange={(checked) => setConfirmSoleCopy(checked === true)}
                />
                <span>
                  I understand a device already enrolled in Mattrax is its only managed copy:
                  removing the incumbent profile leaves it unmanaged until it re-enrols.
                </span>
              </label>
            </div>
            <div class="mt-3 flex gap-2">
              <Button disabled={issue.isPending} onClick={() => issue.mutate(undefined)}>
                {issue.isPending ? "Issuing…" : "Issue to next " + batchLimit()}
              </Button>
            </div>
          </Panel>
        </Show>

        <Panel
          title="Devices"
          description="Every serial in the cohort with the evidence for its status."
        >
          <DataTable
            rows={detail.data ? [...detail.data.entries] : undefined}
            columns={columns}
            empty={<EmptyState title="No devices" description="This cohort has no serials." />}
          />
        </Panel>

        <Show when={detail.data}>{(data) => <HandoffPanel detail={data()} onCopy={copy} />}</Show>
      </Page>

      <ConfirmDialog
        open={confirmDelete()}
        onOpenChange={setConfirmDelete}
        title="Delete this cohort?"
        description="The cohort and its status history are removed. The devices themselves are not touched, and the generated unenrol scripts stay in Scripts."
        confirmLabel="Delete cohort"
        destructive
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </Show>
  );
}

function HandoffPanel(props: {
  detail: FleetMigrationDetail;
  onCopy: (value: string, label: string) => void;
}) {
  return (
    <Panel
      title="Enrolment handoff"
      description="Pre-fill these into the incumbent's re-enrol field, or send them to the person holding the device."
    >
      <div class="grid gap-4">
        <For each={props.detail.enrollment.guides}>
          {(guide) => (
            <div class="rounded-lg border border-border p-3">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="label-caps">{guide.label}</div>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => props.onCopy(guide.enrollmentUrl, guide.label)}
                >
                  Copy URL
                </Button>
              </div>
              <p class="mt-1 break-all font-mono text-xs text-foreground">
                {guide.enrollmentUrl}
              </p>
              <ol class="mt-2 list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
                <For each={guide.steps}>{(step) => <li>{step}</li>}</For>
              </ol>
              <p class="mt-2 text-xs text-subtle-foreground">{guide.note}</p>
            </div>
          )}
        </For>

        <For each={props.detail.enrollment.unenrol}>
          {(recipe) => (
            <div class="rounded-lg border border-border p-3">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="label-caps">{UNENROL_LABELS[recipe.platform] ?? recipe.platform}</div>
                <Badge variant={recipe.delivery === "script" ? "brand" : "outline"}>
                  {recipe.delivery === "script" ? "One-shot script" : "Manual step"}
                </Badge>
              </div>
              <p class="mt-1 text-xs text-muted-foreground">{recipe.instructions}</p>
              <Show when={recipe.script}>
                {(script) => (
                  <>
                    <div class="mt-2 flex justify-end">
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => props.onCopy(script(), "Unenrol script")}
                      >
                        Copy script
                      </Button>
                    </div>
                    <pre class="mt-2 max-h-64 overflow-auto rounded-md bg-surface p-2 font-mono text-xs text-muted-foreground">
                      {script()}
                    </pre>
                  </>
                )}
              </Show>
            </div>
          )}
        </For>

        <p class="text-xs text-subtle-foreground">{props.detail.enrollment.deploymentHint}</p>
      </div>
    </Panel>
  );
}
