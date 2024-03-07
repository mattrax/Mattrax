import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { sendEmail } from "~/api/emails";
import { db, identityProviders, tenantAccounts, tenants, users } from "~/db";
import { authedProcedure, createTRPCRouter, tenantProcedure } from "../helpers";
import { omit } from "~/api/utils";

export const userRouter = createTRPCRouter({
	// TODO: Copy after `devicesRouter`.

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
					id: users.id,
					name: users.name,
					email: users.email,
					resourceId: users.providerResourceId,
					provider: {
						variant: identityProviders.variant,
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
					providerResourceId: users.providerResourceId,
					provider: {
						variant: identityProviders.variant,
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
			await ctx.ensureTenantAccount(user.tenantPk);
			return omit(user, ["tenantPk"]);
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

			const tenant = await ctx.ensureTenantAccount(user.tenantPk)

			// TODO: "On behalf of {tenant_name}" in the content + render `input.message` inside the email.
			await sendEmail({
				type: "userEnrollmentInvite",
				to: user.email,
				subject: "Enroll your device to Mattrax",
				tenantName: tenant.name,
			});
		}),
});
