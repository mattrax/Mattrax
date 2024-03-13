import { type ParentProps, Show } from "solid-js";
import { z } from "zod";
import { A, Navigate, type RouteDefinition } from "@solidjs/router";
import { toast } from "solid-sonner";

import { useZodParams } from "~/lib/useZodParams";
import { trpc } from "~/lib";
import { Breadcrumb } from "~/components/Breadcrumbs";
import { Badge } from "@mattrax/ui";
import { useNavbarItems } from "../../NavItems";
import { MErrorBoundary } from "~/components/MattraxErrorBoundary";
import { PolicyContextProvider } from "./[policyId]/Context";

export const route = {
	load: ({ params }) =>
		trpc.useContext().policy.get.ensureData({
			policyId: params.policyId!,
		}),
} satisfies RouteDefinition;

export default function Layout(props: ParentProps) {
	const params = useZodParams({ policyId: z.string() });

	const query = trpc.policy.get.useQuery(() => params);

	useNavbarItems(NAV_ITEMS);

	return (
		<Show when={query.data !== undefined}>
			<Show when={query.data} fallback={<NotFound />}>
				{(policy) => (
					<PolicyContextProvider policy={policy()} query={query}>
						<Breadcrumb>
							<A href="" class="flex flex-row items-center gap-2">
								<span>{policy().name}</span>
								<Badge variant="outline">Policy</Badge>
							</A>
						</Breadcrumb>
						<MErrorBoundary>{props.children}</MErrorBoundary>
					</PolicyContextProvider>
				)}
			</Show>
		</Show>
	);
}

function NotFound() {
	toast.error("Policy not found");
	// necessary since '..' adds trailing slash -_-
	return <Navigate href="../../policies" />;
}

const NAV_ITEMS = [
	{
		title: "Policy",
		href: "",
	},
	{
		title: "Edit",
		href: "edit",
	},
	{
		title: "Assignees",
		href: "assignees",
	},
	{
		title: "History",
		href: "history",
	},
	{
		title: "Settings",
		href: "settings",
	},
];
