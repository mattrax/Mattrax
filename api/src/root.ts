import { applicationRouter } from "./routers/app";
import { authRouter } from "./routers/auth";
import { deviceRouter } from "./routers/device";
import { groupRouter } from "./routers/group";
import { internalRouter } from "./routers/internal";
import { policyRouter } from "./routers/policy";
import { scriptRouter } from "./routers/script";
import { tenantRouter } from "./routers/tenant";
import { userRouter } from "./routers/user";
import { createTRPCRouter } from "./trpc";

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
});

export type AppRouter = typeof appRouter;
