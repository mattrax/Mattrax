import { RouteDefinition } from "@solidjs/router";
import { lazy } from "solid-js";

import { trpc } from "~/lib";
import deviceRoutes from "./[deviceId]/routes";

export default [
	{
		path: "/",
		component: lazy(() => import("./index")),
		load: ({ params }) => {
			trpc.useContext().device.list.ensureData({
				tenantSlug: params.tenantSlug!,
			});
		},
	},
	{
		path: "/:deviceId",
		component: lazy(() => import("./[deviceId]")),
		load: ({ params }) =>
			trpc.useContext().device.get.ensureData({
				deviceId: params.deviceId!,
			}),
		children: deviceRoutes,
	},
] as RouteDefinition[];
