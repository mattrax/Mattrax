import { startTransition } from "solid-js";
import {
  type ColumnDef,
  createSolidTable,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  getFilteredRowModel,
} from "@tanstack/solid-table";
import { As } from "@kobalte/core";
import { useNavigate } from "@solidjs/router";
import { z } from "zod";

import { trpc, untrackScopeFromSuspense } from "~/lib";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
} from "~/components/ui";
import { ColumnsDropdown, StandardTable } from "~/components/StandardTable";
import { Separator } from "~/components/ui";
import { Form, InputField, createZodForm } from "~/components/forms";

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
  // TODO: Description
  // TODO: Configurations maybe?
  // TODO: Supported OS's
];

function createGroupsTable() {
  const groups = trpc.policy.list.useQuery();

  const table = createSolidTable({
    get data() {
      return groups.data || [];
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

  return { groups, table };
}

// TODO: Infinite scroll

// TODO: Disable search, filters and sort until all backend metadata has loaded in. Show tooltip so it's clear what's going on.

export default function Page() {
  const navigate = useNavigate();
  const { table, groups } = createGroupsTable();

  const isLoading = untrackScopeFromSuspense(() => groups.isLoading);

  return (
    <div class="px-4 py-8 w-full max-w-5xl mx-auto space-y-4">
      <h1 class="text-3xl font-bold">Policies</h1>
      <CreatePolicyCard />
      <Separator />
      <div class="flex flex-row gap-4">
        <Input
          placeholder={isLoading() ? "Loading..." : "Search..."}
          disabled={isLoading()}
          value={(table.getColumn("name")?.getFilterValue() as string) ?? ""}
          onInput={(event) =>
            table.getColumn("name")?.setFilterValue(event.target.value)
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
          onRowClick={(row) => navigate(`./${row.id}`)}
        />
        <div class="flex items-center justify-end space-x-2 py-4">
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

function CreatePolicyCard() {
  const navigate = useNavigate();

  const createPolicy = trpc.policy.create.useMutation(() => ({
    onSuccess: (id) => startTransition(() => navigate(id)),
  }));

  const form = createZodForm({
    schema: z.object({ name: z.string() }),
    onSubmit: ({ value }) => createPolicy.mutateAsync(value),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create Policy</CardTitle>
        <CardDescription>
          Once a new policy is created, you will be taken to assign
          configurations to it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form
          form={form}
          class="w-full"
          fieldsetClass="flex items-center gap-4"
        >
          <InputField
            placeholder="Policy Name"
            fieldClass="flex-1"
            form={form}
            name="name"
          />
          <Button type="submit">Create Policy</Button>
        </Form>
      </CardContent>
    </Card>
  );
}
