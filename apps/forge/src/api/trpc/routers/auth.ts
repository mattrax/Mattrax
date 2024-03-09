import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { generateId } from "lucia";
import { alphabet, generateRandomString } from "oslo/crypto";
import { appendResponseHeader, setCookie } from "vinxi/server";
import { z } from "zod";

import { lucia } from "~/api/auth";
import { sendEmail } from "~/api/emails";
import { accountLoginCodes, accounts, db, tenantAccounts, tenants } from "~/db";
import { authedProcedure, createTRPCRouter, publicProcedure } from "../helpers";

type UserResult = {
	id: number;
	name: string;
	email: string;
	tenants: Awaited<ReturnType<typeof fetchTenants>>;
};

const fetchTenants = (accountPk: number) =>
	db
		.select({
			id: tenants.id,
			name: tenants.name,
			slug: tenants.slug,
			ownerId: accounts.id,
		})
		.from(tenants)
		.where(eq(tenantAccounts.accountPk, accountPk))
		.innerJoin(tenantAccounts, eq(tenants.pk, tenantAccounts.tenantPk))
		.innerJoin(accounts, eq(tenants.ownerPk, accounts.pk));

export const authRouter = createTRPCRouter({
	sendLoginCode: publicProcedure
		.input(z.object({ email: z.string().email() }))
		.mutation(async ({ input }) => {
			const name = input.email.split("@")[0] ?? "";
			const code = generateRandomString(8, alphabet("0-9"));

			const id = generateId(16);
			const result = await db
				.insert(accounts)
				.values({ name, email: input.email, id })
				.onDuplicateKeyUpdate({
					set: { email: input.email },
				});

			let accountPk = parseInt(result.insertId);
			let accountId = id;

			if (accountPk === 0) {
				const account = await db.query.accounts.findFirst({
					where: eq(accounts.email, input.email),
				});
				if (!account)
					throw new Error("Error getting account we just inserted!");
				accountPk = account.pk;
				accountId = account.id;
			}

			await db.insert(accountLoginCodes).values({ accountPk, code });

			await sendEmail({
				type: "loginCode",
				to: input.email,
				subject: "Mattrax Login Code",
				code,
			});

			return { accountId };
		}),

	verifyLoginCode: publicProcedure
		.input(z.object({ code: z.string() }))
		.mutation(async ({ input, ctx }) => {
			const code = await db.query.accountLoginCodes.findFirst({
				where: eq(accountLoginCodes.code, input.code),
			});

			if (!code)
				throw new TRPCError({ code: "NOT_FOUND", message: "Invalid code" });

			await db
				.delete(accountLoginCodes)
				.where(eq(accountLoginCodes.code, input.code));

			const account = await db.query.accounts.findFirst({
				where: eq(accounts.pk, code.accountPk),
			});

			if (!account)
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Account not found",
				});

			const session = await lucia.createSession(account.id, {});

			appendResponseHeader(
				ctx.event,
				"Set-Cookie",
				lucia.createSessionCookie(session.id).serialize(),
			);

			setCookie(ctx.event, "isLoggedIn", "true", {
				httpOnly: false,
			});

			return true;
		}),

	me: authedProcedure.query(async ({ ctx: { account } }) => {
		return {
			id: account.id,
			name: account.name,
			email: account.email,
			tenants: await fetchTenants(account.pk),
		};
	}),

	update: authedProcedure
		.input(
			z.object({
				name: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx: { account }, input }) => {
			// Skip DB if we have nothing to update
			if (input.name !== undefined) {
				await db
					.update(accounts)
					.set({ name: input.name })
					.where(eq(accounts.pk, account.pk));
			}

			return {
				id: account.pk,
				name: input.name || account.name,
				email: account.email,
				tenants: await fetchTenants(account.pk),
			} satisfies UserResult;
		}),

	logout: authedProcedure.mutation(async ({ ctx: { session } }) => {
		await lucia.invalidateSession(session.id);
	}),

	//   delete: authedProcedure.mutation(async ({ ctx }) => {
	//     const session = ctx.session.data;

	//     // TODO: Require the user to leave/delete all tenant's first

	//     await db.delete(accounts).where(eq(accounts.id, session.id));
	//     await ctx.session.clear();
	//     return {};
	//   }),
});
