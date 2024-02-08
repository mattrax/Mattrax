import { flexRender, type Table as TTable } from "@tanstack/solid-table";
import { For } from "solid-js";
import { columns } from "~/routes/(dash)/[tenant]/users";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "./ui";

export function StandardTable<TData>(props: {
  table: TTable<TData>;
  onRowClick?: (row: TData) => void;
}) {
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