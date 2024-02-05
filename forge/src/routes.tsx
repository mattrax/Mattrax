import { RouteDefinition } from "@solidjs/router";
import { lazy } from "solid-js";

// TODO: Split defs across files like Brendan's app router idea in Spacedrive

import dashboardLayout from "./routes/(dash)";
import dashIndex from "./routes/(dash)/index";

const dash: RouteDefinition[] = [
  {
    path: "/",
    component: dashIndex,
  },
  {
    path: "/:tenant",
    children: [
      {
        path: "/",
        component: lazy(() => import("./routes/(dash)/[tenant]/index")),
      },
      {
        path: "/users",
        component: lazy(() => import("./routes/(dash)/[tenant]/users")),
      },
      {
        path: "/users/:userId",
        component: lazy(
          () => import("./routes/(dash)/[tenant]/users/[userId]")
        ),
      },
      {
        path: "/apps",
        component: lazy(() => import("./routes/(dash)/[tenant]/apps")),
      },
      {
        path: "/apps/:appId",
        component: lazy(() => import("./routes/(dash)/[tenant]/apps/[appId]")),
      },
      {
        path: "/devices",
        component: lazy(() => import("./routes/(dash)/[tenant]/devices")),
      },
      {
        path: "/devices/:deviceId",
        component: lazy(
          () => import("./routes/(dash)/[tenant]/devices/[deviceId]")
        ),
      },
      {
        path: "/policies",
        component: lazy(() => import("./routes/(dash)/[tenant]/policies")),
      },
      {
        path: "/policies/:policyId",
        component: lazy(
          () => import("./routes/(dash)/[tenant]/policies/[policyId]")
        ),
      },
      {
        path: "/scripts",
        component: lazy(() => import("./routes/(dash)/[tenant]/scripts")),
      },
      {
        path: "/scripts/:scriptId",
        component: lazy(
          () => import("./routes/(dash)/[tenant]/scripts/[scriptId]")
        ),
      },
      {
        path: "/groups",
        component: lazy(() => import("./routes/(dash)/[tenant]/groups")),
      },
      {
        path: "/groups/:groupId",
        component: lazy(
          () => import("./routes/(dash)/[tenant]/groups/[groupId]")
        ),
      },
      {
        path: "/settings",
        component: lazy(() => import("./routes/(dash)/[tenant]/settings")),
      },
      {
        path: "/*all",
        component: lazy(() => import("./routes/(dash)/[tenant]/[...404]")),
      },
    ],
  },
  {
    path: "/*all",
    component: lazy(() => import("./routes/(dash)/[...404]")),
  },
];

export const routes: RouteDefinition[] = [
  // TODO: Don't lazy load modal layout but lazy load inside content. So the user never ends up with a white page.
  {
    path: "/login",
    component: lazy(() => import("./routes/(auth)/login")),
  },
  {
    // TODO: Prerender this page. End-users will touch it so it needs to be rock solid.
    path: "/enroll",
    component: lazy(() => import("./routes/enroll")),
  },
  {
    path: "/internal",
    component: lazy(() => import("./routes/internal")),
  },
  {
    component: dashboardLayout,
    children: dash,
  },
];