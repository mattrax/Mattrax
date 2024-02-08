import { useParams } from "@solidjs/router";
import { Suspense } from "solid-js";
import { trpc } from "~/lib";

export default function Page() {
  const params = useParams();
  const policy = trpc.policy.get.useQuery(() => ({
    policyId: params.policyId!,
  }));
  const policyUpdate = trpc.policy.update.useMutation(() => ({
    onSuccess: () => alert("Updated!"),
  }));
  const policyPush = trpc.policy.push.useMutation(() => ({
    onSuccess: () => alert("Policy pushed!"),
  }));
  const policyAssign = trpc.policy.assign.useMutation(() => ({
    onSuccess: (_, input) =>
      alert(input.assignOrUnassign ? "Assigned!" : "Unassigned!"),
  }));

  return (
    <div class="flex flex-col space-y-2">
      <h1>General</h1>

      <h1>Policy Page</h1>
      <Suspense fallback={<div>Loading...</div>}>
        <h1>Name: {policy.data?.name}</h1>
        <h1>
          Has Synced With Intune:{" "}
          {JSON.stringify(policy.data?.hasSyncedWithIntune)}
        </h1>

        <h2>Configuration:</h2>
        <div class="flex">
          <p>Disable Camera:</p>

          <input
            checked={false}
            type="checkbox"
            onChange={(e) =>
              policyUpdate.mutate({
                policyId: params.policyId!,
                policy: [
                  {
                    camera: e.currentTarget.checked,
                  },
                ],
              })
            }
          />
        </div>

        <h2>Intune:</h2>
        <button
          onClick={() =>
            policyPush.mutate({
              policyId: params.policyId!,
            })
          }
        >
          Sync
        </button>

        <h2>Assign Devices</h2>
        <button
          onClick={() =>
            policyAssign.mutate({
              policyId: params.policyId!,
              assignOrUnassign: true,
            })
          }
        >
          Assign
        </button>
        <button
          onClick={() =>
            policyAssign.mutate({
              policyId: params.policyId!,
              assignOrUnassign: false,
            })
          }
        >
          Unassign
        </button>
      </Suspense>
    </div>
  );
}
