// import { useSession } from "~/utils/session";

import { cache, createAsync } from "@solidjs/router";
import { For, Suspense } from "solid-js";
import { getDeviceConfigurations, getDevices } from "~/server/microsoft";
import { useGlobalCtx } from "~/utils/globalCtx";

const fetchPolicies = cache(async () => {
  "use server";

  // TODO: Check auth

  // TODO: Serve from our DB
  // TODO: Pagination with Microsoft

  const policies = await getDeviceConfigurations();

  // TODO: Filter to only entities in current tenant
  return policies.value.map((d) => ({
    id: d.id,
    // TODO: Fix Typescript type
    name: d.displayName,
  }));
}, "policies");

export const route = {
  load: () => fetchPolicies(),
};

export default function Page() {
  const ctx = useGlobalCtx();
  // TODO: Error handling for data fetch
  const policies = createAsync(fetchPolicies);

  // TODO: Search
  // TODO: Filtering
  // TODO: Proper table view

  return (
    <div class="flex flex-col">
      <h1>Policies page!</h1>
      <div>
        <Suspense fallback={<div>Loading...</div>}>
          {policies()?.length ? <p>No Policies Found</p> : null}
          <For each={policies()}>
            {(policy) => (
              <div class="flex">
                <p>{policy.name}</p>
                <a href={`/${ctx.activeTenant.id}/policies/${policy.id}`}>
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
