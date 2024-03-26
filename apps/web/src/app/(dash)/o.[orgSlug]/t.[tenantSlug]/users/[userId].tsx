import { type ParentProps, Show } from "solid-js";
import { Navigate, type RouteDefinition } from "@solidjs/router";
import { toast } from "solid-sonner";
import { z } from "zod";

import { useZodParams } from "~/lib/useZodParams";
import { trpc } from "~/lib";
import { Badge } from "@mattrax/ui";
import { MErrorBoundary } from "~c/MattraxErrorBoundary";
import { UserContextProvider } from "./[userId]/Context";

export const route = {
	load: ({ params }) =>
		trpc.useContext().user.get.ensureData({
			id: params.userId!,
		}),
	info: {
		BREADCRUMB: () => {
			const params = useZodParams({ userId: z.string() });

			const query = trpc.user.get.useQuery(() => ({
				id: params.userId,
			}));

			return (
				<>
					<span>{query.data?.name}</span>
					<Badge variant="outline">User</Badge>
				</>
			);
		},
	},
} satisfies RouteDefinition;

export default function Layout(props: ParentProps) {
	const params = useZodParams({ userId: z.string() });

	const query = trpc.user.get.useQuery(() => ({
		id: params.userId,
	}));

	return (
		<Show when={query.data !== undefined}>
			<Show when={query.data} fallback={<NotFound />}>
				{(data) => (
					<UserContextProvider user={data()} query={query}>
						<MErrorBoundary>{props.children}</MErrorBoundary>
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
