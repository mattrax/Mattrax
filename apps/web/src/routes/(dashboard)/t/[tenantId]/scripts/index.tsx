import { useParams } from "@solidjs/router";
import type { RoutePreloadFuncArgs } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { Show } from "solid-js";
import { scriptTriggerLabel } from "@mattrax/enterprise-domain/client";
import {
  DataTable,
  EmptyState,
  LinkButton,
  Page,
  PageHeader,
  Panel,
  QueryError,
  formatDate,
  relativeTime,
} from "~/components/mdm/common";
import { toast } from "~/components/toast";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";
import type { ScriptInfo } from "~/lib/enterprise";
import { preloadPage } from "~/lib/page-data";
import { optimisticUpdate } from "~/lib/optimistic";
import { AccessDenied, ReadOnlyNotice, useCan } from "~/lib/permissions";
import { queryClient } from "~/lib/query-client";

export const route = {
  preload: ({ params, intent }: RoutePreloadFuncArgs) => {
    if (intent === "initial") return;

    return preloadPage([
      () => queryClient.ensureQueryData(enterpriseQueries.scripts(params.tenantId)),
    ]);
  },
};

const statusVariant = (status: string | null | undefined) => {
  switch (status) {
    case "succeeded":
      return "success";
    case "failed":
      return "destructive";
    default:
      return "outline";
  }
};

