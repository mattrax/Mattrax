import {
  Accessor,
  For,
  ParentProps,
  Show,
  Suspense,
  createSignal,
  JSX,
} from "solid-js";
import { z } from "zod";
import { As } from "@kobalte/core";

import {
  Button,
  Checkbox,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
  Tabs,
  TabsList,
  TabsTrigger,
} from "~/components/ui";
import { trpc } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";

export default function Page() {
  const routeParams = useZodParams({ groupId: z.coerce.number() });

  const group = trpc.group.get.useQuery(() => ({ id: routeParams.groupId }));

  return (
    <Show when={group.data}>
      {(group) => {
        const table = createMembersTable(() => group().id);

        const isRouting = useIsRouting();

        return (
          <div class="px-4 py-8 w-full max-w-5xl mx-auto flex flex-col gap-4">
            <div class="flex flex-row justify-between">
              <h1 class="text-3xl font-bold mb-4">{group().name}</h1>
              <AddMemberSheet groupId={routeParams.groupId}>
                <As component={Button}>Add Members</As>
              </AddMemberSheet>
            </div>

            <Show when={!isRouting()}>
              <Suspense>
                <MembersTable table={table} />
              </Suspense>
            </Show>
          </div>
        );
      }}
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
        checked={table.getIsAllPageRowsSelected()}
        indeterminate={table.getIsSomePageRowsSelected()}
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
    size: 1,
    enableSorting: false,
    enableHiding: false,
  }),
  columnHelper.accessor("name", { header: "Name" }),
  columnHelper.accessor("variant", {
    header: "Variant",
    cell: (info) => <Badge>{VariantDisplay[info.getValue()]}</Badge>,
  }),
];

function createMembersTable(groupId: Accessor<number>) {
  const members = trpc.group.members.useQuery(() => ({ id: groupId() }));

  return createSolidTable({
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
    defaultColumn: {
      // @ts-expect-error // TODO: This property's value should be a number but setting it to string works ¯\_(ツ)_/¯
      size: "auto",
    },
  });
}

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui";

function MembersTable(props: { table: ReturnType<typeof createMembersTable> }) {
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
          {props.table.getRowModel().rows?.length ? (
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
import { useIsRouting } from "@solidjs/router";
import { ConfirmDialog } from "~/components/ConfirmDialog";

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
    defaultColumn: {
      // @ts-expect-error // TODO: This property's value should be a number but setting it to string works ¯\_(ツ)_/¯
      size: "auto",
    },
  });

  const addMembers = trpc.group.addMembers.useMutation(() => ({
    onSuccess: () => {
      setOpen(false);
    },
  }));

  const queryClient = useQueryClient();

  return (
    <ConfirmDialog>
      {(confirm) => (
        <Sheet
          open={open()}
          onOpenChange={async (o) => {
            if (o) table.resetRowSelection(true);

            if (
              o === false &&
              table.getIsSomeRowsSelected() &&
              !(await confirm({
                title: "Are You Sure?",
                description: "You still have members selected",
                action: "Continue",
              }))
            )
              return;

            setOpen(o);
          }}
        >
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
                    {Object.entries(AddMemberTableOptions).map(
                      ([value, name]) => (
                        <TabsTrigger value={value}>{name}</TabsTrigger>
                      )
                    )}
                  </TabsList>
                </Tabs>
                <Button
                  disabled={
                    !table.getSelectedRowModel().rows.length ||
                    addMembers.isPending
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
                          <TableRow
                            data-state={row.getIsSelected() && "selected"}
                          >
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
      )}
    </ConfirmDialog>
  );
}
