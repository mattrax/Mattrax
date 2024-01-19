import { cache, createAsync, redirect, useParams } from "@solidjs/router";
import { Suspense } from "solid-js";
import { getDeviceConfiguration } from "~/server/microsoft";

const fetchDevice = cache(async (policyId: string) => {
  "use server";

  // TODO: Check auth
  // TODO: Check user is authorised to access tenant which owns the device

  const policy = await getDeviceConfiguration(policyId);

  return {
    name: policy.displayName,
  };
}, "device");

export const route = {
  load: ({ params }) => fetchDevice(params.policyId),
};

export default function Page() {
  const params = useParams();
  if (!params.policyId) redirect("/"); // TODO: Use a tenant relative redirect instead
  const device = createAsync(() => fetchDevice(params.policyId));

  return (
    <div class="flex flex-col">
      <h1>Policy Page</h1>
      <Suspense fallback={<div>Loading...</div>}>
        <p>Name: {device()?.name}</p>
      </Suspense>
    </div>
  );
}
