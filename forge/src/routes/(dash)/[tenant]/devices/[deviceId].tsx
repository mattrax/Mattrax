import { redirect, useParams } from "@solidjs/router";
import { Suspense } from "solid-js";
import { trpc, trpcClient } from "~/lib";

// TODO: Bring this back
// const fetchDevice = cache(
//   // TODO: Handle error or unauthorised responses
//   (deviceId: string) => trpcClient.device.get.query({ deviceId }),
//   "device"
// );

// export const route = {
//   load: ({ params }) => fetchDevice(params.deviceId!),
// } satisfies RouteDefinition;

export default function Page() {
  const params = useParams();
  if (!params.deviceId) redirect("/"); // TODO: Use a tenant relative redirect instead
  const device = trpc.device.get.useQuery(() => ({
    deviceId: params.deviceId!,
  }));

  const sync = trpc.device.sync.useMutation(() => ({
    onSuccess: () => alert("Synced!"),
  }));

  return (
    <div class="flex flex-col">
      <h1>Device Page</h1>
      <Suspense fallback={<div>Loading...</div>}>
        <p>Name: {device.data?.name}</p>
        <button
          onClick={() =>
            sync.mutate({
              deviceId: params.deviceId!,
            })
          }
          disabled={device.isPending || sync.isPending}
        >
          Sync
        </button>
      </Suspense>
    </div>
  );
}
