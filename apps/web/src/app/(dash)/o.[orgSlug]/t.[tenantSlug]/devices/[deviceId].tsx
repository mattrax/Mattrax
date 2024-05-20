import { Navigate, type RouteDefinition } from "@solidjs/router";
import { type ParentProps, Show } from "solid-js";
import { toast } from "solid-sonner";
import { z } from "zod";

import { useZodParams } from "~/lib/useZodParams";
import { trpc } from "~/lib";
import { MErrorBoundary } from "~c/MattraxErrorBoundary";
import { DeviceContextProvider } from "./[deviceId]/Context";

export const route = {
	load: ({ params }) =>
		trpc.useContext().device.get.ensureData({
			deviceId: params.deviceId!,
		}),
} satisfies RouteDefinition;

export default function Layout(props: ParentProps) {
	const params = useZodParams({ deviceId: z.string() });
	const query = trpc.device.get.createQuery(() => params);

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
