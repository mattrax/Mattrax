import { createContextProvider } from "@solid-primitives/context";
import { type ParentProps, Show } from "solid-js";
import { z } from "zod";
import type { RouterOutput } from "~/api";
import { trpc } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";

const [UserContextProvider, useUser] = createContextProvider(
	(props: {
		user: NonNullable<RouterOutput["user"]["get"]>;
		query: ReturnType<typeof trpc.user.get.createQuery>;
	}) => Object.assign(() => props.user, { query: props.query }),
	null!,
);

export { useUser };

export function UserContext(props: ParentProps) {
	const params = useZodParams({ userId: z.string() });

	const user = trpc.user.get.createQuery(() => ({ id: params.userId }));

	return (
		<Show when={user.data}>
			{(data) => (
				<UserContextProvider user={data()} query={user}>
					{props.children}
				</UserContextProvider>
			)}
		</Show>
	);
}
