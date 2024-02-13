import { flexRender, type Table as TTable } from "@tanstack/solid-table";
import { For, ParentProps } from "solid-js";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "./ui";
import clsx from "clsx";

export function StandardTable<TData>(props: {
  table: TTable<TData>;
  onRowClick?: (row: TData) => void;
  class?: string;
}) {
  const numCols = () =>
    props.table
      .getHeaderGroups()
      .map((c) => c.headers.length)
      .reduce((a, b) => a + b);

  return (
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
                <TableRow
                  data-state={row.getIsSelected() && "selected"}
                  onClick={() => props.onRowClick?.(row.original)}
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
              <TableCell colSpan={numCols()} class="h-24 text-center">
                No results.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

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
