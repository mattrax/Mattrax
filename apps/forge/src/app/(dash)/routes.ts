import { RouteDefinition } from "@solidjs/router";
import { lazy } from "solid-js";

import indexRoute from "./index";
import tenantRoutes from "./[tenantSlug]/routes";

export default [
  {
    path: "/",
    component: indexRoute,
  },
  {
    path: "/:tenantSlug",
    component: lazy(() => import("./[tenantSlug]")),
    children: tenantRoutes,
  },
  {
    path: "/*all",
    component: lazy(() => import("./[...404]")),
  },
] satisfies RouteDefinition[];
