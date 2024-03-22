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
			const { value } = await createAPIKey(input.name, ctx.account.pk);
			return value;
		}),
});

export async function createAPIKey(name: string, accountPk: number) {
	const value = `mttx_${createId()}`;

	const record = await db.insert(apiKeys).values({
		id: createId(),
		value,
		name,
		accountPk,
	});

	return {
		pk: Number(record.insertId),
		value,
	};
}
