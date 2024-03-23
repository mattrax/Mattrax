import { Navigate, type RouteDefinition } from "@solidjs/router";
import { type ParentProps, Show } from "solid-js";
import { toast } from "solid-sonner";
import { Badge } from "@mattrax/ui";
import { z } from "zod";

import { trpc } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";
import { Breadcrumb } from "~/components/Breadcrumbs";
import { MErrorBoundary } from "~/components/MattraxErrorBoundary";
import { PolicyContextProvider } from "./[policyId]/Context";

const NAV_ITEMS = [
	{ title: "Policy", href: "" },
	{ title: "Edit", href: "edit" },
	{ title: "Assignees", href: "assignees" },
	{ title: "History", href: "history" },
	{ title: "Settings", href: "settings" },
];

export const route = {
	load: ({ params }) =>
		trpc.useContext().policy.get.ensureData({
			policyId: params.policyId!,
		}),
	info: { NAV_ITEMS },
} satisfies RouteDefinition;

export default function Layout(props: ParentProps) {
	const params = useZodParams({ policyId: z.string() });

	const query = trpc.policy.get.useQuery(() => params);

	return (
		<Show when={query.data !== undefined}>
			<Show when={query.data} fallback={<NotFound />}>
				{(policy) => (
					<PolicyContextProvider policy={policy()} query={query}>
						<Breadcrumb>
							<span>{policy().name}</span>
							<Badge variant="outline">Policy</Badge>
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
