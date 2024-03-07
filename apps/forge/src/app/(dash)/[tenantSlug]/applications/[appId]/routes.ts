import { RouteDefinition } from "@solidjs/router";
import { lazy } from "solid-js";

export default [
	{
		path: "/",
		component: lazy(() => import("./index")),
	},
] satisfies RouteDefinition[];
