import { RouteDefinition } from "@solidjs/router";
import { lazy } from "solid-js";

import { trpc } from "~/lib";
import userRoutes from "./[appId]/routes";

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
		component: lazy(() => import("./[appId]")),
		load: ({ params }) =>
			trpc.useContext().app.get.ensureData({
				id: params.appId!,
				tenantSlug: params.tenantSlug!,
			}),
		children: userRoutes,
	},
] as RouteDefinition[];
