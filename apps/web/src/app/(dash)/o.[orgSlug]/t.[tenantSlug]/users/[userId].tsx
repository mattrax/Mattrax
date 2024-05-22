import type { RouteDefinition } from "@solidjs/router";
import type { ParentProps } from "solid-js";
import { z } from "zod";

import { trpc } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";
import { createNotFoundRedirect } from "~/lib/utils";
import { MErrorBoundary } from "~c/MattraxErrorBoundary";

export const route = {
	load: ({ params }) =>
		trpc.useContext().user.get.ensureData({
			id: params.userId!,
		}),
} satisfies RouteDefinition;

export default function Layout(props: ParentProps) {
	const params = useZodParams({ userId: z.string() });

	createNotFoundRedirect({
		query: trpc.user.get.createQuery(() => ({ id: params.userId })),
		toast: "User not found",
		to: "../../users",
	});

	return <MErrorBoundary>{props.children}</MErrorBoundary>;
}
