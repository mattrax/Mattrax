import { useNavigate, useParams } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import {
  DeviceStatusBadge,
  EmptyState,
  formatDate,
  LinkButton,
  PageHeader,
  PlatformBadge,
} from "~/components/mdm/common";
import { EntityActions } from "~/components/mdm/entity-actions";
import { MdmTable } from "~/components/mdm/table";
import { enterprise, enterpriseKeys, type DeviceRow } from "~/lib/enterprise";

export default function DevicesPage() {
  const params = useParams();
  const navigate = useNavigate();
  const devices = useQuery(() => ({
    queryKey: enterpriseKeys.list(params.tenantId, "device"),
    queryFn: () => enterprise.list(params.tenantId, "device"),
  }));
  return (
    <div class="flex flex-1 flex-col gap-6 p-6">
      <PageHeader
        title="Devices"
        description="Inventory, sync, and retire enrolled Apple, Windows, and Android devices."
        actions={
          <LinkButton href={`/t/${params.tenantId}/settings/enrollment`} variant="outline">
            Enroll device
          </LinkButton>
        }
      />
      <MdmTable<DeviceRow>
        rows={devices.data?.rows}
        storageKey="devices"
        onRowClick={(row) => navigate(`/t/${params.tenantId}/devices/${row.id}`)}
        actions={(selected, clear) => (
          <EntityActions entity="device" selected={selected} clear={clear} />
        )}
        empty={
          <EmptyState
            title="No devices"
            description="Devices will appear here after users enroll through this tenant's enrollment URL."
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
                class="font-medium text-stone-950 hover:underline"
                href={`/t/${params.tenantId}/devices/${row.id}`}
              >
                {row.name}
              </a>
            ),
          },
          {
            id: "status",
            header: "Status",
            sort: (row) => row.status,
            cell: (row) => <DeviceStatusBadge status={row.status} />,
          },
          {
            id: "platform",
            header: "Platform",
            sort: (row) => row.proto,
            cell: (row) => <PlatformBadge proto={row.proto} />,
          },
          {
            id: "serial",
            header: "Serial",
            sort: (row) => row.serial,
            search: (row) => row.serial,
            cell: (row) => row.serial ?? "Unknown",
          },
          {
            id: "model",
            header: "Model",
            sort: (row) => row.model,
            search: (row) => row.model,
            cell: (row) => row.model ?? "Unknown",
          },
          {
            id: "lastSeen",
            header: "Last seen",
            sort: (row) => row.lastSeenAt,
            cell: (row) => formatDate(row.lastSeenAt),
          },
        ]}
      />
    </div>
  );
}
