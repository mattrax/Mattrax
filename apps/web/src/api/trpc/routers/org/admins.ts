import { flushResponse } from "@mattrax/trpc-server-function/server";
import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { generateId } from "lucia";
import { appendResponseHeader, setCookie } from "vinxi/server";
import { z } from "zod";

import { lucia, setIsLoggedInCookie } from "~/api/auth";
import { sendEmail } from "~/api/emails";
import {
	accounts,
	organisationInvites,
	organisationMembers,
	organisations,
} from "~/db";
import { env } from "~/env";
import { createTRPCRouter, orgProcedure, publicProcedure } from "../../helpers";
import { handleLoginSuccess } from "../auth";

export const adminsRouter = createTRPCRouter({
	list: orgProcedure.query(async ({ ctx }) => {
		const [ownerId, rows] = await Promise.allSettled([
			ctx.db
				.select({ ownerPk: organisations.ownerPk })
				.from(organisations)
				.where(eq(organisations.pk, ctx.org.pk))
				.then((v) => v?.[0]?.ownerPk),
			ctx.db
				.select({
					pk: accounts.pk,
					id: accounts.id,
					name: accounts.name,
					email: accounts.email,
				})
				.from(accounts)
				.leftJoin(
					organisationMembers,
					eq(organisationMembers.accountPk, accounts.pk),
				)
				.where(eq(organisationMembers.orgPk, ctx.org.pk)),
		]);

		// This is required. If the owner is not found, we gracefully continue.
		if (rows.status === "rejected") throw rows.reason;

		return rows.value.map(({ pk, ...row }) => ({
			...row,
			isOwner: ownerId.status === "fulfilled" ? pk === ownerId.value : false,
		}));
	}),

	sendInvite: orgProcedure
		.input(z.object({ email: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const org = await ctx.db.query.organisations.findFirst({
				columns: { name: true },
				where: eq(organisations.pk, ctx.org.pk),
			});
			if (!org)
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "tenant",
				});

			const code = crypto.randomUUID();

			// try {
			await ctx.db.insert(organisationInvites).values({
				orgPk: ctx.org.pk,
				email: input.email,
				code,
			});
			// } catch {
			//   throw new TRPCError({
			//     code: "PRECONDITION_FAILED",
			//     message: "Invite already sent",
			//   });
			// }

			await sendEmail({
				to: input.email,
				subject: "Invitation to Mattrax Tenant",
				type: "tenantAdminInvite",
				invitedByEmail: ctx.account.email,
				tenantName: org.name,
				inviteLink: `${env.VITE_PROD_ORIGIN}/invite/organisation/${code}`,
			});
		}),

	acceptInvite: publicProcedure
		.input(z.object({ code: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const invite = await ctx.db.query.organisationInvites.findFirst({
				where: eq(organisationInvites.code, input.code),
			});
			if (!invite) {
				flushResponse();
				return null;
			}

			const name = invite.email.split("@")[0] ?? "";

			const account = await ctx.db.transaction(async (db) => {
				await db
					.insert(accounts)
					.values({ name, email: invite.email, id: generateId(16) })
					.onDuplicateKeyUpdate({
						set: { pk: sql`${accounts.pk}` },
					});

				const [account] = await db
					.select({ pk: accounts.pk, id: accounts.id })
					.from(accounts);

				await db
					.insert(organisationMembers)
					.values({ orgPk: invite.orgPk, accountPk: account!.pk })
					.onDuplicateKeyUpdate({
						set: { accountPk: sql`${organisationMembers.accountPk}` },
					});

				await db
					.delete(organisationInvites)
					.where(eq(organisationInvites.code, input.code));

				return account!;
			});

			await handleLoginSuccess(account.id);

			flushResponse();

			const org = await ctx.db.query.organisations.findFirst({
				where: eq(organisations.pk, invite.orgPk),
			});
			if (!org)
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "tenant",
				});

			return { slug: org.slug, name: org.name };
		}),

	remove: orgProcedure
		.input(z.object({ adminId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const account = await ctx.db.query.accounts.findFirst({
				where: eq(accounts.id, input.adminId),
			});
			if (!account)
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "account",
				});

			if (account.pk === ctx.org.ownerPk)
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "Cannot remove tenant owner",
				});

			await ctx.db
				.delete(organisationMembers)
				.where(
					and(
						eq(organisationMembers.accountPk, account.pk),
						eq(organisationMembers.orgPk, ctx.org.pk),
					),
				);
		}),

	invites: orgProcedure.query(async ({ ctx }) => {
		return await ctx.db.query.organisationInvites.findMany({
			where: eq(organisationInvites.orgPk, ctx.org.pk),
		});
	}),

	removeInvite: orgProcedure
		.input(z.object({ email: z.string() }))
		.mutation(async ({ ctx, input }) => {
			await ctx.db
				.delete(organisationInvites)
				.where(
					and(
						eq(organisationInvites.orgPk, ctx.org.pk),
						eq(organisationInvites.email, input.email),
					),
				);
		}),
});
