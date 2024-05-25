import type { RouteDefinition } from "@solidjs/router";
import type { ParentProps } from "solid-js";
import { z } from "zod";

import { trpc } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";
import { createNotFoundRedirect } from "~/lib/utils";
import { MErrorBoundary } from "~c/MattraxErrorBoundary";

export const route = {
	load: ({ params }) =>
		trpc.useContext().app.get.ensureData({
			id: params.appId!,
		}),
} satisfies RouteDefinition;

export default function Layout(props: ParentProps) {
	const params = useZodParams({ appId: z.string() });

	createNotFoundRedirect({
		query: trpc.app.get.createQuery(() => ({ id: params.appId })),
		toast: "Application not found",
		to: "../../apps",
	});

	return <MErrorBoundary>{props.children}</MErrorBoundary>;
}
