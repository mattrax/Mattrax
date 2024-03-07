import { RouteDefinition } from "@solidjs/router";
import { lazy } from "solid-js";

import { trpc } from "~/lib";
import userRoutes from "./[userId]/routes";

export default [
	{
		path: "/",
		component: lazy(() => import("./index")),
		load: ({ params }) => {
			trpc.useContext().user.list.ensureData({
				tenantSlug: params.tenantSlug!,
			});
		},
	},
	{
		path: "/:userId",
		component: lazy(() => import("./[userId]")),
		load: ({ params }) =>
			trpc.useContext().user.get.ensureData({
				id: params.userId!,
			}),
		children: userRoutes,
	},
] as RouteDefinition[];
