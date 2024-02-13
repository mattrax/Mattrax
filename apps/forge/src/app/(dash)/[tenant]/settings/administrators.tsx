import { RouterOutput } from "@mattrax/api";
import {
  createColumnHelper,
  createSolidTable,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
} from "@tanstack/solid-table";
import { Suspense } from "solid-js";
import { z } from "zod";

import { StandardTable } from "~/components/StandardTable";
import { Form, InputField, createZodForm } from "~/components/forms";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui";
import { trpc } from "~/lib";

const column =
  createColumnHelper<RouterOutput["tenant"]["administrators"][number]>();

const columns = [
  column.accessor("name", {
    header: "Name",
  }),
  column.accessor("email", {
    header: "Email",
  }),
];

export default function Page() {
  const administrators = trpc.tenant.administrators.useQuery();

  const table = createSolidTable({
    get data() {
      return administrators.data || [];
    },
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <div class="flex flex-col gap-4">
      <InviteAdminForm />
      <Suspense>
        <StandardTable table={table} />
      </Suspense>
    </div>
  );
}

function InviteAdminForm() {
  const inviteAdmin = trpc.tenant.administrators.sendInvite.useMutation();

  const form = createZodForm({
    schema: z.object({ email: z.string().email() }),
    onSubmit: ({ value }) => inviteAdmin.mutateAsync(value),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite Administrator</CardTitle>
        <CardDescription>
          Invite a new administrator to this tenant. They will receive an
          invitation email and be granted full administrative access to this
          tenant.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form form={form} fieldsetClass="flex flex-row gap-4" class="w-full">
          <InputField
            form={form}
            name="email"
            fieldClass="flex-1"
            placeholder="oscar@example.com"
          />
          <Button type="submit">Invite</Button>
        </Form>
      </CardContent>
    </Card>
  );
}