export default function ScriptsPage() {
  const params = useParams();
  const qc = useQueryClient();
  const { can } = useCan();
  const writable = () => can("scripts.write");

  const scripts = useQuery(() => enterpriseQueries.scripts(params.tenantId));

  const setEnabled = useMutation(() => ({
    mutationFn: (enabled: boolean) => enterprise.patchScriptSettings(params.tenantId, { enabled }),
    meta: { inlineError: true },
    onMutate: (enabled) =>
      optimisticUpdate<Awaited<ReturnType<typeof enterprise.listScripts>>>(
        qc,
        enterpriseKeys.scripts(params.tenantId),
        (current) => ({ ...current, enabled }),
      ),
    onError: (error, _enabled, restore) => {
      restore?.();
      toast.error("Could not update script settings", { description: String(error) });
    },
    onSuccess: (result) => {
      toast.success(result.enabled ? "Scripts enabled" : "Scripts disabled", {
        description: result.enabled
          ? "Assigned script profiles will be delivered on the next check-in."
          : "Assigned script profiles are removed and new runs are rejected.",
      });
    },
    onSettled: () =>
      void qc.invalidateQueries({ queryKey: enterpriseKeys.scripts(params.tenantId) }),
  }));

  const rows = () => [...(scripts.data?.scripts ?? [])];

  const columns = [
    {
      header: "Script",
      cell: (row: ScriptInfo) => (
        <a
          href={`/t/${params.tenantId}/scripts/${row.id}`}
          class="font-medium text-foreground hover:underline"
        >
          {row.name}
        </a>
      ),
    },
    {
      header: "Trigger",
      cell: (row: ScriptInfo) => (
        <span class="text-muted-foreground">
          {scriptTriggerLabel(row.trigger.type)}
          <Show when={row.trigger.type === "interval" && row.trigger.intervalSeconds}>
            <span class="text-muted-foreground/60"> · {row.trigger.intervalSeconds}s</span>
          </Show>
          <Show when={row.trigger.type === "cron" && row.trigger.cronExpression}>
            <span class="font-mono text-xs text-muted-foreground/60">
              {" "}
              · {row.trigger.cronExpression}
            </span>
          </Show>
        </span>
      ),
    },
    {
      header: "Runs as",
      cell: (row: ScriptInfo) => (
        <span class="font-mono text-xs text-muted-foreground">
          {row.language} · {row.runAs}
        </span>
      ),
    },
    {
      header: "Devices",
      cell: (row: ScriptInfo) => (
        <span class="tabular-nums text-muted-foreground">{row.assignedDeviceCount}</span>
      ),
    },
    {
      header: "Last run",
      cell: (row: ScriptInfo) => (
        <div class="flex flex-wrap items-center gap-2">
          <Show
            when={row.lastRunStatus}
            fallback={<span class="text-muted-foreground">Never</span>}
          >
            <Badge variant={statusVariant(row.lastRunStatus)}>
              {row.lastRunStatus}
            </Badge>
            <span class="text-xs text-muted-foreground">{relativeTime(row.lastRunAt)}</span>
          </Show>
        </div>
      ),
    },
    {
      header: "Updated",
      cell: (row: ScriptInfo) => (
        <span class="text-muted-foreground">{formatDate(row.updatedAt)}</span>
      ),
    },
  ];

  return (
    <Show when={can("scripts.read")} fallback={<AccessDenied />}>
      <Page>
        <PageHeader
          eyebrow="Automation"
          title="Scripts"
          description="Run shell or PowerShell scripts on managed devices, on a schedule or on demand."
          meta={
            <Show when={scripts.data}>
              <span class="tabular-nums">
                {rows().length} script{rows().length === 1 ? "" : "s"}
              </span>
              <span class="text-muted-foreground/40" aria-hidden="true">
                ·
              </span>
              <span>{scripts.data?.enabled ? "enabled" : "disabled"}</span>
            </Show>
          }
          actions={
            <Show when={writable()}>
              <LinkButton href={`/t/${params.tenantId}/scripts/new`}>New script</LinkButton>
            </Show>
          }
        />

        <Show when={scripts.data && !scripts.data.enabled}>
          <Panel
            title="Scripts are disabled for this tenant"
            description="Scripts execute arbitrary code. While disabled, no script is delivered and new runs are rejected."
            actions={
              <Show when={writable()}>
                <Button
                  variant="outline"
                  disabled={setEnabled.isPending}
                  onClick={() => setEnabled.mutate(true)}
                >
                  Enable scripts
                </Button>
              </Show>
            }
          >
            <p class="text-xs leading-relaxed text-muted-foreground">
              Existing execution history is retained until its retention window expires. Enabling
              scripts again re-delivers the currently assigned scripts on each device's next
              check-in.
            </p>
          </Panel>
        </Show>

        <Show when={scripts.data?.enabled && writable() && rows().length > 0}>
          <div class="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              disabled={setEnabled.isPending}
              onClick={() => setEnabled.mutate(false)}
            >
              Disable scripts for this tenant
            </Button>
          </div>
        </Show>

        <Show when={!writable() && rows().length > 0}>
          <ReadOnlyNotice>
            You can view scripts and run history. Creating a script requires the Scripts write
            permission; editing, assigning and running one also requires a fresh sign-in
            confirmation.
          </ReadOnlyNotice>
        </Show>

        <Show
          when={scripts.isSuccess}
          fallback={
            <Show
              when={scripts.isError}
              fallback={
                <div class="h-64 animate-pulse rounded-lg border border-border bg-surface" />
              }
            >
              <QueryError error={scripts.error} onRetry={() => void scripts.refetch()} />
            </Show>
          }
        >
          <DataTable<ScriptInfo>
            rows={rows()}
            columns={columns}
            caption="Scripts"
            swipeHint="Swipe the table sideways to see more columns."
            empty={
              <EmptyState
                title="No scripts yet"
                description="Create a script, assign it to devices or groups, then run it on demand or on a schedule."
                action={
                  <Show when={writable()}>
                    <LinkButton href={`/t/${params.tenantId}/scripts/new`}>New script</LinkButton>
                  </Show>
                }
              />
            }
          />
        </Show>

        <p class="text-xs leading-relaxed text-muted-foreground">
          Apple devices receive scripts as <code class="font-mono">com.mattrax.script</code>{" "}
          profiles executed by mattraxd. Windows uses the same binary because Windows MDM has no
          arbitrary-script channel. Android Management API exposes no script command, so Android
          devices are never targeted.
        </p>
      </Page>
    </Show>
  );
}
