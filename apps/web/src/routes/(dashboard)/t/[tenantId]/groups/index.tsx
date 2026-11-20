import { useParams, useSearchParams } from "@solidjs/router";
import { useInfiniteQuery } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import { EmptyState, formatDate, LinkButton, Page, PageHeader } from "~/components/mdm/common";
import { EntityHoverCard } from "~/components/entity-hover-card";
import { EntityActions } from "~/components/mdm/entity-actions";
import {
  EntityQueryBar,
  formatEntityQuery,
  parseEntityQuery,
  type EntityCondition,
  type EntityField,
} from "~/components/mdm/entity-query";
import { MdmTable, type MdmSortState } from "~/components/mdm/table";
import { Button } from "~/components/ui/button";
import { UsersRound } from "~/components/ui/icons";
import { enterprise, type GroupRow } from "~/lib/enterprise";
import { useCan } from "~/lib/permissions";
import { routes } from "~/lib/routes";
import { preloadPage } from "~/lib/page-data";
import { queryClient } from "~/lib/query-client";
import { enterpriseQueries } from "~/lib/enterprise";
import { collectAllMatching } from "~/lib/bulk-selection";

const PAGE_SIZE = 50;

function MembershipBadge(props: { kind: GroupRow["kind"]; directoryGroupId?: string | null }) {
  const directory = () => Boolean(props.directoryGroupId);
  const dynamic = () => props.kind === "dynamic";

  return (
    <span
      class={
        dynamic() || directory()
          ? "inline-flex items-center gap-1.5 rounded-full border border-border bg-hover px-2 py-0.5 text-[11px] font-medium text-foreground/85"
          : "inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
      }
      title={directory() ? "Membership follows a linked directory group" : undefined}
    >
      <span class="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {directory() ? "Directory" : dynamic() ? "Dynamic" : "Manual"}
    </span>
  );
}

const fields: ReadonlyArray<EntityField<GroupRow>> = [
  { id: "name", label: "Name", kind: "text", get: (row) => row.name },
  {
    id: "kind",
    label: "Membership",
    kind: "select",
    options: [
      { value: "manual", label: "Manual" },
      { value: "dynamic", label: "Dynamic" },
      { value: "directory", label: "Directory" },
    ],
    get: (row) => (row.directoryGroupId ? "directory" : (row.kind ?? "manual")),
  },
  { id: "devices", label: "Devices", kind: "number", get: (row) => row.devicesCount ?? 0 },
  { id: "policies", label: "Policies", kind: "number", get: (row) => row.policiesCount ?? 0 },
];

export const route = {
  preload: ({ params, intent }: { params: { tenantId?: string }; intent: string }) => {
    const tenantId = params.tenantId;

    if (intent === "initial" || !tenantId) return;

    return preloadPage([
      () =>
        queryClient.ensureInfiniteQueryData(
          enterpriseQueries.searchGroups(tenantId, {
            limit: PAGE_SIZE,
            sort: "name",
            direction: "asc",
          }),
        ),
    ]);
  },
};

