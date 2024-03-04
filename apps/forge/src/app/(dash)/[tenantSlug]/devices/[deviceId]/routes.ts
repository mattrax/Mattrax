import { RouteDefinition } from "@solidjs/router";
import { lazy } from "solid-js";

export default [
	{
		path: "/",
		component: lazy(() => import(".")),
	},
	{
		path: "/scoped",
		component: lazy(() => import("./scoped")),
	},
	{
		path: "/applications",
		component: lazy(() => import("./applications")),
	},
	{
		path: "/settings",
		component: lazy(() => import("./settings")),
	},
] as RouteDefinition[];
