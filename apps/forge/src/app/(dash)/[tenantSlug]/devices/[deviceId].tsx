import { createContextProvider } from "@solid-primitives/context";
import { A, Navigate } from "@solidjs/router";
import { ParentProps, Show } from "solid-js";
import { toast } from "solid-sonner";
import { z } from "zod";

import { useZodParams } from "~/lib/useZodParams";
import { trpc } from "~/lib";
import { RouterOutput } from "~/api";
import { Breadcrumb } from "~/components/Breadcrumbs";
import { Badge } from "~/components/ui";
import { useNavbarItems } from "../../NavItems";

export const [DeviceContextProvider, useDevice] = createContextProvider(
	(props: {
		device: NonNullable<RouterOutput["device"]["get"]>;
		query: ReturnType<typeof trpc.device.get.useQuery>;
	}) => Object.assign(() => props.device, { query: props.query }),
	null!,
);

export default function Layout(props: ParentProps) {
	const params = useZodParams({ deviceId: z.string() });
	const query = trpc.device.get.useQuery(() => params);

	useNavbarItems(NAV_ITEMS);

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

const NAV_ITEMS = [
	{ title: "Device", href: "" },
	{
		title: "Scope",
		href: "scope",
	},
	{
		title: "Inventory",
		href: "inventory",
	},
	{
		title: "Settings",
		href: "settings",
	},
];
