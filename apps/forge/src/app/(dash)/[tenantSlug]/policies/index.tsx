import { As } from "@kobalte/core";
import { A } from "@solidjs/router";
import { createColumnHelper } from "@tanstack/solid-table";
import { Suspense, startTransition } from "solid-js";

import { RouterOutput } from "~/api/trpc";
import {
  ColumnsDropdown,
  StandardTable,
  createStandardTable,
  selectCheckboxColumn,
} from "~/components/StandardTable";
import { Button, Input, Separator } from "~/components/ui";
import { trpc, untrackScopeFromSuspense } from "~/lib";
import { useTenantContext } from "../../[tenantSlug]";

const column = createColumnHelper<RouterOutput["policy"]["list"][number]>();

export const columns = [
  selectCheckboxColumn,
  column.accessor("name", {
    header: "Name",
    cell: (props) => (
      <A
        class="font-medium hover:underline focus:underline p-1 -m-1 w-full block"
        href={props.row.original.id}
      >
        {props.getValue()}
      </A>
    ),
  }),
  // TODO: Description
  // TODO: Configurations maybe?
  // TODO: Supported OS's
];

function createPoliciesTable() {
  const tenant = useTenantContext();
  const policies = trpc.policy.list.useQuery(() => ({
    tenantSlug: tenant.activeTenant.slug,
  }));

  const table = createStandardTable({
    get data() {
      return policies.data || [];
    },
    columns,
  });

  return { policies, table };
}

// TODO: Infinite scroll

// TODO: Disable search, filters and sort until all backend metadata has loaded in. Show tooltip so it's clear what's going on.

export default function Page() {
  const { table, policies } = createPoliciesTable();

  const isLoading = untrackScopeFromSuspense(() => policies.isLoading);

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
        <StandardTable table={table} />
      </Suspense>
    </div>
  );
}

import { useNavigate } from "@solidjs/router";
import { z } from "zod";

import { Form, InputField, createZodForm } from "~/components/forms";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui";

function CreatePolicyCard() {
  const tenant = useTenantContext();
  const navigate = useNavigate();

  const createPolicy = trpc.policy.create.useMutation(() => ({
    onSuccess: (id) => startTransition(() => navigate(id)),
  }));

  const form = createZodForm({
    schema: z.object({ name: z.string() }),
    onSubmit: ({ value }) =>
      createPolicy.mutateAsync({
        name: value.name,
        tenantSlug: tenant.activeTenant.slug,
      }),
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
