import { RouteDefinition } from "@solidjs/router";
import { lazy } from "solid-js";
import { trpc } from "~/lib";

export default [
  {
    path: "/",
    component: lazy(() => import("./index")),
    load: ({ params }) => {
      trpc
        .useContext()
        .tenant.auth.query.ensureData({ tenantId: parseInt(params.tenantId!) });
      trpc.useContext().tenant.enrollmentInfo.ensureData({
        tenantId: parseInt(params.tenantId!),
      });
    },
  },
  {
    path: "/administrators",
    component: lazy(() => import("./administrators")),
    load: ({ params }) => {
      trpc.useContext().tenant.administrators.list.ensureData({
        tenantId: parseInt(params.tenantId!),
      });
    },
  },
  {
    path: "/domains",
    component: lazy(() => import("./domains")),
    load: ({ params }) => {
      trpc.useContext().tenant.domains.list.ensureData({
        tenantId: parseInt(params.tenantId!),
      });
    },
  },
  {
    path: "/billing",
    component: lazy(() => import("./billing")),
  },
] satisfies RouteDefinition[];
