import type { RouteDefinition } from "@solidjs/router";
import { lazy } from "solid-js";

export const routes = [
	{
		path: "/",
		component: lazy(() => import("./routes/index")),
	},
	{
		path: "/home",
		component: lazy(() => import("./routes/home")),
	},
	{
		path: "/:userId",
		component: lazy(() => import("./routes/(dash)")),
		children: [
			{
				path: "/",
				component: lazy(() => import("./routes/(dash)/(overview)")),
			},
			{
				path: "/users",
				component: lazy(() => import("./routes/(dash)/users/(users)")),
			},
			{
				path: "/users/:userId",
				component: lazy(() => import("./routes/(dash)/users/[userId]")),
			},
			{
				path: "/devices",
				component: lazy(() => import("./routes/(dash)/devices/(devices)")),
			},
			{
				path: "/devices/:userId",
				component: lazy(() => import("./routes/(dash)/devices/[deviceId]")),
			},
			{
				path: "/groups",
				component: lazy(() => import("./routes/(dash)/groups/(groups)")),
			},
			{
				path: "/groups/:groupId",
				component: lazy(() => import("./routes/(dash)/groups/[groupId]")),
			},
			{
				path: "/policies",
				component: lazy(() => import("./routes/(dash)/policies/(policies)")),
			},
			{
				path: "/policies/:policyId",
				component: lazy(() => import("./routes/(dash)/policies/[policyId]")),
			},
			{
				path: "/applications",
				component: lazy(
					() => import("./routes/(dash)/applications/(applications)"),
				),
			},
			{
				path: "/applications/:applicationId",
				component: lazy(
					() => import("./routes/(dash)/applications/[applicationId]"),
				),
			},
			{
				path: "/views",
				component: lazy(() => import("./routes/(dash)/views/(views)")),
			},
			{
				path: "/views/:viewId",
				component: lazy(() => import("./routes/(dash)/views/[viewId]")),
			},
			{
				path: "/search",
				component: lazy(() => import("./routes/(dash)/search")),
			},
			{
				path: "/settings",
				component: lazy(() => import("./routes/(dash)/settings")),
			},
			{
				path: "/*",
				component: lazy(() => import("./routes/[...404]")),
			},
		],
	},
] satisfies RouteDefinition[];
