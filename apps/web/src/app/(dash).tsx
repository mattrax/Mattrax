import {
	type RouteSectionProps,
	useMatches,
	useNavigate,
} from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { parse } from "cookie-es";
import { onMount, startTransition } from "solid-js";
import { isServer } from "solid-js/web";

import { trpc } from "~/lib";
import { MErrorBoundary } from "~c/MattraxErrorBoundary";

export const route = {
	load: () => {
		trpc.useContext().auth.me.ensureData();
	},
};

export default function Layout(props: RouteSectionProps<never, "topbar">) {
	const navigate = useNavigate();

	const matches = useMatches();

	onMount(async () => {
		if (!import.meta.env.DEV) {
			const routes = FileRoutes();

			function preloadRoute(route: any) {
				route.component.preload();
				if (route.children) {
					for (const childRoute of route.children) {
						preloadRoute(childRoute);
					}
				}
			}

			for (const route of routes) {
				preloadRoute(route);
			}
		}
	});

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
		}
	}

	return (
		<MErrorBoundary>
			{props.slots.topbar}
			{props.children}
		</MErrorBoundary>
	);
}
