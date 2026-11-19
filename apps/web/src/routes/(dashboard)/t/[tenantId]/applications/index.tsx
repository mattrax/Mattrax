import { type RoutePreloadFuncArgs, useParams, useSearchParams } from "@solidjs/router";
import { Match } from "effect";
import { useQuery } from "@tanstack/solid-query";
import { createEffect, createSignal, Show } from "solid-js";
import {
  EmptyState,
  formatDate,
  LinkButton,
  Page,
  PageHeader,
  PlatformBadge,
  relativeTime,
} from "~/components/mdm/common";
import { MdmTable } from "~/components/mdm/table";
import {
  EntityQueryBar,
  formatEntityQuery,
  matchesEntityQuery,
  parseEntityQuery,
  type EntityCondition,
  type EntityField,
} from "~/components/mdm/entity-query";
import { Badge } from "~/components/ui/badge";
import { Package } from "~/components/ui/icons";
import { enterpriseQueries, type ApplicationRow } from "~/lib/enterprise";
import { preloadPage } from "~/lib/page-data";
import { useCan } from "~/lib/permissions";
import { queryClient } from "~/lib/query-client";
import { routes } from "~/lib/routes";

export const route = {
  preload: ({ params, intent }: RoutePreloadFuncArgs) => {
    if (intent === "initial") return;

    return preloadPage([
      () => queryClient.ensureQueryData(enterpriseQueries.applications(params.tenantId)),
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

  const apps = useQuery(() => enterpriseQueries.applications(params.tenantId));

  const rows = () =>
    (apps.data?.applications ?? []).filter((row) => matchesEntityQuery(conditions(), row, fields));

  const assignedCount = () =>
    rows().filter(
      (row) => (row.groupsCount ?? 0) + (row.userGroupsCount ?? 0) + (row.devicesCount ?? 0) > 0,
    ).length;

  return (
    <Page>
      <PageHeader
        eyebrow="Catalogue"
        title="Applications"
        description="Catalogue installers and assign them to groups or devices."
        meta={
          <Show when={apps.data}>
            <span class="tabular-nums">
              {rows().length} application{rows().length === 1 ? "" : "s"}
            </span>
            <span class="text-muted-foreground/40" aria-hidden="true">
              ·
            </span>
            <span class="tabular-nums">{assignedCount()} assigned</span>
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
      <MdmTable<ApplicationRow>
        rows={rows()}
        loading={apps.isPending}
        isFetching={apps.isFetching}
        onRefresh={() => void apps.refetch()}
        error={apps.error}
        storageKey="applications"
        toolbar={
          <EntityQueryBar fields={fields} conditions={conditions()} onChange={updateConditions} />
        }
        rowHref={(row) => routes.tenant(params.tenantId).application(row.id)}
        empty={
          conditions().length > 0 ? (
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
                <span class="mt-0.5 block max-w-[34ch] truncate font-mono text-[11px] text-muted-foreground">
                  {row.bundleId || "No bundle identifier"}
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
            sort: (row) => row.version ?? "",
            cell: (row) => (
              <span class="whitespace-nowrap text-[12.5px] tabular-nums">{row.version || "—"}</span>
            ),
          },
          {
            id: "assignments",
            header: "Assignments",
            sort: (row) =>
              (row.groupsCount ?? 0) + (row.userGroupsCount ?? 0) + (row.devicesCount ?? 0),
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
