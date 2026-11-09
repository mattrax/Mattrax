import { A, useParams } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { EmptyState, formatDate, LinkButton, PageHeader } from "~/components/mdm/common";
import { EntityActions } from "~/components/mdm/entity-actions";
import { MdmTable } from "~/components/mdm/table";
import { enterprise, enterpriseKeys, type GroupRow } from "~/lib/enterprise";

export default function GroupsPage() {
  const params = useParams();
  const groups = useQuery(() => ({
    queryKey: enterpriseKeys.list(params.tenantId, "group"),
    queryFn: () => enterprise.list(params.tenantId, "group"),
  }));
  return (
    <div class="flex flex-1 flex-col gap-6 p-6">
      <PageHeader
        title="Groups"
        description="Scope devices and policies into reusable deployment targets."
        actions={<LinkButton href={`/t/${params.tenantId}/groups/new`}>Create group</LinkButton>}
      />
      <MdmTable<GroupRow>
        rows={groups.data?.rows}
        actions={(selected, clear) => (
          <EntityActions entity="group" selected={selected} clear={clear} />
        )}
        empty={
          <EmptyState
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
              <A
                class="font-medium hover:underline"
                href={`/t/${params.tenantId}/groups/${row.id}`}
              >
                {row.name}
              </A>
            ),
          },
          {
            id: "devices",
            header: "Devices",
            sort: (row) => row.devicesCount ?? 0,
            cell: (row) => row.devicesCount ?? 0,
          },
          {
            id: "policies",
            header: "Policies",
            sort: (row) => row.policiesCount ?? 0,
            cell: (row) => row.policiesCount ?? 0,
          },
          {
            id: "updated",
            header: "Updated",
            sort: (row) => row.updatedAt,
            cell: (row) => formatDate(row.updatedAt),
          },
        ]}
      />
    </div>
  );
}
