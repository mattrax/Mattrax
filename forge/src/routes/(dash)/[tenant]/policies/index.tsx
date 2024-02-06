import { useNavigate } from "@solidjs/router";
import { For, Suspense } from "solid-js";
import { trpc } from "~/lib";
import { useGlobalCtx } from "~/lib/globalCtx";
import { OutlineLayout } from "../OutlineLayout";
import { Button, Input, Label } from "~/components/ui";

// TODO: Bring this back
// const fetchPolicies = cache(
//   // TODO: Unauthorised/error state in response
//   () => trpcClient.policy.list.query(),
//   "policies"
// );

// export const route = {
//   load: () => fetchPolicies(),
// } satisfies RouteDefinition;

export default function Page() {
  const ctx = useGlobalCtx();
  const policies = trpc.policy.list.useQuery();
  const navigate = useNavigate();
  const createPolicy = trpc.policy.create.useMutation(() => ({
    onSuccess: (policyId) =>
      navigate(`/${ctx.activeTenant!.id}/policies/${policyId}`),
  }));

  // TODO: Search
  // TODO: Filtering
  // TODO: Proper table view

  return (
    <OutlineLayout title="Policies">
      <Label for="form">Create a new policy</Label>
      <form
        id="form"
        class="flex flex-row gap-4 max-w-md mt-1"
        onSubmit={(e) => {
          e.preventDefault();
          const formData = new FormData(e.currentTarget);
          createPolicy.mutate({
            name: formData.get("name")! as string,
          });
        }}
      >
        {/* TODO: Loading state */}
        <Input type="text" name="name" placeholder="My Policy" />
        <Button class="shrink-0" type="submit">
          Create Policy
        </Button>
      </form>

      <div>
        <h1>Policies:</h1>
        <Suspense fallback={<div>Loading...</div>}>
          {policies.data?.length ? <p>No Policies Found</p> : null}
          <For each={policies.data}>
            {(policy) => (
              <div class="flex">
                <p>{policy.name}</p>
                <a href={`/${ctx.activeTenant!.id}/policies/${policy.id}`}>
                  Open
                </a>
              </div>
            )}
          </For>
        </Suspense>
      </div>
    </OutlineLayout>
  );
}
