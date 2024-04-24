import { type RouteDefinition } from "@solidjs/router";
import { type ParentProps } from "solid-js";
import { Badge } from "@mattrax/ui";
import { z } from "zod";

import { trpc } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";
import { MErrorBoundary } from "~c/MattraxErrorBoundary";
import { createNotFoundRedirect, useNameFromListQuery } from "~/lib/utils";
import { useTenantSlug } from "../../t.[tenantSlug]";

export function usePolicyId() {
	const params = useZodParams({ policyId: z.string() });
	return () => params.policyId;
}

const NAV_ITEMS = [
	{ title: "Policy", href: "" },
	{ title: "Edit", href: "edit" },
	{ title: "Deploys", href: "deploys" },
	{ title: "Assignees", href: "assignees" },
	{ title: "Settings", href: "settings" },
];

export const route = {
	load: ({ params }) =>
		trpc.useContext().policy.get.ensureData({
			id: params.policyId!,
		}),
	info: {
		NAV_ITEMS,
		BREADCRUMB: {
			Component: () => {
				const params = useZodParams({ policyId: z.string() });
				const tenantSlug = useTenantSlug();

				const query = trpc.policy.get.createQuery(() => ({
					id: params.policyId,
				}));

				const nameFromList = useNameFromListQuery(
					(trpc) => trpc.policy.list.getData({ tenantSlug: tenantSlug() }),
					() => params.policyId,
				);

				return (
					<>
						<span>{nameFromList() ?? query.data?.name}</span>
						<Badge variant="outline">Policy</Badge>
					</>
				);
			},
		},
	},
} satisfies RouteDefinition;

export default function Layout(props: ParentProps) {
	const params = useZodParams({ policyId: z.string() });

	createNotFoundRedirect({
		query: trpc.policy.get.createQuery(() => ({ id: params.policyId })),
		toast: "Policy not found",
		to: "../../policies",
	});

	return <MErrorBoundary>{props.children}</MErrorBoundary>;
}
