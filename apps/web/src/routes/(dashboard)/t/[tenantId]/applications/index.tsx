import { useNavigate, useParams } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { EmptyState, formatDate, LinkButton, PageHeader } from "~/components/mdm/common";
import { MdmTable } from "~/components/mdm/table";
import { Badge } from "~/components/ui/badge";
import { enterpriseQueries, type ApplicationRow } from "~/lib/enterprise";

const platformLabel = (platform: ApplicationRow["platform"]) =>
  platform === "apple" ? "Apple" : platform === "win" ? "Windows" : "Android";

export default function ApplicationsPage() {
  const params = useParams();
  const navigate = useNavigate();
  const apps = useQuery(() => enterpriseQueries.applications(params.tenantId));

  return (
    <div class="flex flex-1 flex-col gap-6 p-6">
      <PageHeader
        title="Applications"
        description="Catalogue installers and assign them to groups or devices."
        actions={
          <LinkButton href={`/t/${params.tenantId}/applications/new`}>Add application</LinkButton>
        }
      />
      <MdmTable<ApplicationRow>
        rows={apps.data ? [...apps.data.applications] : undefined}
        loading={apps.isPending}
        storageKey="applications"
        onRowClick={(row) => navigate(`/t/${params.tenantId}/applications/${row.id}`)}
        empty={
          <EmptyState
            title="No applications"
            description="Add an Apple manifest or App Store app, or catalogue a Windows/Android package."
            action={
              <LinkButton href={`/t/${params.tenantId}/applications/new`}>
                Add application
              </LinkButton>
            }
          />
        }
        columns={[
          {
            id: "name",
            header: "Name",
            sort: (row) => row.name,
            search: (row) => `${row.name} ${row.bundleId ?? ""}`,
            cell: (row) => (
              <a
                class="font-medium hover:underline"
                href={`/t/${params.tenantId}/applications/${row.id}`}
              >
                {row.name}
              </a>
            ),
          },
          {
            id: "platform",
            header: "Platform",
            sort: (row) => row.platform,
            cell: (row) => <Badge variant="secondary">{platformLabel(row.platform)}</Badge>,
          },
          {
            id: "bundle",
            header: "Bundle / package",
            search: (row) => row.bundleId ?? "",
            cell: (row) => row.bundleId || "—",
          },
          {
            id: "source",
            header: "Source",
            sort: (row) => row.source,
            cell: (row) => row.source,
          },
          {
            id: "assignments",
            header: "Assigned",
            sort: (row) => (row.groupsCount ?? 0) + (row.devicesCount ?? 0),
            cell: (row) => `${row.groupsCount ?? 0} groups · ${row.devicesCount ?? 0} devices`,
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
