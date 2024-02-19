import { Suspense, startTransition } from "solid-js";
import {
  createSolidTable,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  createColumnHelper,
} from "@tanstack/solid-table";
import { As } from "@kobalte/core";
import { useNavigate } from "@solidjs/router";
import { RouterOutput } from "@mattrax/api";
import dayjs from "dayjs";

import { Button, Checkbox, Input } from "~/components/ui";
import { ColumnsDropdown, StandardTable } from "~/components/StandardTable";
import { trpc, untrackScopeFromSuspense } from "~/lib";
import { useTenantContext } from "../../[tenantId]";

const columnHelper =
  createColumnHelper<RouterOutput["device"]["list"][number]>();

export const columns = [
  columnHelper.display({
    id: "select",
    header: ({ table }) => (
      <Checkbox
        class="w-4"
        checked={table.getIsAllPageRowsSelected()}
        indeterminate={table.getIsSomePageRowsSelected()}
        onChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Select all"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        class="w-4"
        checked={row.getIsSelected()}
        onChange={(value) => row.toggleSelected(!!value)}
        aria-label="Select row"
      />
    ),
    size: 1,
    enableSorting: false,
    enableHiding: false,
  }),
  columnHelper.accessor("name", {
    header: "Name",
  }),
  columnHelper.accessor("operatingSystem", {
    header: "Operating System",
  }),
  columnHelper.accessor("serialNumber", {
    header: "Serial Number",
  }),
  columnHelper.accessor("owner", {
    header: "Owner",
    // TODO: Render as link with the user's name
  }),
  columnHelper.accessor("lastSynced", {
    header: "Last Synced",
    // TODO: Make time automatically update
    cell: (cell) => dayjs(cell.getValue()).fromNow(),
  }),
  columnHelper.accessor("enrolledAt", {
    header: "Enrolled At",
    // TODO: Make time automatically update
    cell: (cell) => dayjs(cell.getValue()).fromNow(),
  }),
];

function createDevicesTable() {
  const tenant = useTenantContext();
  const devices = trpc.device.list.useQuery(() => ({
    tenantId: tenant.activeTenant.id,
  }));

  const table = createSolidTable({
    get data() {
      return devices.data || [];
    },
    get columns() {
      return columns;
    },
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    defaultColumn: {
      // @ts-expect-error // TODO: This property's value should be a number but setting it to string works ¯\_(ツ)_/¯
      size: "auto",
    },
  });

  return { devices, table };
}

// TODO: Infinite scroll

// TODO: Disable search, filters and sort until all backend metadata has loaded in. Show tooltip so it's clear what's going on.

export default function Page() {
  const navigate = useNavigate();
  const { table, devices } = createDevicesTable();
  const isLoading = untrackScopeFromSuspense(() => devices.isLoading);

  return (
    <div class="px-4 py-8 w-full max-w-5xl mx-auto flex flex-col gap-4">
      <h1 class="text-3xl font-bold mb-4">Devices</h1>
      <div class="flex flex-row items-center gap-4">
        <Input
          class="flex-1"
          placeholder={isLoading() ? "Loading..." : "Search..."}
          disabled={isLoading()}
          value={(table.getColumn("name")?.getFilterValue() as string) ?? ""}
          onInput={(event) =>
            table.getColumn("name")?.setFilterValue(event.target.value)
          }
        />
        <ColumnsDropdown table={table}>
          <As component={Button} variant="outline" class="ml-auto select-none">
            Columns
            <IconCarbonCaretDown class="ml-2 h-4 w-4" />
          </As>
        </ColumnsDropdown>
      </div>
      <Suspense>
        <StandardTable
          table={table}
          onRowClick={(row) => startTransition(() => navigate(row.id))}
        />
        <div class="flex items-center justify-end space-x-2">
          <div class="flex-1 text-sm text-muted-foreground">
            {table.getFilteredSelectedRowModel().rows.length} of{" "}
            {table.getFilteredRowModel().rows.length} row(s) selected.
          </div>
          <div class="space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next
            </Button>
          </div>
        </div>
      </Suspense>
    </div>
  );
}
