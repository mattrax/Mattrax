import type { RouteDefinition } from "@solidjs/router";
import type { ParentProps } from "solid-js";
import { Badge } from "@mattrax/ui";
import { z } from "zod";

import { useZodParams } from "~/lib/useZodParams";
import { trpc } from "~/lib";
import { MErrorBoundary } from "~c/MattraxErrorBoundary";
import { createNotFoundRedirect } from "~/lib/utils";
import { getMetadata } from "../metadataCache";

export const route = {
	load: ({ params }) =>
		trpc.useContext().user.get.ensureData({
			id: params.userId!,
		}),
	info: {
		BREADCRUMB: {
			Component: () => {
				const params = useZodParams({ userId: z.string() });

				const query = trpc.user.get.createQuery(() => ({
					id: params.userId,
				}));

				return (
					<>
						<span>
							{getMetadata("user", params.userId)?.name ?? query.data?.name}
						</span>
						<Badge variant="outline">User</Badge>
					</>
				);
			},
		},
	},
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
