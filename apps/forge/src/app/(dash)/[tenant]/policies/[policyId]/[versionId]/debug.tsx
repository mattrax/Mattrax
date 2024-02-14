import { useParams } from "@solidjs/router";
import { Button } from "~/components/ui";
import { trpc } from "~/lib";

export default function Page() {
  const params = useParams();
  const policy = trpc.policy.get.useQuery(() => ({
    policyId: params.policyId!,
  }));
  // const policyPush = trpc.policy.push.useMutation(() => ({
  //   onSuccess: () => alert("Policy pushed!"),
  // }));
  // const policyAssign = trpc.policy.assign.useMutation(() => ({
  //   onSuccess: (_, input) =>
  //     alert(input.assignOrUnassign ? "Assigned!" : "Unassigned!"),
  // }));

  return (
    <div class="flex flex-col space-y-2">
      <h2 class="text-2xl font-bold mb-4">Debug</h2>

      <pre>{JSON.stringify(policy.data, null, 2)}</pre>

      <div class="flex flex-col space-y-4 w-72">
        {/* <Button
          onClick={() =>
            policyPush.mutate({
              policyId: params.policyId!,
            })
          }
        >
          Sync w/ Intune
        </Button> */}

        {/* <Button
          onClick={() =>
            policyAssign.mutate({
              policyId: params.policyId!,
              assignOrUnassign: true,
            })
          }
        >
          Assign All Devices
        </Button> */}
        {/* <Button
          onClick={() =>
            policyAssign.mutate({
              policyId: params.policyId!,
              assignOrUnassign: false,
            })
          }
        >
          Unassign All Devices
        </Button> */}
      </div>
    </div>
  );
}
