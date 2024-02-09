import { Form, createZodForm } from "~/components/forms";
import { useAuthContext } from "../(dash)";

import { startTransition } from "solid-js";
import { Navigate, useNavigate } from "@solidjs/router";
import { z } from "zod";
import { InputField } from "~/components/forms";
import { Button } from "~/components/ui";
import { trpc } from "~/lib";

export default function Page() {
  const auth = useAuthContext();

  // If we have an active tenant, send the user to it
  if (auth.me.tenants[0]) {
    return <Navigate href={auth.me.tenants[0].id} />;
  }

  const createTenant = trpc.tenant.create.useMutation();

  const navigate = useNavigate();

  const form = createZodForm({
    schema: z.object({
      name: z.string(),
    }),
    async onSubmit(data) {
      const tenant = await createTenant.mutateAsync(data.value);

      await startTransition(() => navigate(`/${tenant.id}`));
    },
  });

  return (
    <div class="animate-in fade-in slide-in-from-bottom-4 duration-500 flex flex-col items-center justify-center w-full">
      <Form form={form}>
        <div class="flex flex-col items-stretch">
          <h1 class="text-center text-3xl font-semibold mb-2">
            Create a Tenant
          </h1>
          <p class="text-gray-600 mb-4">
            To get started using Mattrax, first create a tenant
          </p>
          <InputField autofocus form={form} label="Name" name="name" />
          <Button class="w-full mt-2" type="submit">
            Create
          </Button>
        </div>
      </Form>
    </div>
  );
}
