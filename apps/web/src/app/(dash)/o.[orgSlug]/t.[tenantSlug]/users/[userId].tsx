import { type ParentProps } from "solid-js";
import { type RouteDefinition } from "@solidjs/router";
import { z } from "zod";

import { useZodParams } from "~/lib/useZodParams";
import { trpc } from "~/lib";
import { Badge } from "@mattrax/ui";
import { MErrorBoundary } from "~c/MattraxErrorBoundary";
import { useTenantSlug } from "../../t.[tenantSlug]";
import { createNotFoundRedirect, useNameFromListQuery } from "~/lib/utils";

export const route = {
	load: ({ params }) =>
		trpc.useContext().user.get.ensureData({
			id: params.userId!,
		}),
	info: {
		BREADCRUMB: {
			Component: () => {
				const params = useZodParams({ userId: z.string() });
				const tenantSlug = useTenantSlug();

				const query = trpc.user.get.createQuery(() => ({
					id: params.userId,
				}));

				const nameFromList = useNameFromListQuery(
					(trpc) => trpc.user.list.getData({ tenantSlug: tenantSlug() }),
					() => params.userId,
				);

				return (
					<>
						<span>{nameFromList() ?? query.data?.name}</span>
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
