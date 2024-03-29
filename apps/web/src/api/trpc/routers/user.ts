import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { sendEmail } from "~/api/emails";
import {
	db,
	devices,
	identityProviders,
	policyAssignableVariants,
	users,
} from "~/db";
import { authedProcedure, createTRPCRouter, tenantProcedure } from "../helpers";
import { omit } from "~/api/utils";

export const userRouter = createTRPCRouter({
	// TODO: Pagination
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

			return await db
				.select({
					id: users.id,
					name: users.name,
					email: users.email,
					resourceId: users.resourceId,
					provider: {
						variant: identityProviders.provider,
						remoteId: identityProviders.remoteId,
					},
				})
				.from(users)
				.where(eq(users.tenantPk, ctx.tenant.pk))
				.innerJoin(
					identityProviders,
					eq(users.providerPk, identityProviders.pk),
				);
		}),

	get: authedProcedure
		.input(z.object({ id: z.string() }))
		.query(async ({ ctx, input }) => {
			const [user] = await db
				.select({
					id: users.id,
					name: users.name,
					email: users.email,
					providerResourceId: users.resourceId,
					provider: {
						variant: identityProviders.provider,
						remoteId: identityProviders.remoteId,
					},
					tenantPk: users.tenantPk,
				})
				.from(users)
				.where(eq(users.id, input.id))
				.innerJoin(
					identityProviders,
					eq(users.providerPk, identityProviders.pk),
				);

			if (!user) return null;
			await ctx.ensureTenantMember(user.tenantPk);
			return omit(user, ["tenantPk"]);
		}),

	getDevices: authedProcedure
		.input(z.object({ id: z.string() }))
		.query(async ({ ctx, input }) => {
			const [user] = await db
				.select({
					pk: users.pk,
					tenantPk: users.tenantPk,
				})
				.from(users)
				.where(eq(users.id, input.id))
				.innerJoin(
					identityProviders,
					eq(users.providerPk, identityProviders.pk),
				);

			if (!user) return null;
			await ctx.ensureTenantMember(user.tenantPk);

			return await db
				.select({
					id: devices.id,
					name: devices.name,
				})
				.from(devices)
				.where(eq(devices.owner, user.pk));
		}),

	invite: authedProcedure
		.input(z.object({ id: z.string(), message: z.string().optional() }))
		.mutation(async ({ ctx, input }) => {
			const user = await db.query.users.findFirst({
				where: eq(users.id, input.id),
			});
			if (!user)
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "user",
				});

			const tenant = await ctx.ensureTenantMember(user.tenantPk);

			// TODO: "On behalf of {tenant_name}" in the content + render `input.message` inside the email.
			await sendEmail({
				type: "userEnrollmentInvite",
				to: user.email,
				subject: "Enroll your device to Mattrax",
				tenantName: tenant.name,
			});
		}),

	members: authedProcedure
		.input(z.object({ id: z.string() }))
		.query(async ({ ctx, input }) => {
			const policy = await db.query.users.findFirst({
				where: eq(users.id, input.id),
			});
			if (!policy)
				throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });

			await ctx.ensureTenantMember(policy.tenantPk);

			return [] as any[]; // TODO

			// 	return await db
			// 		.select({
			// 			pk: policyAssignables.pk,
			// 			variant: policyAssignables.variant,
			// 			name: sql<PolicyAssignableVariant>`
			//     GROUP_CONCAT(
			//         CASE
			//             WHEN ${policyAssignables.variant} = ${PolicyAssignableVariants.device} THEN ${devices.name}
			//             WHEN ${policyAssignables.variant} = ${PolicyAssignableVariants.user} THEN ${users.name}
			//             WHEN ${policyAssignables.variant} = ${PolicyAssignableVariants.group} THEN ${groups.name}
			//         END
			//     )
			//   `.as("name"),
			// 		})
			// 		.from(policyAssignables)
			// 		.where(eq(policyAssignables.policyPk, policy.pk))
			// 		.leftJoin(
			// 			devices,
			// 			and(
			// 				eq(devices.pk, policyAssignables.pk),
			// 				eq(policyAssignables.variant, PolicyAssignableVariants.device),
			// 			),
			// 		)
			// 		.leftJoin(
			// 			users,
			// 			and(
			// 				eq(users.pk, policyAssignables.pk),
			// 				eq(policyAssignables.variant, PolicyAssignableVariants.user),
			// 			),
			// 		)
			// 		.leftJoin(
			// 			groups,
			// 			and(
			// 				eq(groups.pk, policyAssignables.pk),
			// 				eq(policyAssignables.variant, PolicyAssignableVariants.group),
			// 			),
			// 		)
			// 		.groupBy(policyAssignables.variant, policyAssignables.pk);
		}),

	addMembers: authedProcedure
		.input(
			z.object({
				id: z.string(),
				members: z.array(
					z.object({
						pk: z.number(),
						variant: z.enum(policyAssignableVariants), // TODO
					}),
				),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const policy = await db.query.users.findFirst({
				where: eq(users.id, input.id),
			});
			if (!policy)
				throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });

			await ctx.ensureTenantMember(policy.tenantPk);

			// TODO
			// await db.insert(policyAssignables).values(
			// 	input.members.map((member) => ({
			// 		policyPk: policy.pk,
			// 		pk: member.pk,
			// 		variant: member.variant,
			// 	})),
			// );
		}),
});
