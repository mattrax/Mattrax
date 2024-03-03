import { RouteDefinition } from "@solidjs/router";
import { lazy } from "solid-js";

import tenantRoutes from "./[tenantSlug]/routes";
import indexRoute from "./index";

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
