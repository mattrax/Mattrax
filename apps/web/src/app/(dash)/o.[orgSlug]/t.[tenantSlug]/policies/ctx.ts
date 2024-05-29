import { trpc } from "~/lib";
import { z } from "zod";
import { useZodParams } from "~/lib/useZodParams";
import { createNotFoundRedirect } from "~/lib/utils";

export function usePolicyId() {
	const params = useZodParams({ policyId: z.string() });
	return () => params.policyId;
}

export function usePolicy() {
	const policyId = usePolicyId();

	const query = trpc.policy.get.createQuery(() => ({
		policyId: policyId(),
	}));

	createNotFoundRedirect({
		query: query,
		toast: "Policy not found",
		to: "../../policies",
	});

	return query;
}
