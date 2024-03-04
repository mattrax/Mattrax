import { RouteDefinition } from "@solidjs/router";
import { lazy } from "solid-js";

import { trpc } from "~/lib";
import deviceRoutes from "./devices/[deviceId]/routes";
import groupsRoutes from "./groups/routes";
import policiesRoutes from "./policies/routes";
import settingsRoutes from "./settings/routes";

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
		children: [
			{
				path: "/",
				component: lazy(() => import("./users")),
				load: ({ params }) => {
					trpc
						.useContext()
						.user.list.ensureData({ tenantSlug: params.tenantSlug! });
				},
			},
			{
				path: "/:userId",
				component: lazy(() => import("./users/[userId]")),
			},
		],
	},
	{
		path: "/apps",
		children: [
			{
				path: "/",
				component: lazy(() => import("./applications")),
			},
			{
				path: "/:appId",
				component: lazy(() => import("./applications/[appId]")),
			},
		],
	},
	{
		path: "/devices",
		children: [
			{
				path: "/",
				component: lazy(() => import("./devices")),
				load: ({ params }) => {
					trpc.useContext().device.list.ensureData({
						tenantSlug: params.tenantSlug!,
					});
				},
			},
			{
				path: "/:deviceId",
				component: lazy(() => import("./devices/[deviceId]")),
				children: deviceRoutes,
			},
		],
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
