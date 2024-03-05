import { createContextProvider } from "@solid-primitives/context";
import { ParentProps } from "solid-js";
import { useZodParams } from "~/lib/useZodParams";
import { useTenant } from "../../[tenantSlug]";
import { z } from "zod";
import { trpc } from "~/lib";

function getPolicy() {
	const params = useZodParams({
		policyId: z.string(),
	});
	const tenant = useTenant();
	return trpc.policy.get.useQuery(() => ({
		policyId: params.policyId,
		tenantSlug: tenant().slug,
	}));
}

export const [PolicyContextProvider, usePolicy] = createContextProvider(
	(props: { policy: ReturnType<typeof getPolicy> }) => props.policy,
	null!,
);

export default function Layout(props: ParentProps) {
	return (
		<PolicyContextProvider policy={getPolicy()}>
			{props.children}
		</PolicyContextProvider>
	);
}
