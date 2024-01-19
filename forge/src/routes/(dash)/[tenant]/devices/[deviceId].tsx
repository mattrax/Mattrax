import { cache, createAsync, redirect, useParams } from "@solidjs/router";
import { Suspense } from "solid-js";
import { getDevice } from "~/server/microsoft";

const fetchDevice = cache(async (deviceId: string) => {
  "use server";

  // TODO: Check auth
  // TODO: Check user is authorised to access tenant which owns the device

  const device = await getDevice(deviceId);

  return {
    name: device.deviceName,
  };
}, "device");

export const route = {
  load: ({ params }) => fetchDevice(params.deviceId),
};

export default function Page() {
  const params = useParams();
  if (!params.deviceId) redirect("/"); // TODO: Use a tenant relative redirect instead
  const device = createAsync(() => fetchDevice(params.deviceId));

  return (
    <div class="flex flex-col">
      <h1>Device Page</h1>
      <Suspense fallback={<div>Loading...</div>}>
        <p>Name: {device()?.name}</p>
      </Suspense>
    </div>
  );
}
