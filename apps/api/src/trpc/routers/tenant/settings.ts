import { waitUntil } from "@mattrax/trpc-server-function/server";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { sendEmail } from "~/aws/emails";
import { accounts, tenantInvites, tenantMembers, tenants } from "~/db";
import { env } from "~/env";
import {
	createTRPCRouter,
	publicProcedure,
	tenantProcedure,
} from "../../helpers";

export const settingsRouter = createTRPCRouter({
	get: tenantProcedure.query(async ({ ctx }) => {
		const [[tenant], members, invites] = await Promise.all([
			ctx.db
				.select({
					billingEmail: tenants.billingEmail,
				})
				.from(tenants)
				.where(eq(tenants.pk, ctx.tenant.pk)),
			ctx.db
				.select({
					id: accounts.id,
					name: accounts.name,
					email: accounts.email,
				})
				.from(accounts)
				.leftJoin(tenantMembers, eq(tenantMembers.tenantPk, ctx.tenant.pk))
				.where(eq(tenantMembers.tenantPk, ctx.tenant.pk)),
			ctx.db
				.select({
					email: tenantInvites.email,
				})
				.from(tenantInvites)
				.where(eq(tenantInvites.tenantPk, ctx.tenant.pk)),
		]);
		if (!tenant) throw new TRPCError({ code: "FORBIDDEN", message: "tenant" });

		return {
			billingEmail: tenant.billingEmail,
			members,
			invites,
		};
	}),

	inviteAdmin: tenantProcedure
		.input(z.object({ email: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const [tenant] = await ctx.db
				.select({ name: tenants.name })
				.from(tenants)
				.where(eq(tenants.pk, ctx.tenant.pk));
			if (!tenant)
				throw new TRPCError({ code: "NOT_FOUND", message: "tenant" });

			const alreadyAMember = await ctx.db
				.select({ pk: accounts.pk })
				.from(accounts)
				.innerJoin(
					tenantMembers,
					and(
						eq(tenantMembers.accountPk, accounts.pk),
						eq(tenantMembers.tenantPk, ctx.tenant.pk),
					),
				)
				.where(eq(accounts.email, input.email));
			if (alreadyAMember) return;

			const code = crypto.randomUUID();
			try {
				await ctx.db.insert(tenantInvites).values({
					tenantPk: ctx.tenant.pk,
					email: "oscar@otbeaumont.me",
					code,
				});
			} catch (err) {
				// Invite already created in this tenant for this email
				if ((err as { errno: number }).errno === 1062) return;
				throw err;
			}

			waitUntil(
				sendEmail({
					to: input.email,
					subject: "Invitation to Mattrax Tenant",
					type: "tenantAdminInvite",
					invitedByEmail: ctx.account.email,
					tenantName: tenant.name,
					inviteLink: `${env.VITE_PROD_ORIGIN}/invite/organisation/${code}`,
				}),
			);
		}),

	acceptInvite: publicProcedure
		.input(z.object({ code: z.string(), email: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const [invite] = await ctx.db
				.select({
					tenantPk: tenantInvites.tenantPk,
				})
				.from(tenantInvites)
				.where(
					and(
						eq(tenantInvites.email, input.email),
						eq(tenantInvites.code, input.code),
					),
				);
			if (!invite) return null;

			await ctx.db
				.delete(tenantInvites)
				.where(
					and(
						eq(tenantInvites.email, input.email),
						eq(tenantInvites.code, input.code),
					),
				);

			throw new Error("Not implemented");

			// 			const name = invite.email.split("@")[0] ?? "";
			// 			const account = await ctx.db.transaction(async (db) => {
			// 				await db
			// 					.insert(accounts)
			// 					.values({ name, email: invite.email, id: generateId(16) })
			// 					.onDuplicateKeyUpdate({
			// 						set: { pk: sql`${accounts.pk}` },
			// 					});
			// 				const [account] = await db
			// 					.select({ pk: accounts.pk, id: accounts.id })
			// 					.from(accounts);
			// 				await db
			// 					.insert(organisationMembers)
			// 					.values({ orgPk: invite.orgPk, accountPk: account!.pk })
			// 					.onDuplicateKeyUpdate({
			// 						set: { accountPk: sql`${organisationMembers.accountPk}` },
			// 					});
			// 				await db
			// 					.delete(organisationInvites)
			// 					.where(eq(organisationInvites.code, input.code));
			// 				return account!;
			// 			});
			// 			await handleLoginSuccess(account.id);
			// 			flushResponse();
			// 			const org = await ctx.db.query.organisations.findFirst({
			// 				where: eq(organisations.pk, invite.orgPk),
			// 			});
			// 			if (!org)
			// 				throw new TRPCError({
			// 					code: "NOT_FOUND",
			// 					message: "tenant",
			// 				});
			// 			return { slug: org.slug, name: org.name };
		}),

	// 	remove: orgProcedure
	// 		.input(z.object({ adminId: z.string() }))
	// 		.mutation(async ({ ctx, input }) => {
	// 			const account = await ctx.db.query.accounts.findFirst({
	// 				where: eq(accounts.id, input.adminId),
	// 			});
	// 			if (!account)
	// 				throw new TRPCError({
	// 					code: "NOT_FOUND",
	// 					message: "account",
	// 				});
	// 			if (account.pk === ctx.org.ownerPk)
	// 				throw new TRPCError({
	// 					code: "PRECONDITION_FAILED",
	// 					message: "Cannot remove tenant owner",
	// 				});
	// 			await ctx.db
	// 				.delete(organisationMembers)
	// 				.where(
	// 					and(
	// 						eq(organisationMembers.accountPk, account.pk),
	// 						eq(organisationMembers.orgPk, ctx.org.pk),
	// 					),
	// 				);
	// 		}),

	// 	invites: orgProcedure.query(async ({ ctx }) => {
	// 		return await ctx.db.query.organisationInvites.findMany({
	// 			where: eq(organisationInvites.orgPk, ctx.org.pk),
	// 		});
	// 	}),

	// 	removeInvite: orgProcedure
	// 		.input(z.object({ email: z.string() }))
	// 		.mutation(async ({ ctx, input }) => {
	// 			await ctx.db
	// 				.delete(organisationInvites)
	// 				.where(
	// 					and(
	// 						eq(organisationInvites.orgPk, ctx.org.pk),
	// 						eq(organisationInvites.email, input.email),
	// 					),
	// 				);
	// 		}),
});
