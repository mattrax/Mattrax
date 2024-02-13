import { RouteDefinition } from "@solidjs/router";
import { lazy } from "solid-js";

export default [
  {
    path: "/",
    component: lazy(() => import(".")),
  },
  {
    path: "/restrictions",
    component: lazy(() => import("./restrictions")),
  },
  {
    path: "/scripts",
    component: lazy(() => import("./scripts")),
  },
  {
    path: "/debug",
    component: lazy(() => import("./debug")),
  },
  {
    path: "/slack",
    component: lazy(() => import("./slack")),
  },
  {
    path: "/chrome",
    component: lazy(() => import("./chrome")),
  },
  {
    path: "/office",
    component: lazy(() => import("./office")),
  },
] satisfies RouteDefinition[];
