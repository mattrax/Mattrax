import { z } from "zod";
import { createTRPCRouter, tenantProcedure } from "../helpers";

export const applicationRouter = createTRPCRouter({
	get: tenantProcedure.input(z.object({ id: z.string() })).query(() => {
		// TODO: Hook up with the DB
		return {
			name: "My awesome app",
		};
	}),
});
