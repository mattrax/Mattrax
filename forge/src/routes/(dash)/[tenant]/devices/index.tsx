import { For, Suspense } from "solid-js";
import { trpc } from "~/lib";
import { useGlobalCtx } from "~/lib/globalCtx";

// TODO: Bring this back
// const fetchDevices = cache(
//   // TODO: Unauthorised/error state in response
//   () => trpcClient.device.list.query(),
//   "device"
// );

// export const route = {
//   load: () => fetchDevices(),
// };

export default function Page() {
  const ctx = useGlobalCtx();
  // TODO: Error handling for data fetch
  const devices = trpc.device.list.useQuery();

  // TODO: Search
  // TODO: Filtering
  // TODO: Proper table view

  return (
    <div class="flex flex-col">
      <h1>Devices page!</h1>
      <div>
        <Suspense fallback={<div>Loading...</div>}>
          {devices.data?.length ? <p>No Devices Found</p> : null}
          <For each={devices.data}>
            {(device) => (
              <div class="flex">
                <p>{device.name}</p>
                <a href={`/${ctx.activeTenant!.id}/devices/${device.id}`}>
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
