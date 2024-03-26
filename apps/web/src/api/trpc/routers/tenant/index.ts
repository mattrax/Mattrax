import { createId } from "@paralleldrive/cuid2";
import { count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { union } from "drizzle-orm/mysql-core";

import {
	accounts,
	applications,
	auditLog,
	db,
	devices,
	groups,
	identityProviders,
	organisationTenants,
	policies,
	tenantAccounts,
	tenants,
	users,
} from "~/db";
import { createTRPCRouter, orgProcedure, tenantProcedure } from "../../helpers";
import { adminsRouter } from "./admins";
import { identityProviderRouter } from "./identityProvider";
import { membersRouter } from "./members";
import { randomSlug } from "~/api/utils";

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
	create: orgProcedure
		.input(z.object({ name: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const tenantId = await db.transaction(async (db) => {
				const id = createId();
				const result = await db.insert(tenants).values({
					id,
					name: input.name,
					ownerPk: ctx.account.pk,
					orgPk: ctx.org.pk,
					slug: randomSlug(input.name),
				});
				const tenantPk = Number.parseInt(result.insertId);

				await db.insert(tenantAccounts).values({
					tenantPk,
					accountPk: ctx.account.pk,
				});
				await db.insert(organisationTenants).values({
					tenantPk,
					orgPk: ctx.org.pk,
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

	// TODO: Pagination
	auditLog: tenantProcedure
		.input(
			z.object({
				limit: z.number().optional(),
			}),
		)
		.query(({ ctx, input }) =>
			db
				.select({
					action: auditLog.action,
					data: auditLog.data,
					doneAt: auditLog.doneAt,
					user: sql`IFNULL(${accounts.name}, "system")`,
				})
				.from(auditLog)
				.leftJoin(accounts, eq(accounts.pk, auditLog.userPk))
				.orderBy(desc(auditLog.doneAt))
				.limit(input.limit ?? 9999999),
		),

	gettingStarted: tenantProcedure.query(async ({ ctx }) => {
		const data = await Promise.all([
			db
				.select({ count: count() })
				.from(identityProviders)
				.where(eq(identityProviders.tenantPk, ctx.tenant.pk))
				// We don't care about the actual count, just if there are any
				.limit(1),
			db
				.select({ count: count() })
				.from(devices)
				.where(eq(devices.tenantPk, ctx.tenant.pk))
				// We don't care about the actual count, just if there are any
				.limit(1),
			db
				.select({ count: count() })
				.from(policies)
				.where(eq(policies.tenantPk, ctx.tenant.pk))
				// We don't care about the actual count, just if there are any
				.limit(1),
		]);

		return {
			connectedIdentityProvider: data[0][0].count > 0,
			enrolledADevice: data[1][0].count > 0,
			createdFirstPolicy: data[2][0].count > 0,
		};
	}),

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
	identityProvider: identityProviderRouter,
	members: membersRouter,
});
