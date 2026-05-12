import { A, useParams } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { DataTable, DeviceStatusBadge, EmptyState, formatDate, PageHeader, PlatformBadge } from "~/components/mdm/common";
import { enterprise, enterpriseKeys, type DeviceRow } from "~/lib/enterprise";

export default function DevicesPage() {
  const params = useParams();
  const devices = useQuery(() => ({ queryKey: enterpriseKeys.search(params.tenantId, "device"), queryFn: () => enterprise.search(params.tenantId, "device") }));
  return (
    <div class="flex flex-1 flex-col gap-6 p-6">
      <PageHeader title="Devices" description="Inventory, sync, and retire enrolled Apple, Windows, and Android devices." />
      <DataTable<DeviceRow>
        rows={devices.data?.rows}
        empty={<EmptyState title="No devices" description="Devices will appear here after users enroll through this tenant's enrollment URL." />}
        columns={[
          { header: "Name", cell: (row) => <A class="font-medium text-stone-950 hover:underline" href={`/t/${params.tenantId}/devices/${row.id}`}>{row.name}</A> },
          { header: "Status", cell: (row) => <DeviceStatusBadge status={row.status} /> },
          { header: "Platform", cell: (row) => <PlatformBadge proto={row.proto} /> },
          { header: "Serial", cell: (row) => row.serial ?? "Unknown" },
          { header: "Model", cell: (row) => row.model ?? "Unknown" },
          { header: "Last seen", cell: (row) => formatDate(row.lastSeenAt) },
        ]}
      />
    </div>
  );
}
