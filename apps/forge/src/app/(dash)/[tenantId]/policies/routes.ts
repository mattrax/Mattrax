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
        tenantId: params.tenantId!,
      });
    },
  },
  {
    path: "/:policyId",
    load: ({ params }) =>
      trpc.useContext().policy.get.ensureData({
        policyId: params.policyId!,
        tenantId: params.tenantId!,
      }),
    children: policyRoutes,
  },
] as RouteDefinition[];
