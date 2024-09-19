import { asc, count, eq } from "drizzle-orm";
import { z } from "zod";
import { blueprints, db, devices } from "~/db";
import { createTRPCRouter, tenantProcedure } from "../helpers";

export const blueprintRouter = createTRPCRouter({
	list: tenantProcedure.query(async ({ ctx }) => {
		return await db
			.select({
				id: blueprints.id,
				name: blueprints.name,
				description: blueprints.description,
				lastModified: blueprints.lastModified,
				devices: count(devices.pk),
			})
			.from(blueprints)
			.where(eq(blueprints.tenantPk, ctx.tenant.pk))
			.leftJoin(devices, eq(devices.blueprint, blueprints.pk))
			.groupBy(blueprints.id)
			.orderBy(asc(blueprints.name));
	}),

	// TODO: create
	// TODO: update
	// TODO: delete

	// TODO: Add/remove devices
});
