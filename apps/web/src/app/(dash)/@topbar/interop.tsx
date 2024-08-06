// This file hacks support for parallel routes back into the current stable Solid Start/Solid Router version.

import { type RouteDefinition, Router } from "@solidjs/router";
import { lazy } from "solid-js";

// const topbar = [
// {

// },
//     {
//         path: "/*rest"
//     }
// ]satisfies RouteDefinition[];

const navitems = [
	{
		// path: "",
		// TODO: Had to rename this so it doesn't conflict with the folder.
		component: lazy(() => import("./@navItems")),
		children: [
			{
				path: "/*rest",
				component: () => <p>Not Found</p>,
			},
		],
	},
] satisfies RouteDefinition[];

export function NavItemsSlot() {
	return (
		<>
			<p>TODO</p>
			<Router>{navitems}</Router>
		</>
	);
}

export function TopbarSlot() {
	return (
		<>
			<p>TODO</p>
			<Router>{topbar}</Router>
		</>
	);
}
