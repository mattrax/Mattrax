import { createContextProvider } from "@solid-primitives/context";
import type { RouterOutput } from "~/api";
import type { trpc } from "~/lib";

export const [PolicyContextProvider, usePolicy] = createContextProvider(
	(props: {
		policy: NonNullable<RouterOutput["policy"]["get"]>;
		query: ReturnType<typeof trpc.policy.get.useQuery>;
	}) => Object.assign(() => props.policy, { query: props.query }),
	null!,
);
