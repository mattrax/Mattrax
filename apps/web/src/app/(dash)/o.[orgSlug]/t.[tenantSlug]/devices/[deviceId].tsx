import { A, Navigate, type RouteDefinition } from "@solidjs/router";
import { type ParentProps, Show } from "solid-js";
import { toast } from "solid-sonner";
import { Badge } from "@mattrax/ui";
import { z } from "zod";

import { useZodParams } from "~/lib/useZodParams";
import { trpc } from "~/lib";
import { Breadcrumb } from "~c/Breadcrumbs";
import { MErrorBoundary } from "~c/MattraxErrorBoundary";
import { DeviceContextProvider } from "./[deviceId]/Context";

const NAV_ITEMS = [
	{ title: "Device", href: "" },
	{ title: "Configuration", href: "configuration" },
	{ title: "Scope", href: "scope" },
	{ title: "Inventory", href: "inventory" },
	{ title: "Settings", href: "settings" },
];

export const route = {
	load: ({ params }) =>
		trpc.useContext().device.get.ensureData({
			deviceId: params.deviceId!,
		}),
	info: {
		NAV_ITEMS,
		BREADCRUMB: {
			Component: () => {
				const params = useZodParams({ deviceId: z.string() });
				const query = trpc.device.get.useQuery(() => params);

				return (
					<>
						<span>{query.data?.name}</span>
						<Badge variant="outline">Device</Badge>
					</>
				);
			},
		},
	},
} satisfies RouteDefinition;

export default function Layout(props: ParentProps) {
	const params = useZodParams({ deviceId: z.string() });
	const query = trpc.device.get.useQuery(() => params);

	return (
		<Show when={query.data !== undefined}>
			<Show when={query.data} fallback={<NotFound />}>
				{(data) => (
					<DeviceContextProvider device={data()} query={query}>
						<MErrorBoundary>{props.children}</MErrorBoundary>
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
