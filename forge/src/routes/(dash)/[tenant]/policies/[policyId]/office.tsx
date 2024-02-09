import { useParams } from "@solidjs/router";
import { trpc } from "~/lib";

export default function Page() {
  const params = useParams();
  const policy = trpc.policy.get.useQuery(() => ({
    policyId: params.policyId!,
  }));

  return (
    <div class="flex flex-col space-y-2">
      <h2 class="text-2xl font-bold mb-4">Microsoft Office</h2>

      <h1 class="text-muted-foreground opacity-70">Coming soon...</h1>
    </div>
  );
}
