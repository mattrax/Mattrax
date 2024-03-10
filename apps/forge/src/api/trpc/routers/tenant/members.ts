import { z } from "zod";
import { createTRPCRouter, tenantProcedure } from "../../helpers";
import { PolicyAssignableVariants, getDb, devices, groups, users } from "~/db";
import { eq } from "drizzle-orm";

export const membersRouter = createTRPCRouter({
	users: tenantProcedure
		// TODO: Pagination
		.query(async ({ ctx, input }) => {
			return (
				await getDb()
					.select({
						name: users.name,
						id: users.id,
						pk: users.pk,
					})
					.from(users)
					.where(eq(users.tenantPk, ctx.tenant.pk))
			).map((data) => ({
				...data,
				variant: PolicyAssignableVariants.user,
			}));
		}),

	devices: tenantProcedure
		// TODO: Pagination
		.query(async ({ ctx, input }) => {
			return (
				await getDb()
					.select({
						name: devices.name,
						id: devices.id,
						pk: devices.pk,
					})
					.from(devices)
					.where(eq(devices.tenantPk, ctx.tenant.pk))
			).map((data) => ({
				...data,
				variant: PolicyAssignableVariants.device,
			}));
		}),

	groups: tenantProcedure
		// TODO: Pagination
		.query(async ({ ctx, input }) => {
			return (
				await getDb()
					.select({
						name: groups.name,
						id: groups.id,
						pk: groups.pk,
					})
					.from(groups)
					.where(eq(groups.tenantPk, ctx.tenant.pk))
			).map((data) => ({
				...data,
				variant: PolicyAssignableVariants.group,
			}));
		}),
});
