import { useParams, useSearchParams } from "@solidjs/router";
import type { RoutePreloadFuncArgs } from "@solidjs/router";
import { PolicyRow } from "@mattrax/enterprise-domain/client";
import type { PolicyDeploymentDevice } from "@mattrax/enterprise-domain/client";
import { useQuery } from "@tanstack/solid-query";
import { Option, Schema } from "effect";
import { createSignal, For, Show } from "solid-js";
import {
  formatDate,
  Page,
  PageBreadcrumbs,
  PageHeader,
  Panel,
  QueryError,
  relativeTime,
  SkeletonRows,
} from "~/components/mdm/common";
import PolicyProgressBar from "~/components/mdm/policy-progress";
import { MdmTable } from "~/components/mdm/table";
import type { MdmColumn } from "~/components/mdm/table";
import PolicyViewTabs from "~/components/mdm/policy-view-tabs";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";
import {
  policyDeploymentDevicePresentation,
  policyDeploymentSegments,
  policyDeliveryStatePresentation,
} from "~/lib/policy-delivery";
import { preloadPage } from "~/lib/page-data";
import { queryClient } from "~/lib/query-client";

const decodePolicyRow = Schema.decodeUnknownOption(PolicyRow);

const PAGE_SIZE = 50;

type DeviceRow = PolicyDeploymentDevice & { id: string };

const platformLabel = (platform: PolicyDeploymentDevice["platform"]) => {
  switch (platform) {
    case "apple":
      return "Apple";
    case "windows":
      return "Windows";
    case "android":
      return "Android";
  }
};

const columns: MdmColumn<DeviceRow>[] = [
  {
    id: "device",
    header: "Device",
    cell: (row) => (
      <span class="flex min-w-0 flex-col">
        <span class="truncate font-medium text-foreground">{row.name}</span>
        <span class="truncate text-xs text-muted-foreground">
          {platformLabel(row.platform)}
        </span>
      </span>
    ),
    sort: (row) => row.name,
    search: (row) => row.name,
  },
  {
    id: "status",
    header: "Status",
    cell: (row) => {
      const presentation = policyDeploymentDevicePresentation[row.status];

      return (
        <Badge variant={presentation.tone} dot={presentation.dot}>
          {presentation.label}
        </Badge>
      );
    },
    sort: (row) => row.status,
  },
  {
    id: "kinds",
    header: "Reported",
    cell: (row) => (
      <Show when={row.applicableKinds > 0} fallback={<span class="text-muted-foreground">—</span>}>
        <span class="tabular-nums text-muted-foreground">
          {row.deliveredKinds} of {row.applicableKinds}
        </span>
      </Show>
    ),
    sort: (row) => row.deliveredKinds - row.applicableKinds,
  },
  {
    id: "evidence",
    header: "Last evidence",
    cell: (row) => (
      <Show
        when={row.lastEvidenceAt}
        fallback={<span class="text-xs text-muted-foreground">No report</span>}
      >
        {(value) => (
          <span class="text-xs text-muted-foreground" title={formatDate(value())}>
            {relativeTime(value())}
          </span>
        )}
      </Show>
    ),
    sort: (row) => row.lastEvidenceAt ?? "",
  },
  {
    id: "reason",
    header: "Detail",
    class: "max-w-90",
    cell: (row) => (
      <span class="text-xs leading-relaxed text-muted-foreground">{row.reason}</span>
    ),
    search: (row) => row.reason,
  },
];

export const route = {
  preload: ({ params, intent }: RoutePreloadFuncArgs) => {
    if (intent === "initial") return;

    return preloadPage([
      () =>
        queryClient.ensureQueryData(
          enterpriseQueries.item(params.tenantId, "policy", params.policyId),
        ),
      () =>
        queryClient.ensureQueryData({
          queryKey: [
            ...enterpriseKeys.item(params.tenantId, "policy", params.policyId),
            "deployments",
          ],
          queryFn: () => enterprise.listPolicyDeployments(params.tenantId, params.policyId),
        }),
      () =>
        queryClient.ensureQueryData(
          enterpriseQueries.policyDeployment(params.tenantId, params.policyId, "latest", {
            limit: PAGE_SIZE,
          }),
        ),
    ]);
  },
};

