import { useParams } from "@solidjs/router";
import { trpc } from "~/lib";
import { RenderPolicy } from "./RenderPolicy";
import { slack } from "@mattrax/policies";

export default function Page() {
  const params = useParams();
  const policy = trpc.policy.get.useQuery(() => ({
    policyId: params.policyId!,
  }));

  return (
    <div class="flex flex-col space-y-2">
      <h2 class="text-2xl font-bold mb-4">Slack</h2>

      {/* // TODO: Form abstraction hooked up */}
      <RenderPolicy
        data={
          {
            // TODO: Loading this data from the backend
          }
        }
        policy={slack}
      />
    </div>
  );
}
