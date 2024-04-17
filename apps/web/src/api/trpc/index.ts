import { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { createTRPCContext, createTRPCRouter } from "./helpers";
import { applicationRouter } from "./routers/app";
import { authRouter } from "./routers/auth";
import { deviceRouter } from "./routers/device";
import { groupRouter } from "./routers/group";
import { internalRouter } from "./routers/internal";
import { metaRouter } from "./routers/meta";
import { policyRouter } from "./routers/policy";
import { tenantRouter } from "./routers/tenant/index";
import { userRouter } from "./routers/user";
import { apiKeyRouter } from "./routers/apiKey";
import { orgRouter } from "./routers/org";

export const appRouter = createTRPCRouter({
	app: applicationRouter,
	auth: authRouter,
	device: deviceRouter,
	group: groupRouter,
	internal: internalRouter,
	policy: policyRouter,
	tenant: tenantRouter,
	user: userRouter,
	meta: metaRouter,
	apiKey: apiKeyRouter,
	org: orgRouter,
});

export const createContext = createTRPCContext;

export const router = appRouter;

export type AppRouter = typeof appRouter;

export type RouterInput = inferRouterInputs<AppRouter>;
export type RouterOutput = inferRouterOutputs<AppRouter>;

export * from "./helpers";
