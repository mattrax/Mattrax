import { RouteDefinition } from "@solidjs/router";
import { lazy } from "solid-js";

import deviceRoutes from "./devices/[deviceId]/routes";
import settingsRoutes from "./settings/routes";
import policyRoutes from "./policies/[policyId]/routes";
import groupsRoutes from "./groups/routes";
import { trpc } from "~/lib";

export default [
  {
    path: "/",
    component: lazy(() => import("./index")),
    load: ({ params }) => {
      trpc.useContext().tenant.stats.ensureData({
        tenantId: params.tenantId!,
      });
    },
  },
  {
    path: "/users",
    children: [
      {
        path: "/",
        component: lazy(() => import("./users")),
        load: ({ params }) => {
          trpc.useContext().user.list.ensureData({
            tenantId: params.tenantId!,
          });
        },
      },
      {
        path: "/:userId",
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
        load: ({ params }) => {
          trpc.useContext().device.list.ensureData({
            tenantId: params.tenantId!,
          });
        },
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
        load: ({ params }) => {
          trpc.useContext().policy.list.ensureData({
            tenantId: params.tenantId!,
          });
        },
      },
      {
        path: "/:policyId",
        load: ({ params }) =>
          trpc.useContext().policy.get.ensureData({
            policyId: parseInt(params.policyId!),
            tenantId: params.tenantId!,
          }),
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
