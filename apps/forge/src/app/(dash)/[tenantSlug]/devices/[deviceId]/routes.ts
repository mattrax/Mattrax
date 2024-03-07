import { RouteDefinition } from "@solidjs/router";
import { lazy } from "solid-js";

export default [
	{
		path: "/",
		component: lazy(() => import("./index")),
	},
	{
		path: "/scope",
		component: lazy(() => import("./scope")),
	},
	{
		path: "/inventory",
		component: lazy(() => import("./inventory")),
	},
	{
		path: "/settings",
		component: lazy(() => import("./settings")),
	},
] as RouteDefinition[];
