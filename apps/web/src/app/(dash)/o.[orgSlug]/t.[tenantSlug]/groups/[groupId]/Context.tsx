import { createContextProvider } from "@solid-primitives/context";
import type { RouterOutput } from "~/api";
import type { trpc } from "~/lib";

export const [GroupContextProvider, useGroup] = createContextProvider(
	(props: {
		group: NonNullable<RouterOutput["group"]["get"]>;
		query: ReturnType<typeof trpc.group.get.useQuery>;
	}) => Object.assign(() => props.group, { query: props.query }),
	null!,
);
