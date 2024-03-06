import { and, count, eq, sql } from "drizzle-orm";
import { union } from "drizzle-orm/mysql-core";
import { createId } from "@paralleldrive/cuid2";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
	PolicyAssignableVariant,
	PolicyAssignableVariants,
	accounts,
	db,
	devices,
	groups,
	policies,
	policyAssignableVariants,
	policyAssignables,
	policyVersions,
	users,
} from "~/db";
import { createTRPCRouter, tenantProcedure } from "../helpers";

function getPolicy(args: { policyId: string; tenantPk: number }) {
	return db.query.policies.findFirst({
		where: and(
			eq(policies.id, args.policyId),
			eq(policies.tenantPk, args.tenantPk),
		),
	});
}

export const policyRouter = createTRPCRouter({
	list: tenantProcedure.query(async ({ ctx }) => {
		return await db
			.select({
				id: policies.id,
				name: policies.name,
			})
			.from(policies)
			.where(eq(policies.tenantPk, ctx.tenant.pk));
	}),

	get: tenantProcedure
		.input(z.object({ policyId: z.string() }))
		.query(async ({ ctx, input }) => {
			const [[policy], [lastVersion]] = await Promise.all([
				db
					.select({
						id: policies.id,
						name: policies.name,
						data: policies.data,
					})
					.from(policies)
					.where(
						and(
							eq(policies.id, input.policyId),
							eq(policies.tenantPk, ctx.tenant.pk),
						),
					),
				db
					.select({ data: policyVersions.data })
					.from(policyVersions)
					.where(and(eq(policyVersions.id, input.policyId)))
					.orderBy(policyVersions.createdAt)
					.limit(1),
			]);
			if (!policy) throw new Error("policy not found"); // TODO: Proper tRPC error and have frontend catch and handle it

			return {
				// Compare to last deployed version or default (empty object)
				isDirty: !deepEqual(policy.data, lastVersion?.data ?? {}),
				...policy,
			};
		}),

	getDeploySummary: tenantProcedure
		.input(z.object({ policyId: z.string() }))
		.query(async ({ ctx, input }) => {
			// const policy = await getPolicy({
			// 	policyId: input.policyId,
			// 	tenantPk: ctx.tenant.pk,
			// });

			// TODO: Check policy is within the current tenant safely? Can we do this with a join on the second query?
			// db
			// 		.select({
			// 			id: policies.id,
			// 			name: policies.name,
			// 			data: policies.data,
			// 		})
			// 		.from(policies)
			// 		.where(
			// 			and(
			// 				eq(policies.id, input.policyId),
			// 				eq(policies.tenantPk, ctx.tenant.pk),
			// 			),
			// 		),
			// TODO: Also count through groups
			// const [result] = await db
			// 	.select({
			// 		count: count(),
			// 	})
			// 	.from(policyAssignables)
			// 	.where(eq(policyAssignables.policyPk, input.policyId));
			// return result?.count;

			return {
				numScoped: 5, // TODO
				// TODO: Implement this
				changes: {
					"./Testing/Testing/Testing": "123",
				},
			};
		}),

	deploy: tenantProcedure
		.input(z.object({ policyId: z.string(), comment: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const [policy] = await db
				.select({
					pk: policies.pk,
					data: policies.data,
				})
				.from(policies)
				.where(
					and(
						eq(policies.id, input.policyId),
						eq(policies.tenantPk, ctx.tenant.pk),
					),
				);
			if (!policy) throw new Error("policy not found"); // TODO: Error and have frontend catch and handle it

			await db.insert(policyVersions).values({
				policyPk: policy.pk,
				data: policy.data,
				comment: input.comment,
				createdBy: ctx.account.pk,
			});
		}),

	update: tenantProcedure
		.input(
			z.object({
				policyId: z.string(),
				name: z.string().optional(),
				data: z.any().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await db
				.update(policies)
				.set({
					name: input.name ?? sql`${policies.name}`,
					data: input.data ?? sql`${policies.data}`,
				})
				.where(
					and(
						eq(policies.id, input.policyId),
						eq(policies.tenantPk, ctx.tenant.pk),
					),
				);
		}),

	// getVersions: tenantProcedure
	// 	.input(z.object({ policyId: z.string() }))
	// 	.query(async ({ ctx, input }) => {
	// 		const versions = await db
	// 			.select({
	// 				// TODO: Don't return everything here
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
	// 				),
	// 			);

	// 		return versions;
	// 	}),

	// getVersion: tenantProcedure
	// 	.input(z.object({ policyId: z.string(), versionId: z.string() }))
	// 	.query(async ({ ctx, input }) => {
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
	// 	}),

	// updateVersion: tenantProcedure
	// 	.input(
	// 		z.object({
	// 			policyId: z.string(),
	// 			versionId: z.string(),
	// 			data: z.any(),
	// 		}),
	// 	)
	// 	.mutation(async ({ ctx, input }) => {
	// 		// TODO: Check no-one has edited this policy since we read it.

	// 		await db
	// 			.update(policyVersions)
	// 			.set({
	// 				data: input.data,
	// 			})
	// 			.where(
	// 				and(
	// 					eq(policyVersions.id, input.versionId),
	// 					// TODO: tenant id  // eq(policyVersions.policyPk, input.policyId) // TODO
	// 					// You can only update non-deployed versions
	// 					eq(policyVersions.status, "open"),
	// 				),
	// 			);

	// 		return {};
	// 	}),

	// deployVersion: tenantProcedure
	// 	.input(z.object({ policyId: z.string(), comment: z.string() }))
	// 	.mutation(async ({ ctx, input }) => {
	// 		// TODO: Maybe transaction for this?

	// 		const [policy] = await db
	// 			.select({
	// 				id: policies.id,
	// 				pk: policies.pk,
	// 				activeVersion: policies.activeVersion,
	// 			})
	// 			.from(policies)
	// 			.where(
	// 				and(
	// 					eq(policies.id, input.policyId),
	// 					eq(policies.tenantPk, ctx.tenant.pk),
	// 				),
	// 			);
	// 		if (!policy) throw new Error("todo: error handling"); // TODO: Error and have frontend catch and handle it

	// 		const status = await db
	// 			.update(policyVersions)
	// 			.set({
	// 				status: "deploying",
	// 				deployComment: input.comment,
	// 				deployedBy: ctx.account.pk,
	// 				deployedAt: new Date(),
	// 			})
	// 			.where(
	// 				and(
	// 					eq(policyVersions.policyPk, policy.pk),
	// 					eq(policyVersions.status, "open"),
	// 				),
	// 			);
	// 		const versionId = parseInt(status.insertId);

	// 		await db
	// 			.update(policies)
	// 			.set({ activeVersion: versionId })
	// 			.where(
	// 				and(
	// 					eq(policies.id, input.policyId),
	// 					eq(policies.tenantPk, ctx.tenant.pk),
	// 				),
	// 			);

	// 		if (status.rowsAffected !== 0) {
	// 			// TODO: Send push notification to all devices
	// 			// TODO: Push into device page
	// 		}
	// 	}),

	// createVersion: tenantProcedure
	// 	.input(z.object({ policyId: z.string() }))
	// 	.mutation(async ({ ctx, input }) => {
	// 		// TODO: Maybe transaction for this?

	// 		const [policy] = await db
	// 			.select({
	// 				pk: policies.pk,
	// 				activeVersion: policies.activeVersion,
	// 			})
	// 			.from(policies)
	// 			.where(
	// 				and(
	// 					eq(policies.id, input.policyId),
	// 					eq(policies.tenantPk, ctx.tenant.pk),
	// 				),
	// 			);
	// 		if (!policy) throw new Error("todo: error handling"); // TODO: Error and have frontend catch and handle it

	// 		const [result] = await db
	// 			.select({
	// 				count: count(),
	// 			})
	// 			.from(policyVersions)
	// 			.where(
	// 				and(
	// 					eq(policyVersions.id, input.policyId),
	// 					// eq(policyVersions.tenantPk, ctx.tenant.pk),
	// 					eq(policyVersions.status, "open"),
	// 				),
	// 			);
	// 		const numOpenPolicies = result?.count;

	// 		if (numOpenPolicies !== 0)
	// 			throw new Error("There is already an open policy version");

	// 		const [activeVersion] = await db
	// 			.select({
	// 				id: policyVersions.pk,
	// 				data: policyVersions.data,
	// 			})
	// 			.from(policyVersions)
	// 			.where(
	// 				and(
	// 					// @ts-expect-error
	// 					eq(policyVersions.pk, policy.activeVersion), // TODO: This should probs not be this. It should be the latest version???
	// 					// eq(policyVersions.policyPk, policy.id), // TODO
	// 				),
	// 			);

	// 		const newVersionId = createId();
	// 		const newVersion = await db.insert(policyVersions).values({
	// 			id: newVersionId,
	// 			policyPk: policy.pk,
	// 			data: activeVersion?.data || {},
	// 		});

	// 		await db
	// 			.update(policies)
	// 			.set({ activeVersion: parseInt(newVersion.insertId) })
	// 			.where(eq(policies.pk, policy.pk));

	// 		return newVersionId;
	// 	}),

	scope: tenantProcedure
		.input(z.object({ id: z.string() }))
		.query(({ ctx, input }) => {
			return getPolicy({ policyId: input.id, tenantPk: ctx.tenant.pk });
		}),

	members: tenantProcedure
		.input(z.object({ id: z.string() }))
		.query(async ({ ctx, input }) => {
			const policy = await getPolicy({
				policyId: input.id,
				tenantPk: ctx.tenant.pk,
			});
			if (!policy)
				throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found" });

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

	possibleMembers: tenantProcedure
		.input(z.object({ id: z.string() }))
		.query(({ ctx }) => {
			return union(
				db
					.select({
						name: users.name,
						id: users.id,
						pk: users.pk,
						variant: sql<PolicyAssignableVariant>`${PolicyAssignableVariants.user}`,
					})
					.from(users)
					.where(eq(users.tenantPk, ctx.tenant.pk)),
				db
					.select({
						name: devices.name,
						id: devices.id,
						pk: devices.pk,
						variant: sql<PolicyAssignableVariant>`${PolicyAssignableVariants.device}`,
					})
					.from(devices)
					.where(eq(devices.tenantPk, ctx.tenant.pk)),
				db
					.select({
						name: groups.name,
						id: groups.id,
						pk: groups.pk,
						variant: sql<PolicyAssignableVariant>`${PolicyAssignableVariants.group}`,
					})
					.from(groups)
					.where(eq(groups.tenantPk, ctx.tenant.pk)),
			).orderBy(() => sql`name ASC`);
		}),

	addMembers: tenantProcedure
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
			const policy = await getPolicy({
				policyId: input.id,
				tenantPk: ctx.tenant.pk,
			});
			if (!policy)
				throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found" });

			await db.insert(policyAssignables).values(
				input.members.map((member) => ({
					policyPk: policy.pk,
					pk: member.pk,
					variant: member.variant,
				})),
			);
		}),

	// duplicate: tenantProcedure
	//   .input(z.object({ policyId: z.string() }))
	//   .mutation(async ({ ctx, input }) => {
	//     throw new Error("TODO: Bring this back!");
	//     // const id = input.policyId;
	//     // let [row] = (
	//     //   await db.select().from(policies).where(eq(policies.id, id))
	//     // );
	//     // if (!row) throw new Error("todo: error handling");

	//     // // @ts-expect-error
	//     // delete row.id;
	//     // // @ts-expect-error
	//     // delete row.intuneId;
	//     // // @ts-expect-error
	//     // delete row.policyHash;

	//     // const result = await db.insert(policies).values(row);
	//     // return parseInt(result.insertId);
	//   }),

	// updateVersion: tenantProcedure
	//   .input(
	//     z.object({
	//       policyId: z.number(),
	//       versionId: z.number(),
	//       // TODO: Proper Zod type here
	//       data: z.any(),
	//     })
	//   )
	//   .mutation(async ({ ctx, input }) => {
	//     await db
	//       .update(policyVersions)
	//       .set({
	//         data: input.data,
	//       })
	//       .where(
	//         and(
	//           eq(policyVersions.pk, input.versionId),
	//           eq(policyVersions.policyPk, input.policyId)
	//         )
	//       );

	//     return {};
	//   }),

	create: tenantProcedure
		.input(z.object({ name: z.string().min(1).max(100) }))
		.mutation(({ ctx, input }) =>
			db.transaction(async (db) => {
				const policyId = createId();
				const policyInsert = await db.insert(policies).values({
					id: policyId,
					name: input.name,
					tenantPk: ctx.tenant.pk,
				});
				return policyId;
			}),
		),

	delete: tenantProcedure
		.input(z.object({ policyId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			await db
				.delete(policies)
				.where(
					and(
						eq(policies.id, input.policyId),
						eq(policies.tenantPk, ctx.tenant.pk),
					),
				);
		}),
});

function deepEqual(object1: Record<any, any>, object2: Record<any, any>) {
	const keys1 = Object.keys(object1);
	const keys2 = Object.keys(object2);

	if (keys1.length !== keys2.length) {
		return false;
	}

	for (const key of keys1) {
		const val1 = object1[key];
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
