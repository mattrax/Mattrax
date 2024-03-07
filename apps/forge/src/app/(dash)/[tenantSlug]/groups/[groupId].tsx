import { createContextProvider } from "@solid-primitives/context";
import { ParentProps, Show } from "solid-js";

import { useZodParams } from "~/lib/useZodParams";
import { z } from "zod";
import { trpc } from "~/lib";
import { RouterOutput } from "~/api";
import { Breadcrumb } from "~/components/Breadcrumbs";
import { A, Navigate } from "@solidjs/router";
import { Badge } from "~/components/ui";
import { useTenant } from "../../TenantContext";
import { toast } from "solid-sonner";

export const [GroupContextProvider, useGroup] = createContextProvider(
	(props: {
		group: NonNullable<RouterOutput["group"]["get"]>;
		query: ReturnType<typeof trpc.group.get.useQuery>;
	}) => Object.assign(() => props.group, { query: props.query }),
	null!,
);

export default function Layout(props: ParentProps) {
	const params = useZodParams({ groupId: z.string() });
	const tenant = useTenant();
	const query = trpc.group.get.useQuery(() => ({
		tenantSlug: tenant().slug,
		id: params.groupId,
	}));

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
