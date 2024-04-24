import { Navigate, type RouteDefinition } from "@solidjs/router";
import { type ParentProps } from "solid-js";
import { toast } from "solid-sonner";
import { Badge } from "@mattrax/ui";
import { z } from "zod";

import { MErrorBoundary } from "~c/MattraxErrorBoundary";
import { useZodParams } from "~/lib/useZodParams";
import { trpc } from "~/lib";

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
				const query = trpc.group.get.createQuery(() => ({
					id: params.groupId,
				}));

				return (
					<>
						<span>{query.data?.name}</span>
						<Badge variant="outline">Group</Badge>
					</>
				);
			},
		},
	},
} satisfies RouteDefinition;

export default function Layout(props: ParentProps) {
	return <MErrorBoundary>{props.children}</MErrorBoundary>;
}

function NotFound() {
	toast.error("Group not found");
	// necessary since '..' adds trailing slash -_-
	return <Navigate href="../../groups" />;
}
