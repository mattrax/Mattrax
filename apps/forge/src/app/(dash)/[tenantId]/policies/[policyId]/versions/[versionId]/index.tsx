import { z } from "zod";
import { useTenantContext } from "~/app/(dash)/[tenantId]";
import { Input, Label } from "~/components/ui";
import { trpc } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";

export default function Page() {
  const params = useZodParams({
    policyId: z.string(),
  });
  const tenant = useTenantContext();
  // const policy = trpc.policy.get.useQuery(() => ({
  //   policyId: params.policyId,
  //   tenantId: tenant.activeTenant.id,
  // }));

  return (
    <div class="flex flex-col space-y-2">
      <h2 class="text-2xl font-bold mb-4">General</h2>
      {/* // TODO: Form abstraction hooked up */}
      <div class="grid w-full max-w-sm items-center gap-1.5">
        <Label for="name">Name</Label>
        {/* <Input
          type="email"
          id="name"
          placeholder="My Cool Policy"
          value={policy.data?.name}
          disabled
        /> */}
      </div>
    </div>
  );
}
