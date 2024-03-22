import { Navigate, type RouteDefinition } from "@solidjs/router";
import { type ParentProps, Show } from "solid-js";
import { toast } from "solid-sonner";
import { Badge } from "@mattrax/ui";
import { z } from "zod";

import { MErrorBoundary } from "~/components/MattraxErrorBoundary";
import { GroupContextProvider } from "./[groupId]/Context";
import { Breadcrumb } from "~/components/Breadcrumbs";
import { useZodParams } from "~/lib/useZodParams";
import { trpc } from "~/lib";
import { useNavbarItems } from "../../TopBar/NavItems";

export const route = {
	load: ({ params }) =>
		trpc.useContext().group.get.ensureData({
			id: params.groupId!,
		}),
} satisfies RouteDefinition;

export default function Layout(props: ParentProps) {
	const params = useZodParams({ groupId: z.string() });
	const query = trpc.group.get.useQuery(() => ({
		id: params.groupId,
	}));

	useNavbarItems(NAV_ITEMS);

	return (
		<Show when={query.data !== undefined}>
			<Show when={query.data} fallback={<NotFound />}>
				{(data) => (
					<GroupContextProvider group={data()} query={query}>
						<Breadcrumb>
							<span>{data().name}</span>
							<Badge variant="outline">Group</Badge>
						</Breadcrumb>
						<MErrorBoundary>{props.children}</MErrorBoundary>
					</GroupContextProvider>
				)}
			</Show>
		</Show>
	);
}

function NotFound() {
	toast.error("Group not found");
	// necessary since '..' adds trailing slash -_-
	return <Navigate href="../../groups" />;
}

const NAV_ITEMS = [{ title: "Group", href: "" }];
