import { For, startTransition } from "solid-js";
import {
  type ColumnDef,
  createSolidTable,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  getFilteredRowModel,
} from "@tanstack/solid-table";
import {
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Input,
} from "~/components/ui";
import { trpc } from "~/lib";
import { As } from "@kobalte/core";
import { ParentProps } from "solid-js";
import { StandardTable } from "~/components/StandardTable";
import { useNavigate } from "@solidjs/router";

export const columns: ColumnDef<any>[] = [
  {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        class="w-4"
        checked={
          table.getIsAllPageRowsSelected() || table.getIsSomePageRowsSelected()
        }
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
    accessorKey: "email",
    header: ({ column }) => {
      return (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Email
          {/* TODO: Indicate which way we are sorting */}
          <IconCarbonCaretSort class="ml-2 h-4 w-4" />
        </Button>
      );
    },
  },
  {
    accessorKey: "provider",
    header: "Provider",
  },
  // TODO: Link to OAuth provider
  // TODO: Actions
];

// TODO: Disable search, filters and sort until all backend metadata has loaded in. Show tooltip so it's clear what's going on.

function createUsersTable() {
  const users = trpc.user.list.useQuery();

  return createSolidTable({
    get data() {
      return users.data || [];
    },
    get columns() {
      return columns;
    },
    // onSortingChange: setSorting,
    // onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    // onColumnVisibilityChange: setColumnVisibility,
    // onRowSelectionChange: setRowSelection,
    // state: {
    //   sorting,
    //   columnFilters,
    //   columnVisibility,
    //   rowSelection,
    // },
  });
}

export default function Page() {
  const navigate = useNavigate();
  const table = createUsersTable();

  return (
    <div class="flex-1 px-4 py-8">
      <h1 class="text-3xl font-bold">Users</h1>
      <div class="flex items-center py-4">
        <Input
          placeholder="Search..."
          value={(table.getColumn("email")?.getFilterValue() as string) ?? ""}
          onInput={(event) =>
            table.getColumn("email")?.setFilterValue(event.target.value)
          }
          class="max-w-sm"
        />
        <ColumnsDropdown table={table}>
          <As component={Button} variant="outline" class="ml-auto select-none">
            Columns
            <IconCarbonCaretDown class="ml-2 h-4 w-4" />
          </As>
        </ColumnsDropdown>
      </div>
      <StandardTable
        table={table}
        onRowClick={(row) => startTransition(() => navigate(`./${row.id}`))}
      />
      <div class="flex items-center justify-end space-x-2 py-4">
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
    </div>
  );
}

function ColumnsDropdown(
  props: ParentProps & { table: ReturnType<typeof createUsersTable> }
) {
  return (
    <DropdownMenu>
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
