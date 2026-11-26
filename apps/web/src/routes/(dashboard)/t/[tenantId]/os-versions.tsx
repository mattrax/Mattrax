import { useParams } from "@solidjs/router";
import type { RoutePreloadFuncArgs } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { For, Show, createSignal } from "solid-js";
import type {
  OsBehindDevice,
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
import OsComplianceTag from "~/components/os-compliance-badge";
import { Button } from "~/components/ui/button";
import ConfirmDialog from "~/components/ui/confirm-dialog";
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
    case "ios":
      return "iOS";
    case "ipados":
      return "iPadOS";
    case "windows":
      return "Windows";
    case "android":
      return "Android";
  }
};

const platformProto = (platform: OsPolicyPlatform) => {
  switch (platform) {
    case "macos":
    case "ios":
    case "ipados":
      return "apple" as const;
    case "windows":
      return "win" as const;
    case "android":
      return "android" as const;
  }
};

const isApplePlatform = (platform: OsPolicyPlatform) =>
  platform === "macos" || platform === "ios" || platform === "ipados";

const Stat = (props: { label: string; value: number; tone?: string }) => (
  <div class="rounded-lg border border-border bg-card px-3 py-2.5">
    <p class="label-caps">{props.label}</p>
    <p class={cn("mt-1 text-xl font-semibold leading-none tracking-tight", props.tone)}>
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

  type SelectedRow = OsBehindDevice & { platform: OsPolicyPlatform };

  const selectedRows = (): SelectedRow[] => {
    const ids = selected();
    const rows =
      fleet.data?.platforms.flatMap((platform) =>
        platform.behind.map((row) => ({ ...row, platform: platform.platform })),
      ) ?? [];

    return rows.filter((row) => ids.has(row.id));
  };

  /**
   * Which delivery path Apply update uses for the current selection.
   *
   * A device with the DDM declaration receives an APNs wake-up and applies
   * the tenant rule on check-in. Devices without DDM (below the declaration
   * minimum or on legacy delivery) fall back to the explicit ScheduleOSUpdate
   * command. Apple ignores that command while a DDM declaration manages the
   * update, so the declaration wins whenever it is available.
   */
  const selectedMechanisms = () => {
    const rows = selectedRows();
    const declarations = rows.filter((row) => row.updateMechanism === "ddm-software-update").length;
    const commands = rows.filter((row) => row.updateMechanism === "schedule-os-update").length;

    return { total: rows.length, commands, declarations };
  };

  const toggle = (id: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);

      if (checked) next.add(id);
      else next.delete(id);

      return next;
    });

  /**
   * Apply the OS update policy to the selected Apple devices.
   *
   * The DDM declaration installs the tenant minimum, so a capable device only
   * needs an APNs wake-up to sync it. A device without DDM gets the explicit
   * ScheduleOSUpdate command fallback. Every call is one audited device action.
   */
  const apply = useMutation(() => ({
    mutationFn: async () => {
      const rows = selectedRows();
      let failed = 0;

      for (const row of rows) {
        if (row.updateMechanism === null) continue;

        try {
          if (row.updateMechanism === "ddm-software-update")
            // Wakes the device; it fetches the tenant declaration on check-in.
            await enterprise.deviceAction(params.tenantId, row.id, {
              action: "sync",
              osUpdateMechanism: "ddm-software-update",
            });
          else
            await enterprise.deviceAction(params.tenantId, row.id, {
              action: "schedule-os-update",
              osUpdateInstallAction: "InstallASAP",
            });
        } catch {
          failed += 1;
        }
      }

      const { commands, declarations } = selectedMechanisms();

      return { total: rows.length, failed, commands, declarations };
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
              <div class="rounded-lg border border-warning/25 bg-warning/[0.06] px-3.5 py-2.5 text-xs leading-relaxed text-warning-foreground">
                {data().feed.stale
                  ? "The macOS update feed is stale. macOS update availability may be out of date."
                  : "The macOS update feed is unavailable. macOS devices that meet their minimum are still reported as unknown rather than up to date."}
              </div>
            </Show>

            <Show when={data().unsupported.total > 0}>
              <div class="rounded-lg border border-border bg-surface px-3.5 py-2.5 text-xs leading-relaxed text-muted-foreground">
                {data().unsupported.total}{" "}
                {data().unsupported.total === 1 ? "Apple device runs" : "Apple devices run"}{" "}
                {data()
                  .unsupported.byFamily.map((entry) => entry.family)
                  .join(", ")}
                . Mattrax does not manage OS update policy for tvOS, watchOS or visionOS, so these
                devices are excluded from compliance counts rather than reported as unknown.
              </div>
            </Show>

            <For each={data().platforms}>
              {(platform) => {
                const isApple = () => isApplePlatform(platform.platform);

                // A behind device with no mechanism has no safe action (for
                // example a warn-only iPhone 17+): show it, never offer a
                // button the API would reject.
                const actionable = () =>
                  platform.behind.filter((row) => row.updateMechanism !== null);

                const selectable = () => isApple() && canCommand() && actionable().length > 0;

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
                    <div class="grid grid-cols-1 gap-4 lg:grid-cols-12">
                      <div class="min-w-0 lg:col-span-5">
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

                        <p class="mt-3 text-pretty text-xs leading-relaxed text-muted-foreground">
                          {platform.capability.description}
                        </p>
                        <p class="mt-1 text-pretty text-xs leading-relaxed text-muted-foreground">
                          <span class="font-medium text-foreground">Not enforced: </span>
                          {platform.capability.limitation}
                        </p>

                        <div class="mt-3 space-y-1.5">
                          <For each={platform.versions.slice(0, 12)}>
                            {(bucket) => (
                              <div class="flex items-center justify-between gap-3 rounded-md border border-border/70 px-2.5 py-1.5">
                                <div class="flex min-w-0 items-center gap-2">
                                  <span class="font-mono text-xs text-foreground">
                                    {bucket.version ?? "Not reported"}
                                  </span>
                                  <Badge variant={bucketVariant(bucket.status)}>
                                    {bucket.status}
                                  </Badge>
                                </div>
                                <span class="text-xs tabular-nums text-muted-foreground">
                                  {bucket.count}
                                </span>
                              </div>
                            )}
                          </For>
                          <Show when={platform.versions.length > 12}>
                            <p class="text-xs text-muted-foreground">
                              +{platform.versions.length - 12} more versions
                            </p>
                          </Show>
                        </div>
                      </div>

                      <div class="min-w-0 lg:col-span-7">
                        <div class="flex flex-wrap items-center justify-between gap-2">
                          <p class="text-xs font-medium text-foreground">
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

                                    for (const row of actionable()) next.add(row.id);

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
                            <p class="mt-3 rounded-md border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
                              {platform.counts.unknown > 0
                                ? "Devices with unknown status are listed above; they cannot be called compliant."
                                : "Every evaluated device meets the configured policy."}
                            </p>
                          }
                        >
                          <div class="mt-2 overflow-hidden rounded-lg border border-border">
                            <table class="w-full text-left text-xs">
                              <thead class="border-b border-border bg-surface text-xs text-muted-foreground">
                                <tr>
                                  <th class="w-8 px-2 py-1.5">
                                    <span class="sr-only">Select</span>
                                  </th>
                                  <th class="px-2 py-1.5 font-medium">Device</th>
                                  <th class="px-2 py-1.5 font-medium">Version</th>
                                  <th class="px-2 py-1.5 font-medium">Update</th>
                                  <th class="px-2 py-1.5 font-medium">Why</th>
                                  <th class="px-2 py-1.5 font-medium">Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                <For each={platform.behind}>
                                  {(row) => (
                                    <tr class="border-t border-border/70">
                                      <td class="px-2 py-1.5">
                                        <Show when={selectable() && row.updateMechanism !== null}>
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
                                      <td class="px-2 py-1.5 font-mono text-xs">
                                        {row.currentVersion ?? "—"}
                                      </td>
                                      <td class="px-2 py-1.5 text-xs text-muted-foreground">
                                        <Show when={row.pendingVersion || row.installState}>
                                          <span class="flex flex-col">
                                            <Show when={row.pendingVersion}>
                                              {(version) => (
                                                <span class="font-mono text-xs text-foreground">
                                                  {version()} pending
                                                </span>
                                              )}
                                            </Show>
                                            <Show when={row.installState}>
                                              {(state) => <span>{state()}</span>}
                                            </Show>
                                          </span>
                                        </Show>
                                        <Show when={!row.pendingVersion && !row.installState}>
                                          {row.updateMechanism === "ddm-software-update"
                                            ? "DDM on check-in"
                                            : row.updateMechanism === "schedule-os-update"
                                              ? "Command fallback"
                                              : "—"}
                                        </Show>
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
                            <p class="mt-2 text-xs text-muted-foreground">
                              Showing the first {platform.behind.length} devices. The counts above
                              cover the whole fleet; narrow the list from the devices page.
                            </p>
                          </Show>
                        </Show>

                        <Show when={!selectable() && platform.behind.length > 0}>
                          <p class="mt-2 text-xs leading-relaxed text-muted-foreground">
                            {isApple()
                              ? "You need the device-command permission to apply Apple updates."
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
              title={`Apply the OS update policy to ${selectedRows().length} ${selectedRows().length === 1 ? "device" : "devices"}?`}
              description={(() => {
                const { declarations, commands } = selectedMechanisms();
                const parts = [
                  declarations > 0
                    ? `${declarations} ${declarations === 1 ? "device receives" : "devices receive"} Apple's DDM software-update enforcement declaration on its next check-in and installs at the declaration deadline (immediately when no deferral window is set).`
                    : null,
                  commands > 0
                    ? `${commands} ${commands === 1 ? "device receives" : "devices receive"} Apple's ScheduleOSUpdate command with InstallASAP, which may restart the device.`
                    : null,
                ].filter((part): part is string => part !== null);

                return parts.join(" ");
              })()}
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
