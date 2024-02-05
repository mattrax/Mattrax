import { For, ParentProps, Show, Suspense, createSignal } from "solid-js";
import { z } from "zod";
import { As } from "@kobalte/core";

import { Button, Checkbox, Tabs, TabsList, TabsTrigger } from "~/components/ui";
import { trpc } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";

export default function Page() {
  const routeParams = useZodParams({ groupId: z.coerce.number() });

  const group = trpc.group.get.useQuery(() => ({ id: routeParams().groupId }));

  return (
    <Show when={group.data}>
      {(group) => (
        <div class="flex-1 m-4">
          <h1 class="text-xl font-bold">{group().name}</h1>
          <div class="mt-4 mb-2">
            <AddMemberSheet groupId={routeParams().groupId}>
              <As component={Button}>Add Members</As>
            </AddMemberSheet>
          </div>
          <MembersTable groupId={group().id} />
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

const columnHelper = createColumnHelper<{
  id: number;
  name: string;
  variant: "user" | "device" | "policy";
}>();

const VariantDisplay = {
  user: "User",
  device: "Device",
  policy: "Policy",
};

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
  const members = trpc.group.members.useQuery(
    () => ({ id: props.groupId }),
    () => ({ placeholderData: keepPreviousData })
  );

  const table = createSolidTable({
    get data() {
      return members.data || [];
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
import { keepPreviousData } from "@tanstack/solid-query";

const AddMemberTableOptions = {
  all: "All",
  user: "Users",
  device: "Devices",
  policy: "Policies",
};

function AddMemberSheet(props: ParentProps & { groupId: number }) {
  const [open, setOpen] = createSignal(false);

  const possibleMembers = trpc.group.possibleMembers.useQuery(
    () => ({
      id: props.groupId,
    }),
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
    state: {
      get columnFilters() {
        const t = tab();
        if (t === "all") return [];

        return [{ id: "variant", value: t }];
      },
    },
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const [tab, setTab] = createSignal<keyof typeof AddMemberTableOptions>("all");

  return (
    <Sheet open={open()} onOpenChange={setOpen}>
      <SheetTrigger asChild>{props.children}</SheetTrigger>
      <SheetContent transparent size="lg">
        <SheetHeader>
          <SheetTitle>Add Member</SheetTitle>
          <SheetDescription>
            Add users, devices, and policies to this group
          </SheetDescription>
        </SheetHeader>
        <div class="flex flex-row justify-between w-full items-center mt-4">
          <Tabs onChange={setTab}>
            <TabsList>
              {Object.entries(AddMemberTableOptions).map(([value, name]) => (
                <TabsTrigger value={value}>{name}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Suspense fallback={<Button disabled>Add 0 Members</Button>}>
            <Button disabled={!table.getIsSomeRowsSelected()}>
              Add {table.getSelectedRowModel().rows.length} Member
              {table.getSelectedRowModel().rows.length !== 1 && "s"}
            </Button>
          </Suspense>
        </div>
        <Suspense>
          <div class="rounded-md border mt-2">
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
