import { eq } from "drizzle-orm";

import { db, organisations, tenants } from "~/db";
import { createTRPCRouter, orgProcedure } from "../../helpers";
import { billingRouter } from "./billing";

export const orgRouter = createTRPCRouter({
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
});
