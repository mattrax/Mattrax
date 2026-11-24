import { useParams, useSearchParams } from "@solidjs/router";
import type { RoutePreloadFuncArgs } from "@solidjs/router";
import { Match } from "effect";
import { useInfiniteQuery } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import {
  EmptyState,
  formatDate,
  LinkButton,
  Page,
  PageHeader,
  PlatformBadge,
  relativeTime,
} from "~/components/mdm/common";
import { ApplicationViewTabs } from "~/components/mdm/application-view-tabs";
import { MdmTable } from "~/components/mdm/table";
import type { MdmSortState } from "~/components/mdm/table";
import { Button } from "~/components/ui/button";
import { EntityQueryBar, formatEntityQuery, parseEntityQuery } from "~/components/mdm/entity-query";
import type { EntityCondition, EntityField } from "~/components/mdm/entity-query";
import { Badge } from "~/components/ui/badge";
import { Package } from "~/components/ui/icons";
import { enterpriseQueries } from "~/lib/enterprise";
import type { ApplicationRow } from "~/lib/enterprise";
import { preloadPage } from "~/lib/page-data";
import { useCan } from "~/lib/permissions";
import { queryClient } from "~/lib/query-client";
import { routes } from "~/lib/routes";

const PAGE_SIZE = 50;

export const route = {
  preload: ({ params, intent }: RoutePreloadFuncArgs) => {
    if (intent === "initial") return;

    return preloadPage([
      () =>
        queryClient.ensureInfiniteQueryData(
          enterpriseQueries.searchApplications(params.tenantId, {
            limit: PAGE_SIZE,
            sort: "name",
            direction: "asc",
          }),
        ),
    ]);
  },
};

const sourceLabel = (source: ApplicationRow["source"]) =>
  Match.value(source).pipe(
    Match.when("manifest", () => "Manifest"),
    Match.when("store", () => "App Store"),
    Match.orElse(() => "Uploaded"),
  );

const fields: ReadonlyArray<EntityField<ApplicationRow>> = [
  { id: "name", label: "Name", kind: "text", get: (row) => row.name },
  { id: "bundle", label: "Bundle ID", kind: "text", get: (row) => row.bundleId ?? "" },
  {
    id: "platform",
    label: "Platform",
    kind: "select",
    options: [
      { value: "apple", label: "Apple" },
      { value: "win", label: "Windows" },
      { value: "android", label: "Android" },
    ],
    get: (row) => row.platform,
  },
  {
    id: "source",
    label: "Source",
    kind: "select",
    options: [
      { value: "manifest", label: "Manifest" },
      { value: "store", label: "App Store" },
      { value: "upload", label: "Uploaded" },
    ],
    get: (row) => row.source,
  },
  { id: "version", label: "Version", kind: "text", get: (row) => row.version ?? "" },
  { id: "devices", label: "Assigned devices", kind: "number", get: (row) => row.devicesCount ?? 0 },
  {
    id: "availability",
    label: "Availability",
    kind: "select",
    options: [
      { value: "unknown", label: "Not checked" },
      { value: "available", label: "Available" },
      { value: "unavailable", label: "Unavailable" },
    ],
    get: (row) => row.availability ?? "unknown",
  },
];

