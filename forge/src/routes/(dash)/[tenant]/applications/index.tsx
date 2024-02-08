import {
  For,
  ParentProps,
  Suspense,
  createSignal,
  startTransition,
} from "solid-js";
import {
  type ColumnDef,
  createSolidTable,
  getCoreRowModel,
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
  // TODO: Descriptions, supported OS's.
];

function createGroupsTable() {
  // const groups = trpc.policy.list.useQuery();

  return createSolidTable({
    get data() {
      return []; // TODO
      // return groups.data || [];
    },
    get columns() {
      return columns;
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
}

export default function Page() {
  const navigate = useNavigate();
  const groupsTable = createGroupsTable();

  return (
    <OutlineLayout title="Applications">
      <div class="flex items-center mb-4">
        <CreatePolicyDialog>
          <As component={Button}>Create Application</As>
        </CreatePolicyDialog>
        <Input
          placeholder="Search..."
          value={
            (groupsTable.getColumn("name")?.getFilterValue() as string) ?? ""
          }
          onInput={(event) =>
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
      <StandardTable
        table={groupsTable}
        onRowClick={(row) => startTransition(() => navigate(`./${row.id}`))}
      />
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
      <AppleAppStoreDemo />
    </OutlineLayout>
  );
}

import {
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Input,
} from "~/components/ui";
import { OutlineLayout } from "../OutlineLayout";
import { toast } from "solid-sonner";
import dayjs from "dayjs";
import { StandardTable } from "~/components/StandardTable";
import { createAsync, useNavigate } from "@solidjs/router";

function ColumnsDropdown(
  props: ParentProps & { table: ReturnType<typeof createGroupsTable> }
) {
  return (
    <DropdownMenu placement="bottom-end">
      <DropdownMenuTrigger asChild>{props.children}</DropdownMenuTrigger>
      <DropdownMenuContent>
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

import {
  DialogContent,
  DialogHeader,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui";

function CreatePolicyDialog(props: ParentProps) {
  const navigate = useNavigate();
  // const mutation = trpc.app.create.useMutation(() => ({
  //   onSuccess: async (id) => {
  //     await startTransition(() => navigate(`./${id}`));
  //   },
  // }));

  return (
    <DialogRoot>
      <DialogTrigger asChild>{props.children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Application</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            // mutation.mutate({
            //   name: formData.get("name") as any,
            // });
          }}
        >
          <fieldset
            class="flex flex-col space-y-4"
            // disabled={mutation.isPending}
          >
            <Input
              type="text"
              name="name"
              placeholder="New Application"
              autocomplete="off"
            />
            <Button type="submit" disabled>
              Create
            </Button>
          </fieldset>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}

function AppleAppStoreDemo() {
  const [search, setSearch] = createSignal();

  // TODO: Debounce on input + cancel previous request

  // TODO: Typescript types
  // TODO: Move to Tanstack Query
  const data = createAsync(() => {
    // TODO: Pagination support
    return fetch(
      `https://itunes.apple.com/search?term=${search()}&entity=software`
    ).then((res) => res.json());
  });

  return (
    <OutlineLayout title="Applications">
      <input
        type="text"
        class="border border-gray-300 rounded-md p-2"
        placeholder="Search"
        onInput={(e) => setSearch(e.currentTarget.value)}
      />
      <div class="grid grid-cols-3 gap-4">
        {/* TODO: Empty and error states */}
        <Suspense fallback={<div>Loading...</div>}>
          {data()?.results.map((app: any) => (
            <div class="flex flex-col">
              <img src={app.artworkUrl100} />
              <div class="text-sm">{app.trackName}</div>
              <div class="text-xs">{app.sellerName}</div>
            </div>
          ))}
        </Suspense>
      </div>
    </OutlineLayout>
  );
}
