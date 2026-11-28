import { useParams, useSearchParams } from "@solidjs/router";
import { useInfiniteQuery } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import {
  EmptyState,
  formatDate,
  LinkButton,
  Page,
  PageHeader,
  relativeTime,
} from "~/components/mdm/common";
import EntityHoverCard from "~/components/entity-hover-card";
import EntityActions from "~/components/mdm/entity-actions";
import { EntityQueryBar, formatEntityQuery, parseEntityQuery } from "~/components/mdm/entity-query";
import type { EntityCondition, EntityField } from "~/components/mdm/entity-query";
import { MdmTable } from "~/components/mdm/entity-table";
import type { MdmSortState } from "~/components/mdm/entity-table";
import { Button } from "@mattrax/ui";
import { Badge } from "@mattrax/ui";
import { ShieldCheck } from "~/components/ui/app-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@mattrax/ui";
import { enterprise } from "~/lib/enterprise";
import type { PolicyRow } from "~/lib/enterprise";
import {
  isPolicyEnabled,
  policyRowDeliveryPresentation,
  policyScopePresentation,
  policyStatePresentation,
} from "~/lib/policy-delivery";
import { useCan } from "~/lib/permissions";
import { routes } from "~/lib/routes";
import { preloadPage } from "~/lib/page-data";
import { queryClient } from "~/lib/query-client";
import { enterpriseQueries } from "~/lib/enterprise";
import { collectAllMatching } from "~/lib/bulk-selection";

const PAGE_SIZE = 50;

const configurationCount = (row: PolicyRow) =>
  row.configurationCount ?? Object.keys(row.configurations ?? {}).length;

function PolicyCountCell(props: { count: number | undefined; label: string; description: string }) {
  return (
    <Tooltip>
      <span class="inline-flex cursor-default rounded-xs tabular-nums outline-none focus-within:outline-none focus-within:ring-2 focus-within:ring-ring/40">
        <TooltipTrigger
          as="span"
          tabindex={0}
          aria-label={`${props.label}. ${props.description}`}
        >
          <span class={props.count && props.count > 0 ? undefined : "text-muted-foreground"}>
            {props.count ?? "—"}
          </span>
        </TooltipTrigger>
      </span>
      <TooltipContent class="max-w-65">{props.description}</TooltipContent>
    </Tooltip>
  );
}

function PolicyDeliveryCell(props: { row: PolicyRow }) {
  // A disabled policy keeps its last declaration rows, so the derived state
  // would read "Delivered" long after delivery stopped. The enable/disable
  // state wins over the stale delivery rollup.
  const presentation = () => policyRowDeliveryPresentation(props.row);

  return (
    <Show
      when={presentation()}
      fallback={
        <span class="text-muted-foreground" aria-label="Delivery not reported">
          —
        </span>
      }
    >
      {(info) => (
        <Tooltip>
          <span class="inline-flex cursor-default rounded-xs outline-none focus-within:outline-none focus-within:ring-2 focus-within:ring-ring/40">
            <TooltipTrigger
              as="span"
              tabindex={0}
              aria-label={`${info().label}. ${info().description}`}
            >
              <Badge variant={info().tone} dot={info().dot}>
                {info().label}
              </Badge>
            </TooltipTrigger>
          </span>
          <TooltipContent class="max-w-70">
            <p class="text-xs font-medium">{info().label}</p>
            <p class="mt-1 text-xs leading-relaxed">{info().description}</p>
          </TooltipContent>
        </Tooltip>
      )}
    </Show>
  );
}

const fields: ReadonlyArray<EntityField<PolicyRow>> = [
  { id: "name", label: "Name", kind: "text", get: (row) => row.name },
  { id: "notes", label: "Notes", kind: "text", get: (row) => row.notes ?? "" },
  { id: "priority", label: "Priority", kind: "number", get: (row) => row.priority ?? 0 },
  {
    id: "configurations",
    label: "Configurations",
    kind: "number",
    get: (row) => configurationCount(row),
  },
];

export const route = {
  preload: ({ params, intent }: { params: { tenantId?: string }; intent: string }) => {
    const tenantId = params.tenantId;

    if (intent === "initial" || !tenantId) return;

    // The first unfiltered page only; deeper pages follow the offset the
    // table requests as the operator scrolls.
    return preloadPage([
      () =>
        queryClient.ensureInfiniteQueryData(
          enterpriseQueries.searchPolicies(tenantId, {
            limit: PAGE_SIZE,
            sort: "name",
            direction: "asc",
          }),
        ),
    ]);
  },
};