export default function ApplicationsPage() {
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

  const SORT_FIELDS = ["name", "platform", "source", "updatedAt", "createdAt"] as const;
  const sortField = () => SORT_FIELDS.find((field) => field === sort()?.id) ?? ("name" as const);

  const filters = createMemo(() => ({
    q: debouncedQ().trim() || undefined,
    query: formatEntityQuery(conditions()) || undefined,
    limit: PAGE_SIZE,
    sort: sortField(),
    direction: sort()?.dir ?? ("asc" as const),
  }));

  const apps = useInfiniteQuery(() =>
    enterpriseQueries.searchApplications(params.tenantId, filters()),
  );

  const rows = () => apps.data?.pages.flatMap((page) => page.applications) ?? [];
  const total = () => apps.data?.pages.at(-1)?.total ?? 0;

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
    () => apps.isFetching,
    (fetching) => {
      if (!fetching) setFiltersChanged(false);
    },
  );
  const loadingWarning = () => filtersChanged() && apps.isFetching;

  const hasFilters = () => q().trim() !== "" || conditions().length > 0;

  return (
    <Page>
      <PageHeader
        eyebrow="Applications"
        title="Applications"
        description="Catalogue installers and assign them to groups or devices."
        meta={
          <Show when={apps.data}>
            <span class="tabular-nums">
              {total()} application{total() === 1 ? "" : "s"}
            </span>
            <span class="text-muted-foreground/40" aria-hidden="true">
              ·
            </span>
            <span class="tabular-nums">{rows().length} loaded</span>
          </Show>
        }
        actions={
          <div class="flex flex-wrap items-center gap-2">
            <Show when={can("applications.write")}>
              <LinkButton href={routes.tenant(params.tenantId).newApplication()}>
                Add application
              </LinkButton>
            </Show>
          </div>
        }
      />
      <ApplicationViewTabs tenantId={params.tenantId ?? ""} active="applications" />
      <MdmTable<ApplicationRow>
        mode="server"
        rows={rows()}
        total={total()}
        loading={apps.isPending}
        isFetching={apps.isFetching}
        onRefresh={() => void apps.refetch()}
        error={apps.error}
        storageKey="applications"
        selectionKey={JSON.stringify(filters())}
        searchValue={q()}
        onSearchChange={setQ}
        searchPlaceholder="Search applications…"
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
              {rows().length} of {total()} application{total() === 1 ? "" : "s"} loaded
            </span>
            <Show
              when={apps.hasNextPage}
              fallback={
                <span class="text-[12px] text-muted-foreground">
                  All matching applications are loaded.
                </span>
              }
            >
              <Button
                variant="outline"
                size="sm"
                disabled={apps.isFetchingNextPage || apps.isPlaceholderData}
                onClick={() => void apps.fetchNextPage()}
              >
                {apps.isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            </Show>
          </div>
        }
        rowHref={(row) => routes.tenant(params.tenantId).application(row.id)}
        empty={
          hasFilters() ? (
            <EmptyState
              icon={(props) => <Package {...props} />}
              title="No matching applications"
              description="Adjust the filter or clear it from the query bar."
            />
          ) : (
            <EmptyState
              icon={(props) => <Package {...props} />}
              title="No applications"
              description="Add an Apple manifest or App Store app, or catalogue a Windows/Android package."
              action={
                <Show when={can("applications.write")}>
                  <LinkButton href={routes.tenant(params.tenantId).newApplication()}>
                    Add application
                  </LinkButton>
                </Show>
              }
            />
          )
        }
        columns={[
          {
            id: "name",
            header: "Application",
            sort: (row) => row.name,
            search: (row) => `${row.name} ${row.bundleId ?? ""} ${row.version ?? ""}`,
            cell: (row) => (
              <span class="block min-w-0">
                <a
                  class="block truncate font-medium hover:underline"
                  href={routes.tenant(params.tenantId).application(row.id)}
                >
                  {row.name}
                </a>
                <span class="mt-0.5 flex items-center gap-1.5">
                  <span class="block max-w-[34ch] truncate font-mono text-[11px] text-muted-foreground">
                    {row.bundleId || "No bundle identifier"}
                  </span>
                  <Show when={row.availability === "unavailable"}>
                    <Badge variant="destructive" dot="destructive">
                      Unavailable
                    </Badge>
                  </Show>
                </span>
              </span>
            ),
          },
          {
            id: "platform",
            header: "Platform",
            sort: (row) => row.platform,
            search: (row) => row.platform,
            cell: (row) => <PlatformBadge proto={row.platform} />,
          },
          {
            id: "source",
            header: "Source",
            sort: (row) => row.source,
            search: (row) => row.source,
            cell: (row) => (
              <Badge variant="outline" class="text-muted-foreground">
                {sourceLabel(row.source)}
              </Badge>
            ),
          },
          {
            id: "version",
            header: "Version",
            cell: (row) => (
              <span class="whitespace-nowrap text-[12.5px] tabular-nums">{row.version || "—"}</span>
            ),
          },
          {
            id: "assignments",
            header: "Assignments",
            cell: (row) => {
              const groups = (row.groupsCount ?? 0) + (row.userGroupsCount ?? 0);
              const devices = row.devicesCount ?? 0;

              return (
                <Show
                  when={groups + devices > 0}
                  fallback={<span class="text-[12px] text-muted-foreground">Unassigned</span>}
                >
                  <span class="flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary" class="tabular-nums">
                      {groups} group{groups === 1 ? "" : "s"}
                    </Badge>
                    <Badge variant="secondary" class="tabular-nums">
                      {devices} device{devices === 1 ? "" : "s"}
                    </Badge>
                  </span>
                </Show>
              );
            },
          },
          {
            id: "updated",
            header: "Updated",
            sort: (row) => row.updatedAt,
            sortId: "updatedAt",
            cell: (row) => (
              <span class="block min-w-0">
                <span class="block whitespace-nowrap text-[12.5px]">
                  {relativeTime(row.updatedAt)}
                </span>
                <span class="block truncate text-[11px] text-muted-foreground">
                  {formatDate(row.updatedAt)}
                </span>
              </span>
            ),
          },
          {
            id: "created",
            header: "Added",
            defaultHidden: true,
            sort: (row) => row.createdAt,
            sortId: "createdAt",
            cell: (row) => (
              <span class="whitespace-nowrap text-[12.5px] text-muted-foreground">
                {formatDate(row.createdAt)}
              </span>
            ),
          },
        ]}
      />
    </Page>
  );
}
