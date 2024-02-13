import { useParams } from "@solidjs/router";
import { Input, Label } from "~/components/ui";
import { trpc } from "~/lib";

export default function Page() {
  const params = useParams();
  const policy = trpc.policy.get.useQuery(() => ({
    policyId: params.policyId!,
  }));

  return (
    <div class="flex flex-col space-y-2">
      <h2 class="text-2xl font-bold mb-4">General</h2>

      {/* // TODO: Form abstraction hooked up */}
      <div class="grid w-full max-w-sm items-center gap-1.5">
        <Label for="name">Name</Label>
        <Input
          type="email"
          id="name"
          placeholder="My Cool Policy"
          value={policy.data?.name}
          disabled
        />
      </div>
    </div>
  );
}