export default function PoliciesPage() {
  const params = useParams();
  const { can } = useCan();
  const [searchParams, setSearchParams] = useSearchParams();
  const param = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

  const [conditions, setConditions] = createSignal<EntityCondition[]>(
    parseEntityQuery(param(searchParams.query), fields),
  );

  // Mirror back/forward and shared links into the query bar. The signal is
  // seeded once; without this, a URL change while the page stays mounted was
  // ignored.
  createEffect(
    () => param(searchParams.query),
    (value) => {
      setConditions(parseEntityQuery(value, fields));
    },
  );

  const updateConditions = (next: EntityCondition[]) => {
    setConditions(next);
    setSearchParams({ query: formatEntityQuery(next) }, { replace: true });
  };

  const [q, setQ] = createSignal("");
  const [debouncedQ, setDebouncedQ] = createSignal("");
  const [sort, setSort] = createSignal<MdmSortState>({ id: "name", dir: "asc" });

  // Debounce typing so the search endpoint is not hit on every keystroke.
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(settleTimer));
  createEffect(
    () => q(),
    (value) => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => setDebouncedQ(value), 250);
    },
  );

  const SORT_FIELDS = ["name", "priority", "updatedAt", "createdAt"] as const;
  const sortField = () => SORT_FIELDS.find((field) => field === sort()?.id) ?? ("name" as const);

  const filters = createMemo(() => ({
    q: debouncedQ().trim() || undefined,
    query: formatEntityQuery(conditions()) || undefined,
    limit: PAGE_SIZE,
    sort: sortField(),
    direction: sort()?.dir ?? ("asc" as const),
  }));

  const policies = useInfiniteQuery(() =>
    enterpriseQueries.searchPolicies(params.tenantId, filters()),
  );

  const rows = () => policies.data?.pages.flatMap((page) => page.policies) ?? [];
  const total = () => policies.data?.pages.at(-1)?.total ?? 0;

  /** Non-blocking notice when the filters change under a load in flight. */
  const [filtersChanged, setFiltersChanged] = createSignal(false);

  const filterKey = () =>
    JSON.stringify({ q: debouncedQ(), query: formatEntityQuery(conditions()) });

  let lastFilterKey = filterKey();
  createEffect(filterKey, (key) => {
    if (key !== lastFilterKey) {
      lastFilterKey = key;
      setFiltersChanged(true);
    }
  });
  createEffect(
    () => policies.isFetching,
    (fetching) => {
      if (!fetching) setFiltersChanged(false);
    },
  );
  const loadingWarning = () => filtersChanged() && policies.isFetching;

  const hasFilters = () => q().trim() !== "" || conditions().length > 0;

  /** Resolve every policy the active filter matches for "select all matching". */
  const resolveAll = () =>
    collectAllMatching(async (offset, limit) => {
      const result = await enterprise.searchPolicies(params.tenantId, {
        ...filters(),
        limit,
        offset,
      });

      return { rows: result.policies, total: result.total };
    });

  return (
    <Page>
      <PageHeader
        eyebrow="Configuration"
        title="Policies"
        description="Configure device restrictions, payloads, and deployment behavior."
        meta={
          <Show when={policies.data}>
            <span class="tabular-nums">
              {total()} {total() === 1 ? "policy" : "policies"}
            </span>
            <span class="text-muted-foreground/40" aria-hidden="true">
              ·
            </span>
            <span class="tabular-nums">{rows().length} loaded</span>
          </Show>
        }
        actions={
          <Show when={can("policies.write")}>
            <div class="flex items-center gap-2">
              <LinkButton variant="outline" href={routes.tenant(params.tenantId).importPolicy()}>
                Import
              </LinkButton>
              <Show when={total() > 0}>
                <LinkButton href={routes.tenant(params.tenantId).newPolicy()}>
                  Create policy
                </LinkButton>
              </Show>
            </div>
          </Show>
        }
      />
      <MdmTable<PolicyRow>
        mode="server"
        rows={rows()}
        total={total()}
        selectable={can("policies.write")}
        loading={policies.isPending}
        isFetching={policies.isFetching}
        onRefresh={() => void policies.refetch()}
        error={policies.error}
        storageKey="policies"
        selectionKey={JSON.stringify(filters())}
        searchValue={q()}
        onSearchChange={setQ}
        searchPlaceholder="Search policies…"
        sortValue={sort()}
        onSortChange={setSort}
        inlineToolbar={
          <EntityQueryBar
            inline
            fields={fields}
            conditions={conditions()}
            onChange={updateConditions}
          />
        }
        toolbar={
          <Show when={loadingWarning()}>
            <p
              role="status"
              aria-live="polite"
              class="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-muted-foreground"
            >
              Filters changed — loading results. The rows below are from the previous filter until
              this finishes.
            </p>
          </Show>
        }
        footer={
          <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-3.5 py-2 shadow-card">
            <span
              role="status"
              aria-live="polite"
              class="text-xs tabular-nums text-muted-foreground"
            >
              {rows().length} of {total()} policy{total() === 1 ? "" : "s"} loaded
            </span>
            <Show
              when={policies.hasNextPage}
              fallback={
                <span class="text-xs text-muted-foreground">
                  All matching policies are loaded.
                </span>
              }
            >
              <Button
                variant="outline"
                size="sm"
                disabled={policies.isFetchingNextPage || policies.isPlaceholderData}
                onClick={() => void policies.fetchNextPage()}
              >
                {policies.isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            </Show>
          </div>
        }
        rowHref={(row) => routes.tenant(params.tenantId).policy(row.id)}
        actions={(selected, clear, select, selection) => (
          <EntityActions
            entity="policy"
            selected={selected}
            clear={clear}
            select={select}
            allMatching={selection.allMatching}
            total={selection.total}
            resolveAll={resolveAll}
          />
        )}
        empty={
          hasFilters() ? (
            <EmptyState
              icon={(props) => <ShieldCheck {...props} />}
              title="No matching policies"
              description="Adjust the search or filter, or clear it from the query bar."
            />
          ) : (
            <EmptyState
              icon={(props) => <ShieldCheck {...props} />}
              title="No policies"
              description="Create a policy to start configuring managed devices."
              action={
                <Show when={can("policies.write")}>
                  <LinkButton href={routes.tenant(params.tenantId).newPolicy()}>
                    Create policy
                  </LinkButton>
                </Show>
              }
            />
          )
        }
        columns={[
          {
            id: "name",
            header: "Policy",
            sort: (row) => row.name,
            search: (row) => `${row.name} ${row.notes ?? ""}`,
            cell: (row) => (
              <span class="block min-w-0">
                <span class="flex min-w-0 items-center gap-1.5">
                  <EntityHoverCard
                    preview={{ kind: "policy", policy: row }}
                    href={routes.tenant(params.tenantId).policy(row.id)}
                    class="block min-w-0 truncate font-medium hover:underline"
                  >
                    {row.name}
                  </EntityHoverCard>
                  <Show when={!isPolicyEnabled(row)}>
                    <Badge
                      variant={policyStatePresentation(row).tone}
                      dot="warning"
                      title={policyStatePresentation(row).description}
                    >
                      Disabled
                    </Badge>
                  </Show>
                </span>
                <Show when={row.notes}>
                  <span
                  class="mt-0.5 block max-w-(--notes-width) truncate text-xs text-muted-foreground"
                  style={{ "--notes-width": "38ch" }}
                >
                    {row.notes}
                  </span>
                </Show>
              </span>
            ),
          },
          {
            id: "configurations",
            header: "Configurations",
            // Derived counts are not sortable across server pages.
            cell: (row) => {
              const count = configurationCount(row);

              return (
                <span class="inline-flex items-center gap-1.5">
                  <Badge variant={count > 0 ? "secondary" : "outline"}>
                    {count}
                  </Badge>
                  <Show when={(row.userConfigurationCount ?? 0) > 0}>
                    <Badge
                      variant="outline"
                      title="Configurations delivered on the Apple user channel"
                    >
                      {row.userConfigurationCount} user
                    </Badge>
                  </Show>
                </span>
              );
            },
          },
          {
            id: "devices",
            header: "Devices",
            cell: (row) => {
              const scope = () =>
                policyScopePresentation({
                  deviceCount: row.scopedDeviceCount,
                  userCount: row.scopedUserCount,
                });

              return (
                <PolicyCountCell
                  count={row.scopedDeviceCount}
                  label={scope().devices.label}
                  description={scope().devices.description}
                />
              );
            },
          },
          {
            id: "users",
            header: "Users",
            cell: (row) => {
              const scope = () =>
                policyScopePresentation({
                  deviceCount: row.scopedDeviceCount,
                  userCount: row.scopedUserCount,
                });

              return (
                <PolicyCountCell
                  count={row.scopedUserCount}
                  label={scope().users.label}
                  description={scope().users.description}
                />
              );
            },
          },
          {
            id: "delivery",
            header: "Delivery",
            cell: (row) => <PolicyDeliveryCell row={row} />,
          },
          {
            id: "priority",
            header: "Priority",
            sort: (row) => row.priority,
            cell: (row) => (
              <span class="tabular-nums text-muted-foreground">{row.priority ?? 0}</span>
            ),
          },
          {
            id: "updated",
            header: "Updated",
            sort: (row) => row.updatedAt,
            sortId: "updatedAt",
            cell: (row) => (
              <span class="block min-w-0">
                <span class="block whitespace-nowrap text-xs">
                  {relativeTime(row.updatedAt)}
                </span>
                <span class="block truncate text-xs text-muted-foreground">
                  {formatDate(row.updatedAt)}
                </span>
              </span>
            ),
          },
          {
            id: "created",
            header: "Created",
            defaultHidden: true,
            sort: (row) => row.createdAt,
            sortId: "createdAt",
            cell: (row) => (
              <span class="whitespace-nowrap text-xs text-muted-foreground">
                {formatDate(row.createdAt)}
              </span>
            ),
          },
        ]}
      />
    </Page>
  );
}
