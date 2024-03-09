import { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { createTRPCRouter } from "./helpers";
import { applicationRouter } from "./routers/app";
import { authRouter } from "./routers/auth";
import { deviceRouter } from "./routers/device";
import { groupRouter } from "./routers/group";
import { internalRouter } from "./routers/internal";
import { metaRouter } from "./routers/meta";
import { policyRouter } from "./routers/policy";
import { tenantRouter } from "./routers/tenant/index";
import { userRouter } from "./routers/user";

export const router = createTRPCRouter({
	app: applicationRouter,
	auth: authRouter,
	device: deviceRouter,
	group: groupRouter,
	internal: internalRouter,
	policy: policyRouter,
	tenant: tenantRouter,
	user: userRouter,
	meta: metaRouter,
});

export type Router = typeof router;

export type RouterInput = inferRouterInputs<Router>;
export type RouterOutput = inferRouterOutputs<Router>;

export * from "./helpers";
