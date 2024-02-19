import { RouteDefinition } from "@solidjs/router";
import { lazy } from "solid-js";

import dashboardLayout from "./(dash)";
import dashboardRoutes from "./(dash)/routes";
import { trpc } from "~/lib";

export default [
  {
    children: [
      {
        path: "/login",
        component: lazy(() => import("./(auth)/login")),
      },
      {
        path: "/invite/tenant/:code",
        component: lazy(() => import("./(auth)/invite/tenant/[code]")),
      },
    ],
  },
  {
    // TODO: Prerender this page. End-users will touch it so it needs to be rock solid.
    path: "/enroll",
    component: lazy(() => import("./enroll")),
  },
  {
    path: "/internal",
    component: lazy(() => import("./internal")),
  },
  {
    component: dashboardLayout,
    children: dashboardRoutes,
    load: () => {
      trpc.useContext().auth.me.ensureData();
    },
  },
] satisfies RouteDefinition[];
