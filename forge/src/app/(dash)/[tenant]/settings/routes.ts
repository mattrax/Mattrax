import { RouteDefinition } from "@solidjs/router";
import { lazy } from "solid-js";

export default [
  {
    path: "/",
    component: lazy(() => import("./index")),
  },
  {
    path: "/administrators",
    component: lazy(() => import("./administrators")),
  },
  {
    path: "/domains",
    component: lazy(() => import("./domains")),
  },
  {
    path: "/billing",
    component: lazy(() => import("./billing")),
  },
] satisfies RouteDefinition[];
