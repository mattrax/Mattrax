import { and, desc, eq, sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
	type PolicyAssignableVariant,
	PolicyAssignableVariants,
	db,
	devices,
	groups,
	policies,
	policyAssignableVariants,
	policyAssignables,
	policyVersions,
	users,
	accounts,
} from "~/db";
import { authedProcedure, createTRPCRouter, tenantProcedure } from "../helpers";
import { omit } from "~/api/utils";
import { withAuditLog } from "~/api/auditLog";
import type { Configuration } from "~/lib/policy";

function getPolicy(args: { policyId: string; tenantPk: number }) {
	return db.query.policies.findFirst({
		where: and(
			eq(policies.id, args.policyId),
			eq(policies.tenantPk, args.tenantPk),
		),
	});
}

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
			if (!policy) throw new Error("policy not found"); // TODO: Error and have frontend catch and handle it

			await ctx.ensureTenantMember(policy.tenantPk);

			const [lastVersion] = await db
				.select({ data: policyVersions.data })
				.from(policyVersions)
				.where(and(eq(policyVersions.policyPk, policy.pk)))
				.orderBy(desc(policyVersions.createdAt))
				.limit(1);

			return {
				// The differences between the policies state and the last deployed version
				diff: generatePolicyDiff(lastVersion?.data ?? {}, policy.data),
				...omit(policy, ["tenantPk"]),
			};
		}),

	overview: authedProcedure
		.input(z.object({ policyId: z.string() }))
		.query(async ({ ctx, input }) => {
			const [policy] = await db
				.select({
					tenantPk: policies.tenantPk,
				})
				.from(policies)
				.where(eq(policies.id, input.policyId));
			if (!policy) throw new Error("policy not found"); // TODO: Error and have frontend catch and handle it

			await ctx.ensureTenantMember(policy.tenantPk);

			// TODO: Calculate these
			const devices = 5;
			const users = 0;

			return {
				devices,
				users,
			};
		}),

	members: authedProcedure
		.input(z.object({ id: z.string() }))
		.query(async ({ ctx, input }) => {
			const policy = await db.query.policies.findFirst({
				where: eq(policies.id, input.id),
			});
			if (!policy)
				throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found" });

			await ctx.ensureTenantMember(policy.tenantPk);

			return await db
				.select({
					pk: policyAssignables.pk,
					variant: policyAssignables.variant,
					name: sql<PolicyAssignableVariant>`
            GROUP_CONCAT(
                CASE
                    WHEN ${policyAssignables.variant} = ${PolicyAssignableVariants.device} THEN ${devices.name}
                    WHEN ${policyAssignables.variant} = ${PolicyAssignableVariants.user} THEN ${users.name}
                    WHEN ${policyAssignables.variant} = ${PolicyAssignableVariants.group} THEN ${groups.name}
                END
            )
          `.as("name"),
				})
				.from(policyAssignables)
				.where(eq(policyAssignables.policyPk, policy.pk))
				.leftJoin(
					devices,
					and(
						eq(devices.pk, policyAssignables.pk),
						eq(policyAssignables.variant, PolicyAssignableVariants.device),
					),
				)
				.leftJoin(
					users,
					and(
						eq(users.pk, policyAssignables.pk),
						eq(policyAssignables.variant, PolicyAssignableVariants.user),
					),
				)
				.leftJoin(
					groups,
					and(
						eq(groups.pk, policyAssignables.pk),
						eq(policyAssignables.variant, PolicyAssignableVariants.group),
					),
				)
				.groupBy(policyAssignables.variant, policyAssignables.pk);
		}),

	addMembers: authedProcedure
		.input(
			z.object({
				id: z.string(),
				members: z.array(
					z.object({
						pk: z.number(),
						variant: z.enum(policyAssignableVariants),
					}),
				),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const policy = await db.query.policies.findFirst({
				where: eq(policies.id, input.id),
			});
			if (!policy)
				throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found" });

			await ctx.ensureTenantMember(policy.tenantPk);

			await db.insert(policyAssignables).values(
				input.members.map((member) => ({
					policyPk: policy.pk,
					pk: member.pk,
					variant: member.variant,
				})),
			);
		}),

	create: tenantProcedure
		.input(z.object({ name: z.string().min(1).max(100) }))
		.mutation(({ ctx, input }) => {
			const id = createId();
			return withAuditLog(
				"addPolicy",
				{ id, name: input.name },
				[ctx.tenant.pk, ctx.account.pk],
				async () => {
					await db.insert(policies).values({
						id,
						name: input.name,
						tenantPk: ctx.tenant.pk,
					});

					return id;
				},
			);
		}),

	update: authedProcedure
		.input(
			z.object({
				policyId: z.string(),
				name: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const policy = await db.query.policies.findFirst({
				where: eq(policies.id, input.policyId),
			});
			if (!policy)
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "policy",
				});

			await ctx.ensureTenantMember(policy.tenantPk);

			await db
				.update(policies)
				.set({
					name: input.name ?? sql`${policies.name}`,
				})
				.where(eq(policies.id, input.policyId));
		}),

	delete: authedProcedure
		.input(z.object({ policyId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const policy = await db.query.policies.findFirst({
				where: eq(policies.id, input.policyId),
			});
			if (!policy)
				throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found" });

			await withAuditLog(
				"deletePolicy",
				{ name: policy.name },
				[policy.tenantPk, ctx.account.pk],
				async () => {
					await db.delete(policies).where(eq(policies.id, input.policyId));
				},
			);
		}),

	deploy: authedProcedure
		.input(z.object({ policyId: z.string(), comment: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const [policy] = await db
				.select({
					pk: policies.pk,
					data: policies.data,
					tenantPk: policies.tenantPk,
				})
				.from(policies)
				.where(eq(policies.id, input.policyId));
			if (!policy) throw new Error("policy not found"); // TODO: Error and have frontend catch and handle it

			await ctx.ensureTenantMember(policy.tenantPk);

			// TODO: Only allow deploying if the policy has changed
			// if(policy.data)

			await db.insert(policyVersions).values({
				policyPk: policy.pk,
				data: policy.data,
				comment: input.comment,
				author: ctx.account.pk,
			});

			// TODO: Send push notification to all devices
		}),

	versions: createTRPCRouter({
		list: authedProcedure
			.input(z.object({ policyId: z.string(), limit: z.number().optional() }))
			.query(async ({ ctx, input }) => {
				const [policy] = await db
					.select({ tenantPk: policies.tenantPk })
					.from(policies)
					.where(eq(policies.id, input.policyId));
				if (!policy) throw new Error("policy not found"); // TODO: Error and have frontend catch and handle it

				await ctx.ensureTenantMember(policy.tenantPk);

				const versions = await db
					.select({
						id: policyVersions.id,
						status: policyVersions.status,
						author: accounts.name,
						authorEmail: accounts.email,
						comment: policyVersions.comment,
						deployedAt: policyVersions.createdAt,
					})
					.from(policyVersions)
					.innerJoin(policies, eq(policyVersions.policyPk, policies.pk))
					.leftJoin(accounts, eq(policyVersions.author, accounts.pk))
					.where(
						and(
							eq(policies.id, input.policyId),
							eq(policies.tenantPk, policy.tenantPk),
						),
					)
					.orderBy(desc(policyVersions.createdAt))
					.limit(input.limit ?? 99999999);

				return versions;
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
function generatePolicyDiff(
	p1: Record<string, Configuration>,
	p2: Record<string, Configuration>,
) {
	const result: { change: "added" | "deleted" | "modified"; data: any }[] = [];

	for (const [key, value] of Object.entries(p1)) {
		const otherValue = p2[key];
		if (otherValue === undefined) {
			result.push({ change: "deleted", data: value });
		} else {
			if (!deepEqual(value, otherValue)) {
				result.push({ change: "modified", data: value });
			}
		}
	}

	for (const [key, value] of Object.entries(p2)) {
		if (p1[key] === undefined) {
			result.push({ change: "added", data: value });
		}
	}

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
