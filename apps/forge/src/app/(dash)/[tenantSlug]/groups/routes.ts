import { RouteDefinition } from "@solidjs/router";
import { lazy } from "solid-js";
import { trpc } from "~/lib";

import groupRoutes from "./[groupId]/routes";

export default [
	{
		path: "/",
		component: lazy(() => import("./index")),
		load: ({ params }) => {
			trpc.useContext().group.list.ensureData({
				tenantSlug: params.tenantSlug!,
			});
		},
	},
	{
		path: "/:groupId",
		component: lazy(() => import("./[groupId]")),
		load: ({ params }) =>
			trpc.useContext().group.get.ensureData({
				id: params.groupId!,
			}),
		children: groupRoutes,
	},
] satisfies RouteDefinition[];
