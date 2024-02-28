import { RouteDefinition } from "@solidjs/router";
import { lazy } from "solid-js";
import { trpc } from "~/lib";

export default [
  {
    path: "/",
    component: lazy(() => import("./index")),
    load: ({ params }) => {
      trpc.useContext().tenant.enrollmentInfo.ensureData({
        tenantId: params.tenantId!,
      });
    },
  },
  {
    path: "/administrators",
    component: lazy(() => import("./administrators")),
    load: ({ params }) => {
      trpc.useContext().tenant.admins.list.ensureData({
        tenantId: params.tenantId!,
      });
    },
  },
  {
    path: "/billing",
    component: lazy(() => import("./billing")),
  },
  {
    path: "/identity-provider",
    component: lazy(() => import("./identity-provider")),
    load: ({ params }) => {
      trpc.useContext().tenant.identityProvider.get.ensureData({
        tenantId: params.tenantId!,
      });
    },
  },
] satisfies RouteDefinition[];
