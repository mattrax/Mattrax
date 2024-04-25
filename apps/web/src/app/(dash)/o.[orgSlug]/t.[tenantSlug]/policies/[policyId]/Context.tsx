import { createContextProvider } from "@solid-primitives/context";
import { ParentProps, Show } from "solid-js";
import { z } from "zod";

import type { RouterOutput } from "~/api";
import { trpc } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";

const [PolicyContextProvider, usePolicy] = createContextProvider(
	(props: {
		policy: NonNullable<RouterOutput["policy"]["get"]>;
		query: ReturnType<typeof trpc.policy.get.createQuery>;
	}) => Object.assign(() => props.policy, { query: props.query }),
	null!,
);

export { usePolicy };

export function PolicyContext(props: ParentProps) {
	const params = useZodParams({ policyId: z.string() });

	const policy = trpc.policy.get.createQuery(() => ({ id: params.policyId }));

	return (
		<Show when={policy.data}>
			{(data) => (
				<PolicyContextProvider policy={data()} query={policy}>
					{props.children}
				</PolicyContextProvider>
			)}
		</Show>
	);
}
