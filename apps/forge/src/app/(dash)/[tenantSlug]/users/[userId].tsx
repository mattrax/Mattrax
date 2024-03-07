import { createContextProvider } from "@solid-primitives/context";
import { ParentProps, Show } from "solid-js";

import { useZodParams } from "~/lib/useZodParams";
import { z } from "zod";
import { trpc } from "~/lib";
import { RouterOutput } from "~/api";
import { Breadcrumb } from "~/components/Breadcrumbs";
import { A } from "@solidjs/router";
import { Badge } from "~/components/ui";
import { useTenant } from "../../TenantContext";

export const [UserContextProvider, useUser] = createContextProvider(
	(props: {
		user: NonNullable<RouterOutput["user"]["get"]>;
		query: ReturnType<typeof trpc.user.get.useQuery>;
	}) => Object.assign(() => props.user, { query: props.query }),
	null!,
);

export default function Layout(props: ParentProps) {
	const params = useZodParams({ userId: z.string() });
	const tenant = useTenant();
	const query = trpc.user.get.useQuery(() => ({
		tenantSlug: tenant().slug,
		id: params.userId,
	}));

	return (
		<Show when={query.data}>
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
	);
}
