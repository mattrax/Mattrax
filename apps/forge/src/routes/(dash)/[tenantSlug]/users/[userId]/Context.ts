import { createContextProvider } from "@solid-primitives/context";
import { RouterOutput } from "~/api";
import { trpc } from "~/lib";

export const [UserContextProvider, useUser] = createContextProvider(
	(props: {
		user: NonNullable<RouterOutput["user"]["get"]>;
		query: ReturnType<typeof trpc.user.get.useQuery>;
	}) => Object.assign(() => props.user, { query: props.query }),
	null!,
);
