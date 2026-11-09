import { useNavigate, useParams } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { EmptyState, formatDate, LinkButton, PageHeader } from "~/components/mdm/common";
import { EntityActions } from "~/components/mdm/entity-actions";
import { MdmTable } from "~/components/mdm/table";
import { enterprise, enterpriseKeys, type PolicyRow } from "~/lib/enterprise";

export default function PoliciesPage() {
  const params = useParams();
  const navigate = useNavigate();
  const policies = useQuery(() => ({
    queryKey: enterpriseKeys.list(params.tenantId, "policy"),
    queryFn: () => enterprise.list(params.tenantId, "policy"),
  }));
  return (
    <div class="flex flex-1 flex-col gap-6 p-6">
      <PageHeader
        title="Policies"
        description="Configure device restrictions, payloads, and deployment behavior."
        actions={<LinkButton href={`/t/${params.tenantId}/policies/new`}>Create policy</LinkButton>}
      />
      <MdmTable<PolicyRow>
        rows={policies.data?.rows}
        loading={policies.isPending}
        storageKey="policies"
        onRowClick={(row) => navigate(`/t/${params.tenantId}/policies/${row.id}`)}
        actions={(selected, clear) => (
          <EntityActions entity="policy" selected={selected} clear={clear} />
        )}
        empty={
          <EmptyState
            title="No policies"
            description="Create a policy to start configuring managed devices."
            action={
              <LinkButton href={`/t/${params.tenantId}/policies/new`}>Create policy</LinkButton>
            }
          />
        }
        columns={[
          {
            id: "name",
            header: "Name",
            sort: (row) => row.name,
            search: (row) => row.name,
            cell: (row) => (
              <a
                class="font-medium hover:underline"
                href={`/t/${params.tenantId}/policies/${row.id}`}
              >
                {row.name}
              </a>
            ),
          },
          {
            id: "created",
            header: "Created",
            sort: (row) => row.createdAt,
            cell: (row) => formatDate(row.createdAt),
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
