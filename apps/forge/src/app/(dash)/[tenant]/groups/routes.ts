import { RouteDefinition } from "@solidjs/router";
import { lazy } from "solid-js";
import { trpc } from "~/lib";

export default [
  {
    path: "/",
    component: lazy(() => import("./index")),
    load: () => {
      trpc.useContext().group.list.ensureData();
    },
  },
  {
    path: "/:groupId",
    component: lazy(() => import("./[groupId]")),
    load: ({ params }) =>
      trpc.useContext().group.get.ensureData({ id: parseInt(params.groupId!) }),
  },
] satisfies RouteDefinition[];
