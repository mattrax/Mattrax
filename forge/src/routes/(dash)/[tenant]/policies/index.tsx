// import { useSession } from "~/utils/session";

import { cache, createAsync, useNavigate } from "@solidjs/router";
import { For, Suspense } from "solid-js";
import { db } from "~/server/db";
import { policies } from "~/server/db/schema";
import { getDeviceConfigurations, getDevices } from "~/server/microsoft";
import { encodeId } from "~/server/utils";
import { useGlobalCtx } from "~/utils/globalCtx";

const fetchPolicies = cache(async () => {
  "use server";

  // TODO: Check auth

  // TODO: Serve from our DB
  // TODO: Pagination with Microsoft

  // TODO: Filter to only entities in current tenant
  const p = await db.select().from(policies);

  // TODO: Do filtering in DB + add helper for the ID encoding
  return p.map((d) => ({
    id: encodeId("policy", d.id),
    name: d.name,
  }));
}, "policies");

const createPolicy = async (name: string) => {
  "use server";

  // TODO: Input validation

  const result = await db.insert(policies).values({
    name,
  });

  return encodeId("policy", parseInt(result.insertId));
};

export const route = {
  load: () => fetchPolicies(),
};

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
          createPolicy(formData.get("name")!).then((policyId) =>
            navigate(`/${ctx.activeTenant.id}/policies/${policyId}`)
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
