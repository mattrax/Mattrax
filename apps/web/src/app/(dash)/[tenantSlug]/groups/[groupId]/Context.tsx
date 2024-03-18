import { createContextProvider } from "@solid-primitives/context";
import { RouterOutput } from "~/api";
import { trpc } from "~/lib";

export const [GroupContextProvider, useGroup] = createContextProvider(
	(props: {
		group: NonNullable<RouterOutput["group"]["get"]>;
		query: ReturnType<typeof trpc.group.get.useQuery>;
	}) => Object.assign(() => props.group, { query: props.query }),
	null!,
);
