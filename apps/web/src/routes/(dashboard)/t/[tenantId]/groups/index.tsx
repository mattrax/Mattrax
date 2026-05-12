import { A, useParams } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { DataTable, EmptyState, formatDate, LinkButton, PageHeader } from "~/components/mdm/common";
import { enterprise, enterpriseKeys, type GroupRow } from "~/lib/enterprise";

export default function GroupsPage() {
  const params = useParams();
  const groups = useQuery(() => ({ queryKey: enterpriseKeys.search(params.tenantId, "group"), queryFn: () => enterprise.search(params.tenantId, "group") }));
  return <div class="flex flex-1 flex-col gap-6 p-6"><PageHeader title="Groups" description="Scope devices and policies into reusable deployment targets." actions={<LinkButton href={`/t/${params.tenantId}/groups/new`}>Create group</LinkButton>} /><DataTable<GroupRow> rows={groups.data?.rows} empty={<EmptyState title="No groups" description="Create a group to organize devices and attach policy scope." action={<LinkButton href={`/t/${params.tenantId}/groups/new`}>Create group</LinkButton>} />} columns={[{ header: "Name", cell: (row) => <A class="font-medium hover:underline" href={`/t/${params.tenantId}/groups/${row.id}`}>{row.name}</A> }, { header: "Devices", cell: (row) => row.devicesCount ?? 0 }, { header: "Policies", cell: (row) => row.policiesCount ?? 0 }, { header: "Updated", cell: (row) => formatDate(row.updatedAt) }]} /></div>;
}
