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

export const [AppContextProvider, useApp] = createContextProvider(
	(props: {
		app: RouterOutput["app"]["get"];
		query: ReturnType<typeof trpc.app.get.useQuery>;
	}) => Object.assign(() => props.app, { query: props.query }),
	null!,
);

export default function Layout(props: ParentProps) {
	const params = useZodParams({ appId: z.string() });
	const tenant = useTenant();
	const query = trpc.app.get.useQuery(() => ({
		tenantSlug: tenant().slug,
		id: params.appId,
	}));

	return (
		<Show when={query.data}>
			{(data) => (
				<AppContextProvider app={data()} query={query}>
					<Breadcrumb>
						<A href="" class="flex flex-row items-center gap-2">
							<span>{data().name}</span>
							<Badge variant="outline">Application</Badge>
						</A>
					</Breadcrumb>
					{props.children}
				</AppContextProvider>
			)}
		</Show>
	);
}
