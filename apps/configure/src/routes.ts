import type { RouteDefinition } from "@solidjs/router";
import { lazy } from "solid-js";

export const routes = [
	{
		path: "/",
		component: lazy(() => import("./routes/index")),
	},
	{
		component: lazy(() => import("./routes/(dash)")),
		children: [
			{
				path: "/overview",
				component: lazy(() => import("./routes/(dash)/overview")),
			},
		],
	},
	{
		component: lazy(() => import("./routes/[...404]")),
	},
] satisfies RouteDefinition[];
