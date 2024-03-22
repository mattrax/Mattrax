import { createId } from "@paralleldrive/cuid2";
import { count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { union } from "drizzle-orm/mysql-core";

import {
	applications,
	db,
	devices,
	groups,
	policies,
	tenantAccounts,
	tenants,
	users,
} from "~/db";
import {
	authedProcedure,
	createTRPCRouter,
	tenantProcedure,
} from "../../helpers";
import { adminsRouter } from "./admins";
import { billingRouter } from "./billing";
import { identityProviderRouter } from "./identityProvider";
import { membersRouter } from "./members";

export type StatsTarget =
	| "devices"
	| "users"
	| "policies"
	| "applications"
	| "groups";

export const restrictedUsernames = new Set([
	// Misleading names
	"admin",
	"administrator",
	"help",
	"mod",
	"moderator",
	"staff",
	"mattrax",
	"root",
	"contact",
	"support",
	"home",
	"employee",
	// Reserved Mattrax routes
	"enroll",
	"profile",
	"account",
]);

export const tenantRouter = createTRPCRouter({
	create: authedProcedure
		.input(z.object({ name: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const tenantId = await db.transaction(async (db) => {
				const id = createId();
				const result = await db.insert(tenants).values({
					id,
					name: input.name,
					ownerPk: ctx.account.pk,
					slug: `${input.name
						.toLowerCase()
						.replace(/\ /g, "-")
						.replace(/[^a-z0-9-v]/g, "")}-${createId().slice(0, 4)}`,
				});
				const tenantPk = Number.parseInt(result.insertId);

				await db.insert(tenantAccounts).values({
					tenantPk,
					accountPk: ctx.account.pk,
				});

				return id;
			});

			// TODO: Invalidate `tenants`

			return tenantId;
		}),

	edit: tenantProcedure
		.input(
			z.object({
				name: z.string().min(1).max(100).optional(),
				slug: z.string().min(1).max(100).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			if (input.name === undefined) return;

			if (restrictedUsernames.has(input.name.toLowerCase())) {
				throw new Error("Name is restricted"); // TODO: Properly handle this on the frontend
			}

			await db
				.update(tenants)
				.set({
					...(input.name !== undefined && { name: input.name }),
					...(input.slug !== undefined && { slug: input.slug }),
				})
				.where(eq(tenants.pk, ctx.tenant.pk));
		}),

	enrollmentInfo: tenantProcedure.query(async ({ ctx }) =>
		db
			.select({
				enrollmentEnabled: tenants.enrollmentEnabled,
			})
			.from(tenants)
			.where(eq(tenants.pk, ctx.tenant.pk))
			.then((rows) => rows[0]),
	),

	setEnrollmentInfo: tenantProcedure
		.input(z.object({ enrollmentEnabled: z.boolean() }))
		.mutation(async ({ ctx, input }) =>
			db
				.update(tenants)
				.set({
					enrollmentEnabled: input.enrollmentEnabled,
				})
				.where(eq(tenants.pk, ctx.tenant.pk)),
		),

	stats: tenantProcedure.query(({ ctx }) =>
		union(
			db
				.select({ count: count(), variant: sql<StatsTarget>`"users"` })
				.from(users)
				.where(eq(users.tenantPk, ctx.tenant.pk)),
			db
				.select({ count: count(), variant: sql<StatsTarget>`"devices"` })
				.from(devices)
				.where(eq(devices.tenantPk, ctx.tenant.pk)),
			db
				.select({ count: count(), variant: sql<StatsTarget>`"policies"` })
				.from(policies)
				.where(eq(policies.tenantPk, ctx.tenant.pk)),
			db
				.select({ count: count(), variant: sql<StatsTarget>`"applications"` })
				.from(applications)
				.where(eq(applications.tenantPk, ctx.tenant.pk)),
			db
				.select({ count: count(), variant: sql<StatsTarget>`"groups"` })
				.from(groups)
				.where(eq(groups.tenantPk, ctx.tenant.pk)),
		),
	),

	delete: tenantProcedure.mutation(async ({ ctx }) => {
		// TODO: Ensure no outstanding bills

		await db.transaction(async (db) => {
			await db.delete(tenants).where(eq(tenants.pk, ctx.tenant.pk));
			await db
				.delete(tenantAccounts)
				.where(eq(tenantAccounts.tenantPk, ctx.tenant.pk));
			await db.delete(users).where(eq(users.tenantPk, ctx.tenant.pk));
			await db.delete(policies).where(eq(policies.tenantPk, ctx.tenant.pk));
			await db.delete(devices).where(eq(devices.tenantPk, ctx.tenant.pk)); // TODO: Don't do this
		});

		// TODO: Schedule all devices for unenrolment
	}),

	admins: adminsRouter,
	billing: billingRouter,
	identityProvider: identityProviderRouter,
	members: membersRouter,
});
