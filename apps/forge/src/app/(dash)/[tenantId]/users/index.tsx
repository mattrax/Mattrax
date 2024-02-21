import { ParentProps, Suspense, createSignal, startTransition } from "solid-js";
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
import { RouterOutput } from "~/api/trpc";
import { z } from "zod";

import {
  Badge,
  Button,
  Checkbox,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
  Input,
} from "~/components/ui";
import { trpc, untrackScopeFromSuspense } from "~/lib";
import { ColumnsDropdown, StandardTable } from "~/components/StandardTable";
import { useTenantContext } from "../../[tenantId]";
import { AUTH_PROVIDER_DISPLAY } from "~/lib/values";
import { Form, InputField, createZodForm } from "~/components/forms";

const column = createColumnHelper<RouterOutput["user"]["list"][number]>();

export const columns = [
  column.display({
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
  }),
  column.accessor("name", {
    header: "Name",
  }),
  column.accessor("email", {
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
  }),
  column.accessor("provider.variant", {
    header: "Provider",
    cell: (props) => (
      <Badge variant="secondary">
        {AUTH_PROVIDER_DISPLAY[props.getValue()]}
      </Badge>
    ),
  }),
  // TODO: Link to OAuth provider
  // TODO: Actions
];

// TODO: Disable search, filters and sort until all backend metadata has loaded in. Show tooltip so it's clear what's going on.

function createUsersTable() {
  const tenant = useTenantContext();
  const users = trpc.user.list.useQuery(() => ({
    tenantId: tenant.activeTenant.id,
  }));

  const table = createSolidTable({
    get data() {
      return users.data || [];
    },
    columns,
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

  return { table, users };
}

export default function Page() {
  const navigate = useNavigate();
  const { table, users } = createUsersTable();

  const isLoading = untrackScopeFromSuspense(() => users.isLoading);

  return (
    <div class="px-4 py-8 w-full max-w-5xl mx-auto flex flex-col gap-4">
      <h1 class="text-3xl font-bold mb-4">Users</h1>
      <div class="flex flex-row items-center gap-4">
        <Input
          placeholder={isLoading() ? "Loading..." : "Search..."}
          disabled={isLoading()}
          value={(table.getColumn("email")?.getFilterValue() as string) ?? ""}
          onInput={(event) =>
            table.getColumn("email")?.setFilterValue(event.target.value)
          }
          class="flex-1"
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
