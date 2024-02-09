import { startTransition } from "solid-js";
import {
  createSolidTable,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  createColumnHelper,
} from "@tanstack/solid-table";
import { As } from "@kobalte/core";
import { trpc } from "~/lib";

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
    cell: (cell) => dayjs(cell.getValue()).fromNow(),
  }),
  columnHelper.accessor("enrolledAt", {
    header: "Enrolled At",
    cell: (cell) => dayjs(cell.getValue()).fromNow(),
  }),
];

function createGroupsTable() {
  const groups = trpc.device.list.useQuery();

  return createSolidTable({
    get data() {
      return groups.data || [];
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
}

// TODO: Infinite scroll

// TODO: Disable search, filters and sort until all backend metadata has loaded in. Show tooltip so it's clear what's going on.

export default function Page() {
  const navigate = useNavigate();
  const groupsTable = createGroupsTable();
  const forcePullFromIntune = trpc.device.forcePullFromIntune.useMutation(
    () => ({
      onSuccess: () => toast.success("Successfully synced devices from Intune"),
    })
  );

  return (
    <OutlineLayout title="Devices">
      <div class="flex items-center mb-4">
        <Input
          placeholder="Search..."
          value={
            (groupsTable.getColumn("name")?.getFilterValue() as string) ?? ""
          }
          onInput={(event) =>
            groupsTable.getColumn("name")?.setFilterValue(event.target.value)
          }
          class="max-w-sm"
        />
        <Button class="ml-4" onClick={() => forcePullFromIntune.mutate()}>
          Force Pull From Intune
        </Button>
        <ColumnsDropdown table={groupsTable}>
          <As component={Button} variant="outline" class="ml-auto select-none">
            Columns
            <IconCarbonCaretDown class="ml-2 h-4 w-4" />
          </As>
        </ColumnsDropdown>
      </div>
      <StandardTable
        table={groupsTable}
        onRowClick={(row) => startTransition(() => navigate(row.id))}
      />
      <div class="flex items-center justify-end space-x-2 py-4">
        <div class="flex-1 text-sm text-muted-foreground">
          {groupsTable.getFilteredSelectedRowModel().rows.length} of{" "}
          {groupsTable.getFilteredRowModel().rows.length} row(s) selected.
        </div>
        <div class="space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => groupsTable.previousPage()}
            disabled={!groupsTable.getCanPreviousPage()}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => groupsTable.nextPage()}
            disabled={!groupsTable.getCanNextPage()}
          >
            Next
          </Button>
        </div>
      </div>
    </OutlineLayout>
  );
}

import { Button, Checkbox, Input } from "~/components/ui";
import { OutlineLayout } from "../OutlineLayout";
import { toast } from "solid-sonner";
import dayjs from "dayjs";
import { ColumnsDropdown, StandardTable } from "~/components/StandardTable";
import { useNavigate } from "@solidjs/router";
import { RouterOutput } from "@mattrax/api";
