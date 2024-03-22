import { eq } from "drizzle-orm";

import { apiKeys, db } from "~/db";
import { authedProcedure, createTRPCRouter } from "../helpers";
import { createId } from "@paralleldrive/cuid2";
import { z } from "zod";

export const apiKeyRouter = createTRPCRouter({
	list: authedProcedure.query(async ({ ctx }) => {
		return db.query.apiKeys.findMany({
			where: eq(apiKeys.accountPk, ctx.account.pk),
			columns: {
				id: true,
				name: true,
			},
		});
	}),
	create: authedProcedure
		.input(z.object({ name: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const value = `mttx_${createId()}`;

			await db.insert(apiKeys).values({
				value,
				id: createId(),
				name: input.name,
				accountPk: ctx.account.pk,
			});

			return value;
		}),
});
