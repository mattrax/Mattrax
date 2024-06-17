import type { RouteDefinition } from "@solidjs/router";
import type { ParentProps } from "solid-js";

import { trpc } from "~/lib";
import { MErrorBoundary } from "~c/MattraxErrorBoundary";
import { usePolicy } from "./ctx";

export const route = {
	load: ({ params }) =>
		trpc.useContext().policy.get.ensureData({
			policyId: params.policyId!,
		}),
} satisfies RouteDefinition;

export default function Layout(props: ParentProps) {
	const _ = usePolicy();

	return <MErrorBoundary>{props.children}</MErrorBoundary>;
}
