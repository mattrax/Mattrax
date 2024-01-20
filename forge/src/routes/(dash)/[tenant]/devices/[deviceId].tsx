import {
  RouteDefinition,
  cache,
  createAsync,
  redirect,
  useParams,
} from "@solidjs/router";
import { Suspense } from "solid-js";
import { client } from "~/utils";

const fetchDevice = cache(
  (deviceId: string) =>
    // TODO: Handle error or unauthorised responses
    client.api.devices[":deviceId"]
      .$get({ param: { deviceId } })
      .then((res) => res.json()),
  "device"
);

export const route = {
  load: ({ params }) => fetchDevice(params.deviceId!),
} satisfies RouteDefinition;

export default function Page() {
  const params = useParams();
  if (!params.deviceId) redirect("/"); // TODO: Use a tenant relative redirect instead
  const device = createAsync(() => fetchDevice(params.deviceId!));

  return (
    <div class="flex flex-col">
      <h1>Device Page</h1>
      <Suspense fallback={<div>Loading...</div>}>
        <p>Name: {device()?.name}</p>
        <button
          onClick={() =>
            // TODO: Handle error responses
            client.api.devices[":deviceId"].sync
              .$post({ param: { deviceId: params.deviceId! } })
              .then(() => alert("Synced!"))
          }
        >
          Sync
        </button>
      </Suspense>
    </div>
  );
}
