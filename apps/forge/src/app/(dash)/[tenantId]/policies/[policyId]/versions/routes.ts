import { RouteDefinition } from "@solidjs/router";
import { lazy } from "solid-js";

import versionRoutes from "./[versionId]/routes";

export default [
  {
    path: "/:versionId",
    component: lazy(() => import("./[versionId]")),
    children: versionRoutes,
  },
] satisfies RouteDefinition[];
