import type { RouteDefinition } from "@solidjs/router";
import type { ParentProps } from "solid-js";
import { z } from "zod";

import { trpc } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";
import { MErrorBoundary } from "~c/MattraxErrorBoundary";
import { createNotFoundRedirect } from "~/lib/utils";

export function usePolicyId() {
	const params = useZodParams({ policyId: z.string() });
	return () => params.policyId;
}

export const route = {
	load: ({ params }) =>
		trpc.useContext().policy.get.ensureData({
			id: params.policyId!,
		}),
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
