import { type RouteDefinition } from "@solidjs/router";
import { type ParentProps } from "solid-js";
import { Badge } from "@mattrax/ui";
import { z } from "zod";

import { MErrorBoundary } from "~c/MattraxErrorBoundary";
import { useZodParams } from "~/lib/useZodParams";
import { trpc } from "~/lib";
import { useTenantSlug } from "../../t.[tenantSlug]";
import { createNotFoundRedirect, useNameFromListQuery } from "~/lib/utils";

export function useGroupId() {
	const params = useZodParams({ groupId: z.string() });
	return () => params.groupId;
}

const NAV_ITEMS = [
	{ title: "Group", href: "" },
	{ title: "Members", href: "members" },
	{ title: "Assignments", href: "assignments" },
];

export const route = {
	load: ({ params }) =>
		trpc.useContext().group.get.ensureData({
			id: params.groupId!,
		}),
	info: {
		NAV_ITEMS,
		BREADCRUMB: {
			Component: () => {
				const params = useZodParams({ groupId: z.string() });
				const tenantSlug = useTenantSlug();

				const query = trpc.group.get.createQuery(() => ({
					id: params.groupId,
				}));

				const nameFromList = useNameFromListQuery(
					(trpc) => trpc.group.list.getData({ tenantSlug: tenantSlug() }),
					() => params.groupId,
				);

				return (
					<>
						<span>{nameFromList() ?? query.data?.name}</span>
						<Badge variant="outline">Group</Badge>
					</>
				);
			},
		},
	},
} satisfies RouteDefinition;

export default function Layout(props: ParentProps) {
	const params = useZodParams({ groupId: z.string() });

	createNotFoundRedirect({
		query: trpc.group.get.createQuery(() => ({ id: params.groupId })),
		toast: "Group not found",
		to: "../../groups",
	});

	return <MErrorBoundary>{props.children}</MErrorBoundary>;
}
