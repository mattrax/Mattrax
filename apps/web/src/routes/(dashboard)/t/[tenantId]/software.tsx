import { useParams } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { createSignal, Show } from "solid-js";
import { EmptyState, formatDate, LinkButton, PageHeader } from "~/components/mdm/common";
import { MdmTable } from "~/components/mdm/table";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  enterpriseQueries,
  type ApplicationInventoryQuery,
  type ApplicationInventoryRow,
} from "~/lib/enterprise";

type SoftwareRow = ApplicationInventoryRow & { name: string };

const formatBytes = (value?: number | null) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let amount = value / 1024;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit++;
  }
  return `${amount.toFixed(amount >= 10 ? 0 : 1)} ${units[unit]}`;
};

export default function SoftwareInventoryPage() {
  const params = useParams();
  const [search, setSearch] = createSignal("");
  const [managed, setManaged] = createSignal<"all" | "managed" | "unmanaged">("all");
  const [updatesOnly, setUpdatesOnly] = createSignal(false);
  const [limit, setLimit] = createSignal(100);

  const query = (): ApplicationInventoryQuery => ({
    ...(search().trim() ? { q: search().trim() } : {}),
    ...(managed() === "all" ? {} : { managed: managed() as "managed" | "unmanaged" }),
    ...(updatesOnly() ? { updates: "available" as const } : {}),
    limit: limit(),
    offset: 0,
  });
  const inventory = useQuery(() =>
    enterpriseQueries.applicationInventory(params.tenantId, query()),
  );
  const rows = (): SoftwareRow[] =>
    (inventory.data?.applications ?? []).map((row) => ({
      ...row,
      name: row.name ?? row.bundleId,
    }));
  const total = () => inventory.data?.total ?? 0;

  return (
    <div class="flex flex-1 flex-col gap-6 p-6">
      <PageHeader
        title="Software"
        description="Installed application inventory reported by managed devices."
        actions={
          <LinkButton href={`/t/${params.tenantId}/applications`}>Application catalogue</LinkButton>
        }
      />
      <MdmTable<SoftwareRow>
        rows={rows()}
        loading={inventory.isPending}
        error={inventory.error}
        storageKey="software"
        mode="server"
        searchValue={search()}
        onSearchChange={(value) => {
          setSearch(value);
          setLimit(100);
        }}
        total={total()}
        empty={
          <EmptyState
            title="No software reported"
            description="Devices appear here after they report an InstalledApplicationList result. Open a device and choose Refresh applications."
            action={<LinkButton href={`/t/${params.tenantId}/devices`}>View devices</LinkButton>}
          />
        }
        toolbar={
          <div class="flex flex-wrap items-center gap-2">
            <div class="flex rounded-lg border bg-white p-0.5">
              {(["all", "managed", "unmanaged"] as const).map((value) => (
                <Button
                  variant={managed() === value ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => {
                    setManaged(value);
                    setLimit(100);
                  }}
                >
                  {value === "all" ? "All" : value === "managed" ? "Managed" : "Unmanaged"}
                </Button>
              ))}
            </div>
            <Button
              variant={updatesOnly() ? "secondary" : "outline"}
              size="sm"
              onClick={() => {
                setUpdatesOnly((value) => !value);
                setLimit(100);
              }}
            >
              Updates available
            </Button>
          </div>
        }
        footer={
          <Show when={rows().length < total()}>
            <div class="flex justify-center">
              <Button
                variant="outline"
                onClick={() => setLimit((value) => value + 100)}
                disabled={inventory.isFetching}
              >
                {inventory.isFetching ? "Loading…" : `Load more (${rows().length} of ${total()})`}
              </Button>
            </div>
          </Show>
        }
        columns={[
          {
            id: "name",
            header: "Application",
            cell: (row) => (
              <span class="block min-w-0">
                <span class="block truncate font-medium">{row.name}</span>
                <span class="block truncate font-mono text-xs text-muted-foreground">
                  {row.bundleId}
                </span>
              </span>
            ),
          },
          {
            id: "version",
            header: "Version",
            cell: (row) => row.version ?? row.shortVersion ?? "—",
          },
          {
            id: "managed",
            header: "Managed",
            cell: (row) => (
              <Badge variant={row.isManaged ? "default" : "secondary"}>
                {row.isManaged ? "Managed" : "Unmanaged"}
              </Badge>
            ),
          },
          {
            id: "update",
            header: "Update",
            cell: (row) =>
              row.hasUpdateAvailable ? <Badge variant="destructive">Available</Badge> : "—",
          },
          {
            id: "size",
            header: "Size",
            cell: (row) => formatBytes(row.bundleSize),
          },
          {
            id: "devices",
            header: "Devices",
            cell: (row) => row.deviceCount,
          },
          {
            id: "reported",
            header: "Last reported",
            cell: (row) => formatDate(row.lastReportedAt),
          },
        ]}
      />
    </div>
  );
}
