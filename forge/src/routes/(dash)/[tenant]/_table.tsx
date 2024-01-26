import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  createSolidTable,
} from "@tanstack/solid-table";
import { For, Suspense } from "solid-js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: () => TData[] | TData[];
}

export function DataTable<TData, TValue>(props: DataTableProps<TData, TValue>) {
  const table = createSolidTable({
    get data() {
      return typeof props.data === "function" ? props.data() : props.data;
    },
    get columns() {
      return props.columns;
    },
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div class="rounded-md border">
      <Table>
        <TableHeader>
          <For each={table.getHeaderGroups()}>
            {(headerGroup) => (
              <TableRow>
                <For each={headerGroup.headers}>
                  {(header) => {
                    return (
                      <TableHead>
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                      </TableHead>
                    );
                  }}
                </For>
              </TableRow>
            )}
          </For>
        </TableHeader>
        <TableBody>
          {/* TODO: Skeleton UI */}
          <Suspense fallback={<div>Loading...</div>}>
            {table.getRowModel().rows?.length ? (
              <For each={table.getRowModel().rows}>
                {(row) => (
                  <TableRow data-state={row.getIsSelected() && "selected"}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                )}
              </For>
            ) : (
              <TableRow>
                <TableCell
                  aria-colspan={props.columns.length}
                  class="h-24 text-center"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </Suspense>
        </TableBody>
      </Table>
    </div>
  );
}
