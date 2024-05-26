import type { RouteDefinition } from "@solidjs/router";
import type { ParentProps } from "solid-js";
import { trpc } from "~/lib";
import { MErrorBoundary } from "~c/MattraxErrorBoundary";
import { useApp } from "./ctx";

export const route = {
	load: ({ params }) =>
		trpc.useContext().app.get.ensureData({
			appId: params.appId!,
		}),
} satisfies RouteDefinition;

export default function Layout(props: ParentProps) {
	const _ = useApp();

	return <MErrorBoundary>{props.children}</MErrorBoundary>;
}
