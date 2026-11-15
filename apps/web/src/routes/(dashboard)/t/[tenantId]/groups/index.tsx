import { useParams, useSearchParams } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { createSignal, Show } from "solid-js";
import { EmptyState, formatDate, LinkButton, Page, PageHeader } from "~/components/mdm/common";
import { EntityActions } from "~/components/mdm/entity-actions";
import {
  EntityQueryBar,
  formatEntityQuery,
  matchesEntityQuery,
  parseEntityQuery,
  type EntityCondition,
  type EntityField,
} from "~/components/mdm/entity-query";
import { MdmTable } from "~/components/mdm/table";
import { UsersRound } from "~/components/ui/icons";
import { enterprise, enterpriseKeys, type GroupRow } from "~/lib/enterprise";
import { useCan } from "~/lib/permissions";

function MembershipBadge(props: { kind: GroupRow["kind"] }) {
  const dynamic = () => props.kind === "dynamic";

  return (
    <span
      class={
        dynamic()
          ? "inline-flex items-center gap-1.5 rounded-full border border-border bg-hover px-2 py-0.5 text-[11px] font-medium text-foreground/85"
          : "inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
      }
    >
      <span class="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {dynamic() ? "Dynamic" : "Manual"}
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
    ],
    get: (row) => row.kind ?? "manual",
  },
  { id: "devices", label: "Devices", kind: "number", get: (row) => row.devicesCount ?? 0 },
  { id: "policies", label: "Policies", kind: "number", get: (row) => row.policiesCount ?? 0 },
];

export default function GroupsPage() {
  const params = useParams();
  const { can } = useCan();
  const [searchParams, setSearchParams] = useSearchParams();
  const param = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

  const [conditions, setConditions] = createSignal<EntityCondition[]>(
    parseEntityQuery(param(searchParams.query), fields),
  );

  const updateConditions = (next: EntityCondition[]) => {
    setConditions(next);
    setSearchParams({ query: formatEntityQuery(next) }, { replace: true });
  };

  const filteredRows = () =>
    (groups.data?.rows ?? []).filter((row) => matchesEntityQuery(conditions(), row, fields));

  const groups = useQuery(() => ({
    queryKey: enterpriseKeys.list(params.tenantId, "group"),
    queryFn: () => enterprise.list(params.tenantId, "group"),
  }));

  return (
    <Page>
      <PageHeader
        title="Groups"
        description="Scope devices and policies into reusable deployment targets."
        actions={
          <Show when={can("groups.write") && filteredRows().length > 0}>
            <LinkButton href={`/t/${params.tenantId}/groups/new`}>Create group</LinkButton>
          </Show>
        }
      />
      <MdmTable<GroupRow>
        rows={filteredRows()}
        selectable={can("groups.write")}
        loading={groups.isPending}
        isFetching={groups.isFetching}
        onRefresh={() => void groups.refetch()}
        error={groups.error}
        storageKey="groups"
        toolbar={
          <EntityQueryBar fields={fields} conditions={conditions()} onChange={updateConditions} />
        }
        searchPlaceholder="Search groups…"
        rowHref={(row) => `/t/${params.tenantId}/groups/${row.id}`}
        actions={(selected, clear, select) => (
          <EntityActions entity="group" selected={selected} clear={clear} select={select} />
        )}
        empty={
          conditions().length > 0 ? (
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
                  <LinkButton href={`/t/${params.tenantId}/groups/new`}>Create group</LinkButton>
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
                <a
                  class="font-medium text-foreground hover:underline"
                  href={`/t/${params.tenantId}/groups/${row.id}`}
                >
                  {row.name}
                </a>
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
            cell: (row) => <MembershipBadge kind={row.kind} />,
          },
          {
            id: "devices",
            header: "Devices",
            sort: (row) => row.devicesCount ?? 0,
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
            sort: (row) => row.policiesCount ?? 0,
            cell: (row) => (
              <span class="tabular-nums text-foreground">{row.policiesCount ?? 0}</span>
            ),
          },
          {
            id: "updated",
            header: "Updated",
            sort: (row) => row.updatedAt,
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