export default function GroupsPage() {
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

  const SORT_FIELDS = ["name", "kind", "updatedAt", "createdAt"] as const;
  const sortField = () => SORT_FIELDS.find((field) => field === sort()?.id) ?? ("name" as const);

  const filters = createMemo(() => ({
    q: debouncedQ().trim() || undefined,
    query: formatEntityQuery(conditions()) || undefined,
    limit: PAGE_SIZE,
    sort: sortField(),
    direction: sort()?.dir ?? ("asc" as const),
  }));

  const groups = useInfiniteQuery(() => enterpriseQueries.searchGroups(params.tenantId, filters()));

  const rows = () => groups.data?.pages.flatMap((page) => page.groups) ?? [];
  const total = () => groups.data?.pages.at(-1)?.total ?? 0;

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
    () => groups.isFetching,
    (fetching) => {
      if (!fetching) setFiltersChanged(false);
    },
  );
  const loadingWarning = () => filtersChanged() && groups.isFetching;

  const hasFilters = () => q().trim() !== "" || conditions().length > 0;

  /** Resolve every group the active filter matches for "select all matching". */
  const resolveAll = () =>
    collectAllMatching(async (offset, limit) => {
      const result = await enterprise.searchGroups(params.tenantId, {
        ...filters(),
        limit,
        offset,
      });

      return { rows: result.groups, total: result.total };
    });

  return (
    <Page>
      <PageHeader
        title="Groups"
        description="Scope devices and policies into reusable deployment targets."
        actions={
          <Show when={can("groups.write") && total() > 0}>
            <LinkButton href={routes.tenant(params.tenantId).newGroup()}>Create group</LinkButton>
          </Show>
        }
      />
      <MdmTable<GroupRow>
        mode="server"
        rows={rows()}
        total={total()}
        selectable={can("groups.write")}
        loading={groups.isPending}
        isFetching={groups.isFetching}
        onRefresh={() => void groups.refetch()}
        error={groups.error}
        storageKey="groups"
        selectionKey={JSON.stringify(filters())}
        searchValue={q()}
        onSearchChange={setQ}
        searchPlaceholder="Search groups…"
        sortValue={sort()}
        onSortChange={setSort}
        toolbar={
          <div class="space-y-2">
            <EntityQueryBar fields={fields} conditions={conditions()} onChange={updateConditions} />
            <Show when={loadingWarning()}>
              <p
                role="status"
                aria-live="polite"
                class="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12px] text-muted-foreground"
              >
                Filters changed — loading results. The rows below are from the previous filter until
                this finishes.
              </p>
            </Show>
          </div>
        }
        footer={
          <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-3.5 py-2 shadow-card">
            <span
              role="status"
              aria-live="polite"
              class="text-[12px] tabular-nums text-muted-foreground"
            >
              {rows().length} of {total()} group{total() === 1 ? "" : "s"} loaded
            </span>
            <Show
              when={groups.hasNextPage}
              fallback={
                <span class="text-[12px] text-muted-foreground">
                  All matching groups are loaded.
                </span>
              }
            >
              <Button
                variant="outline"
                size="sm"
                disabled={groups.isFetchingNextPage || groups.isPlaceholderData}
                onClick={() => void groups.fetchNextPage()}
              >
                {groups.isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            </Show>
          </div>
        }
        rowHref={(row) => routes.tenant(params.tenantId).group(row.id)}
        actions={(selected, clear, select, selection) => (
          <EntityActions
            entity="group"
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
              icon={UsersRound}
              title="No matching groups"
              description="Adjust the filter or clear it from the query bar."
            />
          ) : (
            <EmptyState
              icon={UsersRound}
              title="No groups"
              description="Create a group to organize devices and attach policy scope."
              action={
                <Show when={can("groups.write")}>
                  <LinkButton href={routes.tenant(params.tenantId).newGroup()}>
                    Create group
                  </LinkButton>
                </Show>
              }
            />
          )
        }
        columns={[
          {
            id: "name",
            header: "Name",
            sort: (row) => row.name,
            search: (row) => row.name,
            cell: (row) => (
              <div class="min-w-0">
                <EntityHoverCard
                  preview={{ kind: "group", group: row }}
                  href={routes.tenant(params.tenantId).group(row.id)}
                  class="font-medium text-foreground hover:underline"
                >
                  {row.name}
                </EntityHoverCard>
                <Show when={row.notes?.trim()}>
                  {(notes) => (
                    <span class="mt-0.5 block max-w-[320px] truncate text-[11px] text-muted-foreground">
                      {notes()}
                    </span>
                  )}
                </Show>
              </div>
            ),
          },
          {
            id: "kind",
            header: "Membership",
            sort: (row) => row.kind ?? "manual",
            search: (row) => row.kind ?? "manual",
            cell: (row) => (
              <MembershipBadge kind={row.kind} directoryGroupId={row.directoryGroupId} />
            ),
          },
          {
            id: "devices",
            header: "Devices",
            cell: (row) =>
              (row.kind ?? "manual") === "dynamic" ? (
                <span class="text-muted-foreground">Rule-based</span>
              ) : (
                <span class="tabular-nums text-foreground">{row.devicesCount ?? 0}</span>
              ),
          },
          {
            id: "policies",
            header: "Policies",
            cell: (row) => (
              <span class="tabular-nums text-foreground">{row.policiesCount ?? 0}</span>
            ),
          },
          {
            id: "updated",
            header: "Updated",
            sort: (row) => row.updatedAt,
            sortId: "updatedAt",
            cell: (row) => (
              <span class="whitespace-nowrap text-[12.5px] text-muted-foreground">
                {formatDate(row.updatedAt)}
              </span>
            ),
          },
        ]}
      />
    </Page>
  );
}
