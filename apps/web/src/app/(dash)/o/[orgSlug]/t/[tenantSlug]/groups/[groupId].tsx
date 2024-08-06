import type { RouteDefinition } from "@solidjs/router";
import type { ParentProps } from "solid-js";

import { trpc } from "~/lib";
import { MErrorBoundary } from "~c/MattraxErrorBoundary";
import { useGroup } from "./ctx";

export const route = {
	load: ({ params }) =>
		trpc.useContext().group.get.ensureData({
			groupId: params.groupId!,
		}),
} satisfies RouteDefinition;

export default function Layout(props: ParentProps) {
	const _ = useGroup();

	return <MErrorBoundary>{props.children}</MErrorBoundary>;
}
