import type { PolicyData } from "@mattrax/policy";
import { createId } from "@paralleldrive/cuid2";
import { cache } from "@solidjs/router";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";

import { createAuditLog } from "~/api/auditLog";
import { omit } from "~/api/utils";
import { createTransaction } from "~/api/utils/transaction";
import {
	PolicyAssignableVariants,
	accounts,
	db,
	devices,
	groups,
	policies,
	policyAssignableVariants,
	policyAssignments,
	policyDeploy,
	users,
} from "~/db";
import { authedProcedure, createTRPCRouter, tenantProcedure } from "../helpers";
import { invalidate } from "~/api/utils/realtime";

const getPolicy = cache(async (id: string) => {
	return await db.query.policies.findFirst({
		where: eq(policies.id, id),
	});
}, "getPolicy");

const policyProcedure = authedProcedure
	.input(z.object({ id: z.string() }))
	.use(async ({ next, input, ctx, type }) => {
		const policy = await getPolicy(input.id);
		if (!policy)
			throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found" });

		const tenant = await ctx.ensureTenantMember(policy.tenantPk);

		return await next({ ctx: { policy, tenant } }).then((result) => {
			// TODO: Right now we invalidate everything but we will need to be more specific in the future
			if (type === "mutation") invalidate(tenant.orgSlug, tenant.slug);
			return result;
		});
	});

