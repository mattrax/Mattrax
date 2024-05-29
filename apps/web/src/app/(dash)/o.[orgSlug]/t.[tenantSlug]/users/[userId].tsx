import type { RouteDefinition } from "@solidjs/router";
import type { ParentProps } from "solid-js";

import { trpc } from "~/lib";
import { MErrorBoundary } from "~c/MattraxErrorBoundary";
import { useUser } from "./ctx";

export const route = {
	load: ({ params }) =>
		trpc.useContext().user.get.ensureData({
			userId: params.userId!,
		}),
} satisfies RouteDefinition;

export default function Layout(props: ParentProps) {
	const _ = useUser();

	return <MErrorBoundary>{props.children}</MErrorBoundary>;
}
