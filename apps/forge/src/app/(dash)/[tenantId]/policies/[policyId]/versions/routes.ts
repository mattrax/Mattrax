import { RouteDefinition } from "@solidjs/router";
import { lazy } from "solid-js";

export default [
  {
    path: "/:versionId",
    component: lazy(() => import("./[versionId]")),
    children: [
      {
        path: "/",
        component: lazy(() => import("./[versionId]/index")),
      },
      {
        path: "/builder",
        component: lazy(() => import("./[versionId]/builder")),
      },
      {
        path: "/versions",
        component: lazy(() => import("./[versionId]/versions")),
      },

      {
        path: "/debug",
        component: lazy(() => import("./[versionId]/debug")),
      },
    ],
  },
] satisfies RouteDefinition[];
