// import { useSession } from "~/utils/session";

import { cache, createAsync } from "@solidjs/router";
import { For, Suspense } from "solid-js";
import { getDevices } from "@mattrax/api";
import { useGlobalCtx } from "~/utils/globalCtx";

const fetchDevices = cache(async () => {
  "use server";

  // TODO: Check auth

  // TODO: Serve from our DB
  // TODO: Pagination with Microsoft

  const devices = await getDevices();

  // TODO: Filter to only devices in current tenant
  return devices.value.map((d) => ({
    id: d.id,
    // TODO: Fix Typescript type
    name: d.deviceName,
  }));
}, "devices");

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
                <a href={`/${ctx.activeTenant.id}/devices/${device.id}`}>
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
