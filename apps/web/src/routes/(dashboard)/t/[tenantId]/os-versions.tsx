import { type RoutePreloadFuncArgs, useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { For, Show, createSignal } from "solid-js";
import type {
  OsFleetPlatform,
  OsPolicyPlatform,
  TenantOsPolicyPlatform,
} from "@mattrax/enterprise-domain/client";
import { osComplianceReasonText } from "@mattrax/enterprise-domain/client";
import { Badge, Checkbox } from "@mattrax/ui";
import {
  ErrorText,
  Page,
  PageHeader,
  PageSkeleton,
  Panel,
  QueryError,
} from "~/components/mdm/common";
import { OsComplianceTag } from "~/components/os-compliance-badge";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";
import { toast } from "~/components/toast";
import { preloadPage } from "~/lib/page-data";
import { queryClient } from "~/lib/query-client";
import { useCan } from "~/lib/permissions";
import { routes } from "~/lib/routes";
import { cn } from "~/lib/utils";

export const route = {
  preload: ({ params, intent }: RoutePreloadFuncArgs) => {
    if (intent === "initial") return;

    return preloadPage([
      () => queryClient.ensureQueryData(enterpriseQueries.osFleet(params.tenantId)),
    ]);
  },
};

const platformLabel = (platform: OsPolicyPlatform) => {
  switch (platform) {
    case "macos":
      return "macOS";
    case "windows":
      return "Windows";
    case "android":
      return "Android";
  }
};

const platformProto = (platform: OsPolicyPlatform) => {
  switch (platform) {
    case "macos":
      return "apple" as const;
    case "windows":
      return "win" as const;
    case "android":
      return "android" as const;
  }
};

const Stat = (props: { label: string; value: number; tone?: string }) => (
  <div class="rounded-lg border border-border bg-card px-3 py-2.5">
    <p class="label-caps">{props.label}</p>
    <p class={cn("mt-1 text-[20px] font-[560] leading-none tracking-[-0.02em]", props.tone)}>
      {props.value}
    </p>
  </div>
);

const bucketVariant = (status: string): "success" | "warning" | "info" | "outline" => {
  switch (status) {
    case "compliant":
      return "success";
    case "below-minimum":
      return "warning";
    case "update-available":
      return "info";
    default:
      return "outline";
  }
};

const enforcementBadge = (platform: OsFleetPlatform | TenantOsPolicyPlatform) => {
  const mode = platform.enforcement;

  if (mode === "enforce")
    return (
      <Badge variant="warning" dot="warning">
        Enforce
      </Badge>
    );

  if (mode === "warn")
    return (
      <Badge variant="info" dot="info">
        Warn
      </Badge>
    );

  return <Badge variant="outline">Off</Badge>;
};

export default function OsVersionsPage() {
  const params = useParams();
  const qc = useQueryClient();
  const { can } = useCan();
  const canCommand = () => can("devices.command");
  const canWrite = () => can("devices.write");

  const fleet = useQuery(() => enterpriseQueries.osFleet(params.tenantId));

  const [selected, setSelected] = createSignal<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = createSignal(false);
  const [applyError, setApplyError] = createSignal<unknown>();

  const selectedRows = () => {
    const ids = selected();
    const rows = fleet.data?.platforms.flatMap((platform) => platform.behind) ?? [];

    return rows.filter((row) => ids.has(row.id));
  };

  const toggle = (id: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);

      if (checked) next.add(id);
      else next.delete(id);

      return next;
    });

  /**
   * Apply updates to the selected Macs.
   *
   * Every row is one `ScheduleOSUpdate` command. Apple's command installs the
   * latest available update, so no ProductKey is sent; the operator can pick a
   * specific update from the device page when they know it.
   */
  const apply = useMutation(() => ({
    mutationFn: async () => {
      const rows = selectedRows();
      let failed = 0;

      for (const row of rows) {
        try {
          await enterprise.deviceAction(params.tenantId, row.id, {
            action: "schedule-os-update",
            osUpdateInstallAction: "InstallASAP",
          });
        } catch {
          failed += 1;
        }
      }

      return { total: rows.length, failed };
    },
    onSuccess: async (result) => {
      setConfirmOpen(false);
      setSelected(new Set<string>());
      setApplyError(undefined);

      if (result.failed > 0)
        toast.warning(
          `Update requested for ${result.total - result.failed} of ${result.total} devices`,
          {
            description: "Some devices rejected the command. Check their command history.",
          },
        );
      else
        toast.success(
          `Update requested for ${result.total} ${result.total === 1 ? "device" : "devices"}`,
        );

      await qc.invalidateQueries({ queryKey: enterpriseKeys.osFleet(params.tenantId) });
      await qc.invalidateQueries({
        queryKey: enterpriseKeys.listPrefix(params.tenantId, "device"),
      });
    },
    onError: (error) => setApplyError(error),
  }));

  return (
    <Page wide>
      <PageHeader
        eyebrow="Fleet"
        title="OS versions"
        description="Who is running what, who is below the tenant minimum, and what can actually be enforced on each platform."
        actions={
          <div class="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={fleet.isFetching}
              onClick={() => void fleet.refetch()}
            >
              Refresh
            </Button>
            <Show when={canWrite()}>
              <Button
                as="a"
                size="sm"
                href={`${routes.tenant(params.tenantId).settings()}/os-updates`}
              >
                Configure policy
              </Button>
            </Show>
          </div>
        }
      />

      <QueryError error={fleet.error} onRetry={() => void fleet.refetch()} />

      <Show
        when={fleet.data}
        fallback={
          <Show when={fleet.isLoading}>
            <PageSkeleton rows={6} />
          </Show>
        }
      >
        {(data) => (
          <>
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Stat label="Devices" value={data().totals.total} />
              <Stat label="Compliant" value={data().totals.compliant} tone="text-success" />
              <Stat
                label="Below minimum"
                value={data().totals.belowMinimum}
                tone={data().totals.belowMinimum > 0 ? "text-warning" : undefined}
              />
              <Stat
                label="Updates available"
                value={data().totals.updateAvailable}
                tone={data().totals.updateAvailable > 0 ? "text-info" : undefined}
              />
              <Stat label="Unknown" value={data().totals.unknown} />
            </div>

            <Show when={data().feed.stale || !data().feed.available}>
              <div class="rounded-lg border border-warning/25 bg-warning/[0.06] px-3.5 py-2.5 text-[12px] leading-relaxed text-warning-foreground">
                {data().feed.stale
                  ? "The macOS update feed is stale. macOS update availability may be out of date."
                  : "The macOS update feed is unavailable. macOS devices that meet their minimum are still reported as unknown rather than up to date."}
              </div>
            </Show>

            <For each={data().platforms}>
              {(platform) => {
                const isMac = () => platform.platform === "macos";

                const selectable = () => isMac() && canCommand() && platform.behind.length > 0;

                return (
                  <Panel
                    title={`${platformLabel(platform.platform)} — ${platform.counts.total} ${platform.counts.total === 1 ? "device" : "devices"}`}
                    description={
                      platform.minimumVersion
                        ? `Minimum ${platform.minimumVersion}${platform.deferralEndsAt ? ` · grace until ${new Date(platform.deferralEndsAt).toLocaleDateString()}` : ""}`
                        : "No minimum version configured for this platform."
                    }
                    actions={
                      <div class="flex items-center gap-2">
                        {enforcementBadge(platform)}
                        <Show when={platform.minimumVersion}>
                          <Badge variant="outline">Minimum {platform.minimumVersion}</Badge>
                        </Show>
                      </div>
                    }
                  >
                    <div class="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                      <div>
                        <div class="flex flex-wrap gap-2">
                          <Badge variant="success" dot="success">
                            {platform.counts.compliant} compliant
                          </Badge>
                          <Show when={platform.counts.belowMinimum > 0}>
                            <Badge variant="warning" dot="warning">
                              {platform.counts.belowMinimum} below minimum
                            </Badge>
                          </Show>
                          <Show when={platform.counts.updateAvailable > 0}>
                            <Badge variant="info" dot="info">
                              {platform.counts.updateAvailable} updates
                            </Badge>
                          </Show>
                          <Show when={platform.counts.deferred > 0}>
                            <Badge variant="outline">{platform.counts.deferred} deferred</Badge>
                          </Show>
                          <Show when={platform.counts.unknown > 0}>
                            <Badge variant="outline">{platform.counts.unknown} unknown</Badge>
                          </Show>
                        </div>

                        <p class="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
                          {platform.capability.description}
                        </p>
                        <p class="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                          <span class="font-medium text-foreground">Not enforced: </span>
                          {platform.capability.limitation}
                        </p>

                        <div class="mt-3 space-y-1.5">
                          <For each={platform.versions.slice(0, 12)}>
                            {(bucket) => (
                              <div class="flex items-center justify-between gap-3 rounded-md border border-border/70 px-2.5 py-1.5">
                                <div class="flex min-w-0 items-center gap-2">
                                  <span class="font-mono text-[11.5px] text-foreground">
                                    {bucket.version ?? "Not reported"}
                                  </span>
                                  <Badge variant={bucketVariant(bucket.status)}>
                                    {bucket.status}
                                  </Badge>
                                </div>
                                <span class="text-[11.5px] tabular-nums text-muted-foreground">
                                  {bucket.count}
                                </span>
                              </div>
                            )}
                          </For>
                          <Show when={platform.versions.length > 12}>
                            <p class="text-[11px] text-muted-foreground">
                              +{platform.versions.length - 12} more versions
                            </p>
                          </Show>
                        </div>
                      </div>

                      <div>
                        <div class="flex flex-wrap items-center justify-between gap-2">
                          <p class="text-[12.5px] font-medium text-foreground">
                            {platform.behind.length === 0
                              ? "Nothing to remediate"
                              : "Devices needing attention"}
                          </p>
                          <div class="flex items-center gap-2">
                            <Button
                              as="a"
                              size="xs"
                              variant="outline"
                              href={routes.tenant(params.tenantId).devices({
                                proto: platformProto(platform.platform),
                              })}
                            >
                              View in devices
                            </Button>
                            <Show when={selectable()}>
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() =>
                                  setSelected((current) => {
                                    const next = new Set(current);

                                    for (const row of platform.behind) next.add(row.id);

                                    return next;
                                  })
                                }
                              >
                                Select all
                              </Button>
                              <Button
                                size="xs"
                                disabled={selectedRows().length === 0 || apply.isPending}
                                onClick={() => setConfirmOpen(true)}
                              >
                                Apply update
                              </Button>
                            </Show>
                          </div>
                        </div>

                        <Show
                          when={platform.behind.length > 0}
                          fallback={
                            <p class="mt-3 rounded-md border border-dashed border-border px-3 py-4 text-[12px] text-muted-foreground">
                              {platform.counts.unknown > 0
                                ? "Devices with unknown status are listed above; they cannot be called compliant."
                                : "Every evaluated device meets the configured policy."}
                            </p>
                          }
                        >
                          <div class="mt-2 overflow-hidden rounded-lg border border-border">
                            <table class="w-full text-left text-[12px]">
                              <thead class="border-b border-border bg-surface-muted/50 text-[11px] text-muted-foreground">
                                <tr>
                                  <th class="w-8 px-2 py-1.5">
                                    <span class="sr-only">Select</span>
                                  </th>
                                  <th class="px-2 py-1.5 font-medium">Device</th>
                                  <th class="px-2 py-1.5 font-medium">Version</th>
                                  <th class="px-2 py-1.5 font-medium">Why</th>
                                  <th class="px-2 py-1.5 font-medium">Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                <For each={platform.behind}>
                                  {(row) => (
                                    <tr class="border-t border-border/70">
                                      <td class="px-2 py-1.5">
                                        <Show when={selectable()}>
                                          <Checkbox
                                            checked={selected().has(row.id)}
                                            aria-label={`Select ${row.name}`}
                                            onCheckedChange={(checked) =>
                                              toggle(row.id, checked === true)
                                            }
                                          />
                                        </Show>
                                      </td>
                                      <td class="max-w-52 truncate px-2 py-1.5">
                                        <a
                                          class="font-medium text-foreground hover:underline"
                                          href={routes.tenant(params.tenantId).device(row.id)}
                                        >
                                          {row.name}
                                        </a>
                                      </td>
                                      <td class="px-2 py-1.5 font-mono text-[11.5px]">
                                        {row.currentVersion ?? "—"}
                                      </td>
                                      <td class="px-2 py-1.5 text-muted-foreground">
                                        {row.reason === "deferral_active" && row.deferralEndsAt
                                          ? `Deferred until ${new Date(row.deferralEndsAt).toLocaleDateString()}`
                                          : osComplianceReasonText({
                                              status: row.status,
                                              reason: row.reason,
                                              platform: platform.platform,
                                              currentVersion: row.currentVersion,
                                              minimumVersion: platform.minimumVersion,
                                              targetVersion: row.targetVersion,
                                              latestVersion: null,
                                              enforcement: platform.enforcement,
                                              enforced: false,
                                              updateKnowledge: "unknown",
                                              deferralEndsAt: row.deferralEndsAt,
                                            })}
                                      </td>
                                      <td class="px-2 py-1.5">
                                        <OsComplianceTag
                                          info={{
                                            status: row.status,
                                            reason: row.reason,
                                            platform: platform.platform,
                                            currentVersion: row.currentVersion,
                                            minimumVersion: platform.minimumVersion,
                                            targetVersion: row.targetVersion,
                                            latestVersion: null,
                                            enforcement: platform.enforcement,
                                            enforced: false,
                                            updateKnowledge: "unknown",
                                            deferralEndsAt: row.deferralEndsAt,
                                          }}
                                        />
                                      </td>
                                    </tr>
                                  )}
                                </For>
                              </tbody>
                            </table>
                          </div>
                          <Show when={platform.behindTruncated}>
                            <p class="mt-2 text-[11px] text-muted-foreground">
                              Showing the first {platform.behind.length} devices. The counts above
                              cover the whole fleet; narrow the list from the devices page.
                            </p>
                          </Show>
                        </Show>

                        <Show when={!selectable() && platform.behind.length > 0}>
                          <p class="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                            {isMac()
                              ? "You need the device-command permission to apply macOS updates."
                              : "This platform has no per-device update command. Enforcement is applied through its update policy on the next check-in."}
                          </p>
                        </Show>
                      </div>
                    </div>
                  </Panel>
                );
              }}
            </For>

            <ConfirmDialog
              open={confirmOpen()}
              onOpenChange={setConfirmOpen}
              title={`Apply macOS updates to ${selectedRows().length} ${selectedRows().length === 1 ? "device" : "devices"}?`}
              description="Each Mac receives Apple's ScheduleOSUpdate command with InstallASAP. Apple installs the latest available update; the command runs on the device's next check-in and may restart it."
              confirmLabel="Apply updates"
              pending={apply.isPending}
              error={applyError()}
              onConfirm={() => apply.mutate()}
            />

            <Show when={apply.error && !confirmOpen()}>
              <ErrorText error={apply.error} />
            </Show>
          </>
        )}
      </Show>
    </Page>
  );
}
