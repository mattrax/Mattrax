import { createContextProvider } from "@solid-primitives/context";
import { ParentProps, Show } from "solid-js";
import { z } from "zod";
import { A, Navigate } from "@solidjs/router";
import { toast } from "solid-sonner";

import { useZodParams } from "~/lib/useZodParams";
import { trpc } from "~/lib";
import { RouterOutput } from "~/api";
import { Breadcrumb } from "~/components/Breadcrumbs";
import { Badge } from "~/components/ui";
import { useNavbarItems } from "../../NavItems";
import { MErrorBoundary } from "~/components/MattraxErrorBoundary";

export const [PolicyContextProvider, usePolicy] = createContextProvider(
	(props: {
		policy: NonNullable<RouterOutput["policy"]["get"]>;
		query: ReturnType<typeof trpc.policy.get.useQuery>;
	}) => Object.assign(() => props.policy, { query: props.query }),
	null!,
);

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
