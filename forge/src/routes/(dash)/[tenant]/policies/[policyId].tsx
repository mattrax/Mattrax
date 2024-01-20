import {
  RouteDefinition,
  cache,
  createAsync,
  redirect,
  useParams,
} from "@solidjs/router";
import { Suspense } from "solid-js";
import { client } from "~/utils";

const fetchPolicy = cache(
  async (policyId: string) =>
    // TODO: Handle error or unauthorised responses
    client.api.policies[":policyId"]
      .$get({ param: { policyId } })
      .then((res) => res.json()),
  "policy"
);

export const route = {
  load: ({ params }) => fetchPolicy(params.policyId!),
} satisfies RouteDefinition;

export default function Page() {
  const params = useParams();
  if (!params.policyId) redirect("/"); // TODO: Use a tenant relative redirect instead
  const policy = createAsync(() => fetchPolicy(params.policyId!));

  return (
    <div class="flex flex-col">
      <h1>Policy Page</h1>
      <Suspense fallback={<div>Loading...</div>}>
        <h1>Name: {policy()?.name}</h1>
        <h1>
          Has Synced With Intune:{" "}
          {JSON.stringify(policy()?.hasSyncedWithIntune)}
        </h1>

        <h2>Configuration:</h2>
        <div class="flex">
          <p>Disable Camera:</p>

          <input
            checked={false}
            type="checkbox"
            onChange={(e) => {
              // TODO: handle unauthorised or error response
              client.api.policies[":policyId"]
                .$patch({
                  param: { policyId: params.policyId! },
                  json: [
                    {
                      camera: e.currentTarget.checked,
                    },
                  ],
                })
                .then(() => alert("Updated!"));
            }}
          />
        </div>

        <h2>Intune:</h2>
        <button
          onClick={() => {
            // TODO: handle unauthorised or error response
            client.api.policies[":policyId"].push
              .$post({
                param: { policyId: params.policyId! },
              })
              .then(() => alert("Policy pushed!"));
          }}
        >
          Sync
        </button>

        <h2>Assign Devices</h2>
        <button
          onClick={() => {
            // TODO: handle unauthorised or error response
            client.api.policies[":policyId"].assign
              .$post({
                param: { policyId: params.policyId! },
                json: {
                  assignOrUnassign: true,
                },
              })
              .then(() => alert("Assigned!"));
          }}
        >
          Assign
        </button>
        <button
          onClick={() => {
            // TODO: handle unauthorised or error response
            client.api.policies[":policyId"].assign
              .$post({
                param: { policyId: params.policyId! },
                json: {
                  assignOrUnassign: false,
                },
              })
              .then(() => alert("Unassigned!"));
          }}
        >
          Unassign
        </button>
      </Suspense>
    </div>
  );
}
