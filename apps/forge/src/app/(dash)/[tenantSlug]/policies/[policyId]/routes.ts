import { RouteDefinition } from "@solidjs/router";
import { lazy } from "solid-js";

import versionsRoutes from "./versions/routes";

export default [
	{
		path: "/",
		component: lazy(() => import("./index")),
	},
	{
		path: "/edit",
		component: lazy(() => import("./edit")),
	},
	{
		path: "/assignees",
		component: lazy(() => import("./assignees")),
	},
	{ path: "/history", children: versionsRoutes },
	{
		path: "/settings",
		component: lazy(() => import("./settings")),
	},
	{
		// This 404 prevents the navbar breaking
		path: "/*all",
		component: lazy(() => import("../../[...404]")),
	},
] satisfies RouteDefinition[];
