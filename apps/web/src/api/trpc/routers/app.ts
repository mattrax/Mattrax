import { z } from "zod";
import { authedProcedure, createTRPCRouter, tenantProcedure } from "../helpers";
import { applications, db } from "~/db";
import { eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";

export const applicationRouter = createTRPCRouter({
	list: tenantProcedure
		// .input(
		//   z.object({
		//     // TODO: Constrain offset and limit to specific max/min values
		//     offset: z.number().default(0),
		//     limit: z.number().default(50),
		//     // query: z.string().optional(),
		//   })
		// )
		.query(async ({ ctx }) => {
			// TODO: Full-text search???
			// TODO: Pagination abstraction
			// TODO: Can a cursor make this more efficent???
			// TODO: Switch to DB

			return await db
				.select({
					id: applications.id,
					name: applications.name,
				})
				.from(applications)
				.where(eq(applications.tenantPk, ctx.tenant.pk));
		}),
	get: authedProcedure
		.input(z.object({ id: z.string() }))
		.query(async ({ input, ctx }) => {
			const app = await db.query.applications.findFirst({
				where: eq(applications.id, input.id),
			});
			if (!app) return null;

			await ctx.ensureTenantAccount(app.tenantPk);

			return app;
		}),
	create: tenantProcedure
		.input(
			z.object({
				name: z.string(),
				targetType: z.enum(["iOS"]),
				targetId: z.string(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const id = createId();

			await db.insert(applications).values({
				id,
				name: input.name,
				tenantPk: ctx.tenant.pk,
			});

			return { id };
		}),
});
