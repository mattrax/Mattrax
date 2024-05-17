import { and, count, eq, or, sql, inArray } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { authedProcedure, createTRPCRouter, tenantProcedure } from "../helpers";
import { createAuditLog } from "~/api/auditLog";
import {
	GroupMemberVariants,
	PolicyAssignableVariants,
	applicationAssignments,
	applications,
	db,
	devices,
	groupMemberVariants,
	groupMembers,
	groups,
	policies,
	policyAssignments,
	users,
} from "~/db";
import { cache } from "@solidjs/router";
import { createTransaction } from "~/api/utils/transaction";

const getGroup = cache(
	(id: string) =>
		db.query.groups.findFirst({
			where: and(eq(groups.id, id)),
		}),
	"getGroup",
);

const groupProcedure = authedProcedure
	.input(z.object({ id: z.string() }))
	.use(async ({ next, input, ctx }) => {
		const group = await getGroup(input.id);
		if (!group) throw new TRPCError({ code: "NOT_FOUND", message: "group" });

		const tenant = await ctx.ensureTenantMember(group.tenantPk);

		return await next({ ctx: { group, tenant } });
	});

export const groupRouter = createTRPCRouter({
	list: tenantProcedure
		// .input(
		//   z.object({
		//     // TODO: Constrain offset and limit to specific max/min values
		//     offset: z.number().default(0),
		//     limit: z.number().default(50),
		//     // query: z.string().optional(),
		//   })
		// )
		.query(async ({ ctx, input }) => {
			// TODO: Full-text search???
			// TODO: Pagination abstraction
			// TODO: Can a cursor make this more efficent???
			// TODO: Switch to DB

			return await ctx.db
				.select({
					id: groups.id,
					name: groups.name,
					memberCount: count(groupMembers.groupPk),
				})
				.from(groups)
				.where(eq(groups.tenantPk, ctx.tenant.pk))
				.leftJoin(groupMembers, eq(groups.pk, groupMembers.groupPk))
				.groupBy(groups.pk);
		}),

	create: tenantProcedure
		.input(z.object({ name: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const id = createId();

			await createTransaction(async (db) => {
				await db.insert(groups).values({
					id,
					name: input.name,
					tenantPk: ctx.tenant.pk,
				});
				await createAuditLog("addGroup", { id, name: input.name });
			});

			return id;
		}),

	get: authedProcedure
		.input(z.object({ id: z.string() }))
		.query(async ({ ctx, input }) => {
			const group = await getGroup(input.id);
			if (!group) return null;

			await ctx.ensureTenantMember(group.tenantPk);

			return group;
		}),

	update: groupProcedure
		.input(z.object({ name: z.string().optional() }))
		.mutation(async ({ ctx, input }) => {
			await ctx.db
				.update(groups)
				.set({ ...(input.name && { name: input.name }) })
				.where(eq(groups.pk, ctx.group.pk));
		}),

	members: groupProcedure.query(async ({ ctx }) => {
		return await ctx.db
			.select({
				pk: groupMembers.pk,
				variant: groupMembers.variant,
				id: sql<string>`
					GROUP_CONCAT(CASE
						WHEN ${groupMembers.variant} = ${GroupMemberVariants.device} THEN ${devices.id}
						WHEN ${groupMembers.variant} = ${GroupMemberVariants.user} THEN ${users.id}
					END)
          `.as("id"),
				name: sql<string>`
					GROUP_CONCAT(CASE
						WHEN ${groupMembers.variant} = ${GroupMemberVariants.device} THEN ${devices.name}
						WHEN ${groupMembers.variant} = ${GroupMemberVariants.user} THEN ${users.name}
					END)
          `.as("name"),
			})
			.from(groupMembers)
			.where(eq(groupMembers.groupPk, ctx.group.pk))
			.leftJoin(
				devices,
				and(
					eq(devices.pk, groupMembers.pk),
					eq(groupMembers.variant, GroupMemberVariants.device),
				),
			)
			.leftJoin(
				users,
				and(
					eq(users.pk, groupMembers.pk),
					eq(groupMembers.variant, GroupMemberVariants.user),
				),
			)
			.groupBy(groupMembers.variant, groupMembers.pk);
	}),

	addMembers: groupProcedure
		.input(
			z.object({
				members: z.array(
					z.object({
						pk: z.number(),
						variant: z.enum(groupMemberVariants),
					}),
				),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await ctx.db
				.insert(groupMembers)
				.values(
					input.members.map((member) => ({
						groupPk: ctx.group.pk,
						pk: member.pk,
						variant: member.variant,
					})),
				)
				.onDuplicateKeyUpdate({
					set: { pk: sql`${groupMembers.pk}` },
				});
		}),
	removeMembers: groupProcedure
		.input(
			z.object({
				members: z.array(
					z.object({
						pk: z.number(),
						variant: z.enum(groupMemberVariants),
					}),
				),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await ctx.db
				.delete(groupMembers)
				.where(
					or(
						...input.members.map((member) =>
							and(
								eq(groupMembers.groupPk, ctx.group.pk),
								eq(groupMembers.pk, member.pk),
								eq(groupMembers.variant, member.variant),
							),
						),
					),
				);
		}),

	assignments: groupProcedure.query(async ({ ctx }) => {
		const { group } = ctx;

		const [p, a] = await Promise.all([
			ctx.db
				.select({ pk: policies.pk, id: policies.id, name: policies.name })
				.from(policyAssignments)
				.where(
					and(
						eq(policyAssignments.variant, "group"),
						eq(policyAssignments.pk, group.pk),
					),
				)
				.innerJoin(policies, eq(policyAssignments.policyPk, policies.pk))
				.then((rows) =>
					rows.map((row) => Object.assign(row, { variant: "policy" as const })),
				),
			ctx.db
				.select({
					pk: applications.pk,
					id: applications.id,
					name: applications.name,
				})
				.from(applicationAssignments)
				.where(
					and(
						eq(applicationAssignments.variant, "group"),
						eq(applicationAssignments.pk, group.pk),
					),
				)
				.innerJoin(
					applications,
					eq(applicationAssignments.applicationPk, applications.pk),
				)
				.then((rows) =>
					rows.map((row) =>
						Object.assign(row, { variant: "application" as const }),
					),
				),
			,
		]);

		return [...p, ...a];
	}),
	addAssignments: groupProcedure
		.input(
			z.object({
				assignments: z.array(
					z.object({
						pk: z.number(),
						variant: z.enum(["policy", "application"]),
					}),
				),
			}),
		)
		.mutation(async ({ ctx: { group, db }, input }) => {
			const pols: Array<number> = [],
				apps: Array<number> = [];

			input.assignments.forEach((a) => {
				if (a.variant === "policy") pols.push(a.pk);
				else apps.push(a.pk);
			});

			await db.transaction((db) => {
				const ops: Promise<any>[] = [];

				if (pols.length > 0)
					ops.push(
						db
							.insert(policyAssignments)
							.values(
								pols.map((pk) => ({
									pk: group.pk,
									policyPk: pk,
									variant: PolicyAssignableVariants.group,
								})),
							)
							.onDuplicateKeyUpdate({
								set: {
									pk: sql`${policyAssignments.pk}`,
								},
							}),
					);

				if (apps.length > 0)
					ops.push(
						db
							.insert(applicationAssignments)
							.values(
								apps.map((pk) => ({
									pk: group.pk,
									applicationPk: pk,
									variant: PolicyAssignableVariants.group,
								})),
							)
							.onDuplicateKeyUpdate({
								set: {
									pk: sql`${applicationAssignments.pk}`,
								},
							}),
					);

				return Promise.all(ops);
			});
		}),
	removeAssignments: groupProcedure
		.input(
			z.object({
				assignments: z.array(
					z.object({
						pk: z.number(),
						variant: z.enum(["policy", "application"]),
					}),
				),
			}),
		)
		.mutation(async ({ ctx: { group, db }, input }) => {
			const pols: Array<number> = [],
				apps: Array<number> = [];

			input.assignments.forEach((a) => {
				if (a.variant === "policy") pols.push(a.pk);
				else apps.push(a.pk);
			});

			await db.transaction((db) => {
				const ops: Promise<any>[] = [];

				if (pols.length > 0)
					ops.push(
						db
							.delete(policyAssignments)
							.where(
								and(
									eq(policyAssignments.pk, group.pk),
									eq(policyAssignments.variant, "group"),
									inArray(policyAssignments.policyPk, pols),
								),
							),
					);

				if (apps.length > 0)
					ops.push(
						db
							.delete(applicationAssignments)
							.where(
								and(
									eq(applicationAssignments.pk, group.pk),
									eq(applicationAssignments.variant, "group"),
									inArray(applicationAssignments.applicationPk, apps),
								),
							),
					);

				return Promise.all(ops);
			});
		}),
});
