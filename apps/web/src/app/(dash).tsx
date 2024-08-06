import { type Params, useNavigate } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { parse } from "cookie-es";
import { Show, onMount, startTransition } from "solid-js";
import type { JSX } from "solid-js";
import { isServer } from "solid-js/web";
import { CommandPalette, useCommandGroup } from "~/components/CommandPalette";

import { trpc } from "~/lib";
import { MErrorBoundary } from "~c/MattraxErrorBoundary";
import Topbar from "./(dash)/@topbar";
import { BreadcrumbsSlot, NavItemsSlot } from "./(dash)/@topbar/interop";

export const route = {
	load: () => {
		trpc.useContext().auth.me.ensureData();
	},
};

// TODO: Copied from: https://github.com/solidjs/solid-router/pull/426
// TODO: Replace with SolidJS import once it's available
export interface RouteSectionProps<T = unknown, TSlots extends string = never> {
	params: Params;
	location: Location;
	data: T;
	children?: JSX.Element;
	slots: Record<TSlots, JSX.Element>;
}

const TopbarAny = Topbar as any;

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
			const params = new URLSearchParams({
				next: location.pathname,
			});

			startTransition(() => navigate(`/login?${params.toString()}`));
		}
	}

	return (
		<MErrorBoundary>
			<CommandPalette>
				{/* // TODO: Replace this with `{props.slots.topbar}` */}
				<TopbarAny
					// TODO: We are faking the API of: https://github.com/solidjs/solid-router/pull/426
					slots={{
						breadcrumbs: <BreadcrumbsSlot />,
						navItems: <NavItemsSlot />,
					}}
				/>

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
