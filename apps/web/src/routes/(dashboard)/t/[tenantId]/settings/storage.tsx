import { useParams } from "@solidjs/router";
import type { RoutePreloadFuncArgs } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { createMemo, For, Show } from "solid-js";
import { EmptyState, LoadingState, SegmentedProgress } from "~/components/ui";
import { ErrorText, Panel, QueryError, formatDate } from "~/components/mdm/common";
import { Button } from "~/components/ui/button";
import { ArrowUpRight, HardDrive, Package, RefreshCw } from "~/components/ui/icons";
import { enterpriseQueries } from "~/lib/enterprise";
import type { StorageCategory, StorageObject } from "~/lib/enterprise";
import { formatBytes, formatShare, sharePercent } from "~/lib/format";
import { preloadPage } from "~/lib/page-data";
import { queryClient } from "~/lib/query-client";

const categoryTone = (id: string) => {
  if (id === "applications") return "bg-brand-solid";
  if (id === "policies") return "bg-info";
  if (id === "backups") return "bg-warning";

  return "bg-muted-foreground/40";
};

const categoryLabel = (categories: ReadonlyArray<StorageCategory>, id: string) =>
  categories.find((category) => category.id === id)?.label ?? id;

const objectLabel = (object: StorageObject) =>
  object.fileName ?? object.key.split("/").pop() ?? object.key;

export const route = {
  preload: ({ params, intent }: RoutePreloadFuncArgs) => {
    if (intent === "initial") return;

    return preloadPage([
      () => queryClient.ensureQueryData(enterpriseQueries.storageUsage(params.tenantId)),
    ]);
  },
};