export default function PolicyDeploymentPage() {
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [offset, setOffset] = createSignal(0);

  const requestedVersion = () => {
    const value = searchParams.version;

    return Schema.is(Schema.String)(value) && value.length > 0 ? value : "latest";
  };

  const policy = useQuery(() => enterpriseQueries.item(params.tenantId, "policy", params.policyId));

  const row = () => Option.getOrUndefined(decodePolicyRow(policy.data));

  const deployments = useQuery(() => ({
    queryKey: [...enterpriseKeys.item(params.tenantId, "policy", params.policyId), "deployments"],
    queryFn: () => enterprise.listPolicyDeployments(params.tenantId, params.policyId),
  }));

  const deployment = useQuery(() =>
    enterpriseQueries.policyDeployment(params.tenantId, params.policyId, requestedVersion(), {
      limit: PAGE_SIZE,
      offset: offset(),
    }),
  );

  const selectVersion = (value: string) => {
    setOffset(0);
    setSearchParams({ version: value === "latest" ? undefined : value }, { replace: true });
  };

  const rows = () =>
    (deployment.data?.devices ?? []).map((device) => ({ ...device, id: device.deviceId }));

  const presentation = () => {
    const data = deployment.data;

    return data ? policyDeliveryStatePresentation(data.state) : undefined;
  };

  const applicable = () => {
    const counts = deployment.data?.counts;

    return counts ? counts.delivered + counts.pending + counts.failed : 0;
  };

  const rangeLabel = () => {
    const data = deployment.data;

    if (!data || data.counts.total === 0) return "No devices";

    const start = data.offset + 1;
    const end = data.offset + data.devices.length;

    return `${start}–${end} of ${data.counts.total}`;
  };

  return (
    <Page>
      <PageBreadcrumbs resourceName={row()?.name} />
      <PageHeader
        eyebrow="Policy"
        title={`Deployment — ${row()?.name ?? "Policy"}`}
        description="Each saved version fans out to the policy's scoped devices. Only Apple devices on the declarative path report whether a configuration arrived."
        meta={
          <Show when={deployment.data}>
            {(data) => (
              <>
                <Show when={presentation()}>
                  {(value) => (
                    <Badge variant={value().tone} dot={value().dot}>
                      {value().label}
                    </Badge>
                  )}
                </Show>
                <span class="tabular-nums">
                  Version <span class="text-foreground">{data().version}</span>
                </span>
                <span class="text-muted-foreground/40" aria-hidden="true">
                  ·
                </span>
                <span class="tabular-nums">{data().counts.scoped} in scope</span>
                <Show when={data().createdAt}>
                  {(createdAt) => (
                    <>
                      <span class="text-muted-foreground/40" aria-hidden="true">
                        ·
                      </span>
                      <span>Saved {formatDate(createdAt())}</span>
                    </>
                  )}
                </Show>
              </>
            )}
          </Show>
        }
        actions={
          <div class="flex flex-wrap items-center gap-2">
            <label class="flex items-center gap-1.5 text-xs text-muted-foreground">
              Version
              <select
                class="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                value={requestedVersion()}
                onChange={(event) => selectVersion(event.currentTarget.value)}
              >
                <option value="latest">
                  Latest
                  {deployments.data?.deployments[0]
                    ? ` (v${deployments.data.deployments[0].version})`
                    : ""}
                </option>
                <For each={deployments.data?.deployments ?? []}>
                  {(item) => <option value={String(item.version)}>Version {item.version}</option>}
                </For>
              </select>
            </label>
            <Button
              as="a"
              variant="outline"
              href={`/t/${params.tenantId}/policies/${params.policyId}`}
            >
              Back to {row()?.name ?? "policy"}
            </Button>
          </div>
        }
      />

      <QueryError error={policy.error} onRetry={() => void policy.refetch()} />

      <PolicyViewTabs
        base={`/t/${params.tenantId}/policies/${params.policyId}`}
        active="deployment"
      />

      <Show
        when={deployment.data}
        fallback={
          <Panel>
            <Show when={deployment.isError} fallback={<SkeletonRows rows={6} />}>
              <Show
                when={(deployments.data?.deployments.length ?? 0) > 0}
                fallback={
                  <p class="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-5 text-xs text-muted-foreground">
                    No deployments yet. Save the policy to create version 1 and start tracking
                    delivery.
                  </p>
                }
              >
                <QueryError error={deployment.error} onRetry={() => void deployment.refetch()} />
              </Show>
            </Show>
          </Panel>
        }
      >
        {(data) => {
          const segments = () => policyDeploymentSegments(data().counts);

          return (
            <div class="space-y-5">
              <Panel
                title="Progress"
                description="Counts cover every device in the policy's current scope, plus any device that left scope but still reports this version."
              >
                <div class="space-y-3">
                  <PolicyProgressBar segments={segments()} />

                  <div class="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                    <For each={segments()}>
                      {(segment) => (
                        <span class="inline-flex items-center gap-1.5">
                          <span
                            class={`size-1.5 rounded-full ${segment.class}`}
                            aria-hidden="true"
                          />
                          <span class="tabular-nums text-foreground">{segment.value}</span>
                          {segment.label.toLowerCase()}
                        </span>
                      )}
                    </For>
                  </div>

                  <p class="text-xs leading-relaxed text-muted-foreground">
                    {data().counts.scoped === 0
                      ? "This policy's assignments match no devices right now."
                      : applicable() > 0
                        ? `${data().counts.delivered} of ${applicable()} tracked devices report this version as valid and active.`
                        : "No device in scope has a declarable configuration from this policy."}
                    <Show when={data().counts.untracked > 0}>
                      {" "}
                      {data().counts.untracked} untracked device
                      {data().counts.untracked === 1 ? " is" : "s are"} in the fan-out but cannot
                      prove delivery: Windows and Android do not report declaration status, and
                      legacy Apple profiles do not either.
                    </Show>
                    <Show when={data().counts.notInScope > 0}>
                      {" "}
                      {data().counts.notInScope} device
                      {data().counts.notInScope === 1 ? " has" : "s have"} left the policy's scope
                      but still reports this version's declarations.
                    </Show>
                  </p>
                </div>
              </Panel>

              <Panel
                title="Devices"
                description="Action-needed first, then by device name."
                actions={
                  <Badge variant="outline">
                    {rangeLabel()}
                  </Badge>
                }
              >
                <MdmTable
                  rows={rows()}
                  columns={columns}
                  total={data().counts.total}
                  loading={deployment.isPending}
                  isFetching={deployment.isFetching && !deployment.isPending}
                  rowHref={(device) => `/t/${params.tenantId}/devices/${device.deviceId}`}
                  selectable={false}
                  storageKey="policy-deployment-devices"
                  caption="Devices in this policy deployment"
                  empty={
                    <p class="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-5 text-xs text-muted-foreground">
                      No device is in this policy's scope. Assign it to a device, a group or a
                      directory user to start a deployment.
                    </p>
                  }
                  footer={
                    <div class="flex items-center justify-between gap-2">
                      <p class="text-xs tabular-nums text-muted-foreground">{rangeLabel()}</p>
                      <div class="flex items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={data().offset === 0 || deployment.isFetching}
                          onClick={() => setOffset(Math.max(0, data().offset - PAGE_SIZE))}
                        >
                          Previous
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={data().nextOffset === null || deployment.isFetching}
                          onClick={() => setOffset(data().nextOffset ?? 0)}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  }
                />
              </Panel>
            </div>
          );
        }}
      </Show>
    </Page>
  );
}
