import { RouteDefinition } from "@solidjs/router";
import { lazy } from "solid-js";

export default [
	{
		path: "/",
		component: lazy(() => import("./index")),
	},
	{
		// This 404 prevents the navbar breaking
		path: "/*all",
		component: lazy(() => import("../../[...404]")),
	},
] satisfies RouteDefinition[];
