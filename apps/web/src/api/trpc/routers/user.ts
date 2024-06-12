import { TRPCError } from "@trpc/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { sendEmail } from "~/api/emails";
import { withTenant } from "~/api/tenant";
import { omit } from "~/api/utils";
import {
	applicationAssignables,
	applications,
	devices,
	groupAssignables,
	identityProviders,
	policies,
	policyAssignments,
	users,
} from "~/db";
import { authedProcedure, createTRPCRouter, tenantProcedure } from "../helpers";

const userProcedure = authedProcedure
	.input(z.object({ id: z.string() }))
	.use(async ({ next, input, ctx }) => {
		const user = await ctx.db.query.users.findFirst({
			where: eq(users.id, input.id),
		});
		if (!user)
			throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });

		const tenant = await ctx.ensureTenantMember(user.tenantPk);

		return withTenant(tenant, () => next({ ctx: { user, tenant } }));
	});

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

			return await ctx.db
				.select({
					id: users.id,
					name: users.name,
					email: users.upn,
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
		.input(z.object({ userId: z.string() }))
		.query(async ({ ctx, input }) => {
			const [user] = await ctx.db
				.select({
					id: users.id,
					name: users.name,
					email: users.upn,
					providerResourceId: users.resourceId,
					provider: {
						variant: identityProviders.provider,
						remoteId: identityProviders.remoteId,
					},
					tenantPk: users.tenantPk,
				})
				.from(users)
				.where(eq(users.id, input.userId))
				.innerJoin(
					identityProviders,
					eq(users.providerPk, identityProviders.pk),
				);

			if (!user) return null;
			await ctx.ensureTenantMember(user.tenantPk);
			return omit(user, ["tenantPk"]);
		}),

	// delete: tenantProcedure
	// 	.input(z.object({ ids: z.array(z.string()) }))
	// 	.mutation(async ({ ctx, input }) => {
	// 		const u = await ctx.db
	// 			.select({ id: users.id, name: users.name, pk: users.pk })
	// 			.from(users)
	// 			.where(
	// 				and(eq(users.tenantPk, ctx.tenant.pk), inArray(users.id, input.ids)),
	// 			);

	// 		const pks = u.map(({ pk }) => pk);

	// 		await ctx.db.transaction((db) => {
	// 			return Promise.all([
	// 				db
	// 					.delete(groupAssignables)
	// 					.where(
	// 						and(
	// 							eq(groupAssignables.variant, "user"),
	// 							inArray(groupAssignables.pk, pks),
	// 						),
	// 					),
	// 				db
	// 					.delete(policyAssignments)
	// 					.where(
	// 						and(
	// 							eq(policyAssignments.variant, "user"),
	// 							inArray(policyAssignments.pk, pks),
	// 						),
	// 					),
	// 				db
	// 					.delete(users)
	// 					.where(inArray(users.pk, pks)),
	// 				// ...u.map((u) => createAuditLog("removeUser", { name: u.name })),
	// 			]);
	// 		});
	// 	}),

	devices: authedProcedure
		.input(z.object({ id: z.string() }))
		.query(async ({ ctx, input }) => {
			const [user] = await ctx.db
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

			return await ctx.db
				.select({
					id: devices.id,
					name: devices.name,
				})
				.from(devices)
				.where(eq(devices.owner, user.pk));
		}),

	invite: userProcedure
		.input(z.object({ message: z.string().optional() }))
		.mutation(async ({ ctx, input }) => {
			const { user, tenant } = ctx;

			// TODO: "On behalf of {tenant_name}" in the content + render `input.message` inside the email.
			await sendEmail({
				type: "userEnrollmentInvite",
				to: user.upn,
				subject: "Enroll your device to Mattrax",
				tenantName: tenant.name,
			});
		}),

	assignments: userProcedure.query(async ({ ctx }) => {
		const { user } = ctx;

		const [p, a] = await Promise.all([
			ctx.db
				.select({ pk: policies.pk, id: policies.id, name: policies.name })
				.from(policyAssignments)
				.where(
					and(
						eq(policyAssignments.variant, "user"),
						eq(policyAssignments.pk, user.pk),
					),
				)
				.innerJoin(policies, eq(policyAssignments.policyPk, policies.pk)),
			ctx.db
				.select({
					pk: applications.pk,
					id: applications.id,
					name: applications.name,
				})
				.from(applicationAssignables)
				.where(
					and(
						eq(applicationAssignables.variant, "user"),
						eq(applicationAssignables.pk, user.pk),
					),
				)
				.innerJoin(
					applications,
					eq(applicationAssignables.applicationPk, applications.pk),
				),
		]);

		return { policies: p, apps: a };
	}),
	addAssignments: userProcedure
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
		.mutation(async ({ ctx: { user, db }, input }) => {
			const pols: Array<number> = [];
			const apps: Array<number> = [];

			for (const a of input.assignments) {
				if (a.variant === "policy") pols.push(a.pk);
				else apps.push(a.pk);
			}

			await db.transaction((db) =>
				Promise.all(
					[
						pols.length > 0 &&
							db
								.insert(policyAssignments)
								.values(
									pols.map((pk) => ({
										pk: user.pk,
										policyPk: pk,
										variant: sql`'user'`,
									})),
								)
								.onDuplicateKeyUpdate({
									set: { pk: sql`${policyAssignments.pk}` },
								}),
						apps.length > 0 &&
							db
								.insert(applicationAssignables)
								.values(
									apps.map((pk) => ({
										pk: user.pk,
										applicationPk: pk,
										variant: sql`'user'`,
									})),
								)
								.onDuplicateKeyUpdate({
									set: { pk: sql`${applicationAssignables.pk}` },
								}),
					].filter(Boolean),
				),
			);
		}),
});
