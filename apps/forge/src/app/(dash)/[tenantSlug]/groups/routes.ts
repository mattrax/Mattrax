import { RouteDefinition } from "@solidjs/router";
import { lazy } from "solid-js";
import { trpc } from "~/lib";

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
        tenantSlug: params.tenantSlug!,
      }),
  },
] satisfies RouteDefinition[];