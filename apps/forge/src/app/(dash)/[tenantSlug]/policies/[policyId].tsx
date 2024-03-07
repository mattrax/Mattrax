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

export const [PolicyContextProvider, usePolicy] = createContextProvider(
	(props: {
		policy: NonNullable<RouterOutput["policy"]["get"]>;
		query: ReturnType<typeof trpc.policy.get.useQuery>;
	}) => Object.assign(() => props.policy, { query: props.query }),
	null!,
);

export default function Layout(props: ParentProps) {
	const params = useZodParams({ policyId: z.string() });
	const tenant = useTenant();
	const query = trpc.policy.get.useQuery(() => ({
		tenantSlug: tenant().slug,
		policyId: params.policyId,
	}));

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
						{props.children}
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
