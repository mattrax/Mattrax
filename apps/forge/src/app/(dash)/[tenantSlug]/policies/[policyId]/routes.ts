import { RouteDefinition } from "@solidjs/router";
import { lazy } from "solid-js";

import versionsRoutes from "./versions/routes";

export default [
  {
    path: "/",
    component: lazy(() => import("./index")),
  },
  {
    path: "/scope",
    component: lazy(() => import("./scope")),
  },
  { path: "/versions", children: versionsRoutes },
] satisfies RouteDefinition[];
