import { createContextProvider } from "@solid-primitives/context";
import { ParentProps, Show } from "solid-js";
import { A, Navigate } from "@solidjs/router";
import { toast } from "solid-sonner";
import { z } from "zod";

import { useZodParams } from "~/lib/useZodParams";
import { trpc } from "~/lib";
import { RouterOutput } from "~/api";
import { Breadcrumb } from "~/components/Breadcrumbs";
import { Badge } from "~/components/ui";
import { useNavbarItems } from "../../NavItems";

export const [UserContextProvider, useUser] = createContextProvider(
	(props: {
		user: NonNullable<RouterOutput["user"]["get"]>;
		query: ReturnType<typeof trpc.user.get.useQuery>;
	}) => Object.assign(() => props.user, { query: props.query }),
	null!,
);

export default function Layout(props: ParentProps) {
	const params = useZodParams({ userId: z.string() });

	const query = trpc.user.get.useQuery(() => ({
		id: params.userId,
	}));

	useNavbarItems(NAV_ITEMS);

	return (
		<Show when={query.data !== undefined}>
			<Show when={query.data} fallback={<NotFound />}>
				{(data) => (
					<UserContextProvider user={data()} query={query}>
						<Breadcrumb>
							<A href="" class="flex flex-row items-center gap-2">
								<span>{data().name}</span>
								<Badge variant="outline">User</Badge>
							</A>
						</Breadcrumb>
						{props.children}
					</UserContextProvider>
				)}
			</Show>
		</Show>
	);
}

function NotFound() {
	toast.error("User not found");
	// necessary since '..' adds trailing slash -_-
	return <Navigate href="../../users" />;
}

const NAV_ITEMS = [
	{
		title: "User",
		href: "",
	},
	{
		title: "Scope",
		href: "scope",
	},
];
