import {
  ColumnDef,
  PartialKeys,
  RowData,
  type Table as TTable,
  TableOptions,
  createSolidTable,
  flexRender,
  getCoreRowModel,
} from "@tanstack/solid-table";
import clsx from "clsx";
import { For, ParentProps, mergeProps } from "solid-js";

export function createStandardTable<TData extends RowData>(
  options: PartialKeys<TableOptions<TData>, "getCoreRowModel">
) {
  return createSolidTable(
    mergeProps(
      {
        getCoreRowModel: getCoreRowModel(),
        defaultColumn: mergeProps(
          { size: "auto" as unknown as number },
          options.defaultColumn
        ),
      },
      options
    )
  );
}

import {
  Button,
  Checkbox,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui";

export function StandardTable<TData>(props: {
  table: TTable<TData>;
  class?: string;
}) {
  const numCols = () =>
    props.table
      .getHeaderGroups()
      .map((c) => c.headers.length)
      .reduce((a, b) => a + b);

  return (
    <>
      <div class={clsx("rounded-md border", props.class)}>
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
            {props.table.getRowModel().rows.length ? (
              <For each={props.table.getRowModel().rows}>
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
                <TableCell colSpan={numCols()} class="h-24 text-center">
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <StandardTableFooter table={props.table} />
    </>
  );
}

export function StandardTableFooter<TData>(props: { table: TTable<TData> }) {
  return (
    <div class="flex items-center justify-end space-x-2">
      <div class="flex-1 text-sm text-muted-foreground">
        {props.table.getFilteredSelectedRowModel().rows.length} of{" "}
        {props.table.getFilteredRowModel().rows.length} row(s) selected.
      </div>
      <div class="space-x-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => props.table.previousPage()}
          disabled={!props.table.getCanPreviousPage()}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => props.table.nextPage()}
          disabled={!props.table.getCanNextPage()}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "./ui";

export function ColumnsDropdown<TData>(
  props: ParentProps & { table: TTable<TData> }
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
              {column.id.split(/(?=[A-Z])/).join(" ")}
            </DropdownMenuCheckboxItem>
          )}
        </For>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const selectCheckboxColumn = {
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
} satisfies ColumnDef<any>;
