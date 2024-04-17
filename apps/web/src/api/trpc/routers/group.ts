import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import { union } from "drizzle-orm/mysql-core";

import {
	GroupAssignmentVariants,
	GroupMemberVariants,
	applications,
	db,
	devices,
	groupAssignmentVariants,
	groupAssignments,
	groupMemberVariants,
	groupMembers,
	groups,
	policies,
	users,
} from "~/db";
import { authedProcedure, createTRPCRouter, tenantProcedure } from "../helpers";
import { withAuditLog } from "~/api/auditLog";

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

			return await db
				.select({
					id: groups.id,
					name: groups.name,
					memberCount: sql`count(${groupMembers.groupPk})`,
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

			await withAuditLog(
				"addGroup",
				{ id, name: input.name },
				[ctx.tenant.pk, ctx.account.pk],
				async () => {
					await db.insert(groups).values({
						id,
						name: input.name,
						tenantPk: ctx.tenant.pk,
					});
				},
			);

			return id;
		}),

	get: authedProcedure
		.input(z.object({ id: z.string() }))
		.query(async ({ ctx, input }) => {
			const group = await db.query.groups.findFirst({
				where: eq(groups.id, input.id),
			});
			if (!group) return null;

			await ctx.ensureTenantMember(group.tenantPk);

			return group;
		}),

	update: authedProcedure
		.input(
			z.object({
				id: z.string(),
				name: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const group = await db.query.groups.findFirst({
				where: eq(groups.id, input.id),
			});
			if (!group) throw new TRPCError({ code: "NOT_FOUND", message: "group" });

			await ctx.ensureTenantMember(group.tenantPk);

			await db
				.update(groups)
				.set({ ...(input.name && { name: input.name }) })
				.where(eq(groups.id, input.id));
		}),

	members: authedProcedure
		.input(z.object({ id: z.string() }))
		.query(async ({ ctx, input }) => {
			const group = await db.query.groups.findFirst({
				where: eq(groups.id, input.id),
			});
			if (!group) throw new TRPCError({ code: "NOT_FOUND", message: "group" });

			await ctx.ensureTenantMember(group.tenantPk);

			return await db
				.select({
					pk: groupMembers.pk,
					variant: groupMembers.variant,
					name: sql<string>`
          	GROUP_CONCAT(
           		CASE
           			WHEN ${groupMembers.variant} = ${GroupMemberVariants.device} THEN ${devices.name}
             		WHEN ${groupMembers.variant} = ${GroupMemberVariants.user} THEN ${users.name}
             	END
           	)
          `.as("name"),
				})
				.from(groupMembers)
				.where(eq(groupMembers.groupPk, group.pk))
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

	addMembers: authedProcedure
		.input(
			z.object({
				id: z.string(),
				members: z.array(
					z.object({
						pk: z.number(),
						variant: z.enum(groupMemberVariants),
					}),
				),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const group = await db.query.groups.findFirst({
				where: and(eq(groups.id, input.id)),
			});
			if (!group)
				throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });

			await ctx.ensureTenantMember(group.tenantPk);

			await db
				.insert(groupMembers)
				.values(
					input.members.map((member) => ({
						groupPk: group.pk,
						pk: member.pk,
						variant: member.variant,
					})),
				)
				.onDuplicateKeyUpdate({
					set: { groupPk: sql`${groupMembers.groupPk}` },
				});
		}),

	assignments: authedProcedure
		.input(z.object({ id: z.string() }))
		.query(async ({ ctx, input }) => {
			const group = await db.query.groups.findFirst({
				where: eq(groups.id, input.id),
			});
			if (!group) throw new TRPCError({ code: "NOT_FOUND", message: "group" });

			await ctx.ensureTenantMember(group.tenantPk);

			return await db
				.select({
					pk: groupAssignments.pk,
					variant: groupAssignments.variant,
					name: sql<string>`
          	GROUP_CONCAT(
           		CASE
           			WHEN ${groupAssignments.variant} = ${GroupAssignmentVariants.policy} THEN ${policies.name}
             		WHEN ${groupAssignments.variant} = ${GroupAssignmentVariants.app} THEN ${applications.name}
             	END
           	)
          `.as("name"),
				})
				.from(groupAssignments)
				.where(eq(groupAssignments.groupPk, group.pk))
				.leftJoin(
					policies,
					and(
						eq(policies.pk, groupAssignments.pk),
						eq(groupAssignments.variant, GroupAssignmentVariants.policy),
					),
				)
				.leftJoin(
					applications,
					and(
						eq(applications.pk, groupAssignments.pk),
						eq(groupAssignments.variant, GroupAssignmentVariants.app),
					),
				)
				.groupBy(groupAssignments.variant, groupAssignments.pk);
		}),
	addAssignments: authedProcedure
		.input(
			z.object({
				id: z.string(),
				assignments: z.array(
					z.object({
						pk: z.number(),
						variant: z.enum(groupAssignmentVariants),
					}),
				),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const group = await db.query.groups.findFirst({
				where: and(eq(groups.id, input.id)),
			});
			if (!group)
				throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });

			await ctx.ensureTenantMember(group.tenantPk);

			await db
				.insert(groupAssignments)
				.values(
					input.assignments.map((assignment) => ({
						groupPk: group.pk,
						pk: assignment.pk,
						variant: assignment.variant,
					})),
				)
				.onDuplicateKeyUpdate({
					set: { groupPk: sql`${groupAssignments.groupPk}` },
				});
		}),
});
