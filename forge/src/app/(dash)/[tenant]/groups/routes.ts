import { RouteDefinition } from "@solidjs/router";
import { lazy } from "solid-js";
import { trpc } from "~/lib";

export default [
  {
    path: "/",
    component: lazy(() => import("./index")),
    load: () => {
      const trpcCtx = trpc.useContext();
      trpcCtx.group.list.prefetch();
    },
  },
  {
    path: "/:groupId",
    component: lazy(() => import("./[groupId]")),
  },
] satisfies RouteDefinition[];
