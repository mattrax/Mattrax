import { useNavigate } from "@solidjs/router";
import { ParentProps, Suspense, startTransition } from "solid-js";
import {
  type ColumnDef,
  createSolidTable,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  getFilteredRowModel,
} from "@tanstack/solid-table";
import { As } from "@kobalte/core";

import { trpc, untrackScopeFromSuspense } from "~/lib";

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
    accessorKey: "memberCount",
    header: "Member Count",
  },
];

function createGroupsTable() {
  const tenant = useTenantContext();
  const groups = trpc.group.list.useQuery(() => ({
    tenantId: tenant.activeTenant.id,
  }));

  const table = createSolidTable({
    get data() {
      return groups.data || [];
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
    defaultColumn: {
      // @ts-expect-error // TODO: This property's value should be a number but setting it to string works ¯\_(ツ)_/¯
      size: "auto",
    },
  });

  return { groups, table };
}

// TODO: Disable search, filters and sort until all backend metadata has loaded in. Show tooltip so it's clear what's going on.

export default function Page() {
  const navigate = useNavigate();
  const { table, groups } = createGroupsTable();

  const isLoading = untrackScopeFromSuspense(() => groups.isLoading);

  return (
    <div class="px-4 py-8 w-full max-w-5xl mx-auto flex flex-col gap-4">
      <div class="flex flex-row justify-between">
        <h1 class="text-3xl font-bold mb-4">Groups</h1>
        <CreateGroupDialog>
          <As component={Button}>Create New Group</As>
        </CreateGroupDialog>
      </div>
      <div class="flex items-center gap-4">
        <Input
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
          onRowClick={(row) => startTransition(() => navigate(`./${row.id}`))}
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

import {
  DialogContent,
  DialogHeader,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
  Input,
} from "~/components/ui";

function CreateGroupDialog(props: ParentProps) {
  const tenant = useTenantContext();
  const navigate = useNavigate();

  const mutation = trpc.group.create.useMutation(() => ({
    onSuccess: async (id) => {
      await startTransition(() => {
        navigate(`../groups/${id}`);
      });
    },
  }));

  return (
    <DialogRoot>
      <DialogTrigger asChild>{props.children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Group</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            mutation.mutate({
              name: formData.get("name") as any,
              tenantId: tenant.activeTenant.id,
            });
          }}
        >
          <fieldset
            class="flex flex-col space-y-4"
            disabled={mutation.isPending}
          >
            <Input
              type="text"
              name="name"
              placeholder="New Group"
              autocomplete="off"
            />
            <Button type="submit">Create</Button>
          </fieldset>
        </form>
      </DialogContent>
    </DialogRoot>
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
import { ColumnsDropdown, StandardTable } from "~/components/StandardTable";
import { useTenantContext } from "../../[tenantId]";
