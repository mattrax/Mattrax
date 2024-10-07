import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { createTRPCRouter } from "./helpers";
import { authRouter } from "./routers/auth";
import { blueprintRouter } from "./routers/blueprint";
import { deviceRouter } from "./routers/device";
import { metaRouter } from "./routers/meta";
import { tenantRouter } from "./routers/tenant/index";

export const router = createTRPCRouter({
	auth: authRouter,
	tenant: tenantRouter,
	blueprint: blueprintRouter,
	device: deviceRouter,
	meta: metaRouter,
});

export type AppRouter = typeof router;
export type RouterInput = inferRouterInputs<AppRouter>;
export type RouterOutput = inferRouterOutputs<AppRouter>;

export * from "./helpers";
