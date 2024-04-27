import { count, desc, eq, sql } from "drizzle-orm";
import { union } from "drizzle-orm/mysql-core";
import { z } from "zod";

import {
	accounts,
	applications,
	auditLog,
	deviceActions,
	devices,
	domains,
	groupMembers,
	groups,
	identityProviders,
	organisationMembers,
	organisations,
	policies,
	policyAssignments,
	policyDeploy,
	policyDeployStatus,
	tenants,
	users,
} from "~/db";
import {
	authedProcedure,
	createTRPCRouter,
	orgProcedure,
	tenantProcedure,
} from "../../helpers";
import { identityProviderRouter } from "./identityProvider";
import { variantTableRouter } from "./members";
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
	list: orgProcedure.query(async ({ ctx }) =>
		ctx.db
			.select({
				id: tenants.id,
				name: tenants.name,
				slug: tenants.slug,
				orgId: organisations.id,
			})
			.from(tenants)
			.where(eq(tenants.orgPk, ctx.org.pk))
			.innerJoin(organisations, eq(organisations.pk, tenants.orgPk))
			.orderBy(tenants.id),
	),

	create: orgProcedure
		.input(z.object({ name: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const slug = await ctx.db.transaction(async (db) => {
				const slug = randomSlug(input.name);

				await db.insert(tenants).values({
					name: input.name,
					slug,
					orgPk: ctx.org.pk,
				});

				return slug;
			});

			// TODO: Invalidate `tenants`

			return slug;
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

			await ctx.db
				.update(tenants)
				.set({
					...(input.name !== undefined && { name: input.name }),
					...(input.slug !== undefined && { slug: input.slug }),
				})
				.where(eq(tenants.pk, ctx.tenant.pk));
		}),

	stats: tenantProcedure.query(async ({ ctx }) => {
		return await union(
			ctx.db
				.select({ count: count(), variant: sql<StatsTarget>`"users"` })
				.from(users)
				.where(eq(users.tenantPk, ctx.tenant.pk)),
			ctx.db
				.select({ count: count(), variant: sql<StatsTarget>`"devices"` })
				.from(devices)
				.where(eq(devices.tenantPk, ctx.tenant.pk)),
			ctx.db
				.select({ count: count(), variant: sql<StatsTarget>`"policies"` })
				.from(policies)
				.where(eq(policies.tenantPk, ctx.tenant.pk)),
			ctx.db
				.select({ count: count(), variant: sql<StatsTarget>`"applications"` })
				.from(applications)
				.where(eq(applications.tenantPk, ctx.tenant.pk)),
			ctx.db
				.select({ count: count(), variant: sql<StatsTarget>`"groups"` })
				.from(groups)
				.where(eq(groups.tenantPk, ctx.tenant.pk)),
		);
	}),

	// TODO: Pagination
	auditLog: tenantProcedure
		.input(z.object({ limit: z.number().optional() }))
		.query(({ ctx, input }) =>
			ctx.db
				.select({
					action: auditLog.action,
					data: auditLog.data,
					doneAt: auditLog.doneAt,
					user: sql<string>`IFNULL(${accounts.name}, "system")`,
				})
				.from(auditLog)
				.where(eq(auditLog.tenantPk, ctx.tenant.pk))
				.leftJoin(accounts, eq(accounts.pk, auditLog.accountPk))
				.orderBy(desc(auditLog.doneAt))
				.limit(input.limit ?? 9999999),
		),

	gettingStarted: tenantProcedure.query(async ({ ctx }) => {
		const [[a], [b], [c]] = await Promise.all([
			ctx.db
				.select({ count: count() })
				.from(identityProviders)
				.where(eq(identityProviders.tenantPk, ctx.tenant.pk))
				// We don't care about the actual count, just if there are any
				.limit(1),
			ctx.db
				.select({ count: count() })
				.from(devices)
				.where(eq(devices.tenantPk, ctx.tenant.pk))
				// We don't care about the actual count, just if there are any
				.limit(1),
			ctx.db
				.select({ count: count() })
				.from(policies)
				.where(eq(policies.tenantPk, ctx.tenant.pk))
				// We don't care about the actual count, just if there are any
				.limit(1),
		]);

		return {
			connectedIdentityProvider: a!.count > 0,
			enrolledADevice: b!.count > 0,
			createdFirstPolicy: c!.count > 0,
		};
	}),

	delete: tenantProcedure.mutation(async ({ ctx }) => {
		const [[a], [b]] = await Promise.all([
			ctx.db
				.select({ count: count() })
				.from(devices)
				.where(eq(devices.tenantPk, ctx.tenant.pk)),
			ctx.db
				.select({ count: count() })
				.from(identityProviders)
				.where(eq(identityProviders.tenantPk, ctx.tenant.pk)),
		]);

		if (a!.count !== 0) throw new Error("Cannot delete tenant with devices"); // TODO: handle this error on the frontend
		if (b!.count !== 0)
			throw new Error("Cannot delete tenant with identity providers"); // TODO: handle this error on the frontend

		// MySQL is really fussy about CTE's + deletes so we end up with a lotta raw SQL here sadly.
		await ctx.db.transaction(async (db) => {
			await db.delete(users).where(eq(users.tenantPk, ctx.tenant.pk));

			const device_actions = db
				.select({ id: devices.id })
				.from(deviceActions)
				.innerJoin(devices, eq(devices.pk, deviceActions.devicePk))
				.where(eq(devices.tenantPk, ctx.tenant.pk));
			const device_actions_query = db.$with("inner").as(device_actions);
			await db.execute(
				sql`with ${device_actions_query} as ${device_actions} delete from ${deviceActions} using ${deviceActions} join ${device_actions_query} on ${deviceActions.devicePk} = ${device_actions_query.id};`,
			);

			await db.delete(devices).where(eq(devices.tenantPk, ctx.tenant.pk));

			const group_assignable = db
				.select({ id: groups.id })
				.from(groupMembers)
				.innerJoin(groups, eq(groups.pk, groupMembers.groupPk))
				.where(eq(groups.tenantPk, ctx.tenant.pk));
			const group_assignable_query = db.$with("inner").as(group_assignable);
			await db.execute(
				sql`with ${group_assignable_query} as ${group_assignable} delete from ${groupMembers} using ${groupMembers} join ${group_assignable_query} on ${groupMembers.groupPk} = ${group_assignable_query.id};`,
			);

			await db.delete(groups).where(eq(groups.tenantPk, ctx.tenant.pk));

			const policy_assignment = db
				.select({ id: policies.id })
				.from(policyAssignments)
				.innerJoin(policies, eq(policies.pk, policyAssignments.policyPk))
				.where(eq(policies.tenantPk, ctx.tenant.pk));
			const policy_assignment_query = db.$with("inner").as(policy_assignment);
			await db.execute(
				sql`with ${policy_assignment_query} as ${policy_assignment} delete from ${policyAssignments} using ${policyAssignments} join ${policy_assignment_query} on ${policyAssignments.policyPk} = ${policy_assignment_query.id};`,
			);

			const policy_deploy_status = db
				.select({ id: policyDeploy.id })
				.from(policyDeployStatus)
				.innerJoin(
					policyDeploy,
					eq(policyDeploy.pk, policyDeployStatus.deployPk),
				)
				.innerJoin(policies, eq(policies.pk, policyDeploy.policyPk))
				.where(eq(policies.tenantPk, ctx.tenant.pk));
			const policy_deploy_status_query = db
				.$with("inner")
				.as(policy_deploy_status);
			await db.execute(
				sql`with ${policy_deploy_status_query} as ${policy_deploy_status} delete from ${policyDeployStatus} using ${policyDeployStatus} join ${policy_deploy_status_query} on ${policyDeployStatus.deployPk} = ${policy_deploy_status_query.id};`,
			);
			await db.delete(policies).where(eq(policies.tenantPk, ctx.tenant.pk));

			await db
				.delete(applications)
				.where(eq(applications.tenantPk, ctx.tenant.pk));
			await db.delete(domains).where(eq(domains.tenantPk, ctx.tenant.pk));
			await db.delete(auditLog).where(eq(auditLog.tenantPk, ctx.tenant.pk));

			await db.delete(tenants).where(eq(tenants.pk, ctx.tenant.pk));
		});
	}),
	identityProvider: identityProviderRouter,
	variantTable: variantTableRouter,
});
