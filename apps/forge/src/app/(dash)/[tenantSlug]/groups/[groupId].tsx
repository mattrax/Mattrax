import {
  Accessor,
  For,
  ParentProps,
  Show,
  Suspense,
  createSignal,
} from "solid-js";
import { z } from "zod";
import { As } from "@kobalte/core";

import { Button, Checkbox, Tabs, TabsList, TabsTrigger } from "~/components/ui";
import { trpc } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";

export default function Page() {
  const routeParams = useZodParams({ groupId: z.string() });

  const tenant = useTenantContext();
  const group = trpc.group.get.useQuery(() => ({
    id: routeParams.groupId,
    tenantSlug: tenant.activeTenant.slug,
  }));

  return (
    <Show when={group.data}>
      {(group) => {
        const table = createMembersTable(() => group().id);

        return (
          <div class="px-4 py-8 w-full max-w-5xl mx-auto flex flex-col gap-4">
            <div class="flex flex-row justify-between">
              <h1 class="text-3xl font-bold mb-4">{group().name}</h1>
              <AddMemberSheet groupId={routeParams.groupId}>
                <As component={Button}>Add Members</As>
              </AddMemberSheet>
            </div>

            <Suspense>
              <StandardTable table={table} />
            </Suspense>
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
} as const;

type Variant = keyof typeof VariantDisplay;

const columnHelper = createColumnHelper<{
  pk: number;
  id: string;
  name: string;
  variant: Variant;
}>();

const columns = [
  columnHelper.display({
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
  }),
  columnHelper.accessor("name", { header: "Name" }),
  columnHelper.accessor("variant", {
    header: "Variant",
    cell: (info) => <Badge>{VariantDisplay[info.getValue()]}</Badge>,
  }),
];

function createMembersTable(groupId: Accessor<string>) {
  const tenant = useTenantContext();
  const members = trpc.group.members.useQuery(() => ({
    id: groupId(),
    tenantSlug: tenant.activeTenant.slug,
  }));

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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "~/components/ui/sheet";
import { Badge } from "~/components/ui/badge";
import { useQueryClient } from "@tanstack/solid-query";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { useTenantContext } from "../../[tenantSlug]";
import { StandardTable } from "~/components/StandardTable";

const AddMemberTableOptions = {
  all: "All",
  user: "Users",
  device: "Devices",
};

function AddMemberSheet(props: ParentProps & { groupId: string }) {
  const [open, setOpen] = createSignal(false);

  const tenant = useTenantContext();
  const possibleMembers = trpc.group.possibleMembers.useQuery(
    () => ({ id: props.groupId, tenantSlug: tenant.activeTenant.slug }),
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
                      tenantSlug: tenant.activeTenant.slug,
                      members: table.getSelectedRowModel().rows.map((row) => ({
                        pk: row.original.pk,
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
                <StandardTable table={table} />
              </div>
            </Suspense>
          </SheetContent>
        </Sheet>
      )}
    </ConfirmDialog>
  );
}
