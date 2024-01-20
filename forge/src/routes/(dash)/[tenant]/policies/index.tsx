import {
  RouteDefinition,
  cache,
  createAsync,
  useNavigate,
} from "@solidjs/router";
import { For, Suspense } from "solid-js";
import { client } from "~/utils";
import { useGlobalCtx } from "~/utils/globalCtx";

const fetchPolicies = cache(
  // TODO: Unauthorised/error state in response
  () => client.api.policies.$get().then((res) => res.json()),
  "policies"
);

export const route = {
  load: () => fetchPolicies(),
} satisfies RouteDefinition;

export default function Page() {
  const ctx = useGlobalCtx();
  // TODO: Error handling for data fetch
  const policies = createAsync(fetchPolicies);
  const navigate = useNavigate();

  // TODO: Search
  // TODO: Filtering
  // TODO: Proper table view

  return (
    <div class="flex flex-col">
      <h1>Policies page!</h1>
      <h1>Create Policy</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const formData = new FormData(e.currentTarget);
          // TODO: Unauthorised/error state in response

          client.api.policies
            .$post({
              json: {
                // @ts-expect-error
                name: formData.get("name")!,
                tenantId: ctx.activeTenant!.id,
              },
            })
            .then((res) => res.json())
            .then((policyId) =>
              navigate(`/${ctx.activeTenant!.id}/policies/${policyId}`)
            );
        }}
      >
        {/* TODO: Loading state */}
        <input type="text" name="name" placeholder="My Policy" />
        <input type="submit" value="Create" />
      </form>

      <div>
        <h1>Policies:</h1>
        <Suspense fallback={<div>Loading...</div>}>
          {policies()?.length ? <p>No Policies Found</p> : null}
          <For each={policies()}>
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
    </div>
  );
}
