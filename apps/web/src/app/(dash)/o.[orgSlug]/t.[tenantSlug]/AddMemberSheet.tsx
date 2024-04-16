import { CreateQueryResult } from "@tanstack/solid-query";
import { type ParentProps, Suspense, createSignal, Index } from "solid-js";
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
  AsyncButton,
} from "@mattrax/ui";

import {
  StandardTable,
  createStandardTable,
  selectCheckboxColumn,
} from "~c/StandardTable";
import { ConfirmDialog } from "~c/ConfirmDialog";

const columnHelper = createColumnHelper<{
  pk: number;
  name: string;
  variant: string;
}>();

function toTitleCase(str: string) {
  return str.replace(/\w\S*/g, (txt) => {
    return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
  });
}

export const memberSheetColumns = [
  selectCheckboxColumn,
  columnHelper.accessor("name", { header: "Name" }),
  columnHelper.accessor("variant", {
    header: "Variant",
    id: "variant",
    cell: (info) => <Badge>{toTitleCase(info.getValue())}</Badge>,
  }),
];

export function AddMemberSheet<
  T extends Record<
    string,
    {
      label: string;
      query: CreateQueryResult<
        Array<{ pk: number; name: string }> | undefined,
        any
      >;
    }
  >,
>(
  props: ParentProps<{
    variants: T;
    onSubmit(items: Array<{ variant: keyof T; pk: number }>): Promise<void>;
  }>,
) {
  const [open, setOpen] = createSignal(false);

  const possibleMembers = () => {
    return Object.entries(props.variants)
      .flatMap(([value, { query }]) =>
        (query.data ?? []).map((d) => ({
          ...d,
          variant: value,
        })),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  };

  const table = createStandardTable({
    get data() {
      return possibleMembers();
    },
    columns: memberSheetColumns,
    // pagination: true, // TODO: Pagination
  });

  // const addMembers = createMutation<
  //   void,
  //   Error,
  //   {
  //     pk: number;
  //     variant: Variant;
  //   }[]
  // >(() => ({
  //   mutationFn: props.addMember as any,
  //   onSuccess: () => setOpen(false),
  // }));

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
                    | string
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
                  <Index
                    each={[
                      { value: "all", display: "All" },
                      ...Object.entries(props.variants).map(
                        ([value, { label: multiple }]) => ({
                          value,
                          display: multiple,
                        }),
                      ),
                    ]}
                  >
                    {(props) => (
                      <TabsTrigger value={props().value}>
                        {props().display}
                      </TabsTrigger>
                    )}
                  </Index>
                </TabsList>
                <TabsIndicator />
              </Tabs>
              <Suspense fallback={<Button disabled>Loading...</Button>}>
                <AsyncButton
                  disabled={!table.getSelectedRowModel().rows.length}
                  onClick={() =>
                    props
                      .onSubmit(
                        table.getSelectedRowModel().rows.map((row) => ({
                          pk: row.original.pk,
                          variant: row.original.variant,
                        })),
                      )
                      .then(() => {
                        setOpen(false);
                      })
                  }
                >
                  Add {table.getSelectedRowModel().rows.length} Member
                  {table.getSelectedRowModel().rows.length !== 1 && "s"}
                </AsyncButton>
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
