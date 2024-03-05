import { createContextProvider } from "@solid-primitives/context";
import { ParentProps, Show } from "solid-js";

import { useZodParams } from "~/lib/useZodParams";
import { useTenant } from "../../[tenantSlug]";
import { z } from "zod";
import { trpc } from "~/lib";
import { RouterOutput } from "~/api";

export const [PolicyContextProvider, usePolicy] = createContextProvider(
	(props: {
		policy: RouterOutput["policy"]["get"];
		query: ReturnType<typeof trpc.policy.get.useQuery>;
	}) => Object.assign(() => props.policy, { query: props.query }),
	null!,
);

export default function Layout(props: ParentProps) {
	const params = useZodParams({ policyId: z.string() });
	const tenant = useTenant();
	const policyQuery = trpc.policy.get.useQuery(() => ({
		tenantSlug: tenant().slug,
		policyId: params.policyId,
	}));

	return (
		<Show when={policyQuery.data}>
			{(policy) => (
				<PolicyContextProvider policy={policy()} query={policyQuery}>
					{props.children}
				</PolicyContextProvider>
			)}
		</Show>
	);
}
