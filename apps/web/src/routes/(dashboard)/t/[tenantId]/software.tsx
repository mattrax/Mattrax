import { useParams } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { createSignal, Show } from "solid-js";
import {
  EmptyState,
  formatDate,
  LinkButton,
  Page,
  PageHeader,
  relativeTime,
} from "~/components/mdm/common";
import { MdmTable } from "~/components/mdm/table";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Package, X } from "~/components/ui/icons";
import { cn } from "~/lib/utils";
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
  const filtered = () => search().trim() !== "" || managed() !== "all" || updatesOnly();
  const resetFilters = () => {
    setSearch("");
    setManaged("all");
    setUpdatesOnly(false);
    setLimit(100);
  };

  return (
    <Page>
      <PageHeader
        eyebrow="Inventory"
        title="Software"
        description="Installed application inventory reported by managed devices."
        meta={
          <Show when={inventory.data}>
            <span class="tabular-nums">
              {total()} bundle{total() === 1 ? "" : "s"} reported
            </span>
            <Show when={managed() !== "all"}>
              <span class="text-muted-foreground/40" aria-hidden="true">
                ·
              </span>
              <span class="capitalize">{managed()} only</span>
            </Show>
            <Show when={updatesOnly()}>
              <span class="text-muted-foreground/40" aria-hidden="true">
                ·
              </span>
              <span class="text-warning-foreground">Updates available</span>
            </Show>
          </Show>
        }
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
            icon={(props) => <Package {...props} />}
            title="No software reported"
            description="Devices appear here after they report an InstalledApplicationList result. Open a device and choose Refresh applications."
            action={<LinkButton href={`/t/${params.tenantId}/devices`}>View devices</LinkButton>}
          />
        }
        toolbar={
          <div class="flex flex-wrap items-center gap-2">
            <div
              class="flex items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5"
              role="group"
              aria-label="Managed filter"
            >
              {(["all", "managed", "unmanaged"] as const).map((value) => (
                <button
                  type="button"
                  aria-pressed={managed() === value ? "true" : "false"}
                  onClick={() => {
                    setManaged(value);
                    setLimit(100);
                  }}
                  class={cn(
                    "h-6 rounded-md px-2.5 text-[11.5px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                    managed() === value
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {value === "all" ? "All" : value === "managed" ? "Managed" : "Unmanaged"}
                </button>
              ))}
            </div>
            <button
              type="button"
              aria-pressed={updatesOnly() ? "true" : "false"}
              onClick={() => {
                setUpdatesOnly((value) => !value);
                setLimit(100);
              }}
              class={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[11.5px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                updatesOnly()
                  ? "border-warning/35 bg-warning/10 text-warning-foreground"
                  : "border-border bg-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              Updates available
            </button>
            <Show when={filtered()}>
              <Button variant="ghost" size="xs" class="gap-1" onClick={resetFilters}>
                <X class="size-3" />
                Clear filters
              </Button>
            </Show>
            <span class="ml-auto hidden text-[11px] tabular-nums text-muted-foreground sm:inline">
              {rows().length} shown
            </span>
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
                <span class="block truncate font-medium text-foreground">{row.name}</span>
                <span class="block max-w-[34ch] truncate font-mono text-[11px] text-muted-foreground">
                  {row.bundleId}
                </span>
              </span>
            ),
          },
          {
            id: "version",
            header: "Version",
            cell: (row) => (
              <span class="whitespace-nowrap font-mono text-[11.5px] tabular-nums text-foreground/90">
                {row.version ?? row.shortVersion ?? "—"}
              </span>
            ),
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
              row.hasUpdateAvailable ? (
                <Badge variant="destructive">Available</Badge>
              ) : (
                <span class="text-muted-foreground/60">—</span>
              ),
          },
          {
            id: "size",
            header: "Size",
            cell: (row) => (
              <span class="whitespace-nowrap text-[11.5px] tabular-nums text-muted-foreground">
                {formatBytes(row.bundleSize)}
              </span>
            ),
          },
          {
            id: "devices",
            header: "Devices",
            cell: (row) => <span class="tabular-nums">{row.deviceCount}</span>,
          },
          {
            id: "reported",
            header: "Last reported",
            cell: (row) => (
              <span class="block min-w-0">
                <span class="block whitespace-nowrap text-[12.5px]">
                  {relativeTime(row.lastReportedAt)}
                </span>
                <span class="block truncate text-[11px] text-muted-foreground">
                  {formatDate(row.lastReportedAt)}
                </span>
              </span>
            ),
          },
        ]}
      />
    </Page>
  );
}
