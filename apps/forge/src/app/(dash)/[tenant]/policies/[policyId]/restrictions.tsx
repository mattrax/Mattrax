import { useParams } from "@solidjs/router";
import { trpc } from "~/lib";
import { restrictions } from "@mattrax/policies";
import { RenderPolicy } from "./RenderPolicy";

export default function Page() {
  const params = useParams();
  const policy = trpc.policy.get.useQuery(() => ({
    policyId: params.policyId!,
  }));

  const policyUpdate = trpc.policy.update.useMutation(() => ({
    onSuccess: () => alert("Updated!"),
  }));

  return (
    <div class="flex flex-col space-y-2">
      <h2 class="text-2xl font-bold mb-4">Restrictions</h2>

      {/* // TODO: Don't autosave */}
      <RenderPolicy
        data={{
          // TODO: Loading this data from the backend
          camera: true,
        }}
        policy={restrictions}
      />
    </div>
  );
}
