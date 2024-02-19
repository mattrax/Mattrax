import { RouteDefinition } from "@solidjs/router";
import { lazy } from "solid-js";

import indexRoute from "./index";
import tenantRoutes from "./[tenantId]/routes";

export default [
  {
    path: "/",
    component: indexRoute,
  },
  {
    path: "/:tenantId",
    component: lazy(() => import("./[tenantId]")),
    children: tenantRoutes,
  },
  {
    path: "/*all",
    component: lazy(() => import("./[...404]")),
  },
] satisfies RouteDefinition[];
