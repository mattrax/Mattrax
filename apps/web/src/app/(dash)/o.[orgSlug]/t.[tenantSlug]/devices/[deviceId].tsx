import type { RouteDefinition } from "@solidjs/router";
import type { ParentProps } from "solid-js";

import { trpc } from "~/lib";
import { MErrorBoundary } from "~c/MattraxErrorBoundary";
import { useDevice } from "./ctx";

export const route = {
	load: ({ params }) =>
		trpc.useContext().device.get.ensureData({
			deviceId: params.deviceId!,
		}),
} satisfies RouteDefinition;

export default function Layout(props: ParentProps) {
	const _ = useDevice();

	return <MErrorBoundary>{props.children}</MErrorBoundary>;
}
