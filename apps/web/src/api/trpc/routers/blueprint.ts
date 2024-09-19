import { z } from "zod";
import { eq, asc, and, gt } from "drizzle-orm";
import { createTRPCRouter, tenantProcedure } from "../helpers";
import { blueprints, db } from "~/db";
import { createId } from "@paralleldrive/cuid2";

// await ctx.db.insert(blueprints).values(
// 	Array.from({ length: 1000 }).map((_, i) => ({
// 		// pk: i,
// 		id: createId(),
// 		name: `Blueprint ${i}`,
// 		tenantPk: ctx.tenant.pk,
// 	})),
// );

export const blueprintRouter = createTRPCRouter({
	list: tenantProcedure.query(async function* ({ ctx }) {
		let cursor: string | undefined = undefined;
		do {
			const data = await db
				.select({
					id: blueprints.id,
					name: blueprints.name,
					description: blueprints.description,
				})
				.from(blueprints)
				.where(
					and(
						eq(blueprints.tenantPk, ctx.tenant.pk),
						cursor !== undefined ? gt(blueprints.id, cursor) : undefined,
					),
				)
				.limit(100)
				.orderBy(asc(blueprints.id));

			cursor = data.length !== 0 ? data[data.length - 1]!.id : undefined;
			yield data;
		} while (cursor !== undefined);
	}),

	list2: tenantProcedure.query(async ({ ctx }) => {
		return await db
			.select({
				id: blueprints.id,
				name: blueprints.name,
				description: blueprints.description,
			})
			.from(blueprints)
			.where(eq(blueprints.tenantPk, ctx.tenant.pk))
			.orderBy(asc(blueprints.id));
	}),

	// TODO: create
	// TODO: update
	// TODO: delete

	// TODO: Add/remove devices
});
