import { RouteDefinition } from "@solidjs/router";
import { lazy } from "solid-js";
import { trpc } from "~/lib";

export default [
  {
    path: "/",
    component: lazy(() => import("./index")),
    load: () => {
      trpc.useContext().tenant.auth.query.ensureData();
      trpc.useContext().tenant.enrollmentInfo.ensureData();
    },
  },
  {
    path: "/administrators",
    component: lazy(() => import("./administrators")),
    load: () => {
      trpc.useContext().tenant.administrators.list.ensureData();
    },
  },
  {
    path: "/domains",
    component: lazy(() => import("./domains")),
    load: () => {
      trpc.useContext().tenant.domains.list.ensureData();
    },
  },
  {
    path: "/billing",
    component: lazy(() => import("./billing")),
  },
] satisfies RouteDefinition[];
