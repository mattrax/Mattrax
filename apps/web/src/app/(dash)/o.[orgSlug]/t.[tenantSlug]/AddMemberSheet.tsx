import { createMutation } from "@tanstack/solid-query";
import { For, type ParentProps, Suspense, createSignal } from "solid-js";
import { createColumnHelper } from "@tanstack/solid-table";
import {
  Badge,
  Button,
  Tabs,
  TabsList,
  TabsTrigger,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  TabsIndicator,
} from "@mattrax/ui";

import { useTenantSlug } from "../t.[tenantSlug]";
import { trpc } from "~/lib";
import {
  StandardTable,
  createStandardTable,
  selectCheckboxColumn,
} from "~c/StandardTable";
import { ConfirmDialog } from "~c/ConfirmDialog";

const VariantDisplay = {
  user: "User",
  device: "Device",
  group: "Group",
} as const;

type Variant = keyof typeof VariantDisplay;

const columnHelper = createColumnHelper<{
  pk: number;
  name: string;
  variant: Variant;
}>();

export const memberSheetColumns = [
  selectCheckboxColumn,
  columnHelper.accessor("name", { header: "Name" }),
  columnHelper.accessor("variant", {
    header: "Variant",
    cell: (info) => <Badge>{VariantDisplay[info.getValue()]}</Badge>,
  }),
];

type Props =
  | {
      omitGroups: true;
      addMember: (
        selected: {
          pk: number;
          variant: Exclude<Variant, "group">;
        }[],
      ) => Promise<void>;
    }
  | {
      omitUsers?: true;
      addMember: (
        selected: {
          pk: number;
          variant: Exclude<Variant, "user">;
        }[],
      ) => Promise<void>;
    }
  | {
      omitGroups?: false;
      omitUsers?: false;
      addMember: (
        selected: {
          pk: number;
          variant: Variant;
        }[],
      ) => Promise<void>;
    };

export function AddMemberSheet(props: ParentProps & Props) {
  const tenantSlug = useTenantSlug();

  const [open, setOpen] = createSignal(false);

  const AddMemberTableOptions = () => ({
    all: "All",
    // @ts-expect-error // TODO
    ...(props.omitUsers ? {} : { user: "Users" }),
    device: "Devices",
    // @ts-expect-error // TODO
    ...(props.omitGroups ? {} : { group: "Groups" }),
  });

  const possibleUsers = trpc.tenant.members.users.useQuery(
    () => ({ tenantSlug: tenantSlug() }),
    // @ts-expect-error // TODO
    () => ({ enabled: props.omitUsers !== true && open() }),
  );
  const possibleDevices = trpc.tenant.members.devices.useQuery(
    () => ({ tenantSlug: tenantSlug() }),
    () => ({ enabled: open() }),
  );
  const possibleGroups = trpc.tenant.members.groups.useQuery(
    () => ({ tenantSlug: tenantSlug() }),
    // @ts-expect-error // TODO
    () => ({ enabled: props.omitGroups !== true && open() }),
  );

  const possibleMembers = () => {
    return [
      ...(possibleUsers.data ?? []),
      ...(possibleDevices.data ?? []),
      ...(possibleGroups.data ?? []),
    ].sort((a, b) => a.name.localeCompare(b.name));
  };

  const table = createStandardTable({
    get data() {
      return possibleMembers();
    },
    columns: memberSheetColumns,
    // pagination: true, // TODO: Pagination
  });

  const addMembers = createMutation<
    void,
    Error,
    {
      pk: number;
      variant: Variant;
    }[]
  >(() => ({
    mutationFn: props.addMember as any,
    onSuccess: () => setOpen(false),
  }));

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
          <SheetContent
            transparent
            size="lg"
            class="overflow-y-auto flex flex-col"
          >
            <SheetHeader>
              <SheetTitle>Add Member</SheetTitle>
              <SheetDescription>
                {/* TODO: Dynamically build this */}
                Add users, devices, and policies to this group
              </SheetDescription>
            </SheetHeader>
            <div class="flex flex-row justify-between w-full items-center my-4">
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
                class="relative"
              >
                <TabsList>
                  <For each={Object.entries(AddMemberTableOptions())}>
                    {([value, name]) => (
                      <TabsTrigger value={value}>{name}</TabsTrigger>
                    )}
                  </For>
                </TabsList>
                <TabsIndicator />
              </Tabs>
              <Suspense fallback={<Button disabled>Loading...</Button>}>
                <Button
                  disabled={
                    !table.getSelectedRowModel().rows.length ||
                    addMembers.isPending
                  }
                  onClick={() =>
                    addMembers.mutate(
                      table.getSelectedRowModel().rows.map((row) => ({
                        pk: row.original.pk,
                        variant: row.original.variant,
                      })),
                    )
                  }
                >
                  Add {table.getSelectedRowModel().rows.length} Member
                  {table.getSelectedRowModel().rows.length !== 1 && "s"}
                </Button>
              </Suspense>
            </div>
            <Suspense>
              <StandardTable table={table} />
            </Suspense>
          </SheetContent>
        </Sheet>
      )}
    </ConfirmDialog>
  );
}
