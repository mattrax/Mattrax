import { useParams } from "@solidjs/router";
import { Checkbox, Label } from "~/components/ui";
import { trpc } from "~/lib";

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
      <div class="items-top flex space-x-2">
        <Checkbox
          id="terms1"
          onChange={(camera) =>
            policyUpdate.mutate({
              policyId: params.policyId!,
              policy: [
                {
                  camera,
                },
              ],
            })
          }
        />
        <div class="grid gap-1.5 leading-none">
          <Label for="terms1-input">Enable camera</Label>
          <p class="text-muted-foreground text-sm">
            The lord of IT herby declares selfies are banned
          </p>
        </div>
      </div>
    </div>
  );
}
