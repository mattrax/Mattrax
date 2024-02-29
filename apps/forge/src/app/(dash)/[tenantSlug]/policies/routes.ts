import { RouteDefinition } from "@solidjs/router";
import { lazy } from "solid-js";

import policyRoutes from "./[policyId]/routes";
import { trpc } from "~/lib";

export default [
  {
    path: "/",
    component: lazy(() => import("./index")),
    load: ({ params }) => {
      trpc.useContext().policy.list.ensureData({
        tenantSlug: params.tenantSlug!,
      });
    },
  },
  {
    path: "/:policyId",
    component: lazy(() => import("./[policyId]")),
    load: ({ params }) =>
      trpc.useContext().policy.get.ensureData({
        policyId: params.policyId!,
        tenantSlug: params.tenantSlug!,
      }),
    children: policyRoutes,
  },
] as RouteDefinition[];
