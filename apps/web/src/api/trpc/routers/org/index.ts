import { count, eq } from "drizzle-orm";

import {
	db,
	organisationInvites,
	organisationMembers,
	organisations,
	tenants,
} from "~/db";
import { createTRPCRouter, orgProcedure } from "../../helpers";
import { billingRouter } from "./billing";
import { adminsRouter } from "./admins";

export const orgRouter = createTRPCRouter({
	billing: billingRouter,
	admins: adminsRouter,

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
});
