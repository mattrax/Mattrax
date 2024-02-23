import { z } from "zod";
import { useTenantContext } from "~/app/(dash)/[tenantId]";
import { Form, InputField, createZodForm } from "~/components/forms";
import { Button, Label } from "~/components/ui";
import { trpc } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";

export default function Page() {
  const params = useZodParams({
    policyId: z.string(),
  });
  const tenant = useTenantContext();
  const policy = trpc.policy.get.useQuery(() => ({
    policyId: params.policyId,
    tenantId: tenant.activeTenant.id,
  }));
  const updatePolicy = trpc.policy.update.useMutation(() => ({
    onSuccess: () => policy.refetch(),
  }));

  const form = createZodForm({
    schema: z.object({ name: z.string() }),
    defaultValues: { name: policy.data?.name || "" },
    onSubmit: ({ value }) =>
      updatePolicy.mutateAsync({
        tenantId: tenant.activeTenant.id,
        policyId: params.policyId,
        name: value.name,
      }),
  });

  return (
    <div class="flex flex-col space-y-2">
      <h2 class="text-2xl font-bold mb-4">General</h2>
      <Form form={form} fieldsetClass="space-y-2">
        <Label for="name">Name</Label>
        <InputField
          form={form}
          type="text"
          name="name"
          placeholder="My Cool Policy"
        />

        <Button type="submit" class="w-full">
          <span class="text-sm font-semibold leading-6">Save</span>
        </Button>
      </Form>
    </div>
  );
}
