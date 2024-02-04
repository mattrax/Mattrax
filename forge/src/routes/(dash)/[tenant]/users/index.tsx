// TODO: Paginated fetch
// TODO: Search
// TODO: Filtering
// TODO: Virtialisation
// TODO: Abstract into reusable components
// TODO: Skeleton loading state

import { createPagination } from "@solid-primitives/pagination";
import { useZodParams } from "~/lib/useZodParams";
import { z } from "zod";
import { createAsync } from "@solidjs/router";
import { For, Show, Suspense } from "solid-js";
import {
  type ColumnDef,
  createSolidTable,
  getCoreRowModel,
  flexRender,
  getPaginationRowModel,
  getSortedRowModel,
  getFilteredRowModel,
} from "@tanstack/solid-table";
import { DataTable } from "../_table";
import {
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Input,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui";
import { trpc } from "~/lib";
import { As } from "@kobalte/core";

export const columns: ColumnDef<any>[] = [
  {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        onChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Select all"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onChange={(value) => row.toggleSelected(!!value)}
        aria-label="Select row"
      />
    ),
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

// TODO: Infinite scroll

// TODO: Disable search, filters and sort until all backend metadata has loaded in. Show tooltip so it's clear what's going on.

export default function Page() {
  const users = trpc.user.list.useQuery();

  // return <p>{JSON.stringify(users.data)}</p>;

  const params = useZodParams({
    // TODO: Max and min validation
    offset: z.number().default(0),
    limit: z.number().default(50),
  });

  // TODO: Data fetching

  // console.log(paginationProps());
  // return (
  //   <div class="flex flex-col p-4 w-full">
  //     <h1>Users page!</h1>

  //     {/* <DataTable columns={columns} data={() => data() || []} /> */}
  //     <TableDemo />
  //   </div>
  // );

  const table = createSolidTable({
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

  return (
    <div class="w-full px-4 py-8">
      <div class="flex items-center py-4">
        <Input
          placeholder="Filter emails..."
          value={(table.getColumn("email")?.getFilterValue() as string) ?? ""}
          onChange={(event) =>
            table.getColumn("email")?.setFilterValue(event.target.value)
          }
          class="max-w-sm"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <As
              component={Button}
              variant="outline"
              class="ml-auto select-none"
            >
              Columns
              <IconCarbonCaretDown class="ml-2 h-4 w-4" />
            </As>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <For
              each={table
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
      </div>
      <div class="rounded-md border">
        <Table>
          <TableHeader>
            <For each={table.getHeaderGroups()}>
              {(headerGroup) => (
                <TableRow>
                  {headerGroup.headers.map((header) => (
                    <TableHead>
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
            {table.getRowModel().rows?.length ? (
              <For each={table.getRowModel().rows}>
                {(row) => (
                  <TableRow data-state={row.getIsSelected() && "selected"}>
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
