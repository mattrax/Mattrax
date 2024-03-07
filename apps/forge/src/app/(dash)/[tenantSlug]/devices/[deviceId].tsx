import { createContextProvider } from "@solid-primitives/context";
import { ParentProps, Show } from "solid-js";

import { useZodParams } from "~/lib/useZodParams";
import { z } from "zod";
import { trpc } from "~/lib";
import { RouterOutput } from "~/api";
import { Breadcrumb } from "~/components/Breadcrumbs";
import { A, Navigate } from "@solidjs/router";
import { Badge } from "~/components/ui";
import { useTenant } from "../../TenantContext";
import { toast } from "solid-sonner";

export const [DeviceContextProvider, useDevice] = createContextProvider(
	(props: {
		device: NonNullable<RouterOutput["device"]["get"]>;
		query: ReturnType<typeof trpc.device.get.useQuery>;
	}) => Object.assign(() => props.device, { query: props.query }),
	null!,
);

export default function Layout(props: ParentProps) {
	const params = useZodParams({ deviceId: z.string() });
	const tenant = useTenant();
	const query = trpc.device.get.useQuery(() => ({
		tenantSlug: tenant().slug,
		deviceId: params.deviceId,
	}));

	return (
		<Show when={query.data !== undefined}>
			<Show when={query.data} fallback={<NotFound />}>
				{(data) => (
					<DeviceContextProvider device={data()} query={query}>
						<Breadcrumb>
							<A href="" class="flex flex-row items-center gap-2">
								<span>{data().name}</span>
								<Badge variant="outline">Device</Badge>
							</A>
						</Breadcrumb>
						{props.children}
					</DeviceContextProvider>
				)}
			</Show>
		</Show>
	);
}

function NotFound() {
	toast.error("Device not found");
	// necessary since '..' adds trailing slash -_-
	return <Navigate href="../../devices" />;
}
