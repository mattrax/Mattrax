import { For, ParentProps, Show, Suspense, createSignal } from "solid-js";
import { z } from "zod";
import { As } from "@kobalte/core";

import { Button, Checkbox, Tabs, TabsList, TabsTrigger } from "~/components/ui";
import { trpc } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";

export default function Page() {
  const routeParams = useZodParams({ groupId: z.coerce.number() });

  const group = trpc.group.get.useQuery(() => ({ id: routeParams.groupId }));

  return (
    <Show when={group.data}>
      {(group) => (
        <div class="flex-1 px-4 py-8">
          <h1 class="text-3xl font-bold focus:outline-none" contentEditable>
            {group().name}
          </h1>
          <div class="my-4">
            <AddMemberSheet groupId={routeParams.groupId}>
              <As component={Button}>Add Members</As>
            </AddMemberSheet>
          </div>
          <Suspense>
            <MembersTable groupId={group().id} />
          </Suspense>
        </div>
      )}
    </Show>
  );
}

import {
  createSolidTable,
  getCoreRowModel,
  flexRender,
  getPaginationRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  createColumnHelper,
} from "@tanstack/solid-table";

const VariantDisplay = {
  user: "User",
  device: "Device",
  policy: "Policy",
} as const;

type Variant = keyof typeof VariantDisplay;

const columnHelper = createColumnHelper<{
  id: number;
  name: string;
  variant: Variant;
}>();

const columns = [
  columnHelper.display({
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
  }),
  columnHelper.accessor("name", { header: "Name" }),
  columnHelper.accessor("variant", {
    header: "Variant",
    cell: (info) => <Badge>{VariantDisplay[info.getValue()]}</Badge>,
  }),
];

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui";

function MembersTable(props: { groupId: number }) {
  const members = trpc.group.members.useQuery(() => ({ id: props.groupId }));

  const table = createSolidTable({
    get data() {
      if (!members.data) return [];

      const res = [
        ...members.data.users.map((user) => ({
          ...user,
          variant: "user" as const,
        })),
        ...members.data.devices.map((device) => ({
          ...device,
          variant: "device" as const,
        })),
        ...members.data.policies.map((policy) => ({
          ...policy,
          variant: "policy" as const,
        })),
      ];

      res.sort((a, b) => a.name.localeCompare(b.name));

      return res;
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
  );
}

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "~/components/ui/sheet";
import { Badge } from "~/components/ui/badge";
import { useQueryClient } from "@tanstack/solid-query";

const AddMemberTableOptions = {
  all: "All",
  user: "Users",
  device: "Devices",
  policy: "Policies",
};

function AddMemberSheet(props: ParentProps & { groupId: number }) {
  const [open, setOpen] = createSignal(false);

  const possibleMembers = trpc.group.possibleMembers.useQuery(
    () => ({ id: props.groupId }),
    () => ({ enabled: open() })
  );

  const table = createSolidTable({
    get data() {
      if (!possibleMembers.data) return [];

      const res = [
        ...possibleMembers.data.users.map((user) => ({
          ...user,
          variant: "user" as const,
        })),
        ...possibleMembers.data.devices.map((device) => ({
          ...device,
          variant: "device" as const,
        })),
        ...possibleMembers.data.policies.map((policy) => ({
          ...policy,
          variant: "policy" as const,
        })),
      ];

      res.sort((a, b) => a.name.localeCompare(b.name));

      return res;
    },
    columns,
    initialState: {
      pagination: {
        pageSize: 9999,
      },
    },
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const addMembers = trpc.group.addMembers.useMutation();

  const queryClient = useQueryClient();

  return (
    <Sheet open={open()} onOpenChange={setOpen}>
      <SheetTrigger asChild>{props.children}</SheetTrigger>
      <SheetContent transparent size="lg" class="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Add Member</SheetTitle>
          <SheetDescription>
            Add users, devices, and policies to this group
          </SheetDescription>
        </SheetHeader>
        <Suspense>
          <div class="flex flex-row justify-between w-full items-center mt-4">
            <Tabs
              value={
                (table.getColumn("variant")!.getFilterValue() as
                  | Variant
                  | undefined) ?? "all"
              }
              onChange={(t) =>
                table
                  .getColumn("variant")!
                  .setFilterValue(t === "all" ? undefined : t)
              }
            >
              <TabsList>
                {Object.entries(AddMemberTableOptions).map(([value, name]) => (
                  <TabsTrigger value={value}>{name}</TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <Button
              disabled={
                !table.getSelectedRowModel().rows.length || addMembers.isPending
              }
              onClick={async () => {
                await addMembers.mutateAsync({
                  id: props.groupId,
                  members: table.getSelectedRowModel().rows.map((row) => ({
                    id: row.original.id,
                    variant: row.original.variant,
                  })),
                });

                setOpen(false);
                queryClient.invalidateQueries();
              }}
            >
              Add {table.getSelectedRowModel().rows.length} Member
              {table.getSelectedRowModel().rows.length !== 1 && "s"}
            </Button>
          </div>
          <div class="rounded-md border mt-2">
            <Table class="h-full flex-1">
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
                            <TableCell
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                row.toggleSelected();
                              }}
                            >
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
                    <TableCell
                      colSpan={columns.length}
                      class="h-24 text-center"
                    >
                      No results.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </Suspense>
      </SheetContent>
    </Sheet>
  );
}
