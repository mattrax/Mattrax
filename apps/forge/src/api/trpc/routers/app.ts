import { z } from "zod";
import { authedProcedure, createTRPCRouter } from "../helpers";

export const applicationRouter = createTRPCRouter({
	get: authedProcedure.input(z.object({ id: z.string() })).query(() => {
		// TODO: Hook up with the db()
		return {
			name: "My awesome app",
		};
	}),
});
