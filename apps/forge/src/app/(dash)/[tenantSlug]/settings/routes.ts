import { RouteDefinition } from "@solidjs/router";
import { lazy } from "solid-js";
import { trpc } from "~/lib";

export default [
  {
    path: "/",
    component: lazy(() => import("./index")),
    load: ({ params }) => {
      trpc.useContext().tenant.enrollmentInfo.ensureData({
        tenantSlug: params.tenantSlug!,
      });
    },
  },
  {
    path: "/administrators",
    component: lazy(() => import("./administrators")),
    load: ({ params }) => {
      trpc.useContext().tenant.admins.list.ensureData({
        tenantSlug: params.tenantSlug!,
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
        tenantSlug: params.tenantSlug!,
      });
    },
  },
] satisfies RouteDefinition[];
