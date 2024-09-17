import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { createTRPCContext, createTRPCRouter } from "./helpers";
import { authRouter } from "./routers/auth";
// import { deviceRouter } from "./routers/device";
import { metaRouter } from "./routers/meta";
// import { orgRouter } from "./routers/org";
import { tenantRouter } from "./routers/tenant/index";
// import { blueprintRouter } from "./routers/blueprint";

export const appRouter = createTRPCRouter({
	auth: authRouter,
	tenant: tenantRouter,
	// blueprint: blueprintRouter,
	// device: deviceRouter,
	meta: metaRouter,
});

export const createContext = createTRPCContext;

export const router = appRouter;

export type AppRouter = typeof appRouter;

export type RouterInput = inferRouterInputs<AppRouter>;
export type RouterOutput = inferRouterOutputs<AppRouter>;

export * from "./helpers";
