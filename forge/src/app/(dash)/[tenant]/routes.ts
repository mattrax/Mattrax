import { RouteDefinition } from "@solidjs/router";
import { lazy } from "solid-js";

import deviceRoutes from "./devices/[deviceId]/routes";
import settingsRoutes from "./settings/routes";
import policyRoutes from "./policies/[policyId]/routes";
import groupsRoutes from "./groups/routes";

export default [
  {
    path: "/",
    component: lazy(() => import("./index")),
  },
  {
    path: "/users",
    children: [
      {
        path: "/",
        component: lazy(() => import("./users")),
      },
      {
        path: "/userId",
        component: lazy(() => import("./users/[userId]")),
      },
    ],
  },
  {
    path: "/apps",
    children: [
      {
        path: "/",
        component: lazy(() => import("./applications")),
      },
      {
        path: "/:appId",
        component: lazy(() => import("./applications/[appId]")),
      },
    ],
  },
  {
    path: "/devices",
    children: [
      {
        path: "/",
        component: lazy(() => import("./devices")),
      },
      {
        path: "/:deviceId",
        component: lazy(() => import("./devices/[deviceId]")),
        children: deviceRoutes,
      },
    ],
  },
  {
    path: "/policies",
    children: [
      {
        path: "/",
        component: lazy(() => import("./policies")),
      },
      {
        path: "/:policyId",
        component: lazy(() => import("./policies/[policyId]")),
        children: policyRoutes,
      },
    ],
  },
  {
    path: "/groups",
    children: groupsRoutes,
  },
  {
    path: "/settings",
    component: lazy(() => import("./settings")),
    children: settingsRoutes,
  },
  {
    path: "/*all",
    component: lazy(() => import("./[...404]")),
  },
] satisfies RouteDefinition[];
