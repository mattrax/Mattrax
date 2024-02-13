import { RouteDefinition } from "@solidjs/router";
import { lazy } from "solid-js";

import indexRoute from "./index";
import tenantRoutes from "./[tenant]/routes";

export default [
  {
    path: "/",
    component: indexRoute,
  },
  {
    path: "/:tenant",
    component: lazy(() => import("./[tenant]")),
    children: tenantRoutes,
  },
  {
    path: "/*all",
    component: lazy(() => import("./[...404]")),
  },
] satisfies RouteDefinition[];
