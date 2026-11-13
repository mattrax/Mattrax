import { useNavigate, useParams } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { Show } from "solid-js";
import { EmptyState, formatDate, LinkButton, Page, PageHeader } from "~/components/mdm/common";
import { EntityActions } from "~/components/mdm/entity-actions";
import { MdmTable } from "~/components/mdm/table";
import { UsersRound } from "~/components/ui/icons";
import { enterprise, enterpriseKeys, type GroupRow } from "~/lib/enterprise";

function MembershipBadge(props: { kind: GroupRow["kind"] }) {
  const dynamic = () => props.kind === "dynamic";
  return (
    <span
      class={
        dynamic()
          ? "inline-flex items-center gap-1.5 rounded-full border border-white/[0.1] bg-white/[0.05] px-2 py-0.5 text-[11px] font-medium text-foreground/85"
          : "inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
      }
    >
      <span class="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {dynamic() ? "Dynamic" : "Manual"}
    </span>
  );
}

export default function GroupsPage() {
  const params = useParams();
  const navigate = useNavigate();
  const groups = useQuery(() => ({
    queryKey: enterpriseKeys.list(params.tenantId, "group"),
    queryFn: () => enterprise.list(params.tenantId, "group"),
  }));
  return (
    <Page>
      <PageHeader
        title="Groups"
        description="Scope devices and policies into reusable deployment targets."
        actions={<LinkButton href={`/t/${params.tenantId}/groups/new`}>Create group</LinkButton>}
      />
      <MdmTable<GroupRow>
        rows={groups.data?.rows}
        loading={groups.isPending}
        error={groups.error}
        storageKey="groups"
        searchPlaceholder="Search groups…"
        onRowClick={(row) => navigate(`/t/${params.tenantId}/groups/${row.id}`)}
        actions={(selected, clear) => (
          <EntityActions entity="group" selected={selected} clear={clear} />
        )}
        empty={
          <EmptyState
            icon={UsersRound}
            title="No groups"
            description="Create a group to organize devices and attach policy scope."
            action={<LinkButton href={`/t/${params.tenantId}/groups/new`}>Create group</LinkButton>}
          />
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
            cell: (row) => (
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
