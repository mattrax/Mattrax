// TODO: Paginated fetch
// TODO: Search
// TODO: Filtering
// TODO: Virtialisation
// TODO: Abstract into reusable components
// TODO: Skeleton loading state

import { useZodParams } from "~/lib/useZodParams";
import { z } from "zod";
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
    accessorKey: "memberCount",
    header: "Member Count",
  },
];

function createGroupsTable() {
  const groups = trpc.group.list.useQuery();

  return createSolidTable({
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
  });
}

// TODO: Infinite scroll

// TODO: Disable search, filters and sort until all backend metadata has loaded in. Show tooltip so it's clear what's going on.

export default function Page() {
  const groupsTable = createGroupsTable();
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

  return (
    <div class="flex-1 px-4 py-8">
      <div class="flex items-center py-4">
        <CreateGroupDialog>
          <As component={Button}>Create New Group</As>
        </CreateGroupDialog>
        <Input
          placeholder="Filter groups..."
          value={
            (groupsTable.getColumn("name")?.getFilterValue() as string) ?? ""
          }
          onChange={(event) =>
            groupsTable.getColumn("name")?.setFilterValue(event.target.value)
          }
          class="max-w-sm ml-4"
        />
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
    </div>
  );
}

import {
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
  DialogContent,
  DialogHeader,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
  Input,
} from "~/components/ui";

function CreateGroupDialog(props: ParentProps) {
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

function ColumnsDropdown(
  props: ParentProps & { table: ReturnType<typeof createGroupsTable> }
) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{props.children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
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
