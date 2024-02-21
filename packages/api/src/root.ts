import { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { applicationRouter } from "./routers/app";
import { authRouter } from "./routers/auth";
import { deviceRouter } from "./routers/device";
import { groupRouter } from "./routers/group";
import { internalRouter } from "./routers/internal";
import { policyRouter } from "./routers/policy";
import { scriptRouter } from "./routers/script";
import { tenantRouter } from "./routers/tenant/index";
import { userRouter } from "./routers/user";
import { createTRPCRouter } from "./trpc";
import { metaRouter } from "./routers/meta";

export const appRouter = createTRPCRouter({
  app: applicationRouter,
  auth: authRouter,
  device: deviceRouter,
  group: groupRouter,
  internal: internalRouter,
  policy: policyRouter,
  script: scriptRouter,
  tenant: tenantRouter,
  user: userRouter,
  meta: metaRouter,
});

export type AppRouter = typeof appRouter;

export type RouterInput = inferRouterInputs<AppRouter>;
export type RouterOutput = inferRouterOutputs<AppRouter>;
