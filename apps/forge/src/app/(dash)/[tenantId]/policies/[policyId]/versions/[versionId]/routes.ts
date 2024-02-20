import { RouteDefinition } from "@solidjs/router";
import { lazy } from "solid-js";

export default [
  {
    path: "/",
    component: lazy(() => import("./index")),
  },
  {
    path: "/builder",
    component: lazy(() => import("./builder")),
  },
  {
    path: "/versions",
    component: lazy(() => import("./versions")),
  },

  {
    path: "/debug",
    component: lazy(() => import("./debug")),
  },
] as RouteDefinition[];
