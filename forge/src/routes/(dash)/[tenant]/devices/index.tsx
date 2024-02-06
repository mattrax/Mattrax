import { useNavigate } from "@solidjs/router";
import { For, ParentProps, startTransition } from "solid-js";
import {
  type ColumnDef,
  createSolidTable,
  getCoreRowModel,
  flexRender,
  getPaginationRowModel,
  getSortedRowModel,
  getFilteredRowModel,
} from "@tanstack/solid-table";
import { trpc } from "~/lib";
import { As } from "@kobalte/core";

export const columns: ColumnDef<any>[] = [
  {
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
  },
  {
    accessorKey: "name",
    header: "Name",
  },
  {
    accessorKey: "operatingSystem",
    header: "Operating System",
  },
  {
    accessorKey: "serialNumber",
    header: "Serial Number",
  },
  {
    accessorKey: "owner",
    header: "Owner",
    // TODO: Render as link with the user's name
  },
  {
    accessorKey: "lastSynced",
    header: "Last Synced",
    cell: (cell) => dayjs(cell.getValue()).fromNow(),
  },
  {
    accessorKey: "enrolledAt",
    header: "Enrolled At",
    cell: (cell) => dayjs(cell.getValue()).fromNow(),
  },
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
      <GroupsTable table={groupsTable} />
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

import {
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui";

function GroupsTable(props: { table: ReturnType<typeof createGroupsTable> }) {
  const navigate = useNavigate();

  return (
    <div class="rounded-md border">
      <Table>
        <TableHeader>
          <For each={props.table.getHeaderGroups()}>
            {(headerGroup) => (
              <TableRow>
                {headerGroup.headers.map((header) => (
                  <TableHead style={{ width: `${header.getSize()}px` }}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            )}
          </For>
        </TableHeader>
        <TableBody>
          {props.table.getRowModel().rows?.length ? (
            <For each={props.table.getRowModel().rows}>
              {(row) => (
                <TableRow
                  data-state={row.getIsSelected() && "selected"}
                  onClick={() => {
                    navigate(`./${row.original.id}`);
                  }}
                >
                  <For each={row.getVisibleCells()}>
                    {(cell) => (
                      <TableCell>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    )}
                  </For>
                </TableRow>
              )}
            </For>
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} class="h-24 text-center">
                No results.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

import {
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "~/components/ui";
import { OutlineLayout } from "../OutlineLayout";
import { toast } from "solid-sonner";
import dayjs from "dayjs";

function ColumnsDropdown(
  props: ParentProps & { table: ReturnType<typeof createGroupsTable> }
) {
  return (
    <DropdownMenu placement="bottom-end">
      <DropdownMenuTrigger asChild>{props.children}</DropdownMenuTrigger>
      <DropdownMenuContent>
        <For
          each={props.table
            .getAllColumns()
            .filter((column) => column.getCanHide())}
        >
          {(column) => (
            <DropdownMenuCheckboxItem
              class="capitalize"
              checked={column.getIsVisible()}
              onChange={(value) => column.toggleVisibility(!!value)}
            >
              {column.id}
            </DropdownMenuCheckboxItem>
          )}
        </For>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
