import { count, eq } from "drizzle-orm";
import { z } from "zod";

import { randomSlug } from "~/api/utils";
import {
	accounts,
	organisationInvites,
	organisationMembers,
	organisations,
	tenants,
} from "~/db";
import { authedProcedure, createTRPCRouter, orgProcedure } from "../../helpers";

import { adminsRouter } from "./admins";
// import { billingRouter } from "./billing";

export const orgRouter = createTRPCRouter({
	admins: adminsRouter,
	// billing: billingRouter,

	list: authedProcedure.query(async ({ ctx }) => {
		return await ctx.db
			.select({
				id: organisations.id,
				name: organisations.name,
				slug: organisations.slug,
				ownerId: accounts.id,
			})
			.from(organisations)
			.where(eq(organisationMembers.accountPk, ctx.account.pk))
			.innerJoin(
				organisationMembers,
				eq(organisations.pk, organisationMembers.orgPk),
			)
			.innerJoin(accounts, eq(organisations.ownerPk, accounts.pk))
			.orderBy(organisations.id);
	}),

	tenants: orgProcedure.query(async ({ ctx }) => {
		return ctx.db
			.select({
				id: tenants.id,
				name: tenants.name,
				slug: tenants.slug,
				orgId: organisations.id,
			})
			.from(tenants)
			.where(eq(organisations.pk, ctx.org.pk))
			.innerJoin(organisations, eq(organisations.pk, tenants.orgPk))
			.orderBy(tenants.id);
	}),

	delete: orgProcedure.query(async ({ ctx }) => {
		const [[a], [b]] = await Promise.all([
			ctx.db
				.select({ count: count() })
				.from(tenants)
				.where(eq(tenants.orgPk, ctx.org.pk)),
			ctx.db
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

		await ctx.db.transaction(async (db) => {
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
			const slug = await ctx.db.transaction(async (db) => {
				const slug = randomSlug(input.name);

				const result = await db.insert(organisations).values({
					name: input.name,
					slug,
					ownerPk: ctx.account.pk,
				});

				const orgPk = Number.parseInt(result.insertId);
				await db.insert(organisationMembers).values({
					orgPk,
					accountPk: ctx.account.pk,
				});

				return slug;
			});

			return slug;
		}),
});
