import { type RouteSectionProps, useNavigate } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { parse } from "cookie-es";
import { Show, lazy, onMount, startTransition } from "solid-js";
import { isServer } from "solid-js/web";
import { CommandPalette, useCommandGroup } from "~/components/CommandPalette";

import { trpc } from "~/lib";
import { MErrorBoundary } from "~c/MattraxErrorBoundary";

export const route = {
	load: () => {
		trpc.useContext().auth.me.ensureData();
	},
};

export default function Layout(props: RouteSectionProps<never, "topbar">) {
	const navigate = useNavigate();

	onMount(async () => {
		if (!import.meta.env.DEV) {
			const routes = FileRoutes();

			function preloadRoute(route: any) {
				route.component.preload();
				if (route.children) {
					for (const childRoute of route.children) {
						setTimeout(() => preloadRoute(childRoute), 100);
					}
				}
			}

			for (const route of routes) {
				setTimeout(() => preloadRoute(route), 100);
			}
		}
	});

	if (!isServer) {
		// isLoggedIn cookie trick for quick login navigation
		const cookies = parse(document.cookie);
		if (cookies.isLoggedIn !== "true") {
			startTransition(() =>
				navigate("/login", {
					state: {
						continueTo: location.pathname,
					},
				}),
			);
		}
	}

	return (
		<MErrorBoundary>
			<CommandPalette>
				{props.slots.topbar}
				{props.children}
				<Show when>
					{(_) => {
						useCommandGroup("Account", [
							{
								title: "Organisations",
								href: "/",
							},
							{
								title: `Log out of ${"todo@example.com"}`,
								onClick: () => alert(1), // TODO
							},
							{
								title: "Settings",
								href: "/account/general",
							},
							// TODO: Dark mode/light mode
						]);

						return null;
					}}
				</Show>
			</CommandPalette>
		</MErrorBoundary>
	);
}
