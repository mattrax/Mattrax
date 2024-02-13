import { RouteDefinition } from "@solidjs/router";
import { lazy } from "solid-js";
import { trpc } from "~/lib";

export default [
  {
    path: "/",
    component: lazy(() => import("./index")),
    load: () => {
      trpc.useContext().tenant.auth.query.prefetch();
      trpc.useContext().tenant.enrollmentInfo.prefetch();
    },
  },
  {
    path: "/administrators",
    component: lazy(() => import("./administrators")),
    load: () => {
      trpc.useContext().tenant.administrators.list.prefetch();
    },
  },
  {
    path: "/domains",
    component: lazy(() => import("./domains")),
    load: () => {
      trpc.useContext().tenant.domains.list.prefetch();
    },
  },
  {
    path: "/billing",
    component: lazy(() => import("./billing")),
  },
] satisfies RouteDefinition[];
