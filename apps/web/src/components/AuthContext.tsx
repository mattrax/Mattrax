import { type ParentProps, Show } from "solid-js";
import { createContextProvider } from "@solid-primitives/context";

import { trpc } from "~/lib";
import type { RouterOutput } from "~/api";

const [AuthContextProvider, useAuth] = createContextProvider(
	(props: {
		query: ReturnType<typeof trpc.auth.me.createQuery>;
		me: RouterOutput["auth"]["me"];
	}) => Object.assign(() => props.me, { query: props.query }),
	null!,
);

export { useAuth };

export function AuthContext(props: ParentProps) {
	// TODO: Use the auth cookie trick for better UX
	const meQuery = trpc.auth.me.createQuery(void 0, () => ({
		// This will *always* stay in the cache. Avoids need for `localStorage` shenanigans.
		gcTime: Number.POSITIVE_INFINITY,
	}));

	return (
		<Show when={meQuery.data}>
			{(me) => (
				<AuthContextProvider me={me()} query={meQuery}>
					{props.children}
				</AuthContextProvider>
			)}
		</Show>
	);
}
