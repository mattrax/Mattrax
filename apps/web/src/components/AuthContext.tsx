import { useNavigate } from "@solidjs/router";
import { type ParentProps, Show, onMount, startTransition } from "solid-js";
import { parse } from "cookie-es";
import { createContextProvider } from "@solid-primitives/context";

import { trpc } from "~/lib";
import type { RouterOutput } from "~/api";
import { isServer } from "solid-js/web";

const [AuthContextProvider, useAuth] = createContextProvider(
	(props: {
		query: ReturnType<typeof trpc.auth.me.createQuery>;
		me: RouterOutput["auth"]["me"];
	}) => Object.assign(() => props.me, { query: props.query }),
	null!,
);

export { useAuth };

export function AuthContext(props: ParentProps) {
	const navigate = useNavigate();

	if (!isServer) {
		// isLoggedIn cookie trick for quick login navigation
		const cookies = parse(document.cookie);
		if (cookies.isLoggedIn !== "true") {
			startTransition(() =>
				navigate(
					`/login?${new URLSearchParams({
						continueTo: location.pathname,
					})}`,
				),
			);

			// return null;
		}
	}

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
