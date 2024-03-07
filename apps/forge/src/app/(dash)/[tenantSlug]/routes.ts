import { RouteDefinition } from "@solidjs/router";
import { lazy } from "solid-js";

import { trpc } from "~/lib";
import deviceRoutes from "./devices/routes";
import groupsRoutes from "./groups/routes";
import policiesRoutes from "./policies/routes";
import settingsRoutes from "./settings/routes";
import usersRoutes from "./users/routes";
import appsRoutes from "./applications/routes";

export default [
	{
		path: "/",
		component: lazy(() => import("./index")),
		load: ({ params }) => {
			trpc
				.useContext()
				.tenant.stats.ensureData({ tenantSlug: params.tenantSlug! });
		},
	},
	{
		path: "/users",
		children: usersRoutes,
	},
	{
		path: "/apps",
		children: appsRoutes,
	},
	{
		path: "/devices",
		children: deviceRoutes,
	},
	{
		path: "/policies",
		children: policiesRoutes,
	},
	{
		path: "/groups",
		children: groupsRoutes,
	},
	{
		path: "/settings",
		component: lazy(() => import("./settings")),
		children: settingsRoutes,
	},
	{
		path: "/*all",
		component: lazy(() => import("./[...404]")),
	},
] satisfies RouteDefinition[];