export const policyRouter = createTRPCRouter({
	list: tenantProcedure.query(({ ctx }) =>
		db
			.select({
				id: policies.id,
				name: policies.name,
			})
			.from(policies)
			.where(eq(policies.tenantPk, ctx.tenant.pk)),
	),

	get: authedProcedure
		.input(z.object({ policyId: z.string() }))
		.query(async ({ ctx, input }) => {
			const [policy] = await db
				.select({
					id: policies.id,
					pk: policies.pk,
					name: policies.name,
					data: policies.data,
					tenantPk: policies.tenantPk,
				})
				.from(policies)
				.where(eq(policies.id, input.policyId));
			if (!policy) return null; // TODO: Error and have frontend catch and handle it

			await ctx.ensureTenantMember(policy.tenantPk);

			const [lastVersion] = await db
				.select({ data: policyDeploy.data })
				.from(policyDeploy)
				.where(and(eq(policyDeploy.policyPk, policy.pk)))
				.orderBy(desc(policyDeploy.doneAt))
				.limit(1);

			await new Promise((resolve) => setTimeout(resolve, 1000));

			return {
				// The differences between the policies state and the last deployed version
				diff: generatePolicyDiff(lastVersion?.data ?? ({} as any), policy.data),
				...omit(policy, ["tenantPk"]),
			};
		}),

	overview: policyProcedure.query(async () => {
		// TODO: Calculate these
		const devices = 5;
		const users = 0;

		return {
			devices,
			users,
		};
	}),

	assignees: policyProcedure.query(async ({ ctx }) => {
		return await db
			.select({
				pk: policyAssignments.pk,
				variant: policyAssignments.variant,
				id: sql<string>`
					GROUP_CONCAT(CASE
						WHEN ${policyAssignments.variant} = ${PolicyAssignableVariants.device} THEN ${devices.id}
						WHEN ${policyAssignments.variant} = ${PolicyAssignableVariants.user} THEN ${users.id}
						WHEN ${policyAssignments.variant} = ${PolicyAssignableVariants.group} THEN ${groups.id}
					END)
          `.as("id"),
				name: sql<string>`
					GROUP_CONCAT(CASE
						WHEN ${policyAssignments.variant} = ${PolicyAssignableVariants.device} THEN ${devices.name}
						WHEN ${policyAssignments.variant} = ${PolicyAssignableVariants.user} THEN ${users.name}
						WHEN ${policyAssignments.variant} = ${PolicyAssignableVariants.group} THEN ${groups.name}
					END)
          `.as("name"),
			})
			.from(policyAssignments)
			.where(eq(policyAssignments.policyPk, ctx.policy.pk))
			.leftJoin(
				devices,
				and(
					eq(devices.pk, policyAssignments.pk),
					eq(policyAssignments.variant, PolicyAssignableVariants.device),
				),
			)
			.leftJoin(
				users,
				and(
					eq(users.pk, policyAssignments.pk),
					eq(policyAssignments.variant, PolicyAssignableVariants.user),
				),
			)
			.leftJoin(
				groups,
				and(
					eq(groups.pk, policyAssignments.pk),
					eq(policyAssignments.variant, PolicyAssignableVariants.group),
				),
			)
			.groupBy(policyAssignments.variant, policyAssignments.pk);
	}),

	addAssignees: policyProcedure
		.input(
			z.object({
				assignees: z.array(
					z.object({
						pk: z.number(),
						variant: z.enum(policyAssignableVariants),
					}),
				),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await db.insert(policyAssignments).values(
				input.assignees.map((member) => ({
					policyPk: ctx.policy.pk,
					pk: member.pk,
					variant: member.variant,
				})),
			);
		}),
	removeAssignees: policyProcedure
		.input(
			z.object({
				assignees: z.array(
					z.object({
						pk: z.number(),
						variant: z.enum(policyAssignableVariants),
					}),
				),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await db
				.delete(policyAssignments)
				.where(
					or(
						...input.assignees.map((assignee) =>
							and(
								eq(policyAssignments.policyPk, ctx.policy.pk),
								eq(policyAssignments.pk, assignee.pk),
								eq(policyAssignments.variant, assignee.variant),
							),
						),
					),
				);
		}),
	create: tenantProcedure
		.input(z.object({ name: z.string().min(1).max(100) }))
		.mutation(async ({ ctx, input }) => {
			const id = createId();

			await createTransaction(async (db) => {
				await db.insert(policies).values({
					id,
					name: input.name,
					tenantPk: ctx.tenant.pk,
				});
				await createAuditLog("addPolicy", { id, name: input.name });
			});

			return id;
		}),

	update: policyProcedure
		.input(
			z.object({
				name: z.string().optional(),
				// TODO: Validate the input type
				data: z.custom<PolicyData>().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await db
				.update(policies)
				.set({
					name: input.name ?? sql`${policies.name}`,
					data: input.data ?? sql`${policies.data}`,
				})
				.where(eq(policies.pk, ctx.policy.pk));
		}),

	delete: policyProcedure.mutation(async ({ ctx }) => {
		await createTransaction(async (db) => {
			await db.delete(policies).where(eq(policies.pk, ctx.policy.pk));
			await createAuditLog("deletePolicy", { name: ctx.policy.name });
		});
	}),

	deploy: policyProcedure
		.input(z.object({ comment: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const [lastVersion] = await db
				.select({ data: policyDeploy.data })
				.from(policyDeploy)
				.where(and(eq(policyDeploy.policyPk, ctx.policy.pk)))
				.orderBy(desc(policyDeploy.doneAt))
				.limit(1);

			if (
				generatePolicyDiff(lastVersion?.data ?? ({} as any), ctx.policy.data)
					.length === 0
			)
				throw new Error("policy has not changed");

			await db.insert(policyDeploy).values({
				policyPk: ctx.policy.pk,
				data: ctx.policy.data,
				comment: input.comment,
				author: ctx.account.pk,
			});

			// TODO: Send push notification to all devices
		}),

	deploys: createTRPCRouter({
		list: authedProcedure
			.input(z.object({ policyId: z.string(), limit: z.number().optional() }))
			.query(async ({ ctx, input }) => {
				const [policy] = await db
					.select({ tenantPk: policies.tenantPk })
					.from(policies)
					.where(eq(policies.id, input.policyId));
				if (!policy) throw new Error("policy not found"); // TODO: Error and have frontend catch and handle it

				await ctx.ensureTenantMember(policy.tenantPk);

				const deploys = await db
					.select({
						id: policyDeploy.id,
						author: accounts.name,
						authorEmail: accounts.email,
						comment: policyDeploy.comment,
						deployedAt: policyDeploy.doneAt,
					})
					.from(policyDeploy)
					.innerJoin(policies, eq(policyDeploy.policyPk, policies.pk))
					.leftJoin(accounts, eq(policyDeploy.author, accounts.pk))
					.where(
						and(
							eq(policies.id, input.policyId),
							eq(policies.tenantPk, policy.tenantPk),
						),
					)
					.orderBy(desc(policyDeploy.doneAt))
					.limit(input.limit ?? 99999999);

				return deploys;
			}),

		get: authedProcedure.query(({ ctx }) => {
			// TODO
			// 		const [version] = await db
			// 			.select({
			// 				id: policyVersions.id,
			// 				status: policyVersions.status,
			// 				data: policyVersions.data,
			// 				deployedBy: accounts.name,
			// 				deployedAt: policyVersions.deployedAt,
			// 				deployComment: policyVersions.deployComment,
			// 				createdAt: policyVersions.createdAt,
			// 			})
			// 			.from(policyVersions)
			// 			.innerJoin(policies, eq(policyVersions.policyPk, policies.pk))
			// 			.leftJoin(accounts, eq(policyVersions.deployedBy, accounts.pk))
			// 			.where(
			// 				and(
			// 					eq(policies.id, input.policyId),
			// 					eq(policies.tenantPk, ctx.tenant.pk),
			// 					eq(policyVersions.id, input.versionId),
			// 				),
			// 			);
			// 		return version;
		}),
	}),
});

// `p1` should be older than `p2` for the result to be correct
export function generatePolicyDiff(p1: PolicyData, p2: PolicyData) {
	const result: { change: "added" | "deleted" | "modified"; data: any }[] = [];

	for (const [key, value] of Object.entries(p1?.windows || {})) {
		const otherValue = p2?.windows?.[key];
		if (otherValue === undefined) {
			result.push({ change: "deleted", data: value });
		} else {
			if (!deepEqual(value, otherValue)) {
				result.push({ change: "modified", data: value });
			}
		}
	}

	for (const [key, value] of Object.entries(p2?.windows || {})) {
		if (p1?.windows?.[key] === undefined) {
			result.push({ change: "added", data: value });
		}
	}

	// TODO: macOS support
	// TODO: Android

	return result;
}

function deepEqual(
	object1: Record<any, any> | any[],
	object2: Record<any, any> | any[],
) {
	const keys1 = Object.keys(object1);
	const keys2 = Object.keys(object2);

	if (keys1.length !== keys2.length) {
		return false;
	}

	for (const key of keys1) {
		// @ts-expect-error
		const val1 = object1[key];
		// @ts-expect-error
		const val2 = object2[key];
		const areObjects = isObject(val1) && isObject(val2);
		if (
			(areObjects && !deepEqual(val1, val2)) ||
			(!areObjects && val1 !== val2)
		) {
			return false;
		}
	}

	return true;
}

function isObject(object: any) {
	return object != null && typeof object === "object";
}
