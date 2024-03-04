import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { appendResponseHeader, setCookie } from "h3";
import { generateId } from "lucia";
import { z } from "zod";

import { lucia } from "~/api/auth";
import { sendEmail } from "~/api/emails";
import {
	accounts,
	db,
	tenantAccountInvites,
	tenantAccounts,
	tenants,
} from "~/db";
import { env } from "~/env";
import {
	createTRPCRouter,
	publicProcedure,
	tenantProcedure,
} from "../../helpers";

export const adminsRouter = createTRPCRouter({
	list: tenantProcedure.query(async ({ ctx }) => {
		const [ownerId, rows] = await Promise.allSettled([
			db
				.select({ ownerId: accounts.id })
				.from(tenants)
				.where(eq(tenants.pk, ctx.tenant.pk))
				.innerJoin(accounts, eq(tenants.ownerPk, accounts.pk))
				.then((v) => v?.[0]?.ownerId),
			db
				.select({
					id: accounts.id,
					name: accounts.name,
					email: accounts.email,
				})
				.from(accounts)
				.leftJoin(tenantAccounts, eq(tenantAccounts.accountPk, accounts.pk))
				.where(eq(tenantAccounts.tenantPk, ctx.tenant.pk)),
		]);
		// This is required. If the owner is not found, we gracefully continue.
		if (rows.status === "rejected") throw rows.reason;

		return rows.value.map((row) => ({
			...row,
			isOwner:
				ownerId.status === "fulfilled" ? row.id === ownerId.value : false,
		}));
	}),
	sendInvite: tenantProcedure
		.input(z.object({ email: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const tenant = await db.query.tenants.findFirst({
				columns: { name: true },
				where: eq(tenants.pk, ctx.tenant.pk),
			});
			if (!tenant)
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "tenant",
				});

			const code = crypto.randomUUID();

			// try {
			await db.insert(tenantAccountInvites).values({
				tenantPk: ctx.tenant.pk,
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
				tenantName: tenant.name,
				inviteLink: `${env.PROD_URL}/invite/tenant/${code}`,
			});
		}),
	acceptInvite: publicProcedure
		.input(z.object({ code: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const invite = await db.query.tenantAccountInvites.findFirst({
				where: eq(tenantAccountInvites.code, input.code),
			});
			if (!invite)
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Invalid invite code",
				});

			const name = invite.email.split("@")[0] ?? "";
			const id = generateId(16);
			const result = await db
				.insert(accounts)
				.values({ name, email: invite.email, id })
				.onDuplicateKeyUpdate({
					set: { email: invite.email },
				});

			let accountPk = parseInt(result.insertId);
			let accountId = id;

			if (accountPk === 0) {
				const account = await db.query.accounts.findFirst({
					where: eq(accounts.email, invite.email),
				});
				if (!account)
					throw new Error("Error getting account we just inserted!");
				accountPk = account.pk;
				accountId = account.id;
			}

			await db.transaction(async (db) => {
				await db.insert(tenantAccounts).values({
					tenantPk: invite.tenantPk,
					accountPk: accountPk,
				});

				await db
					.delete(tenantAccountInvites)
					.where(eq(tenantAccountInvites.code, input.code));
			});

			const session = await lucia.createSession(accountId, {});
			appendResponseHeader(
				ctx.event,
				"Set-Cookie",
				lucia.createSessionCookie(session.id).serialize(),
			);
			setCookie(ctx.event, "isLoggedIn", "true", {
				httpOnly: false,
			});

			const tenant = await db.query.tenants.findFirst({
				where: eq(tenants.pk, invite.tenantPk),
			});
			if (!tenant)
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "tenant",
				});

			return { id: tenant.id, name: tenant.name };
		}),
	remove: tenantProcedure
		.input(z.object({ adminId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const account = await db.query.accounts.findFirst({
				where: eq(accounts.id, input.adminId),
			});
			if (!account)
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "account",
				});

			if (account.pk === ctx.tenant.ownerPk)
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "Cannot remove tenant owner",
				});

			await db
				.delete(tenantAccounts)
				.where(
					and(
						eq(tenantAccounts.accountPk, account.pk),
						eq(tenantAccounts.tenantPk, ctx.tenant.pk),
					),
				);
		}),
	invites: tenantProcedure.query(async ({ ctx }) => {
		return await db.query.tenantAccountInvites.findMany({
			where: eq(tenantAccountInvites.tenantPk, ctx.tenant.pk),
		});
	}),
	removeInvite: tenantProcedure
		.input(z.object({ email: z.string() }))
		.mutation(async ({ ctx, input }) => {
			await db
				.delete(tenantAccountInvites)
				.where(
					and(
						eq(tenantAccountInvites.tenantPk, ctx.tenant.pk),
						eq(tenantAccountInvites.email, input.email),
					),
				);
		}),
});
