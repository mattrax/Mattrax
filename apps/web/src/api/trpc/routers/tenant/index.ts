import { count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { union } from "drizzle-orm/mysql-core";

import {
	accounts,
	applications,
	auditLog,
	db,
	deviceActions,
	devices,
	domains,
	groupAssignables,
	groups,
	identityProviders,
	policies,
	policyAssignables,
	policyDeploy,
	policyDeployStatus,
	tenants,
	users,
} from "~/db";
import { createTRPCRouter, orgProcedure, tenantProcedure } from "../../helpers";
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
			const slug = await db.transaction(async (db) => {
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

			await db
				.update(tenants)
				.set({
					...(input.name !== undefined && { name: input.name }),
					...(input.slug !== undefined && { slug: input.slug }),
				})
				.where(eq(tenants.pk, ctx.tenant.pk));
		}),

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
		.input(z.object({ limit: z.number().optional() }))
		.query(({ ctx, input }) =>
			db
				.select({
					action: auditLog.action,
					data: auditLog.data,
					doneAt: auditLog.doneAt,
					user: sql<string>`IFNULL(${accounts.name}, "system")`,
				})
				.from(auditLog)
				.where(eq(auditLog.tenantPk, ctx.tenant.pk))
				.leftJoin(accounts, eq(accounts.pk, auditLog.userPk))
				.orderBy(desc(auditLog.doneAt))
				.limit(input.limit ?? 9999999),
		),

	gettingStarted: tenantProcedure.query(async ({ ctx }) => {
		const [[a], [b], [c]] = await Promise.all([
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
			connectedIdentityProvider: a!.count > 0,
			enrolledADevice: b!.count > 0,
			createdFirstPolicy: c!.count > 0,
		};
	}),

	delete: tenantProcedure.mutation(async ({ ctx }) => {
		const [[a], [b]] = await Promise.all([
			db
				.select({ count: count() })
				.from(devices)
				.where(eq(devices.tenantPk, ctx.tenant.pk)),
			db
				.select({ count: count() })
				.from(identityProviders)
				.where(eq(users.tenantPk, ctx.tenant.pk)),
		]);

		if (a!.count !== 0) throw new Error("Cannot delete tenant with devices"); // TODO: handle this error on the frontend
		if (b!.count !== 0)
			throw new Error("Cannot delete tenant with identity providers"); // TODO: handle this error on the frontend

		await db.transaction(async (db) => {
			await db.delete(users).where(eq(users.tenantPk, ctx.tenant.pk));

			const device_actions = db
				.$with("device_actions")
				.as(
					db
						.select({ id: devices.id })
						.from(deviceActions)
						.innerJoin(devices, eq(devices.pk, deviceActions.devicePk))
						.where(eq(devices.tenantPk, ctx.tenant.pk)),
				);
			await db
				.with(device_actions)
				.delete(deviceActions)
				.where(eq(deviceActions.devicePk, device_actions.id));
			await db.delete(devices).where(eq(devices.tenantPk, ctx.tenant.pk));

			const group_assignable = db
				.$with("group_assignables")
				.as(
					db
						.select({ id: groups.id })
						.from(groupAssignables)
						.innerJoin(groups, eq(groups.pk, groupAssignables.groupPk))
						.where(eq(groups.tenantPk, ctx.tenant.pk)),
				);
			await db
				.with(group_assignable)
				.delete(groupAssignables)
				.where(eq(groupAssignables.groupPk, group_assignable.id));
			await db.delete(groups).where(eq(groups.tenantPk, ctx.tenant.pk));

			const policy_assignable = db
				.$with("policy_assignables")
				.as(
					db
						.select({ id: policies.id })
						.from(policyAssignables)
						.innerJoin(policies, eq(policies.pk, policyAssignables.policyPk))
						.where(eq(policies.tenantPk, ctx.tenant.pk)),
				);
			await db
				.with(policy_assignable)
				.delete(policyAssignables)
				.where(eq(policyAssignables.policyPk, policy_assignable.id));
			const policy_deploy_status = db
				.$with("policy_deploy_status")
				.as(
					db
						.select({ id: policyDeploy.id })
						.from(policyDeployStatus)
						.innerJoin(
							policyDeploy,
							eq(policyDeploy.pk, policyDeployStatus.deployPk),
						)
						.innerJoin(policies, eq(policies.pk, policyDeploy.policyPk))
						.where(eq(policies.tenantPk, ctx.tenant.pk)),
				);
			await db
				.with(policy_deploy_status)
				.delete(policyDeployStatus)
				.where(eq(policyDeployStatus.deployPk, policy_deploy_status.id));
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
	members: membersRouter,
});
