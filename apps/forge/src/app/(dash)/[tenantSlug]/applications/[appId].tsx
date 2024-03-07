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
import { useTenantSlug } from "../../[tenantSlug]";
import { useNavbarItems } from "../../NavItems";

export const [AppContextProvider, useApp] = createContextProvider(
	(props: {
		app: NonNullable<RouterOutput["app"]["get"]>;
		query: ReturnType<typeof trpc.app.get.useQuery>;
	}) => Object.assign(() => props.app, { query: props.query }),
	null!,
);

export default function Layout(props: ParentProps) {
	const params = useZodParams({ appId: z.string() });
	const tenantSlug = useTenantSlug();

	const query = trpc.app.get.useQuery(() => ({
		id: params.appId,
		tenantSlug: tenantSlug(),
	}));


	useNavbarItems(NAV_ITEMS);

	return (
		<Show when={query.data !== undefined}>
			<Show when={query.data} fallback={<NotFound />}>
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
		</Show>
	);
}

function NotFound() {
	toast.error("Application not found");
	// necessary since '..' adds trailing slash -_-
	return <Navigate href="../../apps" />;
}

const NAV_ITEMS = [{ title: "Application", href: "" }]
