import { createContextProvider } from "@solid-primitives/context";
import { A, Navigate } from "@solidjs/router";
import { ParentProps, Show } from "solid-js";
import { toast } from "solid-sonner";
import { z } from "zod";

import { useZodParams } from "~/lib/useZodParams";
import { trpc } from "~/lib";
import { RouterOutput } from "~/api";
import { Breadcrumb } from "~/components/Breadcrumbs";
import { Badge } from "~/components/ui";
import { useNavbarItems } from "../../NavItems";

export const [GroupContextProvider, useGroup] = createContextProvider(
	(props: {
		group: NonNullable<RouterOutput["group"]["get"]>;
		query: ReturnType<typeof trpc.group.get.useQuery>;
	}) => Object.assign(() => props.group, { query: props.query }),
	null!,
);

export default function Layout(props: ParentProps) {
	const params = useZodParams({ tenantSlug: z.string(), groupId: z.string() });
	const query = trpc.group.get.useQuery(() => ({
		tenantSlug: params.tenantSlug,
		id: params.groupId,
	}));

	useNavbarItems(NAV_ITEMS)

	return (
		<Show when={query.data !== undefined}>
			<Show when={query.data} fallback={<NotFound />}>
				{(data) => (
					<GroupContextProvider group={data()} query={query}>
						<Breadcrumb>
							<A href="" class="flex flex-row items-center gap-2">
								<span>{data().name}</span>
								<Badge variant="outline">Group</Badge>
							</A>
						</Breadcrumb>
						{props.children}
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

const NAV_ITEMS = [{ title: "Group", href: "" }]
