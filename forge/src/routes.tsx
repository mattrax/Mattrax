import { RouteDefinition } from "@solidjs/router";
import { lazy } from "solid-js";

// TODO: Split defs across files like Brendan's app router idea in Spacedrive

const dash: RouteDefinition[] = [
  {
    path: "/",
    component: lazy(() => import("./routes/(dash)/index")),
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
  {
    path: "/login",
    component: lazy(() => import("./routes/(auth)/login")),
  },
  {
    path: "/enroll",
    component: lazy(() => import("./routes/enroll")),
  },
  {
    path: "/internal",
    component: lazy(() => import("./routes/internal")),
  },
  {
    path: "/internal",
    component: lazy(() => import("./routes/internal")),
  },
  {
    path: "/playground",
    component: lazy(() => import("./routes/playground")),
  },
  {
    path: "/testing",
    component: lazy(() => import("./routes/testing")),
  },
  {
    component: lazy(() => import("./routes/(dash)")),
    children: dash,
  },
];
