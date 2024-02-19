import { redirect, useParams } from "@solidjs/router";
import { ParentProps, Suspense } from "solid-js";
import FlatTabs from "~/components/ui/flat-tabs";
import { trpc } from "~/lib";
import { useTenantContext } from "../../[tenantId]";

// TODO: Bring this back
// const fetchDevice = cache(
//   // TODO: Handle error or unauthorised responses
//   (deviceId: string) => trpcClient.device.get.query({ deviceId }),
//   "device"
// );

// export const route = {
//   load: ({ params }) => fetchDevice(params.deviceId!),
// } satisfies RouteDefinition;

export default function Page(props: ParentProps) {
  const params = useParams();
  if (!params.deviceId) redirect("/"); // TODO: Use a tenant relative redirect instead

  const tenant = useTenantContext();
  const device = trpc.device.get.useQuery(() => ({
    deviceId: params.deviceId!,
    tenantId: tenant.activeTenant.id,
  }));

  const url = (suffix: string) =>
    `/${params.tenantId!}/devices/${params.deviceId}${suffix}`;

  const sync = trpc.device.sync.useMutation(() => ({
    onSuccess: () => alert("Synced!"),
  }));

  return (
    <div class="flex flex-col">
      {/* <Suspense fallback={<div>Loading...</div>}>
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
      </Suspense> */}
      {/* TODO: Cleanup this suspense cause it's a whole page suspend */}
      <Suspense fallback={<div>Loading...</div>}>
        <div class="flex-1 px-4 py-8">
          <h1 class="text-3xl font-bold focus:outline-none" contentEditable>
            {device.data?.name}
          </h1>

          {/* TODO: Use JSX children instead of tabs prop */}
          <FlatTabs
            tabs={[
              { name: "Overview", href: url(""), current: false },
              { name: "Scoped", href: url("/scoped"), current: true },
              {
                name: "Applications",
                href: url("/applications"),
                current: false,
              },
              { name: "Settings", href: url("/settings"), current: false },
            ]}
          />

          {props.children}
        </div>
      </Suspense>
    </div>
  );
}
