import { cache, createAsync } from "@solidjs/router";
import { For, Suspense } from "solid-js";
import { client } from "~/lib";
import { useGlobalCtx } from "~/lib/globalCtx";

const fetchDevices = cache(
  // TODO: Unauthorised/error state in response
  () => client.api.devices.$get().then((res) => res.json()),
  "device"
);

export const route = {
  load: () => fetchDevices(),
};

export default function Page() {
  const ctx = useGlobalCtx();
  // TODO: Error handling for data fetch
  const devices = createAsync(fetchDevices);

  // TODO: Search
  // TODO: Filtering
  // TODO: Proper table view

  return (
    <div class="flex flex-col">
      <h1>Devices page!</h1>
      <div>
        <Suspense fallback={<div>Loading...</div>}>
          {devices()?.length ? <p>No Devices Found</p> : null}
          <For each={devices()}>
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
