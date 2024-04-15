import { count, eq } from "drizzle-orm";
import { z } from "zod";

import {
	db,
	organisationInvites,
	organisationMembers,
	organisations,
	tenants,
} from "~/db";
import { authedProcedure, createTRPCRouter, orgProcedure } from "../../helpers";
import { randomSlug } from "~/api/utils";

import { adminsRouter } from "./admins";
import { billingRouter } from "./billing";

export const orgRouter = createTRPCRouter({
	admins: adminsRouter,
	billing: billingRouter,

	tenants: orgProcedure.query(async ({ ctx }) => {
		return db
			.select({
				id: tenants.id,
				name: tenants.name,
				slug: tenants.slug,
			})
			.from(tenants)
			.where(eq(organisations.pk, ctx.org.pk))
			.innerJoin(organisations, eq(organisations.pk, tenants.orgPk));
	}),

	delete: orgProcedure.query(async ({ ctx }) => {
		const [[a], [b]] = await Promise.all([
			db
				.select({ count: count() })
				.from(tenants)
				.where(eq(tenants.orgPk, ctx.org.pk)),
			db
				.select({ count: count() })
				.from(organisationMembers)
				.where(eq(organisations.pk, ctx.org.pk)),
		]);

		if (a!.count !== 0)
			throw new Error("Cannot delete organisation with tenants"); // TODO: handle this error on the frontend

		if (b!.count !== 1)
			throw new Error(
				"Cannot delete organisation with administrators other than yourself",
			); // TODO: handle this error on the frontend

		// TODO: Ensure no outstanding payments

		await db.transaction(async () => {
			await db.delete(organisations).where(eq(organisations.pk, ctx.org.pk));
			await db
				.delete(organisationMembers)
				.where(eq(organisations.pk, ctx.org.pk));
			await db
				.delete(organisationInvites)
				.where(eq(organisations.pk, ctx.org.pk));
		});
	}),

	create: authedProcedure
		.input(z.object({ name: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const slug = await db.transaction(async (db) => {
				const slug = randomSlug(input.name);

				const { insertId } = await db.insert(organisations).values({
					name: input.name,
					slug,
					ownerPk: ctx.account.pk,
				});

				await db.insert(organisationMembers).values({
					orgPk: parseInt(insertId),
					accountPk: ctx.account.pk,
				});

				return slug;
			});

			return slug;
		}),
});
