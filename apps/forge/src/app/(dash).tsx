import { createContextProvider } from "@solid-primitives/context";
import { useNavigate } from "@solidjs/router";
import { parse } from "cookie-es";
import { ErrorBoundary, ParentProps, Show, Suspense, onMount } from "solid-js";

import { RouterOutput } from "~/api/trpc";
import { trpc } from "~/lib";

export const [AuthContextProvider, useAuth] = createContextProvider(
	(props: {
		query: ReturnType<typeof trpc.auth.me.useQuery>;
		me: RouterOutput["auth"]["me"];
	}) => Object.assign(() => props.me, { query: props.query }),
	null!,
);

export default function Layout(props: ParentProps) {
	const navigate = useNavigate();

	onMount(() => {
		// isLoggedIn cookie trick for quick login navigation
		const cookies = parse(document.cookie);
		if (cookies.isLoggedIn !== "true") {
			navigate("/login");
		}
	});

	// TODO: Use the auth cookie trick for better UX
	const meQuery = trpc.auth.me.useQuery(void 0, () => ({
		// This will *always* stay in the cache. Avoids need for `localStorage` shenanigans.
		// gcTime: Infinity,
	}));

	return (
		<ErrorBoundary
			fallback={(err) => {
				console.error(err);

				return (
					<div class="p-2">
						<h1>Error</h1>
						<pre>{err.message}</pre>
					</div>
				);
			}}
		>
			<Show when={meQuery.data}>
				{(me) => (
					<AuthContextProvider me={me()} query={meQuery}>
						{props.children}
					</AuthContextProvider>
				)}
			</Show>
		</ErrorBoundary>
	);
}