export default function StorageSettingsPage() {
  const params = useParams();
  const usage = useQuery(() => enterpriseQueries.storageUsage(params.tenantId));

  const base = () => `/t/${params.tenantId}`;

  const manageHref = (id: string) => {
    if (id === "applications") return `${base()}/applications`;
    if (id === "policies") return `${base()}/policies`;

    return `${base()}/settings`;
  };

  const categories = createMemo(() => usage.data?.categories ?? []);
  const total = createMemo(() => usage.data?.usedBytes ?? 0);
  const segments = createMemo(() =>
    categories()
      .filter((category) => category.bytes > 0)
      .map((category) => ({
        label: category.label,
        value: category.bytes,
        class: categoryTone(category.id),
      })),
  );

  const computedAt = () => {
    const value = usage.data?.computedAt;

    if (!value) return undefined;
    const date = new Date(value);

    return Number.isNaN(date.getTime()) ? undefined : date.toLocaleTimeString();
  };

  return (
    <div class="grid gap-5">
      <QueryError error={usage.error} onRetry={() => void usage.refetch()} />

      <Panel
        title="Storage usage"
        description="Everything this tenant keeps in object storage, plus the files most worth reviewing."
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={usage.isFetching}
            onClick={() => void usage.refetch()}
          >
            <RefreshCw
              class={
                usage.isFetching ? "size-3.5 animate-spin motion-reduce:animate-none" : "size-3.5"
              }
            />
            {usage.isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        }
      >
        <Show
          when={usage.data}
          fallback={<LoadingState label="Scanning tenant storage…" size={18} pattern="scan" />}
        >
          {(data) => (
            <>
              <div class="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div class="label-caps">Total stored</div>
                  <p class="mt-1 text-[28px] font-[580] leading-none tracking-[-0.03em] tabular-nums text-foreground">
                    {formatBytes(data().usedBytes)}
                  </p>
                  <p class="mt-1.5 text-[11.5px] text-muted-foreground">
                    {data().objectCount} object{data().objectCount === 1 ? "" : "s"}
                    <Show when={computedAt()}> · scanned at {computedAt()}</Show>
                  </p>
                </div>
                <div class="flex items-center gap-2 rounded-lg border border-border bg-surface/50 px-3 py-2 text-[11px] text-muted-foreground">
                  <HardDrive class="size-3.5" />
                  Object storage
                </div>
              </div>

              <div class="mt-5">
                <Show
                  when={total() > 0}
                  fallback={<div class="h-2 w-full rounded-full bg-hover" />}
                >
                  <SegmentedProgress segments={segments()} label="Storage by category" />
                </Show>
              </div>

              <div class="mt-3 flex flex-wrap gap-x-5 gap-y-2">
                <For each={categories()}>
                  {(category) => (
                    <div class="flex items-center gap-2 text-[11.5px]">
                      <span class={`size-2 shrink-0 rounded-full ${categoryTone(category.id)}`} />
                      <span class="text-muted-foreground">{category.label}</span>
                      <span class="font-mono tabular-nums text-foreground">
                        {formatBytes(category.bytes)}
                      </span>
                      <span class="font-mono tabular-nums text-subtle-foreground">
                        {formatShare(category.bytes, total())}
                      </span>
                    </div>
                  )}
                </For>
              </div>

              <Show when={data().truncated}>
                <p
                  role="status"
                  class="mt-4 rounded-lg border border-warning/25 bg-warning/[0.07] px-3 py-2 text-[11.5px] text-warning-foreground"
                >
                  The scan stopped at 20,000 objects. Totals may be incomplete for a tenant this
                  large.
                </p>
              </Show>

              <p class="mt-4 border-t border-border pt-3 text-[11.5px] leading-5 text-muted-foreground">
                Storage counts toward the deployment's object-storage bill. Removing unused
                installers or old backups is the fastest way to reduce it.
              </p>
            </>
          )}
        </Show>
      </Panel>

      <Panel
        title="By category"
        description="How the bucket is split between application files, policy packages and tenant backups."
      >
        <Show
          when={categories().length > 0}
          fallback={<p class="text-[12.5px] text-muted-foreground">No storage categories yet.</p>}
        >
          <div class="overflow-x-auto">
            <table class="w-full min-w-[40rem] text-left text-[12px]">
              <thead>
                <tr class="border-b border-border text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground">
                  <th scope="col" class="py-2 pr-3 font-medium">
                    Category
                  </th>
                  <th scope="col" class="py-2 pr-3 text-right font-medium">
                    Objects
                  </th>
                  <th scope="col" class="py-2 pr-3 text-right font-medium">
                    Size
                  </th>
                  <th scope="col" class="py-2 pr-3 font-medium">
                    Share
                  </th>
                  <th scope="col" class="py-2 pr-3 text-right font-medium">
                    Added in 30 days
                  </th>
                  <th scope="col" class="py-2 text-right font-medium">
                    Manage
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                <For each={categories()}>
                  {(category) => (
                    <tr>
                      <td class="py-2.5 pr-3">
                        <span class="flex items-center gap-2">
                          <span
                            class={`size-2 shrink-0 rounded-full ${categoryTone(category.id)}`}
                          />
                          <span class="font-[500] text-foreground">{category.label}</span>
                        </span>
                      </td>
                      <td class="py-2.5 pr-3 text-right font-mono tabular-nums text-muted-foreground">
                        {category.objects}
                      </td>
                      <td class="py-2.5 pr-3 text-right font-mono tabular-nums text-foreground">
                        {formatBytes(category.bytes)}
                      </td>
                      <td class="py-2.5 pr-3">
                        <span class="flex items-center gap-2">
                          <span class="font-mono tabular-nums text-muted-foreground">
                            {formatShare(category.bytes, total())}
                          </span>
                          <span class="h-1 w-16 overflow-hidden rounded-full bg-muted">
                            <span
                              class={`block h-full rounded-full ${categoryTone(category.id)}`}
                              style={{ width: `${sharePercent(category.bytes, total())}%` }}
                            />
                          </span>
                        </span>
                      </td>
                      <td class="py-2.5 pr-3 text-right text-muted-foreground">
                        <Show
                          when={category.growthBytes > 0}
                          fallback={<span class="text-subtle-foreground">—</span>}
                        >
                          <span class="font-mono tabular-nums text-foreground">
                            +{formatBytes(category.growthBytes)}
                          </span>
                          <span class="ml-1.5 text-[10px] text-subtle-foreground">
                            +{category.growthObjects} obj
                          </span>
                        </Show>
                      </td>
                      <td class="py-2.5 text-right">
                        <a
                          class="inline-flex items-center gap-1 text-[11.5px] font-medium text-brand hover:underline"
                          href={manageHref(category.id)}
                        >
                          Manage
                          <ArrowUpRight class="size-3" />
                        </a>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
      </Panel>

      <Panel
        title="Largest objects"
        description="The files doing most of the work. Open their category to remove or replace them."
      >
        <Show
          when={(usage.data?.largest.length ?? 0) > 0}
          fallback={
            <EmptyState
              icon={<HardDrive />}
              title="Nothing stored yet"
              description="Installers, policy packages and backups will appear here once this tenant uploads one."
              action={
                <Button as="a" href={`${base()}/applications`} variant="outline" size="sm">
                  <Package class="size-3.5" />
                  Open applications
                </Button>
              }
            />
          }
        >
          <div class="overflow-x-auto">
            <table class="w-full min-w-[36rem] text-left text-[12px]">
              <thead>
                <tr class="border-b border-border text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground">
                  <th scope="col" class="py-2 pr-3 font-medium">
                    Object
                  </th>
                  <th scope="col" class="py-2 pr-3 font-medium">
                    Category
                  </th>
                  <th scope="col" class="py-2 pr-3 text-right font-medium">
                    Size
                  </th>
                  <th scope="col" class="py-2 pr-3 text-right font-medium">
                    Stored
                  </th>
                  <th scope="col" class="py-2 text-right font-medium" />
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                <For each={usage.data?.largest ?? []}>
                  {(object) => (
                    <tr>
                      <td class="max-w-[22rem] py-2.5 pr-3">
                        <span
                          class="block truncate font-mono text-[11.5px] text-foreground"
                          title={object.key}
                        >
                          {objectLabel(object)}
                        </span>
                      </td>
                      <td class="py-2.5 pr-3 text-muted-foreground">
                        {categoryLabel(categories(), object.category)}
                      </td>
                      <td class="py-2.5 pr-3 text-right font-mono tabular-nums text-foreground">
                        {formatBytes(object.bytes)}
                      </td>
                      <td class="py-2.5 pr-3 text-right text-muted-foreground">
                        {formatDate(object.uploadedAt)}
                      </td>
                      <td class="py-2.5 text-right">
                        <a
                          class="inline-flex items-center gap-1 text-[11.5px] font-medium text-brand hover:underline"
                          href={manageHref(object.category)}
                        >
                          Manage
                          <ArrowUpRight class="size-3" />
                        </a>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
      </Panel>

      <ErrorText error={usage.error} />
    </div>
  );
}
